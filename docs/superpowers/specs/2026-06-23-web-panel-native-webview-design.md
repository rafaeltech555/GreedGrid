# Web Panel 改用 Tauri 原生子 webview — 設計 spec

- 日期：2026-06-23
- 狀態：實作完成（架構已更新，反映實機驗證後的 raw wry + gtk overlay 方案）
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

改用**原生 webview 疊層**，疊在對應 grid cell 上。原生 webview 是獨立的頂層導覽（top-level navigation），不受 `X-Frame-Options` 約束，任何站台都能開。

代價是原生 webview **浮在 DOM 之上**、且用絕對像素座標定位（非 CSS grid），需自行處理定位同步與 z-order。

### 2.1 為何改用 raw wry + gtk overlay（實機發現的三個平台坑）

原設計打算用 Tauri 高階 multi-webview API（`window.add_child`），但實機驗證後發現三個 Linux/WebKitGTK 的平台坑，導致該方案不可行：

1. **子 webview 定位失效**：Tauri `add_child` 在 WebKitGTK 實作上會把子 webview `pack` 進主視窗的 `GtkBox`，使視窗被平均切半；呼叫 `set_position`/`set_size` 會被忽略——子 webview 無法自由定位。

2. **視窗 resize handler 的 widget-tree 假設**：Tauri 的 undecorated-resizing handler 假設 `webview.parent().parent() == gtk::Window`（webview 必須在 window 下兩層）。若在 webview 祖先鏈中插入額外容器，此假設不成立，視窗 resize 功能會失效。

3. **GtkFixed 持久化定位問題**：wry 的 `set_bounds` 底層用 `size_allocate`，在 `GtkFixed` 容器裡會被 GTK 的 relayout 機制還原，導致 splitter 拖曳後 webview 位置無法持久。

這三個坑加在一起使 Tauri 高階 API 路線在 Linux 上無解，最終改採 **raw wry + gtk::Overlay** 架構（見 §3.2）。

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

### 3.2 後端：Rust 指令與 GTK overlay 架構

新增 `src-tauri/src/commands/web.rs`，並在 `lib.rs` 以 `.setup(...)` 呼叫初始化函式 `init_overlay`。

#### 初始化（`init_overlay`）

app setup 時取得主視窗的底層 `gtk::Window`，把它的直接 child（Tauri 預設的 `GtkBox`，即 `default_vbox`）裡的主 webview 取出，再用一個 `gtk::Overlay` **取代** vbox 當視窗的直接 child：

- Overlay 的 **base child**：主 React webview（即 Tauri 原本的 webview），自動填滿 Overlay。
- Overlay 的 **overlay child**：一個 `gtk::Fixed`（`halign/valign = Fill`，鋪滿視窗），web panel 的 wry webview 都建在此 Fixed 上、用座標定位。對此 Fixed 設定 `set_overlay_pass_through(true)`，讓空白處的滑鼠事件穿透到底層的主 webview（React UI／DOM），只有 web panel webview 實際覆蓋的區域才攔截事件。

此架構確保主 webview 維持在 `gtk::Window` 下兩層（`window → overlay → webview`，base child 不額外加層），不破壞 Tauri undecorated-resizing handler 的 `webview.parent().parent() == gtk::Window` 假設（坑 2）。

#### GTK 物件的執行緒管理

`gtk::Fixed`、`wry::WebView` 等 GTK 物件為 `!Send`，無法跨執行緒傳遞。所有物件存放在 **`thread_local!` registry**（`gtk::Fixed` + `HashMap<instanceId, Entry{ view: wry::WebView, url: String }>`），於 setup（主執行緒）初始化。每個 Tauri 指令把只含 `Send` 資料（instanceId、url、座標、bool）的 closure 透過 `AppHandle::run_on_main_thread(...)` 派到主執行緒（GTK main loop 所在執行緒）執行——closure 在主執行緒存取 thread_local registry。指令本身 fire-and-forget（不等回傳值），錯誤於主執行緒以 `eprintln!` 記錄。

#### 指令一覽（前端 IPC 契約不變）

座標一律為 CSS px（`f64`），免 DPR 換算：

| 指令 | 行為 |
|---|---|
| `web_upsert(instanceId, url, x, y, width, height)` | 不存在 → 以 `WebViewBuilder::new().with_url().with_bounds().build_gtk(&fixed)` 建立 wry webview；已存在 → 對既有 view 呼叫 `load_url` 導覽到新 url。 |
| `web_set_bounds(instanceId, x, y, width, height)` | 呼叫自訂 `place()`：`fixed.move_() + widget.set_size_request() + widget.size_allocate() + widget.queue_resize()`，確保定位在 GTK relayout 後持久（坑 3 的解法）。 |
| `web_set_visible(instanceId, visible)` | `wry::WebView::set_visible(visible)`。 |
| `web_reload(instanceId)` | 對既有 view `load_url` 重新載入記錄的 url。 |
| `web_close(instanceId)` | 從 registry 移除 entry，drop wry webview（一併從 Fixed 移除 widget）。 |

座標對齊原理：overlay 層的 `gtk::Fixed` 鋪滿視窗 client area（與底層主 webview 同範圍），故前端 `getBoundingClientRect()` 的視窗座標即等於 webview 在 Fixed 內的定位座標。

#### `Cargo.toml` 依賴（Linux-only）

不再需要 Tauri `unstable` feature。改在 `[target.'cfg(target_os = "linux")'.dependencies]` 加入：

```toml
wry = "0.55"
gtk = "0.18"
```

非 Linux（macOS/Windows）：`web_*` 指令為 stub，返回 `Ok(())`，尚未實作。

對應前端 ipc：`src/lib/ipc.ts` 的 `webUpsert/webSetBounds/webSetVisible/webReload/webClose` 包裝（沿用既有 `isTauri()` 守門與 `invoke` 模式），**前端契約與原設計完全相同，不需修改**。

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
- **依賴 raw wry + gtk（Linux-only）**：直接操作 `wry 0.55` 與 `gtk 0.18`，需自行管理 GTK widget 生命週期（thread_local registry、`run_on_main_thread` 派送、webview drop 順序）。未來 wry/gtk-rs API 升版時需同步維護。
- **macOS/Windows 尚未實作**：非 Linux 平台的 `web_*` 指令為 stub（返回 `Ok(())`），webview 不會出現；前端 fallback 回 iframe。
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
- 改：`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`（註冊指令、setup 呼叫 `init_overlay`）、`src-tauri/Cargo.toml`（移除 `unstable` feature，Linux-only 加入 `wry = "0.55"` 與 `gtk = "0.18"`）。
- 新增：`src-tauri/src/commands/web.rs`。
- 可能新增：偵測「螢幕級 overlay 開啟」與「拖拽進行中」的共享狀態 selector（可放 `panelUiStore` / `layoutStore`，實作計畫再定）。
- 測試：`src/panels/web/` 下對應 `*.test.tsx`。
