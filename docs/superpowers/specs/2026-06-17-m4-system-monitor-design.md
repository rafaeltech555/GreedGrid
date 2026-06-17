# GreedGrid M4 — System Monitor Panel 設計

_Date: 2026-06-17_

---

## Overview / Goals

**M4** 交付 **System Monitor panel**（`PanelKind` = `"sysmon"`，自 M2 起已保留於型別聯集中）：在 grid cell 內呈現一組緊湊、常駐的主機資源指標讀值。這是第一個**唯讀、輪詢式** panel——用於驗證 panel 架構在無串流/生命週期重量的指標資料來源上同樣運作正常（相對於 Terminal M3）。

**範圍（僅核心功能）：**
- 整體 CPU 使用率（%）
- 記憶體已用 / 總量
- Swap 已用 / 總量
- Load average（1 / 5 / 15 分鐘）
- Uptime

**呈現方式：** 針對 **CPU%** 與 **Mem%** 顯示近期歷史的滾動式 **SVG sparkline**，搭配各指標的當前數值與長條，以及一列 swap / load / uptime 的數字資訊。預設更新間隔為 **2 秒**（可設定）。

**架構決策（已鎖定）：Approach A — 共享後端 sampler + 前端輪詢。** 一條背景 sampler 執行緒持有單一 `sysinfo::System`，以固定節拍更新資料至 `Mutex` 後的 snapshot。前端 panel 以輪詢方式呼叫輕量 `sysmon_sample` 指令，僅*讀取*最新 snapshot。此設計確保 CPU% 差分一致（固定 sampler 節拍，不受輪詢時機影響），使後端**無論 panel 數量均為 O(1)**，且**不需要每實例後端狀態、不需要 Channel、不需要 attach/detach 生命週期**。

**Non-goals（YAGNI — 明確排除）：** 逐核心 CPU、網路 / 磁碟 I/O 速率、行程清單、溫度 / 風扇 / 電池、GPU、跨應用程式執行的歷史持久化、警報閾值、native-webview Web 備援（無關，仍延後處理）。以上項目均不在本設計範圍；日後新增任何項目屬新里程碑。

---

## §1 資料模型 (Data Model)

跨越 IPC 邊界的是一個可序列化的 snapshot。後端（`serde::Serialize`）與前端（TS interface）的欄位互相對應。

```rust
// src-tauri/src/sysmon.rs
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysSnapshot {
    pub cpu: f32,          // global CPU usage, 0.0–100.0
    pub mem_used: u64,     // bytes
    pub mem_total: u64,    // bytes
    pub swap_used: u64,    // bytes
    pub swap_total: u64,   // bytes
    pub load: [f64; 3],    // 1 / 5 / 15 min load average
    pub uptime_secs: u64,
}
```

```ts
// src/panels/sysmon/types.ts
export interface SysSnapshot {
  cpu: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  load: [number, number, number];
  uptimeSecs: number;
}
```

`#[serde(rename_all = "camelCase")]` 使 `mem_used` 抵達前端時已轉為 `memUsed`，與 TS 型別完全對應，無須手動映射。

每個 panel 實例的 `PanelConfig.config` 僅保存更新間隔：

```ts
// src/panels/sysmon/types.ts
export interface SysmonConfig {
  refreshSecs?: number; // default 2; minimum enforced at 1
}
export function sysmonReady(_config: Record<string, unknown>): boolean {
  return true; // opens with defaults; placement never forces the config modal
}
```

---

## §2 後端 — 共享 Sampler (Backend — Shared Sampler)

新增檔案 `src-tauri/src/sysmon.rs`。

### Sampler

```rust
pub struct Sampler(pub Arc<Mutex<SysSnapshot>>);
```

- 建構子 `Sampler::start()` 的行為：
  1. 建立一個 `sysinfo::System`，執行初始 `refresh_cpu_usage()` + `refresh_memory()`，休眠 `MINIMUM_CPU_UPDATE_INTERVAL`（約 200 ms），再次更新，使第一筆 CPU% 具有實際意義，並寫入初始 snapshot。
  2. 產生一條分離式（detached）背景執行緒，迴圈執行：`refresh_cpu_usage()` + `refresh_memory()`，重算 `SysSnapshot`，寫入 `Mutex`，再 `sleep(SAMPLE_INTERVAL)`。
  3. 回傳 `Sampler`（持有共享的 `Arc<Mutex<SysSnapshot>>`）。
- `SAMPLE_INTERVAL` = **1 s**（常數）。此為 CPU% 差分的測量節拍，與前端輪詢間隔無關。（前端以 2 s 輪詢時，僅讀取最新的 1 s 視窗 snapshot。）
- `fn snapshot(&self) -> SysSnapshot` — 在鎖保護下 clone 當前 snapshot。

**sysinfo 細節**（crate `sysinfo = "0.33"`）：
- 整體 CPU：`refresh_cpu_usage()` 後呼叫 `sys.global_cpu_usage() -> f32`。
- 記憶體（0.30+ 版本以 bytes 為單位）：`refresh_memory()` 後呼叫 `sys.used_memory()`、`sys.total_memory()`、`sys.used_swap()`、`sys.total_swap()`。
- Load average：`System::load_average()`（關聯函式）→ `LoadAvg { one, five, fifteen }`。
- Uptime：`System::uptime()`（關聯函式）→ `u64` 秒。

Sampler 執行緒**於應用程式啟動時建立一次**（成本極低：1 s 的 cpu+mem 更新），並在應用程式整個生命週期存活——這比延遲啟動 / 停止更簡單，且無論 panel 數量為零或多個均能正確運作。（已拒絕的替代方案：首次 panel 建立時懶惰啟動 + 參考計數停止——桌面應用程式上無實質效益，反而增加更多複雜度。）

### Tauri command

`src-tauri/src/commands/sysmon.rs`：

```rust
#[tauri::command]
pub fn sysmon_sample(state: State<'_, Sampler>) -> SysSnapshot {
    state.snapshot()
}
```

同步且輕量（mutex 讀取 + clone）——無需 async。在 `commands/mod.rs` 中以 `pub mod sysmon;` 方式註冊。

### 接線 (`lib.rs`)

- `mod sysmon;`
- `.manage(Sampler::start())`
- 將 `commands::sysmon::sysmon_sample` 加入 `generate_handler!`。

無需變更 capability（應用程式自訂指令不需要 ACL 項目，已於 M3 建立此慣例）。

---

## §3 前端 — View、Sparkline、格式化 (Frontend — View, Sparkline, Formatting)

新增目錄 `src/panels/sysmon/`。

### IPC wrapper（`src/lib/ipc.ts`）

```ts
export function sysmonSample(): Promise<SysSnapshot> {
  return invoke<SysSnapshot>("sysmon_sample");
}
```

### 純函式輔助工具（`src/panels/sysmon/format.ts`）— 含單元測試

- `formatBytes(n: number): string` → 例如 `6.2G`、`512M`（二進位單位，G 保留 1 位小數）。
- `formatMemPair(used, total): string` → `"6.2/16G"`。
- `formatUptime(secs: number): string` → `"3d 04:12"`（天數 + `HH:MM`；不足 1 天時省略 `Nd ` 前綴）。
- `pushHistory(buf: number[], value: number, cap: number): number[]` → 回傳在末尾附加 `value`、超過 `cap` 則丟棄最舊元素的新陣列（cap = 60）。純函式設計使滾動 buffer 可在不需要 React 的情況下進行測試。

### Sparkline（`src/panels/sysmon/Sparkline.tsx`）— SVG，含單元測試

```ts
export function Sparkline(props: { data: number[]; max: number; className?: string }): ReactNode
```

- 渲染一個帶有 `viewBox="0 0 100 100"`（`preserveAspectRatio="none"`，填滿容器）的 `<svg>`，內含一條 `<polyline>`。
- 將 `data` 映射為點：x 依索引等間距分布於 `0..100`，y = `100 - clamp(value / max, 0, 1) * 100`（數值越高，折線越高）。
- 邊界情況：`data` 為空 → 渲染空 `<svg>`（無 polyline）；單一資料點 → 水平兩點線。`max <= 0` 視為 `1` 以避免除以零。
- 以 `currentColor` 設定筆畫色彩，讓父元素透過 Tailwind text class 控制顏色。

### View（`src/panels/sysmon/SysmonView.tsx`）

- `isTauri()` 防護：在純瀏覽器環境（無後端）下，渲染置中的提示文字 `"System monitor requires the desktop app."`（與 `TerminalView` 一致），避免 Vite-only 路徑崩潰。
- 掛載時（`useEffect` 依賴 `[instanceId, config]`）：
  - 從 config 讀取 `refreshSecs`（`?? 2`，clamp 至 `>= 1`）→ `intervalMs`。
  - 以 `useState<number[]>` 保存 CPU% 與 Mem% 的歷史資料（或以 `useRef` + 強制重渲染的 snapshot state）。較簡單的做法：將最新的 `SysSnapshot | null` 及兩條歷史陣列存在 state 中。
  - `setInterval`：呼叫 `sysmonSample()`、更新最新 snapshot，並以 `pushHistory` 將 CPU% 與 Mem%（Mem% = `memUsed/memTotal*100`）推入各自的 buffer（cap 60）。
  - 在第一次 interval 觸發前先執行一次立即取樣，避免 panel 在 `intervalMs` 內為空白。
  - Cleanup：`clearInterval`。**無需後端 teardown**（sampler 為共享 / 全域）。
- 渲染（符合已核准的 mockup）：CPU% 數值 + `Sparkline`（emerald）+ 長條；Mem 對（used/total）+ `Sparkline` + 長條；Swap（長條或 `used/total`）、Load（`1.24 0.98 0.76`）、Uptime 的緊湊列。
- 使用一個小型可重用 `Bar`（或 Tailwind div）來顯示比例長條。

### Config form（`src/panels/sysmon/SysmonView.tsx` 或相鄰檔案）

`SysmonConfigForm`：單一數字輸入欄位，用於設定**更新間隔（秒）**，預設 2，`min=1`。變更時寫入 `{ ...config, refreshSecs }`。

### Panel 註冊

- `src/panels/sysmon/index.ts` 匯出 `sysmonPanel: PanelTypeDef`：
  - `kind: "sysmon"`、`label: "System"`、`glyph: "📊"`、`defaultConfig: () => ({})`、`ready: sysmonReady`、`ConfigForm: SysmonConfigForm`、`View: SysmonView`。
  - **不設 `onDestroy`**（無每實例後端資源需要釋放）。
- `src/panels/index.ts`：與 web + terminal 並列註冊（依 kind 的冪等防護）。

---

## §4 測試 (Testing)

**Rust（`cargo test`，位於 `sysmon.rs`）：**
- `Sampler::start()` 後呼叫 `snapshot()`，確認回傳值合理：`mem_total > 0`、`0.0 <= cpu <= 100.0`、`load` 為有限數、`uptime_secs > 0`。（單次取樣；不含時序斷言。）

**前端（Vitest）：**
- `sysmonReady` → 永遠為 true。
- `formatBytes` / `formatMemPair` → 邊界值（bytes→M→G，進位）。
- `formatUptime` → `< 1h`、`< 1d`、`> 1d` 情境（例如 `90061` → `"1d 01:01"`）。
- `pushHistory` → 附加資料；超過 cap 時丟棄最舊；不 mutate 輸入。
- `Sparkline`（Testing Library + jsdom）→ 空 data 渲染時無 `<polyline>`；N 個資料點 → `<polyline>` 的 `points` 含 N 個座標；數值依 `max` 正規化（等於 max 的值映射至 y≈0，0 映射至 y≈100）。

`SysmonView` 的即時輪詢**不進行**單元測試（需要 Tauri 執行期）；由人工 GUI 驗證涵蓋。

**人工 GUI 驗證（`pnpm tauri dev` + XTest/截圖流程）：** 放置一個 System panel，確認數值在約 2 秒內填入，CPU% 對負載有反應（例如在 Terminal panel 中執行 `yes > /dev/null` 並觀察 CPU 攀升），sparkline 隨時間增長，且透過 gear 更改更新間隔後立即生效。

---

## §5 檔案結構與分階段執行 (File Structure & Phasing)

**新增 / 修改的檔案：**
```
src-tauri/
  Cargo.toml                      (+ sysinfo = "0.33")
  src/sysmon.rs                   (Sampler + SysSnapshot + Rust test)         NEW
  src/commands/sysmon.rs          (sysmon_sample command)                     NEW
  src/commands/mod.rs             (+ pub mod sysmon;)
  src/lib.rs                      (mod sysmon; .manage(Sampler::start()); handler)
src/
  lib/ipc.ts                      (+ sysmonSample wrapper)
  panels/sysmon/types.ts          (SysSnapshot, SysmonConfig, sysmonReady)    NEW
  panels/sysmon/format.ts         (formatBytes/formatMemPair/formatUptime/pushHistory) NEW
  panels/sysmon/Sparkline.tsx     (SVG sparkline)                             NEW
  panels/sysmon/SysmonView.tsx    (View + ConfigForm)                         NEW
  panels/sysmon/index.ts          (sysmonPanel: PanelTypeDef)                 NEW
  panels/index.ts                 (register sysmonPanel)
  + matching *.test.ts(x) files for types/format/Sparkline/registration
```

**分階段執行（實作順序，每階段均可獨立測試）：**
1. 後端：`sysinfo` 相依性 + `Sampler`/`SysSnapshot` + Rust 測試。
2. 後端：`sysmon_sample` 指令 + 模組接線 + `.manage`。
3. 前端：`types.ts`（`SysmonConfig`/`sysmonReady`）+ `format.ts` 輔助工具 + 各自的測試。
4. 前端：`Sparkline` + 測試。
5. 前端：`sysmonSample` IPC wrapper + `SysmonView` + `SysmonConfigForm`。
6. 註冊 `sysmonPanel` + 註冊測試。
7. 人工 GUI 驗證。

此分階段方式與 M3 節奏一致（後端優先、純邏輯前端測試、GUI 最後），並且在不修改的前提下重用已建立的 panel-registry、IPC wrapper 與 config-modal 基礎設施。
