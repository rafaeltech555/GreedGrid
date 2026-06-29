# 分隔視窗縮放（Maximize）與 IDLE 提示 — 設計文件

- 日期：2026-06-29
- 狀態：草案（待 review）
- 範圍：GreedGrid（Tauri v2 + React 19 + Zustand）新增兩項功能

## 1. 背景與目標

GreedGrid 把單一視窗切成可調整的 grid，每格放一個 panel（terminal / file / web / sysmon）。本文件規劃兩項使用者需求：

1. **分隔視窗縮放（Maximize）**：把某一格暫時放大佔滿整個 grid，其餘格隱藏；放大期間其餘 panel 仍照常在背景執行；縮小後回到原本 layout。
2. **IDLE 提示**：當某個 terminal「跑完前景指令、而使用者還沒回去看那一格」時，以慢速動畫提醒使用者；提醒同時出現在該面板、工具列、以及 system tray（讓視窗最小化時也看得到）。提醒可由使用者點擊清除。

兩項功能共用相同的視覺語彙（amber 色、慢速動畫、laptop+zzz 圖示），但**彼此獨立、分兩階段交付**：

- **階段 A — Maximize**：純前端、無後端風險，先做。
- **階段 B — IDLE**：含 pty 前景偵測與 system tray，後做。

## 2. 名詞與範圍界定

- 「**背景執行**」（Maximize 語境）：被放大的格以外的 panel 在視覺上被遮蓋，但其執行緒／程序照常運作（terminal pty、sysmon sampler 本來就獨立於畫面）。Maximize **不**暫停任何 panel。
- 「**閒置 / IDLE**」（提示語境）：限定 terminal panel。指該 terminal **曾在跑前景指令 → 指令結束回到 shell prompt → 且使用者在指令結束後尚未回去檢視該格**。空 prompt、從未跑過指令的 terminal **不算**閒置。sysmon / file / web panel **沒有**閒置概念，不參與提示。
- 提示色一律 amber `#fbbf24`，刻意避開 selected 狀態使用的 emerald 綠（`#34d399`），以免兩種高亮混淆。

## 3. 現狀（與本設計相關的既有結構）

- 暫時性 UI 狀態：`src/panels/panelUiStore.ts`（`usePanelUiStore`，存 picker/modal 等不進持久化的狀態）。
- 持久化 layout：`src/store/layoutStore.ts`（`useLayoutStore`，存 `GridLayout`）。**Maximize / IDLE 狀態都不得寫進 `GridLayout`**。
- Grid 渲染：`src/grid/GridHost.tsx`（CSS Grid + 推導 splitter）、`src/grid/GridCell.tsx`（單格渲染 + hover chrome `⠿`/`⚙`/`✕`）。
- Web panel 原生 webview：`src/panels/web/WebPanel.tsx` 透過 `webSetVisible` / `webSetBounds` 控制浮在 DOM 上的原生 webview；既有的 `src/panels/web/useWebSuppressed.ts` + ResizeObserver 是同步 bounds/visibility 的範本。
- Terminal：前端 `src/panels/terminal/TerminalView.tsx`、`terminal/index.ts`、`terminal/types.ts`；後端 `src-tauri/src/pty.rs`（`PtySession` / `SessionInfo`，目前只回報 `alive` / `attached`，**無前景程序概念**）。
- IPC wrapper：`src/lib/ipc.ts`。
- 工具列：`src/components/Toolbar.tsx`（目前為文字按鈕，右側尚無狀態指示區）。
- App 掛載點：`src/App.tsx`（適合掛一次性的全域 hook）。
- Tauri builder / setup：`src-tauri/src/lib.rs`；能力宣告：`src-tauri/capabilities/default.json`；Rust 相依：`src-tauri/Cargo.toml`。**目前完全沒有 system tray。**

---

## 階段 A — 分隔視窗縮放（Maximize）

### A.1 狀態

在 `usePanelUiStore` 新增暫時性欄位：

- `maximizedCellId: string | null`（預設 `null`）
- action：`maximizeCell(cellId)`、`restoreCell()`、`toggleMaximize(cellId)`

不進 `GridLayout`、不進 workspace 持久化。切換 preset、merge/split、載入 workspace、或被放大的 cell 消失時，一律 `restoreCell()`（避免指向不存在的 cell）。

### A.2 渲染

`GridHost` / `GridCell` 在 `maximizedCellId !== null` 時：

- 被放大的 cell：以 `position:absolute; inset:0; z-index:<在 grid 內容之上、在 modal 之下>` 撐滿整個 grid 容器區（即 `GridHost` 的內容區，不含 header/toolbar）。
- 其餘 cell 與 splitter：隱藏（`display:none` 或不渲染），但**不可卸載元件**（terminal 的 xterm、web 的 webview 必須保活，才能「背景照常執行」且縮小後即時恢復，不重新初始化）。實作上以 CSS 隱藏，DOM 與元件保留。

### A.3 觸發與還原

- 每格 hover chrome 新增一顆 `⛶` 放大鈕（置於既有 `⠿`/`⚙`/`✕` 之列）。放大後該鈕語意切為「還原」。
- 鍵盤：放大狀態下按 **Esc** 還原。（註：`Toolbar.tsx` 已有 Esc 退出 select mode 的 listener；需確保兩者不衝突——maximize 的 Esc 優先，或各自獨立判斷狀態。）
- 點放大鈕為 toggle。

### A.4 Web panel webview 同步（關鍵）

原生 webview 浮在 DOM 之上，CSS `display:none` 無法遮住它，必須主動呼叫：

- 進入 maximize：
  - 若被放大的是 web panel → `webSetBounds` 到放大後的矩形。
  - 其餘 web panel（被遮的）→ `webSetVisible(false)`。
- 還原：所有 web panel 依其 cell 的實際矩形 `webSetBounds` + `webSetVisible(true)`。
- 沿用 `useWebSuppressed` + ResizeObserver 的既有模式；maximize 視為一種新的 suppression 來源，需與既有 suppression 邏輯整合（兩者皆可令某 web panel 隱藏，採「OR」）。

### A.5 邊界情況

- 放大空白格（無 panel）：允許，顯示放大的 `+` placeholder。
- 放大狀態下不允許進入 select / merge / split（或進入時先自動還原）；以還原優先，避免狀態交纏。
- 已有 `maximizedCellId` 時再對另一格放大：直接切換目標（先還原舊的 web bounds 再放大新的）。

### A.6 測試（階段 A）

- 單元：`panelUiStore` 的 maximize/restore/toggle 與「目標 cell 消失自動還原」。
- 元件：放大後僅目標 cell 可見、其餘 `display:none` 但仍在 DOM；Esc / 還原鈕可回復。
- 原生 GUI 驗證（見 verify-tauri-gui 配方）：放大含 web panel 的格，確認 webview bounds 正確；放大其他格時被遮的 web panel 不再蓋住畫面。

---

## 階段 B — IDLE 提示

### B.1 判定語意（權威定義）

對每個 terminal instance 維護一組狀態，`isIdle` 為真需**同時**滿足：

1. 該 terminal **曾經**進入過「前景有指令在跑」的狀態（`wasRunning` 曾為真）；
2. 目前前景**已回到 shell prompt**（指令結束）；
3. 指令結束的時間點 `finishedAt` **晚於**該格最後一次被使用者檢視的時間 `lastViewedAt`（即跑完後使用者還沒回去看）。

任一條件不成立即非閒置。使用者「檢視」該格（見 B.4）後 `isIdle` 立即轉假。

非 terminal panel 永遠非閒置。

### B.2 後端：terminal 前景程序偵測（`src-tauri/src/pty.rs`）

新增「前景 process group」偵測，用來判斷 shell 是停在 prompt 還是正在跑指令：

- 取得 pty master 的 fd，呼叫 `tcgetpgrp(master_fd)` 得到目前前景 process group id（fpgid）。
- 記錄 shell 自身的 pgid（spawn 時 child pid，通常即其 pgid，因 shell 為其 process group leader）。
- 判定：`fpgid == shell_pgid` → 停在 prompt（無前景指令）；`fpgid != shell_pgid` → 有前景指令在跑。
- 由「!= → ==」的轉換即代表「指令剛跑完」。

實作備註（待實作時驗證）：

- `portable-pty` 取得 master fd 的方式需確認（例如 master 的 `as_raw_fd()`；若 API 不直接暴露，改在開 pty 時保留 fd）。`tcgetpgrp` 走 `nix`/`libc`。
- 平台：本功能以 **Linux** 為目標（專案實際運行環境）。其他平台若無法取得前景 pgid，則該 terminal 一律視為非閒置（功能優雅退化，不報錯）。
- 暴露方式：擴充 `SessionInfo`（`pty.rs` 與前端 `terminal/types.ts`）新增欄位，例如 `foreground: bool`（true=有前景指令）。前端以既有 `term_list` 輪詢取得即可，無需新事件通道；輪詢頻率沿用前端既有節奏（約 1–2s）。
- 偵測為**盡力而為**：偵測不到時不閃，不影響既有 terminal 功能。

### B.3 前端：`idleStore`（新增 Zustand store）

新增 `src/store/idleStore.ts`（或置於 panels 下），每個 terminal instanceId 對應：

```
{ wasRunning: boolean; foreground: boolean; finishedAt: number | null; lastViewedAt: number; }
```

- 衍生 `isIdle(instanceId)`：依 B.1 計算。
- 衍生 `anyIdle`：是否有任一 terminal 閒置（供工具列 chip 與 tray 用）。
- 在 `App.tsx` 掛一個一次性 hook：定期讀後端 `term_list` 的 `foreground`，更新各 instance 的 `foreground` / `wasRunning` / `finishedAt`（偵測 true→false 轉換時寫入 `finishedAt`）。
- 清掉已不存在的 instance（與 layout 對齊，沿用 `panelsRemoved` 的比對思路）。

### B.4 「檢視 / 清除」的定義

下列任一行為視為使用者已檢視該 terminal，將其 `lastViewedAt` 更新為現在、令 `isIdle` 轉假：

- 點擊該 terminal 格（或其浮出的「此面板閒置」徽章）。
- 該 terminal 取得 focus 或有鍵盤輸入（`TerminalView` 的 `term.onData` / focus；注意 xterm 把鍵盤攔在 host 內，頂層 listener 看不到，需由 `TerminalView` 主動回報）。
- 點工具列 chip → 清除**全部** terminal 的閒置。
- 點 system tray / 還原並聚焦視窗 → 清除全部閒置（回到視窗即視為檢視）。

### B.5 圖示：laptop + zzz（SVG，動畫）

單一 SVG 元件，三處共用（工具列 chip、每格 terminal 標題狀態、system tray 來源圖）：

- 造型：筆電（螢幕 `rect` + 底座一橫線）+ 右上兩個由小到大的 `z`。單色 `currentColor`，顏色由容器決定（非閒置=灰 `rgba(255,255,255,.55)`，閒置=amber）。
- 動畫（視窗內，DOM/CSS）：閒置時兩個 z 依序「上升＋放大＋淡出」循環（`zfloat`，週期約 1.8s，第二個 z delay ≈ 0.9s），筆電本體極輕微呼吸縮放（`breathe`，週期 2.4s）。非閒置時 z 隱藏、筆電靜止灰色。
- 參考實作：`scratchpad/idle-demo.html`（v4）的 `.lz` SVG 與 `@keyframes zfloat` / `breathe`，落地時抽成 React 元件 `IdleIcon`。
- 需尊重 `prefers-reduced-motion`：減動偏好時停用飄動/呼吸，改為靜態 amber + 變色。

### B.6 視窗內提示（per-panel）

- 閒置的 terminal 格：amber 邊框光暈（`glowpulse`，inset box-shadow，週期 2.4s）+ 底部浮出「此面板閒置」徽章（可點擊清除該格）。
- 每格 terminal 標題列右側顯示 `IdleIcon` 小尺寸狀態（執行中=灰靜止 / 閒置=amber 動畫）。
- 僅閒置的那一格有效果，其餘不受影響。

### B.7 工具列 chip（`src/components/Toolbar.tsx`）

- 在工具列右側新增狀態 chip：`IdleIcon` + 文字（「活動中」/「閒置」）。
- `anyIdle` 為真時整顆轉 amber 並播放動畫；點擊清除全部閒置。
- 非閒置時為低調的灰色靜態指示（可作為「目前無待辦」的常駐狀態）。

### B.8 System tray（`src-tauri/`）

讓視窗最小化/被遮時仍能提示：

- 啟用 Tauri tray：`Cargo.toml` 開 `tauri` 的 `tray-icon` feature；`capabilities/default.json` 補必要權限；在 `lib.rs` 的 `.setup()` 建立 `TrayIcon`（與既有 `commands::web::init_overlay` 同處初始化）。
- 狀態圖：
  - 非閒置 → 中性 greedgrid 圖示。
  - 閒置 → amber 版圖示。
- **動畫退路（重要）**：OS tray 無法做平滑 CSS 動畫，只能定時 `set_icon` 切換 PNG。
  - 首選：閒置時以 2–3 張預先 render 的 frame（z 多/少）每 ~1.2s 輪換，模擬慢速閃爍。
  - 退路（Linux/Cinnamon tray 動畫支援不佳時）：**至少**做到「閒置時切成 amber 靜態圖示 + 更新 tooltip 文字（例如 `terminal #N 跑完待查看`）」。此為驗收底線。
- 互動：左鍵點 tray → 還原並聚焦視窗 + 清除全部閒置；（可選）右鍵選單含「顯示視窗 / 結束」。
- 前端 `anyIdle` 與 tray 狀態需同步：前端狀態變化時透過 IPC 通知後端更新 tray 圖示/ tooltip（新增一個 `set_idle_indicator(active: bool, tooltip: string)` 命令）。

### B.9 測試（階段 B）

- 單元：`idleStore` 的 `isIdle` 真值表（涵蓋 B.1 三條件的各種組合）、`anyIdle`、instance 清理、`lastViewedAt` 更新令 `isIdle` 轉假。
- 後端：前景 pgid 偵測在「跑長指令 → 結束」時 `foreground` 由 true→false（可用 `sleep` 指令做整合測試）；取不到 fpgid 時不 panic、回報非前景。
- 元件：`IdleIcon` 在 idle/active 兩態的 class 切換；reduced-motion 時不套動畫。
- 原生 GUI 驗證：在一格 terminal 跑 `sleep 3` 後不點該格 → 該格光暈+徽章、工具列 chip、tray 皆轉 amber；點該格 → 全部還原；視窗最小化時 tray 仍顯示 amber/tooltip。

---

## 4. 非目標（YAGNI）

- 不為 sysmon / file / web 設計「背景任務 / 閒置」概念。
- Maximize 不做動畫過場、不做多格同時放大、不做跨視窗。
- IDLE 不做「整體系統閒置（純滑鼠鍵盤無操作計時）」——已收斂為 terminal 導向的「指令跑完待查看」。
- 不引入 OS 系統通知（notification plugin）；提示僅在 tray + 視窗內。（若日後要，再獨立評估。）
- tray 不做即時 token/資源儀表（與 claude-usage-monitor 那類 widget 無關，僅借用視覺風格）。

## 5. 風險與待驗證項目

- `portable-pty` 是否能穩定取得 master fd 供 `tcgetpgrp`；若否，需在建立 pty 時保留 fd。
- Cinnamon（X11）下 tray 圖示動態 `set_icon` 的更新頻率與穩定度；退路已定義。
- xterm 鍵盤輸入回報 `lastViewedAt` 的接點（`TerminalView`）需確認不影響 IME 修法（見既有 terminal IME 修正）。
- Esc 鍵在 maximize 與 select mode 間的優先序。

## 6. 交付順序

1. 階段 A（Maximize）：`panelUiStore` → 渲染特判 → 放大鈕/Esc → web webview 同步 → 測試 → GUI 驗證。
2. 階段 B（IDLE）：後端前景偵測 + `SessionInfo` → `idleStore` + App hook → `IdleIcon` 元件 → per-panel 光暈/徽章 → 工具列 chip → system tray + 退路 → 測試 → GUI 驗證。

每階段各自一份 implementation plan，獨立可驗收、可合併。
