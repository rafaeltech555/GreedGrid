# GreedGrid M6 — Workspace Persistence 設計

_Date: 2026-06-17_

---

## Overview / Goals

**M6** 交付 **Workspace persistence**：把目前的 grid layout 取名存成 JSON、之後載回、列出、刪除。這是 roadmap 最後一個里程碑,讓使用者把整套面板配置存成具名 workspace 重複使用。

**範圍（具名 workspace,不做自動還原）：**
- **Save**：把目前 layout 取名存成 JSON（同名直接覆蓋——那是你自己命名的存檔）。
- **Load**：選一個已存的 workspace,替換目前 layout。
- **List**：列出所有已存的 workspace 名稱。
- **Delete**：刪除一個 workspace（走 confirm dialog）。

**架構決策（已鎖定）：後端存「不透明 JSON 字串」(Approach A)。** 前端 `JSON.stringify(layout)` 把 `GridLayout` 送去存、讀回來 `JSON.parse`。後端只負責檔案 I/O,**不重複定義 layout schema**(DRY；schema 單一真相在前端 `src/lib/types.ts` 的 `GridLayout`)。存檔前後端僅驗證它是合法 JSON。(已拒絕的替代方案 B:後端用 Rust mirror struct 反序列化——要在 Rust 重複維護整個 layout schema,違反 DRY。)

**Non-goals（YAGNI — 明確排除）：** 自動 session 還原(開 app 自動載入上次 layout)、workspace 改名、匯入/匯出、縮圖預覽、雲端同步、版本遷移。以上均不在本設計範圍。

---

## §1 資料模型與儲存 (Data Model & Storage)

一個 workspace = 一個具名的 `GridLayout`(既有的持久化合約,定義於 `src/lib/types.ts`,已是 JSON-friendly)存成 JSON。**每個 workspace 一個檔**:`workspaces_dir/<name>.json`,內容就是 `JSON.stringify(layout)`。

儲存位置與安全寫入由 M0 已備好的 `src-tauri/src/paths.rs` 提供(M6 終於用上,移除其 `#![allow(dead_code)]`):
- `config_dir(app)` → 每使用者 config 目錄(`app_config_dir`,首次存取時建立)。
- `workspaces_dir(app)` → `config_dir/workspaces`(on demand 建立)。
- `atomic_write(path, contents)` → 寫 sibling temp 檔再 rename,**防半寫**(crash 不會留下半個 layout)。

後端把 layout 當**不透明字串**處理,不解析 schema;唯一驗證是「存檔前確認它能 parse 成合法 JSON」(避免存進垃圾)。

---

## §2 後端 — Workspace 指令 (Backend — Workspace Commands)

新增 `src-tauri/src/commands/workspace.rs`。檔案邏輯抽成吃 `dir: &Path` 的**純函式**(可 `cargo test`),`#[tauri::command]` 薄包裝解析 `paths::workspaces_dir(app)` 後委派。`serde_json` 已是既有依賴。

### 純函式(便於測試)

```rust
fn validate_ws_name(name: &str) -> AppResult<()>
// 拒空、"."、".."、含 '/'(防路徑注入),否則 AppError::Other。

fn save_to(dir: &Path, name: &str, layout: &str) -> AppResult<()>
// validate_ws_name；serde_json::from_str::<serde_json::Value>(layout) 驗證是合法 JSON；
// paths::atomic_write(dir/<name>.json, layout bytes)。

fn load_from(dir: &Path, name: &str) -> AppResult<String>
// validate_ws_name；fs::read_to_string(dir/<name>.json) 回傳 JSON 字串。

fn list_in(dir: &Path) -> AppResult<Vec<String>>
// 列 dir 內所有 .json 檔,回傳 file_stem(去副檔名)清單,依名稱不分大小寫排序。
// dir 不存在時回空 vec。忽略非 .json(例如 atomic_write 殘留的 .tmp)。

fn delete_in(dir: &Path, name: &str) -> AppResult<()>
// validate_ws_name；移除 dir/<name>.json(不存在則 no-op)。
```

### Tauri 指令(薄包裝)

```rust
#[tauri::command] pub fn ws_save(name: String, layout: String, app: AppHandle) -> AppResult<()>
#[tauri::command] pub fn ws_load(name: String, app: AppHandle) -> AppResult<String>
#[tauri::command] pub fn ws_list(app: AppHandle) -> AppResult<Vec<String>>
#[tauri::command] pub fn ws_delete(name: String, app: AppHandle) -> AppResult<()>
// 各自 workspaces_dir(&app)? 後呼叫對應純函式。
```

### 接線

- `commands/mod.rs`：`pub mod workspace;`。
- `lib.rs`：把四個 `commands::workspace::ws_*` 加入 `generate_handler!`；無新 state。
- `paths.rs`：移除 `#![allow(dead_code)]`(workspaces_dir/atomic_write/config_dir 現都被用到)。
- Capability:app 自訂指令不需 ACL(沿用慣例)。

---

## §3 Store — 載入動作 (Store — Load Action)

`src/store/layoutStore.ts` 加一個替換整個 layout 的動作(載入用):

```ts
loadLayout: (layout: GridLayout) => void
// 實作:
//   set((s) => { fireDestroyed(s.layout, layout); return { layout, selectedIds: [] }; })
```

沿用既有 `fireDestroyed(before, after)`(經 `panelsRemoved` 對「舊有但新沒有的 instanceId」呼叫 `onDestroy`)——載入新 layout 時,舊 layout 裡被換掉的 panel(含執行中的 terminal pty)會正確 teardown。這與 `applyPreset` 的模式一致。

---

## §4 前端 — IPC、ConfirmDialog 共用化、WorkspaceMenu

### IPC wrappers(`src/lib/ipc.ts`）

```ts
export function wsSave(name: string, layout: string): Promise<void> { return invoke<void>("ws_save", { name, layout }); }
export function wsLoad(name: string): Promise<string> { return invoke<string>("ws_load", { name }); }
export function wsList(): Promise<string[]> { return invoke<string[]>("ws_list"); }
export function wsDelete(name: string): Promise<void> { return invoke<void>("ws_delete", { name }); }
```

### 小重構:ConfirmDialog 共用化

`ConfirmDialog` 目前在 `src/panels/file/ConfirmDialog.tsx`,M6 的刪除確認也要用。把它(連同測試)搬到 `src/components/ConfirmDialog.tsx`,更新 `FileView` 的 import。`components` 不該依賴某個 panel,故搬到 `components/` 是正確的 DRY 方向。元件介面不變。

### WorkspaceMenu(`src/components/WorkspaceMenu.tsx`)

掛在 `Toolbar` 右側。`isTauri()` 防護:非 Tauri(純瀏覽器)時 `return null`(workspace 僅桌面 app 有；Toolbar 的 Layout/Merge/Split 仍正常)。

本地 state:`names: string[]`、`menuOpen: boolean`、`saving: boolean`、`saveName: string`、`pendingDelete: string | null`、`error: string | null`。

- 進入點/開選單時呼叫 `wsList()` 更新 `names`。
- **Save**(💾):點擊 → `saving=true` → inline 名稱輸入。Enter:前端先擋(`name.trim()` 非空且不含 `/`,後端再擋一次)→ `wsSave(name, JSON.stringify(useLayoutStore.getState().layout))` → 重新 `wsList`、`saving=false`、清空輸入。Escape 取消。
- **Load**(📂 ▾):toggle `menuOpen` → 下拉列出 `names`。點名稱 → `wsLoad(name)` → `JSON.parse` → 最小驗證(`parsed.grid` 存在且 `Array.isArray(parsed.cells)`)→ `loadLayout(parsed)` → 關選單;parse/驗證失敗 → 設 `error` 顯示,不套用。
- **Delete**(每項旁 ✕):設 `pendingDelete=name` → `ConfirmDialog`(訊息「刪除 workspace『name』？」)→ 確認 `wsDelete(name)` → 重新 `wsList`、清 `pendingDelete`。
- 讀目前 layout 用 `useLayoutStore.getState().layout`(存檔當下的非反應式讀取)。

---

## §5 測試 (Testing)

**Rust(`cargo test`,於 `commands/workspace.rs`):** 在 `std::env::temp_dir()` 唯一子目錄操作,測完清除。
- `save_to` → `list_in` → `load_from` → `delete_in` 生命週期:存兩個、list 回傳排序後名稱、load 拿回原 JSON、delete 後 list 反映移除。
- `save_to` 對壞名稱(空、`a/b`)與壞 JSON(`"not json"`)回 `Err`。
- `list_in` 對不存在的 dir 回空 vec;忽略非 `.json` 檔。

**前端(Vitest):**
- `layoutStore.loadLayout`:替換 layout、清 `selectedIds`;對「舊有但新 layout 沒有的 panel」觸發 `onDestroy`(沿用既有 store 測試的 spy 模式),對仍存在的不觸發。
- JSON round-trip 衛生:`JSON.parse(JSON.stringify(layout))` 與原 layout 深度相等(確認 layout 是純 JSON,無函式/不可序列化欄位)。

`WorkspaceMenu` 的互動(需 Tauri runtime / invoke mock)與 `ws_*` 指令的實機行為由人工 GUI 驗證涵蓋,不做單元測試(與既有 View 的處理一致)。

**人工 GUI 驗證(`pnpm tauri dev` + XTest/截圖):** 擺幾個 panel → Save 取名 → 改 layout(換 preset / 加 panel)→ Load 剛存的 → 確認 layout 還原 → Delete(confirm)→ 確認從清單消失。也檢查 `~/.config/<app id>/workspaces/<name>.json` 真的寫出。

---

## §6 檔案結構與分階段執行 (File Structure & Phasing)

**新增 / 修改的檔案：**
```
src-tauri/
  src/commands/workspace.rs       (save_to/load_from/list_in/delete_in + ws_* commands + Rust tests)  NEW
  src/commands/mod.rs             (+ pub mod workspace;)
  src/lib.rs                      (register 4 handlers)
  src/paths.rs                    (移除 #![allow(dead_code)])
src/
  lib/ipc.ts                      (+ wsSave/wsLoad/wsList/wsDelete)
  store/layoutStore.ts            (+ loadLayout 動作)
  store/layoutStore.test.ts       (+ loadLayout 測試)
  components/ConfirmDialog.tsx    (從 panels/file/ 搬來)                                            MOVED
  components/ConfirmDialog.test.tsx (一併搬)                                                          MOVED
  panels/file/FileView.tsx        (更新 ConfirmDialog import 路徑)
  components/WorkspaceMenu.tsx     (Save/Load/Delete UI)                                              NEW
  components/Toolbar.tsx          (掛載 WorkspaceMenu)
  + workspace JSON round-trip 測試(放 store 或 lib 測試)
```

**分階段(實作順序,各自可測):**
1. 後端:`workspace.rs` 純函式(`save_to`/`load_from`/`list_in`/`delete_in` + `validate_ws_name`)+ Rust 生命週期/驗證測試。
2. 後端:`ws_*` 指令薄包裝 + `mod.rs`/`lib.rs` 接線 + 移除 `paths.rs` 的 `allow(dead_code)`。
3. Store:`loadLayout` 動作 + 測試(含 JSON round-trip)。
4. 前端:把 `ConfirmDialog` 搬到 `components/`(+ 測試)+ 更新 `FileView` import。
5. 前端:IPC wrappers + `WorkspaceMenu` + 掛上 `Toolbar`。
6. 人工 GUI 驗證 + docs/merge。

此節奏沿用 M3–M5(後端先行、純邏輯測試、GUI 最後),重用既有 `paths.rs`、`fireDestroyed`、ConfirmDialog、IPC-wrapper 慣例。
