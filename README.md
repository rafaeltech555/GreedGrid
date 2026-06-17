# GreedGrid

> *greed × grid* — a screen-splitting monitoring dashboard as a desktop app.

GreedGrid is a **Tauri v2** desktop application that turns one window into a resizable, mergeable grid of pluggable monitoring panels. Pick a cell-count preset (4 / 6 / 8 / 9 / 12 cells), drag panel types into cells, and save the whole layout as a named workspace. The UI uses **Space Grotesk** (self-hosted via `@fontsource`) and a custom grid-with-emerald app icon.

**GreedGrid is not a window manager.** It hosts its own panels inside the app — it does not reparent external OS windows. Panel types are designed to be pluggable, so an "embed external X11 window" type can be added in the future without reworking the core.

---

## Panel Types

| Panel | Technology |
|---|---|
| **Terminal** | portable-pty + Tauri Channel + xterm.js |
| **File Browser** | Custom Rust file-system commands |
| **Web / URL** | iframe (webview) |
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
| **M1** | Grid engine — preset layouts (4/6/8/9/12), draggable splitters to resize tracks, merge/split adjacent cells (cells are selected via a **Select** mode toggle button in the Toolbar — overlays an intercept layer so any panel including Web/iframe can be clicked — or by Ctrl/Cmd+left-click for non-iframe cells; switching a preset remaps panels by position and only prompts when a panel cannot fit, preserving running Terminal/sysmon/Web panels) | ✅ Done |
| **M2** | Panel host + pluggable panel-type interface (`PanelTypeDef` registry), empty-cell picker + palette drag-and-drop placement, unified config modal, Web/URL panel (iframe) | ✅ Done |
| **M3** | Terminal panel — portable-pty PTY backend + xterm.js frontend, output streamed over Tauri Channel, 256 KB scrollback ring buffer, same-run reconnect with scrollback replay, pty killed on panel removal | ✅ Done |
| **M4** | System Monitor panel — shared background sampler thread (`sysinfo` crate) writes a `SysSnapshot` every 1 s; frontend polls on a configurable interval (default 2 s) and displays CPU%, memory, swap, load average, and uptime with rolling SVG sparklines for CPU% and Mem% | ✅ Done |
| **M5** | File Browser panel — custom Rust `std::fs` commands (`fs_list`, `fs_delete`, `fs_rename`, `fs_mkdir`), folder-first listing with hidden files, navigate directories + open files with OS default app (`tauri-plugin-opener`), inline rename, new-folder creation, permanent delete guarded by confirm dialog | ✅ Done |
| **M6** | Workspace persistence — named workspaces saved as JSON files in the app config `workspaces/` directory; Save / Load / List / Delete via toolbar Workspace menu; atomic write; layout stored as opaque JSON string (schema owned by frontend) | ✅ Done |

> **Note (M2):** The Web/URL panel shipped as iframe-first. A native-webview fallback (for sites that refuse framing via X-Frame-Options/CSP) is deferred to a later phase — it will be the first Rust-side panel work.

> **Note (M3):** The pty is killed on explicit panel removal. Detached-session reattach (M3b) and a UI trigger for scrollback replay on React remount are deferred to a future phase — the same-run reconnect path is covered by a Rust integration test.

> **Note (M4):** Per-core CPU breakdown, network/disk I/O, process list, temperature sensors, history persistence, and alert thresholds are deferred to future milestones.

> **Note (M5):** Delete is permanent (no Trash/recycle-bin). Copy/move/paste, multi-select, drag-and-drop, file preview, and an editable path bar are deferred to future milestones.

> **Note (M6):** Automatic session restore, workspace rename, import/export, thumbnail preview, and cloud sync are deferred to future work.

### Post-v1 additions (shipped after M6)

| Addition | Description |
|---|---|
| **Cell selection** | Two ways to select cells for Merge/Split: (1) **Select mode** — a Toolbar toggle button overlays a transparent intercept layer on every cell so clicks are captured before any inner content, enabling selection of any panel type including Web/iframe; (2) **Ctrl/Cmd+left-click** anywhere on a cell without entering Select mode (note: does not work on Web/iframe cells — the iframe swallows the event; use Select mode instead). Esc or a successful merge/split exits Select mode automatically. Fixes the post-M2 regression where Merge/Split were always disabled. |
| **Merged-cell splitter fix** | After merging cells, splitter dividers no longer bleed through merged regions. `boundarySegments` now slices each border segment by the cells it crosses, so merged cells only see the splitters on their actual boundaries. |
| **Preset-switch panel remapping** | Switching the cell-count preset now remaps existing panels to the nearest same-(col, row) cell in the new layout instead of discarding all of them. Only panels that genuinely fall outside the new grid bounds trigger a confirm dialog; the rest (Terminal PTY, System Monitor, Web iframe) are preserved and keep running. |
| **App icon** | Custom icon generated via `scripts/make_icon.py` (Pillow): dark rounded square, 3 × 3 grid lines, one emerald-400 accent cell. The full icon set (`src-tauri/icons/*`) is regenerated with `pnpm tauri icon`. |
| **UI font — Space Grotesk** | Self-hosted via `@fontsource/space-grotesk` (weights 400/500/600/700). Terminal panels continue to use a monospace font unchanged. |

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
