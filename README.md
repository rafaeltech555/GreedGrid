# GreedGrid

> *greed × grid* — a screen-splitting monitoring dashboard as a desktop app.

GreedGrid is a **Tauri v2** desktop application that turns one window into a resizable, mergeable grid of pluggable monitoring panels. Pick a cell-count preset (4 / 6 / 8 / 9 / 12 cells), place panel types into cells via the in-cell picker, and save the whole layout as a named workspace. Panels can be moved between cells by dragging the grip handle (⠿) in each panel's control bar. The UI uses **Space Grotesk** (self-hosted via `@fontsource`) and a custom grid-with-emerald app icon.

**GreedGrid is not a window manager.** It hosts its own panels inside the app — it does not reparent external OS windows. Panel types are designed to be pluggable, so an "embed external X11 window" type can be added in the future without reworking the core.

---

## Panel Types

| Panel | Technology |
|---|---|
| **Terminal** | portable-pty + Tauri Channel + xterm.js |
| **File Browser** | Custom Rust file-system commands |
| **Web / URL** | raw wry + gtk::Overlay (native webview, Linux); iframe fallback (dev/non-Linux) |
| **System Monitor** | sysinfo crate |

---

## Tech Stack

- **Desktop shell:** Tauri v2 (Rust)
- **UI:** React 19 + Vite 7 + TypeScript
- **State:** Zustand
- **Styles:** Tailwind CSS v4 + Space Grotesk (self-hosted via `@fontsource/space-grotesk`)
- **Tests:** Vitest + Testing Library
- **Package manager:** pnpm
- **Target platform:** Linux X11 / Cinnamon (cross-platform capable)

---

## Roadmap

| Milestone | Description | Status |
|---|---|---|
| **M0** | Scaffold — Tauri v2 + React 19 + typed IPC, `ping` health-check, 9-cell hello-grid | ✅ Done |
| **M1** | Grid engine — preset layouts (4/6/8/9/12), draggable splitters to resize tracks, merge/split adjacent cells (cells are selected via a **Select** mode toggle button in the Toolbar — overlays an intercept layer so any panel can be clicked — or by Ctrl/Cmd+left-click; switching a preset remaps panels by position and only prompts when a panel cannot fit, preserving running Terminal/sysmon/Web panels) | ✅ Done |
| **M2** | Panel host + pluggable panel-type interface (`PanelTypeDef` registry), empty-cell picker placement, unified config modal, Web/URL panel (iframe) — palette drag-and-drop was removed in a later cleanup | ✅ Done |
| **M3** | Terminal panel — portable-pty PTY backend + xterm.js frontend, output streamed over Tauri Channel, 256 KB scrollback ring buffer, same-run reconnect with scrollback replay; on panel removal the pty is detached (kept alive), not killed; GNOME-style clipboard shortcuts: Ctrl+Shift+C copies selection, Ctrl+Shift+V pastes (via Tauri clipboard plugin), Ctrl+C remains SIGINT | ✅ Done |
| **M3b** | Detached-terminal reattach — `term_detach` command keeps the pty alive on panel removal; `term_list` returns `SessionInfo { instanceId, shell, cwd, alive, attached }`; the empty-cell PanelPicker shows a "Detached terminals" section where alive sessions show a green dot and exited sessions show a grey dot; each entry has **Reattach** (binds a new terminal panel to the existing instanceId, replaying scrollback, attachable to any cell) and **Kill ✕** (calls `term_close` explicitly); exited sessions remain listed so their last output can be reviewed; tmux-like: pty survives panel removal and can be reattached to any cell with full history | ✅ Done |
| **M4** | System Monitor panel — shared background sampler thread (`sysinfo` crate) writes a `SysSnapshot` every 1 s; frontend polls on a configurable interval (default 2 s) and displays CPU%, memory, swap, load average, and uptime with rolling SVG sparklines for CPU% and Mem% | ✅ Done |
| **M5** | File Browser panel — custom Rust `std::fs` commands (`fs_list`, `fs_delete`, `fs_rename`, `fs_mkdir`), folder-first listing with hidden files, navigate directories + open files with OS default app (`tauri-plugin-opener`), inline rename, new-folder creation, permanent delete guarded by confirm dialog | ✅ Done |
| **M6** | Workspace persistence — named workspaces saved as JSON files in the app config `workspaces/` directory; Save / Load / List / Delete via toolbar Workspace menu; atomic write; layout stored as opaque JSON string (schema owned by frontend) | ✅ Done |

> **Note (M2):** The Web/URL panel shipped as iframe-first. The native-webview upgrade (bypassing `X-Frame-Options`/CSP `frame-ancestors` restrictions) shipped as a post-v1 addition — see "Web panel native webview" in the post-v1 table below.

> **Note (M3/M3b):** Panel removal calls `term_detach`, keeping the pty alive — it is **not** killed. An explicit **Kill ✕** action (via the PanelPicker or `term_close` command) is required to destroy a session. Exited sessions are also retained so their scrollback can be reviewed or the session killed cleanly. The same-run reconnect path is covered by a Rust integration test. The pty is spawned with `TERM=xterm-256color` and `COLORTERM=truecolor` explicitly set on the `CommandBuilder`, so colour-aware tools (bash prompt, `ls`, `vim`, `git`) work correctly whether GreedGrid is launched from a terminal or a desktop icon (where the GUI process would otherwise have no `TERM`).

> **Note (M4):** Per-core CPU breakdown, network/disk I/O, process list, temperature sensors, history persistence, and alert thresholds are deferred to future milestones.

> **Note (M5):** Delete is permanent (no Trash/recycle-bin). Copy/move/paste, multi-select, drag-and-drop, file preview, and an editable path bar are deferred to future milestones.

> **Note (M6):** Automatic session restore, workspace rename, import/export, thumbnail preview, and cloud sync are deferred to future work.

### Post-v1 additions (shipped after M6)

| Addition | Description |
|---|---|
| **Cell selection** | Two ways to select cells for Merge/Split: (1) **Select mode** — a Toolbar toggle button overlays a transparent intercept layer on every cell so clicks are captured before any inner content, enabling selection of any panel type including Web panels (native webview hides during select mode, revealing the cell for interaction); (2) **Ctrl/Cmd+left-click** anywhere on a cell without entering Select mode. Esc or a successful merge/split exits Select mode automatically. Fixes the post-M2 regression where Merge/Split were always disabled. |
| **Merged-cell splitter fix** | After merging cells, splitter dividers no longer bleed through merged regions. `boundarySegments` now slices each border segment by the cells it crosses, so merged cells only see the splitters on their actual boundaries. |
| **Preset-switch panel remapping** | Switching the cell-count preset now remaps existing panels to the nearest same-(col, row) cell in the new layout instead of discarding all of them. Only panels that genuinely fall outside the new grid bounds trigger a confirm dialog; the rest (Terminal PTY, System Monitor, Web) are preserved and keep running. |
| **App icon** | Custom icon generated via `scripts/make_icon.py` (Pillow): dark rounded square, 3 × 3 grid lines, one emerald-400 accent cell. The full icon set (`src-tauri/icons/*`) is regenerated with `pnpm tauri icon`. |
| **UI font — Space Grotesk** | Self-hosted via `@fontsource/space-grotesk` (weights 400/500/600/700). Terminal panels continue to use a monospace font unchanged. |
| **Panel drag-move between cells** | Each panel's control bar shows a grip handle (⠿). Drag it onto any other cell to move the panel there. If the target cell is empty the panel simply moves; if it is already occupied, the two panels **swap** positions. The move preserves the panel's `instanceId`, so Terminal PTY sessions and System Monitor subscriptions keep running without interruption — the panel stays live throughout. |
| **Open File/Terminal at a specific folder** | When placing a **File** or **Terminal** panel from the picker, a **native folder picker dialog** opens first. Selecting a folder opens the panel rooted there (File → `config.path`, Terminal → `config.cwd`); cancelling falls back to the system default (`$HOME`). This is the primary, reliable path on all platforms. — Additionally, dragging a folder from the OS file manager onto a grid cell triggers a floating **DropMenu** that lets you choose File or Terminal; if a file is dropped, its parent directory is used, and dropping onto an occupied cell shows a confirmation dialog. This OS drag-drop path is a **cross-platform best-effort** supplement: it works on Windows and macOS, but is not triggered on some Linux environments (e.g. Cinnamon / X11 / WebKitGTK) due to an upstream Tauri/WebKitGTK limitation ([tauri-apps/tauri#9725](https://github.com/tauri-apps/tauri/issues/9725)); the native folder picker is the reliable fallback for those systems. The OS drag-drop code is preserved and will automatically benefit from any future upstream fix. |
| **Terminal file-path insert** | Ctrl+Shift+O (or the 📎 button in the terminal panel's lower-right corner) opens a native OS file-picker and pastes the chosen paths — POSIX-single-quoted, space-separated, with a trailing space — directly into the running pty. Useful for feeding images/files to a CLI in the terminal (e.g. Claude Code). On Linux, native drag-drop into the WebKitGTK webview is unreliable ([tauri-apps/tauri#9725](https://github.com/tauri-apps/tauri/issues/9725)); the OS file-picker is the reliable alternative on those systems. |
| **Web panel native webview** | Replaces the Web/URL panel's iframe with a native webview overlay, bypassing `X-Frame-Options` / CSP `frame-ancestors` restrictions that blocked most real sites. Architecture: on Linux, a `gtk::Overlay` replaces the default GtkBox as the main window's child — the main React webview stays as the base child, and a pass-through `gtk::Fixed` overlay layer hosts raw `wry` webviews (one per web panel instance) positioned over their cells while keeping the React UI clickable in the empty areas. Each web panel renders its own 28 px chrome bar (DOM, always above the native webview: reload ↻, move ⠿, settings ⚙, close ✕) and drives the webview via 5 Tauri IPC commands (`web_upsert` / `web_set_bounds` / `web_set_visible` / `web_reload` / `web_close`). Visibility is managed via ResizeObserver debounce (hide on resize, snap + show on quiescence) and suppression hooks (hide behind modals / workspace menu / select mode). Non-Linux: stub commands + iframe fallback. |

---

## Development

**Prerequisites:** Rust toolchain, Node.js, pnpm, and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
# Install JS dependencies
pnpm install

# Start dev server (Vite + Tauri hot-reload)
pnpm tauri dev

# Run unit tests
pnpm test

# Production build (full desktop binary)
pnpm tauri build
```

Rust code lives in `src-tauri/`. IPC commands are declared in `src-tauri/src/commands/` (split into per-feature modules) and exposed via the typed `src/lib/ipc.ts` wrapper on the frontend.
