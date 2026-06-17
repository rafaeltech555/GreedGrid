# GreedGrid M5 — File Browser Panel 設計

_Date: 2026-06-17_

---

## Overview / Goals

**M5** 交付 **File Browser panel**（`PanelKind` = `"file"`，自 M2 起已保留於型別聯集中）：在 grid cell 內提供一個可導覽、可管理的檔案總管。這是第一個帶**破壞性檔案操作**的 panel，因此安全確認流程是設計重點。

**範圍（完整檔案管理）：**
- 導覽目錄（點資料夾進入、`..` 上一層）
- 開啟檔案（以 OS 預設程式，透過 `tauri-plugin-opener`）
- 新增資料夾（inline 輸入）
- 重新命名（inline 輸入）
- **永久刪除**（`std::fs::remove_*`，由明確的 confirm dialog 把關，標示不可復原）

**架構決策（已鎖定）：無狀態自訂 Rust fs 指令 + 前端持有路徑 state。** 後端以 `std::fs` 實作一組一次性（stateless）指令，前端 `FileView` 持有「當前路徑」的 React state，每次導覽或操作呼叫一次指令並重新列出。**無 per-instance 後端狀態、無 Channel、無 `onDestroy`**（沿用 M4 sysmon 的無狀態精神，但操作是事件驅動而非定時輪詢）。

**Non-goals（YAGNI — 明確排除）：** copy / move / paste、多選、拖放移動、檔案內容預覽、可輸入跳轉的路徑列、隱藏檔顯示開關（一律顯示）、跨應用程式的書籤/最近路徑。以上均不在本設計範圍；日後新增屬後續里程碑。

---

## §1 資料模型 (Data Model)

後端列目錄回傳一個已解析的絕對路徑加上條目陣列；前端據此追蹤當前位置。

```rust
// src-tauri/src/commands/fs.rs
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64, // bytes；資料夾為 0
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub path: String,            // 實際列出的「絕對、正規化」路徑
    pub entries: Vec<FileEntry>,
}
```

```ts
// src/panels/file/types.ts
export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
}
export interface ListResult {
  path: string;
  entries: FileEntry[];
}
export interface FileConfig {
  path?: string; // 起始目錄；空則後端用 $HOME
}
export function fileReady(_config: Record<string, unknown>): boolean {
  return true; // 以預設目錄開啟，placement 不開 config modal
}
```

`#[serde(rename_all = "camelCase")]` 使 `is_dir` 抵達前端為 `isDir`，與 TS 型別對應。

`FileConfig.path` 是「起始目錄」；面板開啟後當前路徑改由 `FileView` 的 React state 持有（不寫回 config，導覽不算設定變更）。

---

## §2 後端 — 自訂 fs 指令 (Backend — Custom fs Commands)

新增檔案 `src-tauri/src/commands/fs.rs`，全部以 `std::fs` 實作，回傳 `AppResult<T>`（沿用 `crate::error::{AppError, AppResult}`，其 `AppError::Io(#[from] std::io::Error)` 會把 I/O 錯誤自動轉成可序列化的訊息給前端）。

### 路徑解析

- 空 / 缺省路徑 → `$HOME`（`std::env::var("HOME")`，失敗時退回 `/`）。目標平台為 Linux，故用 `HOME` env，不引入額外 crate。
- 列目錄前先 `std::fs::canonicalize(path)`，回傳「絕對、正規化、解析 symlink」後的路徑字串——這讓 `..` 導覽乾淨（前端把 `..` 接到當前路徑後交給後端 canonicalize），並讓前端永遠拿到真實路徑。

### 指令

```rust
#[tauri::command]
pub fn fs_list(path: Option<String>) -> AppResult<ListResult>
// path 空 → $HOME。canonicalize 後 read_dir，組 entries。
// 排序：資料夾優先，再依 name 不分大小寫排序。含隱藏檔（dotfiles）。
// 每個條目的 metadata 以 best-effort 取得；單一條目 metadata 失敗（權限）時，
// 該條目以 size=0 處理，不讓整個 list 失敗。

#[tauri::command]
pub fn fs_delete(path: String) -> AppResult<()>
// 以 symlink_metadata 判斷型別（不跟隨 symlink）：
//   - 真實目錄 → remove_dir_all（遞迴，永久）
//   - 其餘（檔案/symlink）→ remove_file
// 不做 trash；不可復原。確認由前端 dialog 把關。

#[tauri::command]
pub fn fs_rename(path: String, new_name: String) -> AppResult<()>
// 驗證 new_name 非空且不含 '/'（拒絕跨目錄移動 / 路徑注入），否則回 AppError::Other。
// 目標 = path.parent() / new_name，呼叫 std::fs::rename。

#[tauri::command]
pub fn fs_mkdir(parent: String, name: String) -> AppResult<()>
// 驗證 name 非空且不含 '/'，否則回 AppError::Other。
// std::fs::create_dir(parent / name)。
```

排序與條目組裝抽成一個小的純函式（例如 `fn collect_entries(dir: &Path) -> std::io::Result<Vec<FileEntry>>`）便於 Rust 單元測試。

### 開啟檔案

不寫自訂指令——前端用 `tauri-plugin-opener` 的 `openPath` 在 OS 預設程式開檔/資料夾。後端只需確保 plugin 已註冊（`lib.rs` 已有 `tauri_plugin_opener::init()`）。

### 接線 (`lib.rs` / `commands/mod.rs`)

- `commands/mod.rs`：加 `pub mod fs;`。
- `lib.rs`：把四個 `commands::fs::fs_list / fs_delete / fs_rename / fs_mkdir` 加入 `generate_handler!`。
- **無新 state**（無 `.manage`）；fs 指令皆無狀態。
- **Capability**：`fs_*` 為 app 自訂指令，不需 ACL（沿用 M3 慣例）。但 `openPath` 屬 opener plugin，需確認 `capabilities/default.json` 的權限涵蓋 open-path——若 `opener:default` 未含，補上 `opener:allow-open-path`。

---

## §3 前端 — View 與操作 UI (Frontend — View & Operation UI)

新增目錄 `src/panels/file/`。

### IPC wrappers（`src/lib/ipc.ts`）

```ts
export function fsList(path?: string): Promise<ListResult> {
  return invoke<ListResult>("fs_list", { path });
}
export function fsDelete(path: string): Promise<void> {
  return invoke<void>("fs_delete", { path });
}
export function fsRename(path: string, newName: string): Promise<void> {
  return invoke<void>("fs_rename", { path, newName });
}
export function fsMkdir(parent: string, name: string): Promise<void> {
  return invoke<void>("fs_mkdir", { parent, name });
}
```

開檔用 plugin 套件 `@tauri-apps/plugin-opener` 的 `openPath`（前端新增 JS 依賴）；在 `FileView` 直接 import 使用，或在 `ipc.ts` 包一層 `openInDefaultApp(path)` 轉呼叫，維持「call site 不碰 plugin 細節」的慣例。

### 純函式 helpers（`src/panels/file/path.ts`）— 單元測試

- `parentPath(p: string): string` — 回傳上一層路徑；`/` 的上層仍是 `/`。
- `joinPath(dir: string, name: string): string` — 接合並正規化重複斜線。
- `formatSize(n: number): string` — 檔案大小（`2.1K` / `4.2M` / `512B`），與 sysmon 的 `formatBytes` 概念相同但本地一份，避免跨 panel 耦合。
- `isValidName(name: string): boolean` — 非空且不含 `/`（前端先擋，後端再擋一次）。

### Confirm dialog（`src/panels/file/ConfirmDialog.tsx`）— 單元測試

小型受控對話框：`{ message, confirmLabel, onConfirm, onCancel }`，沿用 `ConfigModal` 的 a11y 慣例（`role="dialog"` / `aria-modal`）。刪除時訊息明確標示「永久刪除、不可復原」，確認鈕用警示色。

### View（`src/panels/file/FileView.tsx`）

- `isTauri()` 防護：純瀏覽器渲染置中提示 `"File browser requires the desktop app."`（沿用 `TerminalView` / `SysmonView`），不啟動任何 fs 呼叫。
- 狀態：`path`（當前目錄，seed 自 `config.path`，可為 undefined）、`entries`、`error`、以及操作用的暫態（`renamingName: string | null`、`creating: boolean`、`pendingDelete: FileEntry | null`）。
- 載入：`useEffect` 依賴 `[path]`，呼叫 `fsList(path)`，把回傳的 `result.path` 設回 `path`（取得 canonical 路徑）並存 `entries`；錯誤存 `error` 並顯示。首次 `path` 為 undefined → 後端回 `$HOME`。
- 渲染：
  - **路徑列（唯讀）**：顯示當前 `path` 字串（過長則截斷/可捲動），不可輸入跳轉。
  - **動作列**：一個「+ 新資料夾」鈕 → 切 `creating=true`，於清單頂部冒出 inline input（Enter 呼叫 `fsMkdir(path, name)` 後重列、Esc 取消；用 `isValidName` 擋空/含斜線）。
  - **`..` 列**：恆在最上（除非已在檔案系統根）；點擊 → `setPath(parentPath(path))`。
  - **條目清單**（資料夾優先）：每列圖示（📁/📄）+ 名稱 + （檔案才顯示）`formatSize`。
    - 點資料夾 → `setPath(joinPath(path, name))`。
    - 點檔案 → `openInDefaultApp(joinPath(path, name))`。
    - hover 顯示 ✏（改名）與 ✕（刪除）。
    - ✏ → 該列名稱變 inline input（預填原名，Enter 呼叫 `fsRename(fullPath, newName)` 後重列、Esc 取消）。
    - ✕ → 設 `pendingDelete`，開 `ConfirmDialog`；確認 → `fsDelete(fullPath)` 後重列。
- 每次成功的 mkdir / rename / delete 之後都重新 `fsList(path)` 以反映變更。

### Config form（`src/panels/file/FileView.tsx` 或相鄰）

`FileConfigForm`：單一文字輸入「起始目錄（空 = $HOME）」，寫入 `{ ...config, path }`。`fileReady` 恆 true，故僅 gear 編輯時用得到。

### Panel 註冊

- `src/panels/file/index.ts` 匯出 `filePanel: PanelTypeDef`：`kind: "file"`、`label: "Files"`、`glyph: "📁"`、`defaultConfig: () => ({})`、`ready: fileReady`、`ConfigForm: FileConfigForm`、`View: FileView`、**無 `onDestroy`**。
- `src/panels/index.ts`：與 web / terminal / sysmon 並列註冊（依 kind 冪等防護），總數變為 4。

---

## §4 測試 (Testing)

**Rust（`cargo test`，於 `commands/fs.rs`）：** 全部在 `std::env::temp_dir()` 下建立唯一子目錄操作，測完清除，不碰使用者真實檔案。
- `fs_list`：在 temp 目錄建 2 檔 + 1 子夾，驗回傳 entries 數量、排序（資料夾優先）、`is_dir`、檔案 `size` 正確、`path` 為 canonical 絕對路徑。
- 生命週期：`fs_mkdir` 建子夾 → `fs_list` 看得到 → `fs_rename` 改名 → `fs_list` 反映新名 → `fs_delete` 移除 → `fs_list` 不再出現。
- 驗證：`fs_rename` / `fs_mkdir` 對含 `/` 或空的 name 回 `Err`。
- `fs_delete` 對非空目錄成功（遞迴）。

**前端（Vitest）：**
- `fileReady` → 恆 true。
- `parentPath` → `/a/b/c`→`/a/b`、`/a`→`/`、`/`→`/`。
- `joinPath` → 處理尾斜線/重複斜線。
- `formatSize` → bytes/K/M 邊界。
- `isValidName` → 空、含 `/`、正常名。
- `ConfirmDialog`（Testing Library）→ 顯示 message、按確認/取消觸發對應 callback。

`FileView` 的實際 fs I/O 與 `openPath` **不做**單元測試（需 Tauri runtime），由人工 GUI 驗證涵蓋。

**人工 GUI 驗證（`pnpm tauri dev` + XTest/截圖流程）：** 一律在預先建立的 temp 測試目錄（例如 `/tmp/m5-test/`，內含假檔/子夾）內操作，**不動真實重要檔案**。驗：導覽進出資料夾、`..` 上層、點檔案以預設程式開啟、新增資料夾、改名、刪除（confirm dialog → 永久刪除）後清單更新。

---

## §5 檔案結構與分階段執行 (File Structure & Phasing)

**新增 / 修改的檔案：**
```
src-tauri/
  src/commands/fs.rs              (fs_list/fs_delete/fs_rename/fs_mkdir + Rust tests)  NEW
  src/commands/mod.rs             (+ pub mod fs;)
  src/lib.rs                      (register 4 handlers)
  capabilities/default.json       (確認/補 opener:allow-open-path)
src/
  lib/ipc.ts                      (+ fsList/fsDelete/fsRename/fsMkdir/openInDefaultApp)
  panels/file/types.ts            (FileEntry/ListResult/FileConfig/fileReady)          NEW
  panels/file/path.ts             (parentPath/joinPath/formatSize/isValidName)         NEW
  panels/file/ConfirmDialog.tsx   (受控確認對話框)                                      NEW
  panels/file/FileView.tsx        (View + ConfigForm)                                   NEW
  panels/file/index.ts            (filePanel: PanelTypeDef)                             NEW
  panels/index.ts                 (register filePanel)
  package.json                    (+ @tauri-apps/plugin-opener)
  + 對應 *.test.ts(x)（types/path/ConfirmDialog/registration）
```

**分階段（實作順序，各自可獨立測試）：**
1. 後端：`fs_list` + `FileEntry`/`ListResult` + 排序純函式 + Rust 測試。
2. 後端：`fs_delete` / `fs_rename` / `fs_mkdir`（含 name 驗證）+ 生命週期測試 + `lib.rs`/`mod.rs` 接線 + capability。
3. 前端：`types.ts`（`fileReady`）+ `path.ts` helpers + 測試。
4. 前端：`ConfirmDialog` + 測試。
5. 前端：IPC wrappers（含 `@tauri-apps/plugin-opener` 安裝 + `openInDefaultApp`）+ `FileView` + `FileConfigForm`。
6. 註冊 `filePanel` + registration 測試（panel 數 → 4）。
7. 人工 GUI 驗證（在 temp 測試目錄）。

此節奏沿用 M3/M4（後端先行、純邏輯前端測試、GUI 最後），並重用既有 panel-registry、IPC-wrapper、config-modal 與 a11y dialog 慣例。
