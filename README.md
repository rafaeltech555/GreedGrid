# GreedGrid

> *greed × grid* — a screen-splitting monitoring dashboard as a desktop app.

GreedGrid is a **Tauri v2** desktop application that turns one window into a resizable, mergeable grid of pluggable monitoring panels. Pick a cell-count preset (4 / 6 / 8 / 9 / 12 cells), drag panel types into cells, and save the whole layout as a named workspace.

**GreedGrid is not a window manager.** It hosts its own panels inside the app — it does not reparent external OS windows. Panel types are designed to be pluggable, so an "embed external X11 window" type can be added in the future without reworking the core.

---

## Panel Types (v1 roadmap)

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
- **Styles:** Tailwind CSS v4
- **Tests:** Vitest + Testing Library
- **Package manager:** pnpm
- **Target platform:** Linux X11 / Cinnamon (cross-platform capable)

---

## Roadmap

| Milestone | Description | Status |
|---|---|---|
| **M0** | Scaffold — Tauri v2 + React 19 + typed IPC, `ping` health-check, 9-cell hello-grid | ✅ Done |
| **M1** | Grid engine — preset layouts (4/6/8/9/12), draggable splitters to resize tracks, merge/split adjacent cells | ✅ Done |
| **M2** | Panel host + pluggable panel-type interface (`PanelTypeDef` registry), empty-cell picker + palette drag-and-drop placement, unified config modal, Web/URL panel (iframe) | ✅ Done |
| **M3** | Terminal panel — portable-pty PTY backend + xterm.js frontend, output streamed over Tauri Channel, 256 KB scrollback ring buffer, same-run reconnect with scrollback replay, pty killed on panel removal | ✅ Done |
| **M4** | System Monitor panel — shared background sampler thread (`sysinfo` crate) writes a `SysSnapshot` every 1 s; frontend polls on a configurable interval (default 2 s) and displays CPU%, memory, swap, load average, and uptime with rolling SVG sparklines for CPU% and Mem% | ✅ Done |
| **M5** | File Browser panel | Planned |
| **M6** | Workspace persistence — save / load named layouts as JSON | Planned |

> **Note (M2):** The Web/URL panel shipped as iframe-first. A native-webview fallback (for sites that refuse framing via X-Frame-Options/CSP) is deferred to a later phase — it will be the first Rust-side panel work.

> **Note (M3):** The pty is killed on explicit panel removal. Detached-session reattach (M3b) and a UI trigger for scrollback replay on React remount are deferred to a future phase — the same-run reconnect path is covered by a Rust integration test.

> **Note (M4):** Per-core CPU breakdown, network/disk I/O, process list, temperature sensors, history persistence, and alert thresholds are deferred to future milestones.

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

# Production build
pnpm build
```

Rust code lives in `src-tauri/`. IPC commands are declared in `src-tauri/src/commands/` (split into per-feature modules) and exposed via the typed `src/lib/ipc.ts` wrapper on the frontend.
