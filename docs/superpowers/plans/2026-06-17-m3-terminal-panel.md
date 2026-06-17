# M3 Terminal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Terminal panel backed by a real PTY — xterm.js on the frontend, portable-pty on the Rust backend, output streamed over a Tauri Channel, with the PTY surviving React unmount and replaying scrollback on reconnect within a single app run.

**Architecture:** The Rust side owns a `PtyRegistry` (a `Mutex<HashMap<instanceId, PtySession>>` in Tauri app state). Each session spawns a shell via `portable-pty`, runs a detached reader thread that appends every output chunk to a bounded scrollback ring buffer and forwards it to the currently-attached output sink. `term_open` either spawns a new session or, if one exists for the `instanceId`, replays scrollback into the new sink and re-attaches — this is the reconnect path. The PTY is keyed by `instanceId` (independent of React lifecycle) and dies only on explicit `term_close`, which the panel's `onDestroy` hook calls (already wired into the M2 store/merge/split removal path via `fireDestroyed` → `panelsRemoved`).

**Tech Stack:** Rust (`portable-pty`, `std::thread`, Tauri v2 `Channel`), TypeScript/React (`@xterm/xterm`, `@xterm/addon-fit`), Zustand store (unchanged — reuses existing `setPanel`/`clearPanel`/`onDestroy`).

**Scope note:** This plan covers §4 of `docs/superpowers/specs/2026-06-16-m2-m3-panels-design.md` (Terminal panel) only. The §3 native-webview fallback was deferred at M2 and is out of scope here. M3b (detached-session reattach) is explicitly out of scope; the `onDestroy` "always kills" behavior is the M3 contract.

---

## File Structure

**Rust (`src-tauri/`):**
- `Cargo.toml` — add `portable-pty` dependency.
- `src/commands.rs` → **converted to a module directory** `src/commands/`:
  - `src/commands/mod.rs` — re-exports `ping` + all `pty` command handlers (replaces the old single-file `commands.rs`).
  - `src/commands/pty.rs` — the four Tauri command wrappers (`term_open`/`term_write`/`term_resize`/`term_close`) + the `ChannelSink` adapter + `default_shell()`.
- `src/pty.rs` — **new**: pure-ish PTY engine: `ScrollbackBuffer`, `OutputSink` trait, `OpenOpts`, `PtySession`, `PtyRegistry` with `open`/`write`/`resize`/`close` methods + unit tests. No Tauri types here so it is `cargo test`-able.
- `src/lib.rs` — declare `mod pty;`, register the four new handlers, and `.manage(PtyRegistry(...))`.

**Frontend (`src/`):**
- `src/lib/ipc.ts` — add `termOpen`/`termWrite`/`termResize`/`termClose` wrappers + `Channel` import.
- `src/panels/terminal/types.ts` — **new**: `TermConfig` + `termReady`.
- `src/panels/terminal/types.test.ts` — **new**: `termReady` unit test.
- `src/panels/terminal/TerminalView.tsx` — **new**: xterm view + a minimal `TerminalConfigForm`.
- `src/panels/terminal/index.ts` — **new**: `terminalPanel: PanelTypeDef` with `onDestroy → termClose`.
- `src/panels/index.ts` — register `terminalPanel` alongside `webPanel`.
- `src/panels/index.test.ts` — extend to assert the terminal panel registers.
- `package.json` — add `@xterm/xterm` + `@xterm/addon-fit`.

---

## Task 1: Frontend `TermConfig` type + `termReady`

**Files:**
- Create: `src/panels/terminal/types.ts`
- Test: `src/panels/terminal/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/panels/terminal/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { termReady } from "./types";

describe("termReady", () => {
  it("is always true — a terminal opens with defaults", () => {
    expect(termReady({})).toBe(true);
    expect(termReady({ shell: "/bin/zsh" })).toBe(true);
    expect(termReady({ shell: "", cwd: "/tmp" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/panels/terminal/types.test.ts`
Expected: FAIL — cannot resolve `./types` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/panels/terminal/types.ts`:

```ts
/** Config for the Terminal panel. Both fields are optional — the backend falls
 *  back to $SHELL/$HOME when they are absent. */
export interface TermConfig {
  shell?: string;
  cwd?: string;
}

/** A terminal is always ready: it can open with defaults, so placement never
 *  forces the config modal. (Contrast with Web, which needs a non-empty url.) */
export function termReady(_config: Record<string, unknown>): boolean {
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/panels/terminal/types.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/panels/terminal/types.ts src/panels/terminal/types.test.ts
git commit -m "M3: TermConfig type + termReady (always ready)"
```

---

## Task 2: Rust scrollback ring buffer

**Files:**
- Modify: `src-tauri/Cargo.toml` (add dependency)
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod pty;`)

- [ ] **Step 1: Add the `portable-pty` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
portable-pty = "0.9"
```

- [ ] **Step 2: Declare the module so it compiles**

In `src-tauri/src/lib.rs`, add `mod pty;` to the module list at the top (alongside `mod commands;`, `mod error;`, `mod paths;`):

```rust
mod commands;
mod error;
mod paths;
mod pty;
```

- [ ] **Step 3: Write the failing test**

Create `src-tauri/src/pty.rs` with only the buffer + its test (the rest of the engine lands in Task 3):

```rust
//! PTY engine: a registry of live pseudo-terminals keyed by panel instanceId.
//! Kept free of Tauri types so the lifecycle is unit-testable with `cargo test`.

use std::collections::VecDeque;

/// Default scrollback capacity per session (~256 KB).
pub const SCROLLBACK_CAP: usize = 256 * 1024;

/// Fixed-capacity byte ring buffer. Oldest bytes are dropped once full so a
/// long-running terminal cannot grow memory without bound. On reconnect the
/// snapshot is replayed into the freshly-attached frontend.
pub struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    cap: usize,
}

impl ScrollbackBuffer {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            cap,
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buf.extend(data.iter().copied());
        while self.buf.len() > self.cap {
            self.buf.pop_front();
        }
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrollback_keeps_bytes_under_capacity() {
        let mut sb = ScrollbackBuffer::new(8);
        sb.push(b"abc");
        assert_eq!(sb.snapshot(), b"abc");
    }

    #[test]
    fn scrollback_drops_oldest_over_capacity() {
        let mut sb = ScrollbackBuffer::new(4);
        sb.push(b"abc");
        sb.push(b"de"); // total "abcde" (5) > cap 4 → drop leading "a"
        assert_eq!(sb.snapshot(), b"bcde");
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test pty::tests::scrollback`
Expected: PASS — 2 tests. (First run downloads/compiles `portable-pty`; allow a few minutes.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "M3: portable-pty dep + scrollback ring buffer"
```

---

## Task 3: Rust `PtyRegistry` — spawn, write, resize, close, reconnect

**Files:**
- Modify: `src-tauri/src/pty.rs` (add the engine + a live-pty integration test)

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/pty.rs` inside the existing `#[cfg(test)] mod tests { ... }` block (after the scrollback tests), a live-PTY round-trip test. It spawns a real `/bin/sh`, writes a command, polls the sink for the echoed output, then reconnects a second sink and asserts scrollback replay:

```rust
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct VecSink(Mutex<Vec<u8>>);

    impl OutputSink for VecSink {
        fn send(&self, data: Vec<u8>) {
            self.0.lock().unwrap().extend(data);
        }
    }

    impl VecSink {
        fn contains(&self, needle: &[u8]) -> bool {
            let g = self.0.lock().unwrap();
            g.windows(needle.len()).any(|w| w == needle)
        }
    }

    /// Poll a sink for up to ~3s waiting for `needle` to appear.
    fn wait_for(sink: &VecSink, needle: &[u8]) -> bool {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if sink.contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn opts() -> OpenOpts {
        OpenOpts {
            shell: "/bin/sh".to_string(),
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn open_write_then_reconnect_replays_scrollback() {
        let reg = PtyRegistry::default();

        // New session: spawn, write a command, observe its output on sink1.
        let sink1 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink1.clone()).unwrap();
        reg.write("t1", b"printf GREEDGRID_OK\n").unwrap();
        assert!(
            wait_for(&sink1, b"GREEDGRID_OK"),
            "expected command output on the live sink"
        );

        // Reconnect the same instanceId with a fresh sink: scrollback replays.
        let sink2 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink2.clone()).unwrap();
        assert!(
            sink2.contains(b"GREEDGRID_OK"),
            "reconnect must replay prior scrollback into the new sink"
        );

        // Resize is accepted while live.
        reg.resize("t1", 100, 30).unwrap();

        // Close removes the session; a subsequent write errors.
        reg.close("t1").unwrap();
        assert!(reg.write("t1", b"x").is_err(), "write after close must fail");
    }

    #[test]
    fn write_to_unknown_session_errors() {
        let reg = PtyRegistry::default();
        assert!(reg.write("nope", b"x").is_err());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test pty::tests::open_write`
Expected: FAIL to **compile** — `OutputSink`, `OpenOpts`, `PtyRegistry`, `PtySession` are not defined yet.

- [ ] **Step 3: Write the engine**

In `src-tauri/src/pty.rs`, add these imports at the top (below the existing `use std::collections::VecDeque;`):

```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::error::{AppError, AppResult};
```

Then add the engine (above the `#[cfg(test)]` block):

```rust
/// Where a session's output bytes are pushed. The command layer adapts a Tauri
/// `Channel` to this trait; tests use an in-memory `Vec`. Keeping the engine
/// generic over this trait is what makes it testable without a frontend.
pub trait OutputSink: Send + Sync {
    fn send(&self, data: Vec<u8>);
}

/// Parameters for spawning a new PTY. Shell/cwd are already resolved to
/// concrete values by the command layer before reaching the engine.
pub struct OpenOpts {
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// One live PTY. The reader thread is detached; it communicates through the
/// shared `scrollback` + `sink` handles, which is how reconnect swaps the sink
/// out from under a running thread without restarting it.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
    sink: Arc<Mutex<Option<Arc<dyn OutputSink>>>>,
}

/// Registry of live PTYs keyed by panel `instanceId`. Lives in Tauri app state.
#[derive(Default)]
pub struct PtyRegistry(pub Mutex<HashMap<String, PtySession>>);

impl PtyRegistry {
    /// Spawn a new session, or — if one already exists for `instance_id` —
    /// replay its scrollback into `sink` and re-attach it (the reconnect path).
    pub fn open(
        &self,
        instance_id: &str,
        opts: OpenOpts,
        sink: Arc<dyn OutputSink>,
    ) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();

        if let Some(session) = map.get(instance_id) {
            let snapshot = session.scrollback.lock().unwrap().snapshot();
            if !snapshot.is_empty() {
                sink.send(snapshot);
            }
            *session.sink.lock().unwrap() = Some(sink);
            return Ok(());
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("openpty: {e}")))?;

        let mut cmd = CommandBuilder::new(&opts.shell);
        if let Some(cwd) = &opts.cwd {
            cmd.cwd(cwd);
        }
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(format!("spawn: {e}")))?;
        // Slave is held by the child now; drop our handle so EOF propagates on exit.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(format!("clone reader: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(format!("take writer: {e}")))?;

        let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAP)));
        let sink_slot: Arc<Mutex<Option<Arc<dyn OutputSink>>>> =
            Arc::new(Mutex::new(Some(sink)));

        // Detached reader thread: append to scrollback, forward to the attached
        // sink (if any). Exits on EOF/error when the child dies.
        {
            let scrollback = scrollback.clone();
            let sink_slot = sink_slot.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let chunk = buf[..n].to_vec();
                            scrollback.lock().unwrap().push(&chunk);
                            if let Some(sink) = sink_slot.lock().unwrap().as_ref() {
                                sink.send(chunk);
                            }
                        }
                    }
                }
            });
        }

        map.insert(
            instance_id.to_string(),
            PtySession {
                master: pair.master,
                writer,
                child,
                scrollback,
                sink: sink_slot,
            },
        );
        Ok(())
    }

    pub fn write(&self, instance_id: &str, data: &[u8]) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();
        let session = map
            .get_mut(instance_id)
            .ok_or_else(|| AppError::Other(format!("no pty session: {instance_id}")))?;
        session.writer.write_all(data)?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, instance_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let map = self.0.lock().unwrap();
        let session = map
            .get(instance_id)
            .ok_or_else(|| AppError::Other(format!("no pty session: {instance_id}")))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("resize: {e}")))?;
        Ok(())
    }

    pub fn close(&self, instance_id: &str) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();
        if let Some(mut session) = map.remove(instance_id) {
            let _ = session.child.kill();
        }
        Ok(())
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test pty::tests`
Expected: PASS — all four `pty::tests` (2 scrollback + 2 live). The live test spawns `/bin/sh`; on a normal Linux dev box this runs in well under the 3s poll window.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "M3: PtyRegistry engine — spawn/write/resize/close + scrollback reconnect"
```

---

## Task 4: Tauri command wrappers + module restructure + state registration

**Files:**
- Delete: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/pty.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Convert `commands.rs` into a module directory**

Move the existing `ping` handler into `src-tauri/src/commands/mod.rs`. Create `src-tauri/src/commands/mod.rs` with the old contents plus a `pty` submodule re-export:

```rust
//! Tauri command surface. Commands stay thin here and delegate to domain
//! modules (`pty`, and later files/sysmon/workspace). M0 ships a health check;
//! M3 adds the terminal commands.

pub mod pty;

use serde::Serialize;

#[derive(Serialize)]
pub struct PingInfo {
    pub app: &'static str,
    pub version: &'static str,
}

#[tauri::command]
pub fn ping() -> PingInfo {
    PingInfo {
        app: "greedgrid",
        version: env!("CARGO_PKG_VERSION"),
    }
}
```

Then delete the old single file:

```bash
git rm src-tauri/src/commands.rs
```

(The `mod commands;` line already in `lib.rs` now resolves to the directory's `mod.rs` — no change needed to that line.)

- [ ] **Step 2: Write the command wrappers**

Create `src-tauri/src/commands/pty.rs`:

```rust
//! Tauri command layer for the Terminal panel. Thin wrappers that resolve
//! defaults, adapt the frontend `Channel` to the engine's `OutputSink`, and
//! delegate to `PtyRegistry`. All PTY logic lives in `crate::pty`.

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::pty::{OpenOpts, OutputSink, PtyRegistry};

/// Adapts a Tauri output `Channel` to the engine's `OutputSink`.
struct ChannelSink(Channel<Vec<u8>>);

impl OutputSink for ChannelSink {
    fn send(&self, data: Vec<u8>) {
        // The frontend went away mid-stream if this errors; the reader thread
        // keeps buffering into scrollback regardless, so just drop the error.
        let _ = self.0.send(data);
    }
}

/// $SHELL, falling back to /bin/bash.
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

#[tauri::command]
pub async fn term_open(
    instance_id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<Vec<u8>>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    let opts = OpenOpts {
        shell: shell.filter(|s| !s.is_empty()).unwrap_or_else(default_shell),
        cwd: cwd.filter(|s| !s.is_empty()),
        cols,
        rows,
    };
    state.open(&instance_id, opts, Arc::new(ChannelSink(channel)))
}

#[tauri::command]
pub async fn term_write(
    instance_id: String,
    data: Vec<u8>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    state.write(&instance_id, &data)
}

#[tauri::command]
pub async fn term_resize(
    instance_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    state.resize(&instance_id, cols, rows)
}

#[tauri::command]
pub async fn term_close(instance_id: String, state: State<'_, PtyRegistry>) -> AppResult<()> {
    state.close(&instance_id)
}
```

- [ ] **Step 3: Register state + handlers in `lib.rs`**

Edit `src-tauri/src/lib.rs` to manage the registry and register the four handlers. The full file becomes:

```rust
mod commands;
mod error;
mod paths;
mod pty;

use pty::PtyRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::pty::term_open,
            commands::pty::term_write,
            commands::pty::term_resize,
            commands::pty::term_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(No capability change is required: app-defined commands registered via `generate_handler!` are invokable from the frontend without an ACL entry — the capability system gates *plugin*/core commands, which `core:default` in `capabilities/default.json` already covers.)

- [ ] **Step 4: Verify the backend compiles and all Rust tests pass**

Run: `cd src-tauri && cargo test`
Expected: PASS — `pty::tests` (4) still green and the crate compiles cleanly with the new command module and managed state. Then confirm no warnings block: `cargo build` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands src-tauri/src/lib.rs
git rm --cached src-tauri/src/commands.rs 2>/dev/null || true
git commit -m "M3: term_* Tauri commands, commands/ module split, PtyRegistry state"
```

---

## Task 5: Frontend IPC wrappers

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the typed wrappers**

Append to `src/lib/ipc.ts` (and extend the existing `import` from `@tauri-apps/api/core` to also bring in `Channel`):

```ts
import { Channel, invoke } from "@tauri-apps/api/core";
import type { PingInfo } from "./types";
import type { TermConfig } from "../panels/terminal/types";
```

Then add, below `ping()`:

```ts
// --- Terminal (M3) ---------------------------------------------------------
// Output streams over a Tauri Channel<Uint8Array>; keystrokes/resize/close are
// plain invokes keyed by the panel instanceId, which maps to a backend PtySession.

/** Open (or reconnect to) the pty for `instanceId`; output flows into `channel`. */
export function termOpen(
  instanceId: string,
  config: TermConfig,
  cols: number,
  rows: number,
  channel: Channel<Uint8Array>,
): Promise<void> {
  return invoke<void>("term_open", {
    instanceId,
    shell: config.shell,
    cwd: config.cwd,
    cols,
    rows,
    channel,
  });
}

/** Send user keystrokes to the pty. */
export function termWrite(instanceId: string, data: Uint8Array): Promise<void> {
  return invoke<void>("term_write", { instanceId, data: Array.from(data) });
}

/** Tell the pty the viewport size changed. */
export function termResize(instanceId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("term_resize", { instanceId, cols, rows });
}

/** Kill the pty and drop its backend session. Called from the panel's onDestroy. */
export function termClose(instanceId: string): Promise<void> {
  return invoke<void>("term_close", { instanceId });
}
```

(`data: Array.from(data)` — Tauri serializes a JS number array into Rust's `Vec<u8>`; passing a raw `Uint8Array` is not reliably deserialized as `Vec<u8>` across the IPC boundary.)

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS — no type errors. (`Channel` is exported from `@tauri-apps/api/core`; `TermConfig` resolves from Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "M3: typed term_* IPC wrappers + Channel import"
```

---

## Task 6: Install xterm.js + Terminal View component

**Files:**
- Modify: `package.json` (deps)
- Create: `src/panels/terminal/TerminalView.tsx`

- [ ] **Step 1: Install the xterm packages**

Run:

```bash
pnpm add @xterm/xterm @xterm/addon-fit
```

Expected: `package.json` gains `@xterm/xterm` and `@xterm/addon-fit` under `dependencies`.

- [ ] **Step 2: Write the Terminal view + config form**

Create `src/panels/terminal/TerminalView.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { TermConfig } from "./types";
import { isTauri, termOpen, termResize, termWrite } from "../../lib/ipc";

/** Live view: an xterm.js terminal bound to a backend pty via a Tauri Channel.
 *  The pty outlives this component (keyed by instanceId); unmount detaches the
 *  output channel but never calls term_close — that is the panel's onDestroy. */
export function TerminalView({ instanceId, config }: PanelViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return; // no backend in a plain browser; see placeholder below
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({ fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // Route pty output → xterm. Bytes arrive as a number[] (Rust Vec<u8>).
    const channel = new Channel<Uint8Array>();
    let detached = false;
    channel.onmessage = (msg) => {
      if (!detached) term.write(new Uint8Array(msg));
    };

    const cfg = config as TermConfig;
    void termOpen(instanceId, cfg, term.cols, term.rows, channel);

    // Keystrokes → pty.
    const dataSub = term.onData((data) =>
      termWrite(instanceId, new TextEncoder().encode(data)),
    );

    // Resize → fit + notify pty.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void termResize(instanceId, term.cols, term.rows);
      } catch {
        // host detached mid-observation; ignore
      }
    });
    observer.observe(host);

    return () => {
      detached = true; // stop writing late channel messages into a disposed term
      observer.disconnect();
      dataSub.dispose();
      term.dispose();
      // NOTE: intentionally NOT calling termClose — the pty survives unmount and
      // reconnects (replaying scrollback) when this instanceId remounts.
    };
  }, [instanceId, config]);

  if (!isTauri()) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30">
        Terminal requires the desktop app (no pty backend in browser).
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full bg-black" />;
}

/** Config form: optional shell + working directory overrides. */
export function TerminalConfigForm({ config, onChange }: ConfigFormProps) {
  const cfg = config as TermConfig;
  return (
    <div className="flex flex-col gap-2 text-xs text-white/70">
      <label className="flex flex-col gap-1">
        Shell (blank = $SHELL)
        <input
          type="text"
          value={cfg.shell ?? ""}
          placeholder="/bin/bash"
          onChange={(e) => onChange({ ...config, shell: e.target.value })}
          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
        />
      </label>
      <label className="flex flex-col gap-1">
        Working directory (blank = $HOME)
        <input
          type="text"
          value={cfg.cwd ?? ""}
          placeholder="/home/you"
          onChange={(e) => onChange({ ...config, cwd: e.target.value })}
          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `pnpm typecheck`
Expected: PASS — xterm types resolve, `ConfigFormProps`/`PanelViewProps` match.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/panels/terminal/TerminalView.tsx
git commit -m "M3: xterm.js TerminalView + config form (shell/cwd overrides)"
```

---

## Task 7: Register the terminal panel

**Files:**
- Create: `src/panels/terminal/index.ts`
- Modify: `src/panels/index.ts`
- Modify: `src/panels/index.test.ts`

- [ ] **Step 1: Write the failing registration test**

Edit `src/panels/index.test.ts` — add a test asserting the terminal panel registers, inside the existing `describe("registerAllPanels", ...)` block:

```ts
  it("registers the terminal panel", () => {
    registerAllPanels();
    expect(getPanelType("terminal")?.label).toBe("Terminal");
  });

  it("registers both built-in panels exactly once", () => {
    registerAllPanels();
    registerAllPanels(); // idempotent
    expect(allPanelTypes()).toHaveLength(2);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: FAIL — `getPanelType("terminal")` is `undefined` (label read throws/returns undefined); the count assertion sees 1, not 2.

- [ ] **Step 3: Create the panel definition**

Create `src/panels/terminal/index.ts`:

```ts
import type { PanelTypeDef } from "../types";
import { termReady } from "./types";
import { TerminalConfigForm, TerminalView } from "./TerminalView";
import { termClose } from "../../lib/ipc";

/** The Terminal panel: a real pty rendered with xterm.js. `ready` is always
 *  true, so placement never opens the config modal — the gear edits shell/cwd
 *  after the fact. `onDestroy` kills the backend pty (M3 has no detach mode). */
export const terminalPanel: PanelTypeDef = {
  kind: "terminal",
  label: "Terminal",
  glyph: "⌨",
  defaultConfig: () => ({}),
  ready: termReady,
  ConfigForm: TerminalConfigForm,
  View: TerminalView,
  onDestroy: (instanceId) => {
    void termClose(instanceId);
  },
};
```

- [ ] **Step 4: Register it in `panels/index.ts`**

Replace the body of `src/panels/index.ts` so both panels register idempotently (the old single-`if` guard only covered web):

```ts
import { getPanelType, registerPanel } from "./registry";
import { webPanel } from "./web";
import { terminalPanel } from "./terminal";

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (!getPanelType("web")) registerPanel(webPanel);
  if (!getPanelType("terminal")) registerPanel(terminalPanel);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: PASS — terminal registers (label "Terminal"), idempotent, two panels total. The web-only assertions still pass.

- [ ] **Step 6: Run the full unit suite + typecheck (no regressions)**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — all existing tests green; the palette/picker now list Terminal automatically (they read `allPanelTypes()`), no host code changed.

- [ ] **Step 7: Commit**

```bash
git add src/panels/terminal/index.ts src/panels/index.ts src/panels/index.test.ts
git commit -m "M3: register Terminal panel (onDestroy → term_close)"
```

---

## Task 8: Manual verification (live Tauri runtime)

Streaming pty I/O, xterm rendering, TUI compatibility, and scrollback replay cannot be driven by Vitest (they need a real Tauri runtime + a real pty). This task is human/screenshot verification with `pnpm tauri dev`, mirroring how M2 was verified.

**Files:** none (verification only).

- [ ] **Step 1: Launch the app**

Run: `pnpm tauri dev`
Expected: the GreedGrid window opens; header shows `backend: greedgrid vX.Y.Z` (not "browser"), confirming the Rust side is attached.

- [ ] **Step 2: Place a Terminal panel**

In an empty cell, click `+` → the picker now lists **⌨ Terminal** alongside 🌐 Web. Click Terminal.
Expected: because `ready` is always true, the panel appears immediately (no config modal); a live shell prompt renders in the cell.

- [ ] **Step 3: Interactive shell**

Type `echo hello` + Enter; then `ls` + Enter.
Expected: output renders correctly; prompt and colors look right.

- [ ] **Step 4: Full-screen TUI (the real bar)**

Run `vim` (or `htop`). Move the cursor / scroll, then quit (`:q!` / `q`).
Expected: the alternate screen renders, cursor positioning is correct, quitting restores the shell. Repeat with `htop` if available. Optionally run `claude` to confirm it hosts this very tool.

- [ ] **Step 5: Resize**

Drag a splitter to grow/shrink the terminal's cell; inside the terminal run `tput cols; tput lines` (or just observe a running `htop` reflow).
Expected: the pty picks up the new size — `tput` reports the new dimensions; TUIs reflow.

- [ ] **Step 6: Scrollback replay on remount (the M3 headline feature)**

With output on screen, force the `TerminalView` to unmount and remount the *same instance* without removing the panel — e.g. start a `4`-cell preset, place the terminal, run a command, then switch the layout preset to one that keeps... 

  ⚠️ Preset switching destroys panels (calls `onDestroy` → `term_close`), so it does NOT exercise reconnect — it kills. To exercise reconnect you need a remount that preserves the cell's `instanceId`. If no such interaction exists in the current UI, verify reconnect at the engine level instead: it is already covered by the Rust test `pty::tests::open_write_then_reconnect_replays_scrollback` (Task 3). **Note in the verification report whether a UI-level remount path exists; if not, state that reconnect is verified by the Rust test, and that a UI remount trigger (e.g. row collapse) is future work / M3b territory.**

Expected: either a UI remount replays prior output, or — documented — reconnect is covered by the backend test and there is no UI trigger yet.

- [ ] **Step 7: Removal kills the pty**

Hover the terminal panel → click ✕.
Expected: the panel clears; `onDestroy` fired `term_close`. Confirm the shell process is gone (e.g. it was a `sleep 9999` you started — it should no longer appear in `ps`).

- [ ] **Step 8: Capture evidence + report**

Use the `verify` skill's report format. Capture at minimum: a screenshot of a working `vim`/`htop` in a cell, and the `ps`-confirms-killed observation from Step 7. Record the Step 6 reconnect finding explicitly.

---

## Self-Review

**Spec coverage (§4 + relevant §5):**
- PTY registry / `PtySession` / `ScrollbackBuffer` ring buffer → Tasks 2–3. ✅
- `term_open`/`term_write`/`term_resize`/`term_close` commands, `Channel<Vec<u8>>` output, reconnect/replay → Tasks 3–4. ✅
- `commands/` module split (`mod.rs` + `pty.rs`) → Task 4. ✅ (`web.rs` omitted by scope — native-webview deferred.)
- `PtyRegistry` in app state via `.manage(...)` → Task 4. ✅
- Typed IPC wrappers in `lib/ipc.ts` → Task 5. ✅
- `TerminalView` (xterm + FitAddon + Channel, no `term_close` on unmount) → Task 6. ✅
- `TermConfig` + `ready` always true → Task 1. ✅
- `onDestroy` → `term_close` (reuses M2's `fireDestroyed`/`panelsRemoved` removal path — no store change needed) → Task 7. ✅
- Vitest pure-logic tests (`termReady`, registry presence/idempotency) → Tasks 1, 7. ✅
- Rust unit tests (spawn → write → scrollback replay → close, mock sink) → Tasks 2–3. ✅
- Manual TUI verification (vim/htop/claude) → Task 8. ✅

**Out-of-scope (documented, not gaps):** §3 native-webview path (deferred at M2); M3b detached reattach (`onDestroy` "detach mode" — Task 8 Step 6 calls out the missing UI remount trigger).

**Type consistency:** `TermConfig {shell?, cwd?}` is defined once (Task 1) and consumed identically in `ipc.ts` (Task 5), `TerminalView` (Task 6), and `terminal/index.ts` (Task 7). Command param names (`instanceId`, `cols`, `rows`, `data`, `channel`) match between `lib/ipc.ts` invokes (Task 5) and the Rust `#[tauri::command]` signatures (Task 4) — Tauri maps camelCase JS keys to snake_case Rust params automatically (`instanceId` → `instance_id`). `PtyRegistry::open/write/resize/close` signatures match their call sites in `commands/pty.rs`. `OutputSink` is implemented by both `VecSink` (test) and `ChannelSink` (command layer) with the same `fn send(&self, data: Vec<u8>)`.

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" — every code step carries full code. The only narrative-without-code step is Task 8 (manual verification), which is correct: it has no code to write.
