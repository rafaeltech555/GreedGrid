# Web Panel 改用 Tauri 原生子 webview — 設計 spec

- 日期：2026-06-23
- 狀態：設計定稿，待 review
- 相關里程碑：post-v1（沿用 [[m6-workspace-persistence-done]] 後的 panel 擴充節奏）

## 1. 問題與根因

目前 `web` panel 的 `View` 是一個 `<iframe src={url}>`（`src/panels/web/WebPanel.tsx`）。輸入主流網址後畫面一片空白。

根因已證實：**並非 app 端 CSP 阻擋**——`tauri.conf.json` 的 CSP 為 `frame-src *`，允許內嵌任何來源。空白來自**目標網站自身回傳的反內嵌標頭**，命令 WebKitGTK 拒絕被當成 sub-frame 渲染。實測：

| 網站 | 反內嵌標頭 | iframe 結果 |
|---|---|---|
| google.com | `X-Frame-Options: SAMEORIGIN` | 空白 |
| github.com | `X-Frame-Options: deny` + CSP `frame-ancestors 'none'` | 空白 |
| youtube.com | `X-Frame-Options: SAMEORIGIN` | 空白 |
| example.com | （無） | 正常 |

`X-Frame-Options` / CSP `frame-ancestors` 是 server 端指令，app 的 CSP 無法覆寫。因此 iframe 內嵌對絕大多數真實站台先天無解。這是**架構層級**問題，不是設定錯誤。

## 2. 解法方向

改用 **Tauri v2 原生子 webview（multi-webview）**，疊在對應 grid cell 上。原生 webview 是獨立的頂層導覽（top-level navigation），不受 `X-Frame-Options` 約束，任何站台都能開。

代價是原生 webview **浮在 DOM 之上**、且用絕對像素座標定位（非 CSS grid），需自行處理定位同步與 z-order。

## 3. 架構

維持「panel 是 pluggable `PanelTypeDef`」的現有抽象（見 `src/panels/types.ts`）。**只替換 `web` 這一種的 `View` 實作**；grid／host／store／registry 完全不動，新增 panel 不觸碰核心的設計原則保留。

### 3.1 前端：`WebView` controller 元件

取代現在的純 iframe（`src/panels/web/WebPanel.tsx` 的 `WebView`）：

1. **chrome bar**（DOM，約 28px 高）：
   - 截斷顯示目前 url。
   - 控制鈕沿用既有語意：⚙（開 ConfigModal 改 url）、⠿（拖移 panel）、✕（移除 panel）、↻（reload）。
   - 因為是 DOM 且永遠位於 webview 上方（webview 定位在 bar 之下），控制鈕永不被網頁蓋住、永遠可點。
2. **webview 佔位區**：bar 下方一個空 `<div ref>`，不畫任何內容，只用來量 `getBoundingClientRect()` 取得 webview 應佔的矩形（content rect）。
3. **生命週期驅動**：以 `useEffect` 在掛載／url 變動／rect 變動／可見性變動時，透過新增的 ipc 指令呼叫 Rust 操作原生 webview。

非 Tauri 環境（純瀏覽器 dev、vitest/jsdom）：`isTauri()` 為 false 時 **fallback 回原本的 iframe**，確保 dev 與既有測試不破。

### 3.2 後端：Rust 指令與 registry

新增 `src-tauri/src/commands/web.rs`，並在 `src-tauri/src/commands/mod.rs`、`lib.rs` 註冊 handler。以一個 registry（`Mutex<HashSet<String>>` 記錄已建立的 instanceId，或直接依 label 慣例查詢）追蹤子 webview。

子 webview label 慣例：`web-{instanceId}`。

指令一覽（座標一律 `LogicalPosition`/`LogicalSize`，CSS px，免 DPR 換算）：

| 指令 | 行為 |
|---|---|
| `web_upsert(instanceId, url, rect)` | 不存在 → `window.add_child(WebviewBuilder, pos, size)` 建立；已存在 → 導覽（navigate）到新 url。 |
| `web_set_bounds(instanceId, rect)` | `set_position` + `set_size` 重新定位／縮放。 |
| `web_set_visible(instanceId, visible)` | 顯示／隱藏子 webview。 |
| `web_reload(instanceId)` | 重新載入目前頁面。 |
| `web_close(instanceId)` | 關閉並從 registry 移除。 |

座標對齊原理：主 webview 鋪滿視窗 client area，故前端 `getBoundingClientRect()` 的視窗座標即等於子 webview 相對視窗的定位座標。

`Cargo.toml` 需開啟 `tauri = { features = ["unstable"] }`（multi-webview API 前提，見 §6 風險）。

對應前端 ipc：在 `src/lib/ipc.ts` 新增 `webUpsert/webSetBounds/webSetVisible/webReload/webClose` 包裝（沿用既有 `isTauri()` 守門與 `invoke` 模式）。

## 4. 關鍵行為

### 4.1 建立與銷毀
- `WebView` 掛載且 url 有效 → `web_upsert` 建立子 webview。
- `WebView` 卸載（移除 panel、切換 panel kind、拖移到他格導致重掛載）→ `web_close`。
- url 變動（透過既有 ⚙ ConfigModal）→ `web_upsert` 導覽到新 url。

### 4.2 跟隨 cell（拖拽時隱藏，放開對齊）
WebKitGTK 上每幀重定位原生 webview 易卡頓／拖影，故採統一的「隱藏—靜止後對齊」策略，避免任何進行中的連續變動觸發逐幀重定位：

- **連續變動偵測（debounce）**：以 `ResizeObserver` 觀察佔位區 rect。每次觸發即 `web_set_visible(false)` 並重置一個短 debounce timer；timer 在 rect 靜止（quiescent）後才 fire → 量最終 rect → `web_set_bounds` + `web_set_visible(true)`。視窗 resize 因會逐幀觸發 observer，自然落入此路徑。
- **明確拖拽信號**：splitter 拖曳（GridHost 既有 `onDragStart`/`onDragEnd`）與 panel 拖移（`GridCell` 既有 `dragging` 狀態）在拖拽期間強制保持 hidden，直到 dragEnd 才量最終 rect 並復原。此信號優先於 debounce，確保拖拽全程不重定位。

換言之只有兩種狀態：變動進行中 → hidden；靜止 → 對齊後 show。不存在「逐幀 set_bounds」路徑。

### 4.3 被螢幕級 overlay 蓋住時隱藏
原生 webview 會浮在 DOM modal 之上，故任一螢幕級 overlay 開啟時，隱藏**所有** web webview，關閉後復原。需涵蓋：`ConfigModal`、`WorkspaceMenu`、`DropMenu`。

### 4.4 select-mode
進入 select-mode 時隱藏 webview，露出 cell 讓 Ctrl+click 選取與 select overlay 可作用；離開後復原。

## 5. 持久化
web panel 的 url 已存在 workspace JSON 的 `PanelConfig.config`（沿用既有機制，不變）。原生 webview 本身為 ephemeral，載入 workspace 時由各 `WebView` 依 config 重新 `web_upsert` 重建。無需新增持久化欄位。

## 6. 取捨與已知限制（v1 接受，使用者已同意）

- **拖移 panel 會 reload 網頁**：`movePanel` 換格 → `GridCell` 以 `cell.id` 為 key，`WebView` 隨之重掛載 → webview 重建並重載頁面。v1 接受；未來優化方向：把 webview 生命週期移出 React、以 instanceId 為錨改純重定位。
- **依賴 Tauri `unstable` feature**：multi-webview（`add_child` / `Webview`）在 Tauri 2 屬 `unstable`，API 可能隨版本變動。目前為唯一原生途徑，列為已知風險。
- **非 Tauri 環境**：fallback 回 iframe（功能等同改版前，主流站仍空白），僅供 dev／測試。

## 7. 測試策略

- **單元測試（vitest）**：
  - rect → ipc 參數的純邏輯（content rect 計算、可見性決策）。
  - chrome bar 元件渲染（url 截斷、控制鈕 aria-label／行為）。
  - `isTauri()` 分支：false 時走 iframe fallback。
- **原生 webview 無法單元測**：以 verify-tauri-gui 配方（[[greedgrid-gui-verify-recipe]]，X11 全視窗截圖會拍到原生 webview）實機驗證 google.com / github.com / youtube.com 皆能正常顯示，並驗證 splitter 拖曳後對齊、modal 開啟時隱藏、移除 panel 後 webview 消失。

## 8. 影響檔案

- 改：`src/panels/web/WebPanel.tsx`（`WebView` 改 controller + chrome bar；`WebConfigForm` 不變）。
- 改：`src/lib/ipc.ts`（新增 web_* 包裝）。
- 改：`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`（註冊指令）、`src-tauri/Cargo.toml`（`unstable` feature）。
- 新增：`src-tauri/src/commands/web.rs`。
- 可能新增：偵測「螢幕級 overlay 開啟」與「拖拽進行中」的共享狀態 selector（可放 `panelUiStore` / `layoutStore`，實作計畫再定）。
- 測試：`src/panels/web/` 下對應 `*.test.tsx`。
