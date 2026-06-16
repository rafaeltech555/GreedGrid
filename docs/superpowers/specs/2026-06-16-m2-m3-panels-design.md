# GreedGrid M2 + M3 — Pluggable Panels Design

_Date: 2026-06-16_

---

## Overview / Goals

**M2** delivers the pluggable panel-type interface, a panel host that renders registered types into grid cells, placement UX (empty-cell click and side palette), a unified config dialog, and the Web/URL panel as the first concrete type.

**M3** delivers the Terminal panel: xterm.js on the frontend, portable-pty on the Rust backend, output streamed via Tauri Channel, with bounded reconnect within a single app run.

**M3b (future, out of scope):** Detached-session reattach — a pty survives panel removal and can be reattached to any cell from a session list (tmux-like). Not designed here; note the hook points where M3b would plug in.

**Non-goals:** GreedGrid is not a window manager. It does not reparent external OS windows. The Terminal and File Browser are native panels rendered inside the GreedGrid window, not embedded OS window handles.

---

## §1 Panel Plugin Architecture & Data Model

### Frontend panel registry

New file `src/panels/types.ts` exports the registry interface and the registry map:

```ts
import type { PanelKind } from '@/lib/types';

export interface PanelTypeDef<C = Record<string, unknown>> {
  kind: PanelKind;
  label: string;                   // palette / menu display name
  glyph: string;                   // single-char icon for compact UI
  defaultConfig: () => C;          // called once on placement
  ready: (config: C) => boolean;   // if false, open ConfigForm modal before placing
  ConfigForm: React.FC<{ config: C; onChange: (c: C) => void }>;
  View: React.FC<{ instanceId: string; config: C }>;
  onDestroy?: (instanceId: string, config: C) => void; // cleanup on removal
}

export const panelRegistry: Record<PanelKind, PanelTypeDef>;
```

`panelRegistry` is a plain object keyed by `PanelKind` (`"terminal" | "file" | "web" | "sysmon"`). Each panel module exports a `PanelTypeDef` and the registry file aggregates them. No dynamic plugin loading — the four kinds are compile-time known.

### Data model

**Reuse `PanelConfig` unchanged.** The existing shape in `src/lib/types.ts` — `{ instanceId: string; kind: PanelKind; config: Record<string, unknown> }` — is the long-lived persistence contract targeted for M6. No new fields are added to `PanelConfig` or `Cell`.

New store actions added to `layoutStore.ts`:

```ts
setPanel(cellId: string, kind: PanelKind): void
// generate instanceId (crypto.randomUUID()), call defaultConfig(), write to cell

updatePanelConfig(cellId: string, config: Record<string, unknown>): void
// replace config in-place; does not change instanceId or kind

clearPanel(cellId: string): void
// calls onDestroy(instanceId, config) if registered, then nulls cell.panel
```

### instanceId generation

Use `crypto.randomUUID()` via an injectable generator, mirroring the style in `src/grid/cellId.ts`. The store accepts an optional `idGen` parameter (defaults to `crypto.randomUUID`) so unit tests can supply deterministic ids.

### Lifecycle hook: onDestroy

When a cell's panel is removed for any reason — `clearPanel`, a merge that absorbs the cell, a split that re-creates it, or a kind-change — the current instance's `onDestroy` is called before the new state is written. This must be wired into the existing merge/split paths in `src/grid/merge.ts` and the store actions. The Terminal panel uses `onDestroy` to send `term_close`; the Web panel uses it to send `web_close` (native-webview path only). Panels that need no teardown omit `onDestroy`.

---

## §2 Placement UX & Config Dialog

Two placement methods are supported. The config modal is shared.

### Method 1: Empty-cell click

An empty cell renders a centered `+` button. Clicking opens an inline or floating panel-type list drawn from `panelRegistry` (label + glyph for each kind). On selection:

1. Call `ready(defaultConfig())` for the chosen kind.
2. If `true`: call `setPanel(cellId, kind)` immediately — panel appears.
3. If `false`: open the unified config modal pre-populated with `defaultConfig()`. On OK: call `setPanel` then `updatePanelConfig`. On Cancel: no change.

### Method 2: Side palette

A thin fixed-width column on the left lists all registered panel types (glyph + label). Each entry is a native HTML5 drag source (`draggable="true"`, `onDragStart` stores the kind in `dataTransfer`). Each `GridCell` is a drop target (`onDragOver` + `onDrop`). The drop handler follows the same ready-check logic as Method 1. The drop-hit logic (determining which cell receives the drop) is extracted as a pure function for unit testability:

```ts
// src/panels/dnd.ts
export function resolveDropTarget(
  cells: Cell[],
  dropCellId: string
): Cell | null
```

### Placed-panel controls

Once a cell hosts a panel, two controls appear on hover (top-right corner overlay):

- **Gear (⚙)**: opens the unified config modal for that instance → on OK calls `updatePanelConfig`.
- **✕**: calls `clearPanel(cellId)`.

### Unified config modal

A shared modal shell: title bar (kind label), scrollable body (injected `ConfigForm`), OK / Cancel buttons. The modal is controlled — it holds a local config draft; OK commits via `updatePanelConfig`, Cancel discards. The same component serves both first-time placement (from Method 1) and later editing (from the gear button). It is not tied to any specific panel type.

---

## §3 Web Panel (iframe-First Hybrid)

**Decision locked: iframe-first hybrid.**

The Web panel handles arbitrary URLs. It does not have a file-browser role.

### Default path: iframe

Render the configured URL in a sandboxed `<iframe>`. This covers the majority of use cases: intranet dashboards, Grafana, self-hosted monitoring pages, documentation sites. No backend involvement.

### Fallback detection

When the iframe load event fires, check whether framing was blocked. A blocked frame can be detected by catching the load error or by observing a blank frame with `contentDocument` inaccessible (cross-origin + X-Frame-Options / CSP `frame-ancestors`). On detection:

- Display a friendly inline message explaining the iframe was blocked.
- Show a button: **"Open in embedded webview"**.

### Native Tauri child-webview path (on-demand)

Clicking "Open in embedded webview" switches that panel instance to a native Tauri v2 child webview (the `unstable` multi-webview feature). This is per-instance — other Web panels remain on the iframe path.

Backend commands (added to `src-tauri/src/commands/web.rs`):

```rust
#[tauri::command]
async fn web_open(instance_id: String, url: String, bounds: Bounds, app: AppHandle) -> Result<()>

#[tauri::command]
async fn web_set_bounds(instance_id: String, bounds: Bounds, app: AppHandle) -> Result<()>

#[tauri::command]
async fn web_navigate(instance_id: String, url: String, app: AppHandle) -> Result<()>

#[tauri::command]
async fn web_set_visible(instance_id: String, visible: bool, app: AppHandle) -> Result<()>

#[tauri::command]
async fn web_close(instance_id: String, app: AppHandle) -> Result<()>
```

`Bounds` is a struct `{ x: f64, y: f64, width: f64, height: f64 }` in physical pixels.

The child webview is labeled by `instanceId`. A `HashMap<instanceId, WebviewWindow>` in a `Mutex`-wrapped state holds live references.

**Bounds synchronization:** The frontend `WebPanel` `View` renders an anchor `<div>` that fills its cell. A `ResizeObserver` + layout effect measures the div's `DOMRect` (CSS pixels) and converts to physical pixels via `window.devicePixelRatio`. It calls `web_set_bounds` on mount, on every resize observation, on window resize, and at splitter-drag-end. This keeps the child webview positioned directly over its anchor div.

**z-order handling:** Native webviews float above the DOM and occlude modals, the side palette, and splitter drag handles. Mitigation strategy:

- When a modal or palette opens, call `web_set_visible(false)` on all active web-panel webviews; restore on close.
- While a splitter drag is in progress (the `resizeTrack` state in `GridHost.tsx` is active), hide all web webviews; restore on drag end.
- When a cell is merged away, call `web_close` for any web-panel instance that lived in that cell (via the `onDestroy` hook).

**`onDestroy`:** Calls `web_close(instanceId)` if the instance is on the native-webview path. No-op for iframe-path instances.

### WebConfig type

```ts
// src/panels/web/types.ts
export interface WebConfig {
  url: string;     // must be non-empty for ready() to return true
}
```

`ready(config)` returns `config.url.trim().length > 0`. The URL is validated to be `http://` or `https://` before opening.

### Rationale (recorded decision)

iframe is simpler, zero backend cost, and works for the primary use cases (intranet, Grafana, self-hosted pages). Its only real limitation is sites that refuse framing via `X-Frame-Options` or `CSP frame-ancestors`, plus some `SameSite=Strict` cookie scenarios that prevent session carry-over. Native child webview embeds everything but constantly fights the grid (manual positioning, z-order, bounds synchronization overhead). The hybrid pays the native-webview complexity only for instances that actually need it, keeping the common case simple.

---

## §4 Terminal Panel + Backend PTY Registry (M3)

**Decision locked: bounded reconnect within a single app run.**

### Backend: PTY registry

Add `src-tauri/src/pty.rs` (or `src-tauri/src/commands/pty.rs`). Tauri app state holds:

```rust
pub struct PtyRegistry(pub Mutex<HashMap<String, PtySession>>);

pub struct PtySession {
    writer: Box<dyn Write + Send>,          // pty master input
    child: Box<dyn portable_pty::Child + Send>,
    scrollback: ScrollbackBuffer,           // ring buffer, ~256 KB
    // reader thread handle is detached; it holds a weak ref / channel to
    // push bytes to the currently-attached frontend Channel, if any
}
```

`ScrollbackBuffer` is a fixed-capacity `VecDeque<u8>` that drops the oldest bytes when the limit is reached.

### Tauri commands

```rust
#[tauri::command]
async fn term_open(
    instance_id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<Vec<u8>>,
    state: State<'_, PtyRegistry>,
) -> Result<()>
// If no session exists: spawn a new pty with the given shell/cwd/size.
// If a session exists: replay scrollback into channel, then attach channel
// as the live output sink. This is the reconnect path.

#[tauri::command]
async fn term_write(instance_id: String, data: Vec<u8>, state: State<'_, PtyRegistry>) -> Result<()>

#[tauri::command]
async fn term_resize(instance_id: String, cols: u16, rows: u16, state: State<'_, PtyRegistry>) -> Result<()>

#[tauri::command]
async fn term_close(instance_id: String, state: State<'_, PtyRegistry>) -> Result<()>
// Kill child process, drop PtySession from map.
```

Output is delivered via `Channel<Vec<u8>>` (Tauri v2 channel primitive), not global events. Each `term_open` call attaches a new channel; the reader thread routes bytes to whichever channel is currently attached.

### Frontend: Terminal View

`src/panels/terminal/TerminalView.tsx`:

1. On mount: create a Tauri `Channel<Uint8Array>`, call `termOpen(instanceId, config, cols, rows, channel)`.
2. Instantiate `xterm.js` `Terminal` + `FitAddon`. Attach the Channel's `onmessage` to `xterm.write(data)`.
3. User keystrokes: `xterm.onData(data => termWrite(instanceId, data))`.
4. Resize: `FitAddon.fit()` on container resize → `termResize(instanceId, cols, rows)`.
5. On unmount: detach the channel (stop routing output to this instance); do NOT call `term_close`. The pty stays alive in the registry.

The terminal must support full interactive TUIs — vim, htop, and running `claude` itself — because it is backed by a real pty pair and xterm.js renders the full VT sequence set.

### Lifecycle: bounded reconnect

The pty is owned by the backend registry, keyed by `instanceId`, independent of React component lifecycle. React component unmount (navigating away, collapsing a row) does not terminate the process. Remounting the same `instanceId` replays scrollback first so the user sees previous output, then resumes live streaming.

A pty instance is terminated only by an explicit user action:

- Clicking ✕ on the panel (calls `clearPanel` → `onDestroy` → `term_close`).
- The cell being merged away (same path via `onDestroy`).

The pty also terminates when the backend process exits (app close). There is no persistence across app restarts in M3.

**M3b hook point:** To support detached-session reattach in M3b, `onDestroy` would need a "detach, don't kill" mode. That distinction is not designed here; when M3b is scoped, the `onDestroy` signature may grow a `reason` parameter.

### TermConfig type

```ts
// src/panels/terminal/types.ts
export interface TermConfig {
  shell?: string;  // defaults to $SHELL or /bin/bash
  cwd?: string;    // defaults to $HOME
}
```

`ready(config)` always returns `true` — the terminal can open with defaults.

---

## §5 IPC, Types & Testing

### IPC conventions

Typed wrappers for all new commands live in `src/lib/ipc.ts`, following the existing pattern (callers never touch raw command-name strings):

```ts
export const webOpen = (instanceId: string, url: string, bounds: Bounds) =>
  invoke<void>('web_open', { instanceId, url, bounds });

export const webSetBounds = (instanceId: string, bounds: Bounds) =>
  invoke<void>('web_set_bounds', { instanceId, bounds });

export const webNavigate = (instanceId: string, url: string) =>
  invoke<void>('web_navigate', { instanceId, url });

export const webSetVisible = (instanceId: string, visible: boolean) =>
  invoke<void>('web_set_visible', { instanceId, visible });

export const webClose = (instanceId: string) =>
  invoke<void>('web_close', { instanceId });

export const termOpen = (
  instanceId: string,
  config: TermConfig,
  cols: number,
  rows: number,
  channel: Channel<Uint8Array>
) => invoke<void>('term_open', { instanceId, ...config, cols, rows, channel });

export const termWrite = (instanceId: string, data: Uint8Array) =>
  invoke<void>('term_write', { instanceId, data });

export const termResize = (instanceId: string, cols: number, rows: number) =>
  invoke<void>('term_resize', { instanceId, cols, rows });

export const termClose = (instanceId: string) =>
  invoke<void>('term_close', { instanceId });
```

### Rust module layout

`commands.rs` is split into submodules:

```
src-tauri/src/commands/
  mod.rs       — re-exports all handlers
  web.rs       — web_open, web_set_bounds, web_navigate, web_set_visible, web_close
  pty.rs       — term_open, term_write, term_resize, term_close
```

`src-tauri/src/lib.rs` registers all handlers from `commands::mod` and adds `PtyRegistry` to Tauri app state via `.manage(PtyRegistry(Mutex::new(HashMap::new())))`.

### Per-panel config types

```ts
// src/panels/web/types.ts
export interface WebConfig { url: string; }

// src/panels/terminal/types.ts
export interface TermConfig { shell?: string; cwd?: string; }
```

`PanelConfig.config` remains `Record<string, unknown>` — each plugin's `ConfigForm` and `View` cast to their typed config internally. The persistence contract is unchanged.

### Testing (Vitest + Rust)

**Pure-logic Vitest tests (no Tauri runtime needed):**

| Test target | What to cover |
|---|---|
| `panelRegistry` lookup | All four kinds present; `defaultConfig` returns a fresh object each call |
| `setPanel` / `updatePanelConfig` / `clearPanel` | State transitions; `onDestroy` fires with correct instanceId+config on clear; does not fire on update |
| `onDestroy` via merge/split | Merging a cell with a panel calls `onDestroy` on the absorbed panel |
| DnD `resolveDropTarget` | Returns correct cell for a given drop cellId; returns null for occupied cells if applicable |
| Bounds conversion | CSS px → physical px with `devicePixelRatio` mock |
| `WebConfig.ready` | Empty string → false; whitespace → false; valid URL → true |
| `TermConfig.ready` | Always true |
| `instanceId` injection | Custom `idGen` passed to `setPanel` produces deterministic ids |

**Manual verification (`pnpm tauri dev`):** Streaming behavior — pty output delivery, xterm rendering, scrollback replay on remount, native-webview bounds synchronization — is verified manually because it requires a live Tauri runtime and cannot be driven by Vitest.

**Rust unit tests (`cargo test`):** `PtyRegistry` spawn → write round-trip → scrollback replay → close lifecycle, without a real frontend channel (use a mock `Sender`).

---

## Implementation Phasing

### M2

Deliver §1 + §2 + §3 in order:

1. **§1 architecture**: `src/panels/types.ts`, registry, store actions (`setPanel`, `updatePanelConfig`, `clearPanel`), `onDestroy` wired into merge/split.
2. **§2 placement UX**: empty-cell `+` click, panel-type list, side palette with HTML5 DnD, gear/✕ controls, unified config modal.
3. **§3 Web panel**: iframe-first path with blocked-frame detection message; then native-webview fallback with backend commands, bounds sync, and z-order mitigation.

Completing M2 proves the pluggable interface end-to-end with a panel that requires a backend (native-webview path) without taking on the pty complexity.

### M3

Deliver §4 on top of the M2 foundation:

1. Backend pty registry (`portable-pty` integration, `PtyRegistry` state, commands).
2. Frontend `TerminalView` (xterm.js, Channel wiring, FitAddon resize).
3. `onDestroy` → `term_close` integration.
4. Manual verification of TUI compatibility (vim, htop, `claude`).

### M3b (future)

Detached-session reattach — pty survives `onDestroy`, reattach from a session list. Out of scope for this document.
