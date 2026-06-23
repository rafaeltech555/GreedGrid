# Web Panel 原生子 webview 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `web` panel 從會被 `X-Frame-Options` 擋成空白的 iframe，換成 Tauri v2 原生子 webview，疊在對應 grid cell 上，任何站台都能開。

**Architecture:** 維持 pluggable `PanelTypeDef` 抽象，只換掉 `web` 的 `View`。前端 `WebView` 變成 controller：渲染 28px chrome bar（DOM，永遠在 webview 上方）+ 一個量測用的佔位 div，透過新增 ipc 指令驅動 Rust 建立/定位/顯隱/導覽/關閉子 webview。可見性由「ResizeObserver debounce（變動中隱藏、靜止後對齊顯示）」與「螢幕級 overlay 抑制」兩條路徑決定。非 Tauri 環境 fallback 回 iframe。

**Tech Stack:** raw wry 0.55 + gtk 0.18（Linux-only）、Rust、React 18 + zustand、TypeScript、Vitest + Testing Library。

完整設計見 spec：`docs/superpowers/specs/2026-06-23-web-panel-native-webview-design.md`。

---

## File Structure

- `src-tauri/src/commands/web.rs` — **新增**：web_* 指令 + 純 helper（`label`、`parse_url`）。
- `src-tauri/src/error.rs` — **改**：加 `Tauri(#[from] tauri::Error)` 變體。
- `src-tauri/src/commands/mod.rs` — **改**：`pub mod web;`。
- `src-tauri/src/lib.rs` — **改**：註冊 5 個 web 指令。
- `src-tauri/Cargo.toml` — **改**：`tauri` 開 `unstable` feature。
- `src/lib/ipc.ts` — **改**：`WebRect` 型別 + `webUpsert/webSetBounds/webSetVisible/webReload/webClose`。
- `src/panels/web/geometry.ts` — **新增**：`measureRect`（純函式，可測）。
- `src/panels/web/geometry.test.ts` — **新增**。
- `src/panels/panelUiStore.ts` — **改**：加 `workspaceMenuOpen` + `setWorkspaceMenuOpen`。
- `src/components/WorkspaceMenu.tsx` — **改**：選單開關接到 store flag。
- `src/panels/web/useWebSuppressed.ts` — **新增**：抑制可見性的 hook。
- `src/panels/web/useWebSuppressed.test.tsx` — **新增**。
- `src/panels/types.ts` — **改**：`PanelTypeDef` 加 `selfChrome?: boolean`。
- `src/panels/web/index.ts` — **改**：`selfChrome: true`。
- `src/grid/GridCell.tsx` — **改**：`selfChrome` 時不渲染 host hover 控制列。
- `src/panels/web/WebPanel.tsx` — **改**：`WebView` 改 controller + `WebChrome`；`WebConfigForm` 不變。
- `src/panels/web/WebPanel.test.tsx` — **新增**：chrome bar 渲染 + iframe fallback。
- `src/grid/GridCell.test.tsx` — **改**：補 selfChrome 抑制 overlay 的測試。

---

## Task 1: Rust 後端 — web 指令與純 helper

**Files:**
- Create: `src-tauri/src/commands/web.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/commands/mod.rs:6-9`
- Modify: `src-tauri/src/lib.rs:18-35`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 開啟 Tauri `unstable` feature**

修改 `src-tauri/Cargo.toml` 的 tauri 依賴行：

```toml
tauri = { version = "2", features = ["unstable"] }
```

- [ ] **Step 2: error.rs 加 Tauri 變體**

在 `src-tauri/src/error.rs` 的 `AppError` enum 內，`Io` 變體之後加入：

```rust
    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),
```

- [ ] **Step 3: 寫 web.rs（含 helper 的失敗測試）**

建立 `src-tauri/src/commands/web.rs`，先放含純 helper 與其單元測試的版本：

```rust
//! Native child webview panel (Web panel). Replaces the iframe, which most
//! sites block via X-Frame-Options / CSP frame-ancestors. Each web panel owns
//! a child `Webview` labelled `web-{instanceId}`, positioned over its grid cell.
//!
//! Requires the Tauri `unstable` feature for the multi-webview API
//! (`Window::add_child`, `Manager::get_webview`).

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

use crate::error::{AppError, AppResult};

/// Default singleton window label (no explicit label set in tauri.conf.json).
const MAIN_WINDOW: &str = "main";

/// Child-webview label for a panel instance.
fn label(instance_id: &str) -> String {
    format!("web-{instance_id}")
}

/// Parse a user-entered URL, mapping failure to a readable AppError.
fn parse_url(url: &str) -> AppResult<Url> {
    url.parse::<Url>()
        .map_err(|e| AppError::Other(format!("invalid url '{url}': {e}")))
}

#[tauri::command]
pub async fn web_upsert(
    app: AppHandle,
    instance_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let parsed = parse_url(&url)?;
    let lbl = label(&instance_id);

    // Already exists → navigate in place (no reload-from-scratch).
    if let Some(existing) = app.get_webview(&lbl) {
        existing.navigate(parsed)?;
        return Ok(());
    }

    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| AppError::Other("main window not found".into()))?
        .window();

    let builder = WebviewBuilder::new(&lbl, WebviewUrl::External(parsed));
    window.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn web_set_bounds(
    app: AppHandle,
    instance_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.set_position(LogicalPosition::new(x, y))?;
        wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_set_visible(
    app: AppHandle,
    instance_id: String,
    visible: bool,
) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        if visible {
            wv.show()?;
        } else {
            wv.hide()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn web_reload(app: AppHandle, instance_id: String) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.reload()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_close(app: AppHandle, instance_id: String) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.close()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_prefixes_instance_id() {
        assert_eq!(label("abc123"), "web-abc123");
    }

    #[test]
    fn parse_url_accepts_https() {
        assert!(parse_url("https://example.com").is_ok());
    }

    #[test]
    fn parse_url_rejects_garbage() {
        assert!(parse_url("not a url").is_err());
    }
}
```

- [ ] **Step 4: 註冊 module 與指令**

在 `src-tauri/src/commands/mod.rs` 的 module 宣告區（第 6–9 行附近）加上：

```rust
pub mod web;
```

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 內，於 workspace 指令之後加入：

```rust
            commands::web::web_upsert,
            commands::web::web_set_bounds,
            commands::web::web_set_visible,
            commands::web::web_reload,
            commands::web::web_close,
```

- [ ] **Step 5: 編譯 + 跑 Rust 單元測試**

Run:
```bash
cd src-tauri && cargo test --lib web 2>&1 | tail -20
```
Expected: 編譯通過，`label_prefixes_instance_id`、`parse_url_accepts_https`、`parse_url_rejects_garbage` 三項 PASS。

> 若 `cargo` 報 `add_child` / `get_webview` 找不到，確認 Step 1 的 `unstable` feature 已生效（`cargo clean` 後重編）。若 `.window()` 解析失敗，改用 `app.get_webview_window(MAIN_WINDOW)` 取得的 `WebviewWindow` 經由其 `Deref<Target = Webview>` 呼叫 `.window()`——簽名為 `Webview::window(&self) -> Window<R>`。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/error.rs src-tauri/src/commands/web.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(web): native child webview backend commands (web_upsert/bounds/visible/reload/close)"
```

### 實作後記（Addendum）

> **Task 1 後端最終以 raw wry + gtk overlay 重新實作，而非上述的 Tauri `add_child` 方案。**

原設計（Step 1–5）的 `add_child` / `get_webview` 路線在實機（Linux/WebKitGTK）驗證後發現三個無法繞過的平台坑（詳見 spec §2.1）：
1. `add_child` 把子 webview pack 進 GtkBox，導致視窗被切半且 `set_position`/`set_size` 被忽略。
2. Tauri undecorated-resizing handler 假設 webview 在 window 下兩層，不允許插入額外容器。
3. wry `set_bounds`（底層用 `size_allocate`）在 GtkFixed 裡被 GTK relayout 還原，定位無法持久。

最終實作改採 **raw wry + gtk::Overlay** 架構（`wry = "0.55"`, `gtk = "0.18"`，Linux-only deps）：
- setup 時 `init_overlay`：把主視窗的 default_vbox **換成** `gtk::Overlay`，base child 為主 React webview，overlay child 為一個 `gtk::Fixed`（`pass_through=true`，放 wry webview，空白處點擊穿透到底層 React UI）。
- `!Send` 的 GTK/wry 物件存在 `thread_local!` registry，透過 `AppHandle::run_on_main_thread` 派到 GTK main loop 執行。
- 定位用自訂 `place()`（`fixed.move_() + set_size_request + size_allocate + queue_resize`）解決坑 3。
- 5 個指令簽名與前端 IPC 契約**完全不變**；`Cargo.toml` 移除 `unstable` feature。

完整架構描述見更新後的 spec §3.2。

---

## Task 2: 前端 ipc 包裝

**Files:**
- Modify: `src/lib/ipc.ts`
- Test: `src/lib/ipc.test.ts`（若不存在則建立）

- [ ] **Step 1: 寫失敗測試**

建立或追加 `src/lib/ipc.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

import { webUpsert, webSetBounds, webSetVisible, webReload, webClose } from "./ipc";

describe("web panel ipc", () => {
  beforeEach(() => invoke.mockClear());

  it("webUpsert flattens rect into the payload", () => {
    webUpsert("id1", "https://example.com", { x: 1, y: 2, width: 3, height: 4 });
    expect(invoke).toHaveBeenCalledWith("web_upsert", {
      instanceId: "id1",
      url: "https://example.com",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it("webSetBounds flattens rect", () => {
    webSetBounds("id1", { x: 5, y: 6, width: 7, height: 8 });
    expect(invoke).toHaveBeenCalledWith("web_set_bounds", {
      instanceId: "id1",
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
  });

  it("webSetVisible passes the boolean", () => {
    webSetVisible("id1", false);
    expect(invoke).toHaveBeenCalledWith("web_set_visible", {
      instanceId: "id1",
      visible: false,
    });
  });

  it("webReload / webClose pass instanceId", () => {
    webReload("id1");
    webClose("id1");
    expect(invoke).toHaveBeenCalledWith("web_reload", { instanceId: "id1" });
    expect(invoke).toHaveBeenCalledWith("web_close", { instanceId: "id1" });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/lib/ipc.test.ts`
Expected: FAIL（`webUpsert` 等未匯出）。

- [ ] **Step 3: 實作 ipc 包裝**

在 `src/lib/ipc.ts` 結尾加入：

```ts
// --- Web panel (native child webview) ---------------------------------------
// Each web panel owns a child Tauri webview keyed by its panel instanceId; the
// frontend feeds it the cell's viewport rect (CSS px) for positioning.

/** Viewport rectangle (CSS px) a child webview should occupy. */
export interface WebRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Create the child webview if absent, else navigate it to `url` in place. */
export function webUpsert(instanceId: string, url: string, rect: WebRect): Promise<void> {
  return invoke<void>("web_upsert", { instanceId, url, ...rect });
}

/** Reposition / resize the child webview to `rect`. */
export function webSetBounds(instanceId: string, rect: WebRect): Promise<void> {
  return invoke<void>("web_set_bounds", { instanceId, ...rect });
}

/** Show or hide the child webview (used while resizing or behind overlays). */
export function webSetVisible(instanceId: string, visible: boolean): Promise<void> {
  return invoke<void>("web_set_visible", { instanceId, visible });
}

/** Reload the child webview's current page. */
export function webReload(instanceId: string): Promise<void> {
  return invoke<void>("web_reload", { instanceId });
}

/** Close and drop the child webview. */
export function webClose(instanceId: string): Promise<void> {
  return invoke<void>("web_close", { instanceId });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run src/lib/ipc.test.ts`
Expected: PASS（4 項）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/lib/ipc.test.ts
git commit -m "feat(web): typed ipc wrappers for native webview commands"
```

---

## Task 3: measureRect 幾何 helper

**Files:**
- Create: `src/panels/web/geometry.ts`
- Test: `src/panels/web/geometry.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `src/panels/web/geometry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { measureRect } from "./geometry";

function fakeEl(rect: Partial<DOMRect>): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect,
  } as HTMLElement;
}

describe("measureRect", () => {
  it("maps left/top/width/height to a rounded WebRect", () => {
    const el = fakeEl({ left: 10.4, top: 20.6, width: 300.5, height: 200.2 });
    expect(measureRect(el)).toEqual({ x: 10, y: 21, width: 301, height: 200 });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/panels/web/geometry.test.ts`
Expected: FAIL（`measureRect` 不存在）。

- [ ] **Step 3: 實作**

建立 `src/panels/web/geometry.ts`：

```ts
import type { WebRect } from "../../lib/ipc";

/**
 * Read an element's viewport rect and round to integer CSS px. The main webview
 * fills the window client area, so getBoundingClientRect coords map directly to
 * the child webview's position relative to the window.
 */
export function measureRect(el: HTMLElement): WebRect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run src/panels/web/geometry.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/panels/web/geometry.ts src/panels/web/geometry.test.ts
git commit -m "feat(web): measureRect helper for child webview positioning"
```

---

## Task 4: panelUiStore 加 workspaceMenuOpen + WorkspaceMenu 接線

**Files:**
- Modify: `src/panels/panelUiStore.ts:19-50`
- Modify: `src/components/WorkspaceMenu.tsx:14,28-31,53-54,110`
- Test: `src/panels/panelUiStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `src/panels/panelUiStore.test.ts` 追加：

```ts
import { usePanelUiStore } from "./panelUiStore";

it("tracks workspace menu open state", () => {
  usePanelUiStore.setState({ workspaceMenuOpen: false });
  usePanelUiStore.getState().setWorkspaceMenuOpen(true);
  expect(usePanelUiStore.getState().workspaceMenuOpen).toBe(true);
  usePanelUiStore.getState().setWorkspaceMenuOpen(false);
  expect(usePanelUiStore.getState().workspaceMenuOpen).toBe(false);
});
```

> 若 `panelUiStore.test.ts` 尚未 import `usePanelUiStore`，沿用檔案頂部既有 import；上方片段僅補測試本體。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/panels/panelUiStore.test.ts`
Expected: FAIL（`setWorkspaceMenuOpen` 不存在 / `workspaceMenuOpen` undefined）。

- [ ] **Step 3: 在 store 加欄位**

`src/panels/panelUiStore.ts`：在 `PanelUiState` interface 內 `dropMenu` 之後加：

```ts
  /** Whether the toolbar's workspace "Load" dropdown is open (a grid overlay). */
  workspaceMenuOpen: boolean;
```

在同 interface 的 actions 區加：

```ts
  setWorkspaceMenuOpen: (open: boolean) => void;
```

在 `create<PanelUiState>((set) => ({ ... }))` 初值區（`dropMenu: null,` 之後）加：

```ts
  workspaceMenuOpen: false,
```

在 actions 實作區（`closeDropMenu` 之後）加：

```ts
  setWorkspaceMenuOpen: (open) => set({ workspaceMenuOpen: open }),
```

- [ ] **Step 4: WorkspaceMenu 改用 store flag**

`src/components/WorkspaceMenu.tsx`：

移除本地 `menuOpen` state，改成 store。第 1–3 行 import 區加入：

```ts
import { usePanelUiStore } from "../panels/panelUiStore";
```

刪除這一行（第 14 行）：
```ts
  const [menuOpen, setMenuOpen] = useState(false);
```
換成：
```ts
  const menuOpen = usePanelUiStore((s) => s.workspaceMenuOpen);
  const setMenuOpen = usePanelUiStore((s) => s.setWorkspaceMenuOpen);
```

把 `toggleMenu` 改成不用 functional updater（store setter 是絕對值）：

```ts
  const toggleMenu = () => {
    if (!menuOpen) refresh(); // refresh on open
    setMenuOpen(!menuOpen);
  };
```

`doLoad` 內原本的 `setMenuOpen(false);`（第 54 行附近）維持不變即可（setter 簽名相容）。

> `useState` 若已無其他用途仍由其他 state 使用（`saving`、`saveName` 等），保留 import。

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm vitest run src/panels/panelUiStore.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/panels/panelUiStore.ts src/panels/panelUiStore.test.ts src/components/WorkspaceMenu.tsx
git commit -m "feat(web): expose workspace-menu open state for webview suppression"
```

---

## Task 5: useWebSuppressed hook

**Files:**
- Create: `src/panels/web/useWebSuppressed.ts`
- Test: `src/panels/web/useWebSuppressed.test.tsx`

- [ ] **Step 1: 寫失敗測試**

建立 `src/panels/web/useWebSuppressed.test.tsx`：

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWebSuppressed } from "./useWebSuppressed";
import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

describe("useWebSuppressed", () => {
  beforeEach(() => {
    usePanelUiStore.setState({ modal: null, dropMenu: null, workspaceMenuOpen: false });
    useLayoutStore.setState({ selectMode: false });
  });

  it("is false when no overlay is active", () => {
    const { result } = renderHook(() => useWebSuppressed());
    expect(result.current).toBe(false);
  });

  it("is true when a config modal is open", () => {
    usePanelUiStore.setState({ modal: { cellId: "c1", kind: "web", mode: "edit" } });
    const { result } = renderHook(() => useWebSuppressed());
    expect(result.current).toBe(true);
  });

  it("is true in select mode", () => {
    useLayoutStore.setState({ selectMode: true });
    const { result } = renderHook(() => useWebSuppressed());
    expect(result.current).toBe(true);
  });

  it("is true when the workspace menu is open", () => {
    usePanelUiStore.setState({ workspaceMenuOpen: true });
    const { result } = renderHook(() => useWebSuppressed());
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/panels/web/useWebSuppressed.test.tsx`
Expected: FAIL（hook 不存在）。

- [ ] **Step 3: 實作 hook**

建立 `src/panels/web/useWebSuppressed.ts`：

```ts
import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

/**
 * Whether all web panels' native webviews should be hidden right now. Native
 * webviews float above the DOM, so any screen-level overlay (config modal, the
 * folder-drop menu, the workspace dropdown) or select-mode must hide them so the
 * overlay/selection UI underneath stays usable.
 */
export function useWebSuppressed(): boolean {
  const modal = usePanelUiStore((s) => s.modal);
  const dropMenu = usePanelUiStore((s) => s.dropMenu);
  const workspaceMenuOpen = usePanelUiStore((s) => s.workspaceMenuOpen);
  const selectMode = useLayoutStore((s) => s.selectMode);
  return modal !== null || dropMenu !== null || workspaceMenuOpen || selectMode;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run src/panels/web/useWebSuppressed.test.tsx`
Expected: PASS（4 項）。

- [ ] **Step 5: Commit**

```bash
git add src/panels/web/useWebSuppressed.ts src/panels/web/useWebSuppressed.test.tsx
git commit -m "feat(web): useWebSuppressed hook for overlay-aware visibility"
```

---

## Task 6: PanelTypeDef.selfChrome + GridCell 抑制 host 控制列

**Files:**
- Modify: `src/panels/types.ts:21-30`
- Modify: `src/panels/web/index.ts:5-13`
- Modify: `src/grid/GridCell.tsx:121,150-184`
- Test: `src/panels/registry.test.ts`、`src/grid/GridCell.test.tsx`

- [ ] **Step 1: 寫失敗測試（registry + GridCell）**

在 `src/panels/registry.test.ts` 追加：

```ts
import { getPanelType } from "./registry";

it("web panel declares selfChrome (renders its own controls)", () => {
  expect(getPanelType("web")?.selfChrome).toBe(true);
});
```

在 `src/grid/GridCell.test.tsx` 追加一個案例（沿用該檔既有的 render helper / store 設定模式；下方為行為斷言重點）：

```ts
it("hides host hover controls for selfChrome panels (web)", () => {
  // 安排:一個放了 web panel 的 cell(沿用檔案既有的 makeCell / store seed 寫法)
  // render <GridCell cell={webCell} />
  // host 控制列以 aria-label 辨識:
  expect(screen.queryByLabelText("Remove panel")).toBeNull();
  expect(screen.queryByLabelText("Panel settings")).toBeNull();
});
```

> 注意：web panel 自己的 chrome bar 也用相同 aria-label。此測試要驗證的是「host 那層 overlay 不再渲染」。請在測試中以非 Tauri 環境 render（`isTauri()` 為 false），WebView 走 iframe fallback 但仍渲染 chrome bar；因此斷言改為「`Remove panel` 按鈕只有 1 個（來自 chrome bar），而非 2 個（host + chrome）」：
> ```ts
> expect(screen.getAllByLabelText("Remove panel")).toHaveLength(1);
> ```
> 若該 cell 用其他非 selfChrome panel（如 sysmon）render，則應有 host 控制列：`expect(screen.getByLabelText("Remove panel")).toBeInTheDocument();`

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/panels/registry.test.ts src/grid/GridCell.test.tsx`
Expected: FAIL（`selfChrome` undefined；host 控制列仍渲染導致數量為 2）。

- [ ] **Step 3: types.ts 加 selfChrome**

`src/panels/types.ts` 的 `PanelTypeDef` interface，在 `onDestroy?` 之前加：

```ts
  /**
   * When true, the panel's own View renders its window chrome (title bar +
   * controls), so the host (GridCell) skips its hover ⚙/✕/⠿ overlay. Used by
   * the web panel, whose native webview would float over the host overlay.
   */
  selfChrome?: boolean;
```

- [ ] **Step 4: web/index.ts 設旗標**

`src/panels/web/index.ts` 的 `webPanel` 物件加一行（放在 `View: WebView,` 之後）：

```ts
  selfChrome: true,
```

- [ ] **Step 5: GridCell 跳過 host 控制列**

`src/grid/GridCell.tsx`：`panelDef` 已於第 121 行取得。把渲染 host 控制列的 JSX 區塊（第 153–183 行的 `<div className="absolute right-1 top-1 ...">…</div>`）用 `panelDef.selfChrome` 守門。將：

```tsx
          <panelDef.View instanceId={cell.panel.instanceId} config={cell.panel.config} />
          <div className={`absolute right-1 top-1 gap-1 group-hover:flex group-focus-within:flex ${dragging ? "flex" : "hidden"}`}>
            {/* ⠿ ⚙ ✕ buttons */}
          </div>
```

改為：

```tsx
          <panelDef.View instanceId={cell.panel.instanceId} config={cell.panel.config} />
          {!panelDef.selfChrome && (
            <div className={`absolute right-1 top-1 gap-1 group-hover:flex group-focus-within:flex ${dragging ? "flex" : "hidden"}`}>
              {/* 既有的 ⠿ ⚙ ✕ 三顆按鈕原樣保留在此 */}
            </div>
          )}
```

（只在外層包 `{!panelDef.selfChrome && ( … )}`，內部三顆按鈕與其 handler 完全不動。）

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm vitest run src/panels/registry.test.ts src/grid/GridCell.test.tsx`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/panels/types.ts src/panels/web/index.ts src/grid/GridCell.tsx src/panels/registry.test.ts src/grid/GridCell.test.tsx
git commit -m "feat(web): selfChrome flag so host skips overlay controls for web panels"
```

---

## Task 7: WebView controller + chrome bar + iframe fallback

**Files:**
- Modify: `src/panels/web/WebPanel.tsx`（整個 `WebView` 重寫；`WebConfigForm` 不動）
- Test: `src/panels/web/WebPanel.test.tsx`

- [ ] **Step 1: 寫失敗測試（chrome + fallback）**

建立 `src/panels/web/WebPanel.test.tsx`：

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// 非 Tauri 環境:isTauri() = false → 走 iframe fallback,但仍渲染 chrome bar。
vi.mock("../../lib/ipc", async (orig) => {
  const actual = await orig<typeof import("../../lib/ipc")>();
  return { ...actual, isTauri: () => false };
});

import { WebView } from "./WebPanel";

describe("WebView (non-Tauri fallback)", () => {
  beforeEach(() => {
    // seed a layout cell holding this web panel so chrome-bar actions resolve.
    // 沿用 layoutStore 既有 API:此處用 setState 直接塞一個含 web panel 的 cell。
  });

  it("renders the url and an iframe fallback", () => {
    render(<WebView instanceId="w1" config={{ url: "https://example.com" }} />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://example.com");
  });

  it("renders chrome-bar controls", () => {
    render(<WebView instanceId="w1" config={{ url: "https://example.com" }} />);
    expect(screen.getByLabelText("Reload page")).toBeInTheDocument();
    expect(screen.getByLabelText("Panel settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Move panel")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });
});
```

> chrome-bar 的 ⚙/✕ handler 會呼叫 store。測試只驗證渲染與 aria-label 存在即可；handler 行為（openEditModal/clearPanel）由 store 既有測試與 GUI 驗證覆蓋。若 render 時因 store 找不到 cell 而報錯，於 `beforeEach` 用 `useLayoutStore.setState` 塞一個 `cells: [{ id: "c1", ..., panel: { instanceId: "w1", kind: "web", config: { url } } }]`（沿用 `makePreset` 後覆寫 panel 的既有測試慣例）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run src/panels/web/WebPanel.test.tsx`
Expected: FAIL（新版 `WebView` 尚未實作 chrome bar）。

- [ ] **Step 3: 重寫 WebPanel.tsx**

把 `src/panels/web/WebPanel.tsx` 改為（`WebConfigForm` 保留原樣，僅新增 import 與重寫 `WebView` + 內部 `WebChrome`）：

```tsx
import { useEffect, useRef } from "react";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { WebConfig } from "./types";
import {
  isTauri,
  webClose,
  webReload,
  webSetBounds,
  webSetVisible,
  webUpsert,
} from "../../lib/ipc";
import { useLayoutStore } from "../../store/layoutStore";
import { usePanelUiStore } from "../panelUiStore";
import { PANEL_MOVE_DND } from "../dnd";
import { measureRect } from "./geometry";
import { useWebSuppressed } from "./useWebSuppressed";

const RESIZE_DEBOUNCE_MS = 150;
const btn =
  "rounded px-1.5 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white";

/** Always-visible DOM chrome bar (native webview floats above it, so the host's
 *  hover overlay is unusable for web panels — controls live here instead). */
function WebChrome({
  instanceId,
  url,
  slotRef,
  children,
}: {
  instanceId: string;
  url: string;
  slotRef: React.RefObject<HTMLDivElement>;
  children?: React.ReactNode;
}) {
  const cellId = useLayoutStore(
    (s) => s.layout.cells.find((c) => c.panel?.instanceId === instanceId)?.id,
  );
  const clearPanel = useLayoutStore((s) => s.clearPanel);
  const openEditModal = usePanelUiStore((s) => s.openEditModal);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-white/10 bg-neutral-900 px-2">
        <span className="flex-1 truncate text-xs text-white/50" title={url}>
          {url}
        </span>
        <button type="button" aria-label="Reload page" className={btn}
          onClick={() => void webReload(instanceId).catch(console.error)}>
          ↻
        </button>
        <button type="button" aria-label="Move panel" title="Drag to move this panel"
          draggable className={`${btn} cursor-grab active:cursor-grabbing`}
          onDragStart={(e) => {
            if (!cellId) return;
            e.dataTransfer.setData(PANEL_MOVE_DND, cellId);
            e.dataTransfer.effectAllowed = "move";
          }}>
          ⠿
        </button>
        <button type="button" aria-label="Panel settings" className={btn}
          onClick={() => cellId && openEditModal(cellId, "web")}>
          ⚙
        </button>
        <button type="button" aria-label="Remove panel" className={btn}
          onClick={() => cellId && clearPanel(cellId)}>
          ✕
        </button>
      </div>
      <div ref={slotRef} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}

/** Live view: a native child webview (Tauri) positioned over this cell, or an
 *  iframe fallback outside Tauri (dev/test). */
export function WebView({ instanceId, config }: PanelViewProps) {
  const url = (config as unknown as WebConfig).url;
  const slotRef = useRef<HTMLDivElement>(null);
  const tauri = isTauri();
  const suppressed = useWebSuppressed();
  const suppressedRef = useRef(suppressed);

  // Close the child webview when this panel unmounts (removed / moved / kind change).
  useEffect(() => {
    if (!tauri) return;
    return () => void webClose(instanceId).catch(console.error);
  }, [tauri, instanceId]);

  // Create-or-navigate when url changes (web_upsert is idempotent: first call
  // creates, later calls navigate in place).
  useEffect(() => {
    if (!tauri || !url) return;
    const el = slotRef.current;
    if (!el) return;
    void webUpsert(instanceId, url, measureRect(el)).catch(console.error);
  }, [tauri, instanceId, url]);

  // Follow the cell: hide on any size change, snap to final rect + show once
  // quiescent. Splitter drags and window resizes both flow through here.
  useEffect(() => {
    if (!tauri || !url) return;
    const el = slotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    let hidden = false;
    const hide = () => {
      if (!hidden) {
        hidden = true;
        void webSetVisible(instanceId, false).catch(console.error);
      }
    };
    const settle = () => {
      if (suppressedRef.current) return;
      void webSetBounds(instanceId, measureRect(el)).catch(console.error);
      if (hidden) {
        hidden = false;
        void webSetVisible(instanceId, true).catch(console.error);
      }
    };
    const ro = new ResizeObserver(() => {
      hide();
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(settle, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [tauri, instanceId, url]);

  // Overlay-aware visibility: hide behind modals/menus/select-mode, restore after.
  useEffect(() => {
    suppressedRef.current = suppressed;
    if (!tauri || !url) return;
    if (suppressed) {
      void webSetVisible(instanceId, false).catch(console.error);
    } else {
      const el = slotRef.current;
      if (el) {
        void webSetBounds(instanceId, measureRect(el)).catch(console.error);
        void webSetVisible(instanceId, true).catch(console.error);
      }
    }
  }, [tauri, instanceId, url, suppressed]);

  return (
    <WebChrome instanceId={instanceId} url={url} slotRef={slotRef}>
      {!tauri && (
        <iframe
          src={url}
          title={url}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </WebChrome>
  );
}

/** Config form: a single URL text field. */
export function WebConfigForm({ config, onChange }: ConfigFormProps) {
  const url = (config as unknown as WebConfig).url ?? "";
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      URL
      <input
        type="url"
        value={url}
        placeholder="https://…"
        autoFocus
        onChange={(e) => onChange({ ...config, url: e.target.value })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run src/panels/web/WebPanel.test.tsx`
Expected: PASS（2 項）。

- [ ] **Step 5: 全套單元測試 + lint/build 綠**

Run:
```bash
pnpm vitest run && pnpm tsc --noEmit
```
Expected: 全綠（含既有 web/types.test.ts、App.test.tsx 等）。若 `WebConfigForm`/`webReady` 既有測試引用路徑未變，應不受影響。

- [ ] **Step 6: Commit**

```bash
git add src/panels/web/WebPanel.tsx src/panels/web/WebPanel.test.tsx
git commit -m "feat(web): WebView controller drives native child webview with chrome bar"
```

---

## Task 8: 原生 GUI 實機驗證

**Files:** 無程式碼變更（驗證 + 記錄）。

依 verify-tauri-gui 配方（見 memory `greedgrid-gui-verify-recipe`）以 XTest + 全視窗 screenshot 程式化驅動原生視窗。逐項確認並截圖存證：

- [ ] **Step 1: 啟動 app**

Run: `pnpm tauri dev`（或既有 verify 配方的啟動方式），等待視窗出現。

- [ ] **Step 2: 放置 web panel 並輸入會擋 iframe 的網址**

操作：在某 cell 選 Web → ConfigModal 輸入 `https://github.com` → 確認。
Expected: cell 內出現 28px chrome bar（顯示網址 + ↻⠿⚙✕），下方原生 webview **正常顯示 GitHub 首頁**（不再空白）。再以 `https://www.google.com`、`https://www.youtube.com` 各驗一次。

- [ ] **Step 3: splitter 拖曳跟隨**

操作：拖動該 web cell 邊界的 splitter。
Expected: 拖曳過程 webview 隱藏（露出 cell 底色/網址列），放開後 webview snap 對齊新尺寸並重新顯示，無殘影/錯位。

- [ ] **Step 4: 視窗縮放跟隨**

操作：縮放整個視窗。
Expected: 縮放中隱藏、靜止後對齊顯示。

- [ ] **Step 5: overlay 抑制**

操作：(a) 開 ⚙ ConfigModal；(b) 開 toolbar 的 📂 Load 下拉；(c) 進入 Select 模式。
Expected: 三種情況下 webview 皆隱藏，對應的 modal/選單/選取 overlay 完整可見可操作；關閉後 webview 復原。

- [ ] **Step 6: 移除與切換**

操作：(a) 按 chrome bar 的 ✕ 移除 panel；(b) 另放一個 web panel 後用 ⚙ 改網址。
Expected: (a) webview 消失、cell 回到空狀態；(b) webview 原地導覽到新網址。

- [ ] **Step 7: 記錄結果**

把截圖與結論記錄到驗證輸出（沿用既有 verify 慣例）。若全綠，更新 memory `m3-terminal-panel-done` 風格的完成註記（本任務於收尾 §後續 處理，不在此 commit）。

---

## Self-Review（撰寫者自查結果）

- **Spec coverage**：
  - §1 根因 → 本計畫前言/spec 連結。
  - §3.1 controller + chrome bar → Task 7；§3.2 Rust 指令 + registry（以 label 查詢取代額外 registry）→ Task 1；ipc → Task 2。
  - §4.1 建立/銷毀/導覽 → Task 7（三個 effect）。
  - §4.2 跟隨（debounce 隱藏-對齊）→ Task 7（ResizeObserver effect）。
  - §4.3 overlay 隱藏 → Task 4 + 5 + 7（suppression effect）。
  - §4.4 select-mode → Task 5（`selectMode` 納入 hook）。
  - §5 持久化 → 無需改動（沿用既有 config JSON）；計畫未新增欄位，符合。
  - §6 取捨：unstable feature → Task 1 Step 1；iframe fallback → Task 7；拖移 reload → 由「unmount close + 重掛載 upsert」自然成立，已於架構說明標註。
  - §7 測試 → Task 2/3/4/5/6/7 單元 + Task 8 GUI。
  - §8 影響檔案 → 與本計畫 File Structure 一致。
- **Placeholder scan**：無 TBD/TODO；每個改碼步驟都附完整 code。GUI 任務（Task 8）為操作清單，本質非程式碼，附明確預期。
- **Type consistency**：`WebRect`（ipc，Task 2）→ `measureRect`（Task 3）→ WebView（Task 7）一致；`webUpsert/webSetBounds/webSetVisible/webReload/webClose` 命名前後一致；`selfChrome`（Task 6）一致；`workspaceMenuOpen/setWorkspaceMenuOpen`（Task 4）於 Task 5 使用一致；Rust 指令名 `web_upsert/web_set_bounds/web_set_visible/web_reload/web_close` 與 ipc 字串一致。
- **已知風險**：Tauri unstable API 的 `.window()` / `add_child` / `get_webview` 簽名於 Task 1 Step 5 附 fallback 指引；其餘為標準 React/zustand 模式。
