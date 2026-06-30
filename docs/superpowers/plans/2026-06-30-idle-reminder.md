# Terminal IDLE Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a terminal finishes a foreground command and the user hasn't looked back at that cell, slowly pulse an amber reminder on the panel, the toolbar, and the system tray; clear it the moment the user views it.

**Architecture:** The Rust pty engine already links `libc` through `portable-pty`, whose `MasterPty::process_group_leader()` is `tcgetpgrp(master_fd)` — so foreground detection needs **no new crate**: compare the pty's foreground pgid to the shell's own pid (stored at spawn). `SessionInfo` gains `foreground: bool`, polled by the existing `term_list`. A new `idleStore` (Zustand) keeps per-terminal `{wasRunning, foreground, finishedAt, lastViewedAt}` and derives `isIdle` (B.1's three-condition AND) and `anyIdle`. An App-mounted poll hook feeds the store; viewing a terminal (keystroke/focus/click) or refocusing the window clears it. Visuals come from a shared animated `IdleIcon` SVG + amber glow/badge; the system tray (new — the app had none) swaps to an amber icon + tooltip when `anyIdle`.

**Tech Stack:** Rust (`portable-pty`, Tauri v2 `tray-icon`), React 19 + Zustand + TypeScript, Tailwind v4 CSS, Vitest + @testing-library/react, `cargo test`.

This implements **Stage B** of `docs/superpowers/specs/2026-06-29-panel-maximize-and-idle-reminder-design.md` (§B). Stage A (maximize) already shipped.

---

## Key facts verified against the codebase (do not re-derive)

- `portable-pty` **0.9.0** `MasterPty` trait exposes `fn process_group_leader(&self) -> Option<libc::pid_t>` (impl = `tcgetpgrp(master_fd)`) and `fn as_raw_fd(&self) -> Option<RawFd>`. `Child::process_id(&self) -> Option<u32>` exists too. **No `nix`/`libc` dependency is needed** — `process_group_leader()` does the syscall for us.
- The spawned shell is a session leader on the pty (portable-pty `setsid`s the child), so the shell's **pgid == its pid**. At prompt, `process_group_leader()` returns that pid; while a foreground command runs, it returns the command's (different) pgid. So `foreground = fpgid.is_some() && fpgid != shell_pid`.
- `SessionInfo` lives in `src-tauri/src/pty.rs` (serde `camelCase`) and mirrors `src/panels/terminal/types.ts`. `term_list` (`commands/pty.rs` → `PtyRegistry::list`) returns it; the frontend polls it via `termList()` in `src/lib/ipc.ts`.
- Terminal panel: `src/panels/terminal/TerminalView.tsx` (xterm; `term.onData` is the keystroke hook; the IME fix captures keydown on `host` — do NOT disturb it). `onDestroy` (in `terminal/index.ts`) detaches the pty.
- App mount point for a one-time hook: `src/App.tsx`. Toolbar: `src/components/Toolbar.tsx` (right side after `<WorkspaceMenu />` is free). Global CSS (Tailwind v4 `@import "tailwindcss"`): `src/index.css` — add `@keyframes` here.
- Tauri: builder/setup in `src-tauri/src/lib.rs` (tray goes in `.setup()` next to `commands::web::init_overlay`); window label is `"main"`; identifier `com.rafaeltech555.greedgrid`; icons in `src-tauri/icons/`. `tauri = { version = "2", features = [] }` — tray needs the `tray-icon` feature added. Custom commands don't need capability entries (only plugin/core commands do), so `capabilities/default.json` needs no change for `set_idle_indicator`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src-tauri/src/pty.rs` | Store `shell_pid`; compute `foreground`; add `SessionInfo.foreground`. | Modify |
| `src/panels/terminal/types.ts` | Add `foreground: boolean` to TS `SessionInfo`. | Modify |
| `src/store/idleStore.ts` | Per-terminal idle state + `entryIsIdle`/`anyIdle` + actions. | Create |
| `src/store/idleStore.test.ts` | Truth-table + lifecycle tests. | Create |
| `src/store/useIdlePolling.ts` | App hook: poll `term_list` → store; window-focus → clearAll; tray sync. | Create |
| `src/components/IdleIcon.tsx` | Shared animated laptop+zzz SVG. | Create |
| `src/index.css` | `@keyframes zfloat/breathe/glowpulse` + reduced-motion. | Modify |
| `src/panels/terminal/TerminalView.tsx` | Per-panel glow/badge/icon + markViewed wiring. | Modify |
| `src/components/Toolbar.tsx` | Idle status chip (click clears all). | Modify |
| `src/App.tsx` | Mount `useIdlePolling`. | Modify |
| `src/lib/ipc.ts` | `setIdleIndicator` wrapper. | Modify |
| `src-tauri/icons/tray-neutral.png`, `tray-idle.png` | Tray icon states (gray vs amber). | Create |
| `src-tauri/Cargo.toml` | Enable Tauri `tray-icon` feature. | Modify |
| `src-tauri/src/commands/tray.rs` | `set_idle_indicator` command. | Create |
| `src-tauri/src/lib.rs` | Build tray in setup; register command + tray.rs mod. | Modify |
| `src-tauri/src/commands/mod.rs` | `pub mod tray;` | Modify |

---

## Task 1: Backend foreground detection + `SessionInfo.foreground`

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Modify: `src/panels/terminal/types.ts`

- [ ] **Step 1: Write the failing backend test**

In `src-tauri/src/pty.rs`, inside the existing `#[cfg(test)] mod tests`, add a helper and a test (place after `list_reports_exited_session`):

```rust
    /// Poll `list()` until the named session reports `foreground == expected`.
    fn wait_for_foreground(reg: &PtyRegistry, id: &str, expected: bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if let Some(e) = reg.list().iter().find(|s| s.instance_id == id) {
                if e.foreground == expected {
                    return true;
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        false
    }

    #[test]
    fn foreground_flips_true_while_a_command_runs_then_false() {
        let reg = PtyRegistry::default();
        let sink = Arc::new(VecSink::default());
        reg.open("fg", opts(), sink.clone()).unwrap();

        // Run a slow foreground command: tcgetpgrp(master) should move off the
        // shell's own pgid while `sleep` owns the foreground, then back.
        reg.write("fg", b"sleep 1\n").unwrap();
        assert!(
            wait_for_foreground(&reg, "fg", true),
            "foreground must read true while `sleep` runs in the foreground"
        );
        assert!(
            wait_for_foreground(&reg, "fg", false),
            "foreground must return to false once the shell is back at its prompt"
        );
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test foreground_flips`
Expected: FAIL — `SessionInfo` has no field `foreground`.

- [ ] **Step 3: Implement foreground detection**

In `src-tauri/src/pty.rs`:

Add a `shell_pid` field to `PtySession` (after `cwd`):

```rust
    cwd: Option<String>,
    /// The spawned shell's pid. The shell is a session leader on the pty, so its
    /// pgid equals this pid; comparing it to the pty's current foreground pgid
    /// (`process_group_leader`) tells us whether a foreground command is running.
    shell_pid: Option<u32>,
```

Capture it at spawn — after `let child = pair.slave.spawn_command(cmd)...?;` add:

```rust
        let shell_pid = child.process_id();
```

And pass it into the `PtySession { ... }` constructor (add to the struct literal, after `cwd: opts.cwd,`):

```rust
                shell_pid,
```

Add `foreground` to `SessionInfo` (after `attached`):

```rust
    pub attached: bool,
    /// True when a foreground command is currently running in this terminal
    /// (best-effort; false when it cannot be determined). Drives the idle UI.
    pub foreground: bool,
```

Compute it in `list()`. Replace the `SessionInfo { ... }` construction inside the `map(...)` with:

```rust
            .map(|(instance_id, session)| {
                let alive = matches!(session.child.try_wait(), Ok(None));
                let attached = session.sink.lock().unwrap().is_some();
                // tcgetpgrp on the master; a foreground command has a pgid that
                // differs from the shell's own pid. None (e.g. no tty) → not
                // foreground, so the feature degrades gracefully.
                let foreground = match (session.master.process_group_leader(), session.shell_pid) {
                    (Some(fpgid), Some(shell_pid)) => fpgid != shell_pid as i32,
                    _ => false,
                };
                SessionInfo {
                    instance_id: instance_id.clone(),
                    shell: session.shell.clone(),
                    cwd: session.cwd.clone(),
                    alive,
                    attached,
                    foreground,
                }
            })
```

- [ ] **Step 4: Run the backend test + full pty suite**

Run: `cd src-tauri && cargo test`
Expected: PASS — including `foreground_flips_true_while_a_command_runs_then_false` and all existing pty tests.

> If `foreground_flips` is flaky on a slow machine, the 4s deadline in the helper should cover it; do NOT weaken the assertion. If `process_group_leader()` returns `None` on this platform (it won't on Linux pty masters), the feature degrades to "never idle" — that is intended, not a test failure to paper over.

- [ ] **Step 5: Update the TS contract**

In `src/panels/terminal/types.ts`, add to the `SessionInfo` interface (after `attached: boolean;`):

```ts
  /** True when a foreground command is currently running (best-effort). */
  foreground: boolean;
```

- [ ] **Step 6: Run frontend typecheck (contract still compiles)**

Run: `npm run typecheck`
Expected: clean. (No call site constructs `SessionInfo` literally except tests; if a test mock omits `foreground`, fix that mock to include `foreground: false`.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pty.rs src/panels/terminal/types.ts
git commit -m "feat(pty): report terminal foreground via process_group_leader"
```

---

## Task 2: `idleStore`

**Files:**
- Create: `src/store/idleStore.ts`
- Test: `src/store/idleStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/idleStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useIdleStore, entryIsIdle, type IdleEntry } from "./idleStore";

const s = () => useIdleStore.getState();

beforeEach(() => useIdleStore.setState({ entries: {} }));

const entry = (e: Partial<IdleEntry>): IdleEntry => ({
  wasRunning: false,
  foreground: false,
  finishedAt: null,
  lastViewedAt: 0,
  ...e,
});

describe("entryIsIdle", () => {
  it("is false when the terminal never ran a command", () => {
    expect(entryIsIdle(entry({ wasRunning: false }))).toBe(false);
  });

  it("is false while a foreground command is still running", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: true, finishedAt: 5, lastViewedAt: 0 })),
    ).toBe(false);
  });

  it("is false when finished but already viewed since", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: 5, lastViewedAt: 10 })),
    ).toBe(false);
  });

  it("is true: ran, back at prompt, finished after last view", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: 10, lastViewedAt: 5 })),
    ).toBe(true);
  });

  it("is false when never finished (finishedAt null)", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: null })),
    ).toBe(false);
  });
});

describe("idleStore actions", () => {
  it("updateForeground initializes an entry", () => {
    s().updateForeground("a", true, 100);
    expect(s().entries.a).toEqual({
      wasRunning: true,
      foreground: true,
      finishedAt: null,
      lastViewedAt: 100,
    });
  });

  it("records finishedAt on a true→false transition and becomes idle", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    expect(s().entries.a.finishedAt).toBe(200);
    expect(s().isIdle("a")).toBe(true);
    expect(s().anyIdle()).toBe(true);
  });

  it("does not move finishedAt while staying at prompt", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    s().updateForeground("a", false, 300);
    expect(s().entries.a.finishedAt).toBe(200);
  });

  it("markViewed clears idle", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    s().markViewed("a", 250);
    expect(s().isIdle("a")).toBe(false);
  });

  it("clearAll clears every idle terminal", () => {
    s().updateForeground("a", true, 10);
    s().updateForeground("a", false, 20);
    s().updateForeground("b", true, 10);
    s().updateForeground("b", false, 20);
    s().clearAll(30);
    expect(s().anyIdle()).toBe(false);
  });

  it("prune drops entries not in the active set", () => {
    s().updateForeground("a", false, 10);
    s().updateForeground("b", false, 10);
    s().prune(["a"]);
    expect(Object.keys(s().entries)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/idleStore.test.ts`
Expected: FAIL — `Cannot find module './idleStore'`.

- [ ] **Step 3: Implement the store**

Create `src/store/idleStore.ts`:

```ts
import { create } from "zustand";

/** Per-terminal idle bookkeeping. All times are `Date.now()` epoch ms; callers
 *  pass `now` explicitly so the logic stays pure and testable. */
export interface IdleEntry {
  /** Has this terminal ever had a foreground command running? */
  wasRunning: boolean;
  /** Latest backend `foreground` reading. */
  foreground: boolean;
  /** When foreground last transitioned true→false (command finished), or null. */
  finishedAt: number | null;
  /** When the user last viewed this terminal. */
  lastViewedAt: number;
}

/** B.1 truth: ran a command, now back at prompt, and finished after the user
 *  last looked at the cell. */
export function entryIsIdle(e: IdleEntry): boolean {
  return (
    e.wasRunning &&
    !e.foreground &&
    e.finishedAt !== null &&
    e.finishedAt > e.lastViewedAt
  );
}

interface IdleState {
  entries: Record<string, IdleEntry>;
  /** Feed a backend foreground reading for `instanceId` at time `now`. */
  updateForeground: (instanceId: string, foreground: boolean, now: number) => void;
  /** Mark a terminal viewed (keystroke/focus/click) — clears its idle. */
  markViewed: (instanceId: string, now: number) => void;
  /** Mark every terminal viewed — used by the chip/tray/window-focus. */
  clearAll: (now: number) => void;
  /** Drop entries whose instanceId is not in `ids` (panel removed). */
  prune: (ids: string[]) => void;
  /** Whether a specific terminal is idle. */
  isIdle: (instanceId: string) => boolean;
  /** Whether any terminal is idle. */
  anyIdle: () => boolean;
}

export const useIdleStore = create<IdleState>((set, get) => ({
  entries: {},

  updateForeground: (instanceId, foreground, now) =>
    set((st) => {
      const prev = st.entries[instanceId];
      if (!prev) {
        return {
          entries: {
            ...st.entries,
            [instanceId]: {
              wasRunning: foreground,
              foreground,
              finishedAt: null,
              lastViewedAt: now,
            },
          },
        };
      }
      const finishedAt =
        prev.foreground && !foreground ? now : prev.finishedAt;
      return {
        entries: {
          ...st.entries,
          [instanceId]: {
            wasRunning: prev.wasRunning || foreground,
            foreground,
            finishedAt,
            lastViewedAt: prev.lastViewedAt,
          },
        },
      };
    }),

  markViewed: (instanceId, now) =>
    set((st) => {
      const prev = st.entries[instanceId];
      if (!prev) return {};
      return {
        entries: { ...st.entries, [instanceId]: { ...prev, lastViewedAt: now } },
      };
    }),

  clearAll: (now) =>
    set((st) => {
      const next: Record<string, IdleEntry> = {};
      for (const [id, e] of Object.entries(st.entries)) {
        next[id] = { ...e, lastViewedAt: now };
      }
      return { entries: next };
    }),

  prune: (ids) =>
    set((st) => {
      const keep = new Set(ids);
      const next: Record<string, IdleEntry> = {};
      for (const [id, e] of Object.entries(st.entries)) {
        if (keep.has(id)) next[id] = e;
      }
      return { entries: next };
    }),

  isIdle: (instanceId) => {
    const e = get().entries[instanceId];
    return e ? entryIsIdle(e) : false;
  },

  anyIdle: () => Object.values(get().entries).some(entryIsIdle),
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/idleStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/idleStore.ts src/store/idleStore.test.ts
git commit -m "feat(idle): add idleStore (per-terminal isIdle/anyIdle)"
```

---

## Task 3: Poll hook (`useIdlePolling`) + App mount

**Files:**
- Create: `src/store/useIdlePolling.ts`
- Modify: `src/App.tsx`
- Test: `src/store/useIdlePolling.test.ts`

The hook polls `term_list` (~1.5s), feeds `updateForeground`, prunes to the placed terminal instanceIds, and wires window-focus → `clearAll`. Foreground/term-list IPC is mocked in tests.

- [ ] **Step 1: Write the failing test**

Create `src/store/useIdlePolling.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

vi.mock("../lib/ipc", () => ({
  isTauri: () => true,
  termList: vi.fn(),
}));

import { termList } from "../lib/ipc";
import { useIdleStore } from "./idleStore";
import { useLayoutStore } from "./layoutStore";
import { useIdlePolling } from "./useIdlePolling";
import { makePreset } from "../grid/presets";
import type { SessionInfo } from "../panels/terminal/types";

const mockTermList = vi.mocked(termList);

const session = (instanceId: string, foreground: boolean): SessionInfo => ({
  instanceId,
  shell: "/bin/bash",
  cwd: null,
  alive: true,
  attached: true,
  foreground,
});

beforeEach(() => {
  vi.useFakeTimers();
  useIdleStore.setState({ entries: {} });
  // A layout with one terminal placed in the first cell, instanceId "term-1".
  const layout = makePreset(4);
  layout.cells[0].panel = { kind: "terminal", instanceId: "term-1", config: {} };
  useLayoutStore.setState({ layout });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useIdlePolling", () => {
  it("feeds foreground readings into the idle store", async () => {
    mockTermList.mockResolvedValue([session("term-1", true)]);
    renderHook(() => useIdlePolling());

    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(useIdleStore.getState().entries["term-1"]).toBeTruthy());
    expect(useIdleStore.getState().entries["term-1"].foreground).toBe(true);
  });

  it("prunes entries for terminals no longer placed", async () => {
    useIdleStore.setState({
      entries: {
        ghost: { wasRunning: true, foreground: false, finishedAt: 1, lastViewedAt: 0 },
      },
    });
    mockTermList.mockResolvedValue([]);
    renderHook(() => useIdlePolling());

    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() =>
      expect(useIdleStore.getState().entries.ghost).toBeUndefined(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/useIdlePolling.test.ts`
Expected: FAIL — `Cannot find module './useIdlePolling'`.

- [ ] **Step 3: Implement the hook**

Create `src/store/useIdlePolling.ts`:

```ts
import { useEffect } from "react";
import { isTauri, termList } from "../lib/ipc";
import { useIdleStore } from "./idleStore";
import { useLayoutStore } from "./layoutStore";

const POLL_MS = 1500;

/** Collect instanceIds of terminal panels currently placed in the layout. */
function placedTerminalIds(): string[] {
  const ids: string[] = [];
  for (const c of useLayoutStore.getState().layout.cells) {
    if (c.panel?.kind === "terminal") ids.push(c.panel.instanceId);
  }
  return ids;
}

/**
 * One-time App hook: poll the backend for each terminal's foreground state and
 * feed the idle store; prune stale entries; clear all idle when the window
 * regains focus (returning to the app counts as "viewing"). No-op outside Tauri.
 */
export function useIdlePolling(): void {
  useEffect(() => {
    if (!isTauri()) return;
    const idle = useIdleStore.getState;

    let cancelled = false;
    const tick = async () => {
      try {
        const sessions = await termList();
        if (cancelled) return;
        const placed = new Set(placedTerminalIds());
        const now = Date.now();
        for (const s of sessions) {
          if (placed.has(s.instanceId)) {
            idle().updateForeground(s.instanceId, s.foreground, now);
          }
        }
        idle().prune([...placed]);
      } catch {
        // term_list can fail transiently; skip this tick.
      }
    };

    const timer = window.setInterval(tick, POLL_MS);
    void tick(); // prime immediately

    const onFocus = () => idle().clearAll(Date.now());
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/useIdlePolling.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount it in App**

In `src/App.tsx`, add the import:

```tsx
import { useIdlePolling } from "./store/useIdlePolling";
```

Call it at the top of the `App()` component body (after the existing `useState`):

```tsx
  useIdlePolling();
```

- [ ] **Step 6: Run the App test (no regression)**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS. (The hook is a no-op when `isTauri()` is false, which is the case in jsdom.)

- [ ] **Step 7: Commit**

```bash
git add src/store/useIdlePolling.ts src/store/useIdlePolling.test.ts src/App.tsx
git commit -m "feat(idle): poll term_list into idleStore; clear on window focus"
```

---

## Task 4: `IdleIcon` component + keyframes

**Files:**
- Create: `src/components/IdleIcon.tsx`
- Modify: `src/index.css`
- Test: `src/components/IdleIcon.test.tsx`

A single SVG (laptop + two rising z's), `currentColor` so the container picks the colour. Idle → amber animated; active → gray static. Animation classes come from `index.css`, gated off by `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing test**

Create `src/components/IdleIcon.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IdleIcon } from "./IdleIcon";

afterEach(cleanup);

describe("IdleIcon", () => {
  it("renders an accessible svg and animates the z's only when idle", () => {
    const { rerender } = render(<IdleIcon idle={false} />);
    const svg = screen.getByTestId("idle-icon");
    // Active: no idle class, z's hidden.
    expect(svg.getAttribute("data-idle")).toBe("false");

    rerender(<IdleIcon idle />);
    expect(screen.getByTestId("idle-icon").getAttribute("data-idle")).toBe("true");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/IdleIcon.test.tsx`
Expected: FAIL — `Cannot find module './IdleIcon'`.

- [ ] **Step 3: Add the keyframes to `src/index.css`**

Append to `src/index.css`:

```css
/* IDLE reminder animations (Stage B). Amber pulse for terminals that finished a
   command the user hasn't looked back at. Disabled under reduced-motion. */
@keyframes zfloat {
  0% { transform: translateY(2px) scale(0.7); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translateY(-6px) scale(1.1); opacity: 0; }
}
@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes glowpulse {
  0%, 100% { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.25); }
  50% { box-shadow: inset 0 0 14px 2px rgba(251, 191, 36, 0.55); }
}

.idle-z {
  transform-origin: center;
  opacity: 0;
}
.idle-icon[data-idle="true"] .idle-laptop {
  transform-origin: center;
  animation: breathe 2.4s ease-in-out infinite;
}
.idle-icon[data-idle="true"] .idle-z {
  animation: zfloat 1.8s ease-in-out infinite;
}
.idle-icon[data-idle="true"] .idle-z-2 {
  animation-delay: 0.9s;
}
.idle-glow {
  animation: glowpulse 2.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .idle-icon[data-idle="true"] .idle-laptop,
  .idle-icon[data-idle="true"] .idle-z,
  .idle-glow {
    animation: none;
  }
  /* Keep the static amber cue: show the z's without motion. */
  .idle-icon[data-idle="true"] .idle-z {
    opacity: 1;
  }
}
```

- [ ] **Step 4: Implement the component**

Create `src/components/IdleIcon.tsx`:

```tsx
interface IdleIconProps {
  /** Idle → amber + animated; otherwise gray + static. */
  idle: boolean;
  /** Pixel size (square). Default 16. */
  size?: number;
  className?: string;
}

/**
 * Laptop + two rising "z" glyphs. Single-colour via `currentColor` so the
 * container decides the colour (gray when active, amber when idle). Animation
 * is driven by the `data-idle` attribute + classes in index.css.
 */
export function IdleIcon({ idle, size = 16, className = "" }: IdleIconProps) {
  return (
    <svg
      data-testid="idle-icon"
      className={`idle-icon ${className}`}
      data-idle={idle ? "true" : "false"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: idle ? "#fbbf24" : "rgba(255,255,255,0.55)" }}
    >
      {/* laptop screen + base */}
      <g className="idle-laptop">
        <rect x="4" y="7" width="13" height="9" rx="1" />
        <path d="M2 18 h17" />
      </g>
      {/* two z's, small then large */}
      <path className="idle-z idle-z-1" d="M16 4 h3 l-3 3 h3" />
      <path className="idle-z idle-z-2" d="M19.5 2 h2.2 l-2.2 2.2 h2.2" />
    </svg>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/IdleIcon.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/IdleIcon.tsx src/index.css src/components/IdleIcon.test.tsx
git commit -m "feat(idle): add animated IdleIcon + keyframes"
```

---

## Task 5: Per-panel idle visuals + markViewed in `TerminalView`

**Files:**
- Modify: `src/panels/terminal/TerminalView.tsx`
- Test: `src/panels/terminal/TerminalView.test.tsx` (create)

Add an amber inset glow + a small `IdleIcon` + a clickable "此面板閒置" badge when this terminal is idle, and mark the terminal viewed on keystroke / focus / click. The heavy xterm `useEffect` (keyed `[instanceId, config]`) must NOT gain idle deps — read idle via a selector for render, and call `markViewed` through `getState()` inside handlers.

- [ ] **Step 1: Write the failing test**

Create `src/panels/terminal/TerminalView.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { TerminalView } from "./TerminalView";
import { useIdleStore } from "../../store/idleStore";

// Outside Tauri, TerminalView renders its placeholder branch AND the idle
// overlay still reflects the store (the overlay is rendered regardless of the
// pty effect). We drive the store directly.
beforeEach(() => useIdleStore.setState({ entries: {} }));
afterEach(cleanup);

function makeIdle(id: string) {
  useIdleStore.getState().updateForeground(id, true, 10);
  useIdleStore.getState().updateForeground(id, false, 20); // finished, idle
}

describe("TerminalView idle overlay", () => {
  it("shows the idle badge when this terminal is idle and clears on click", () => {
    makeIdle("t1");
    render(<TerminalView instanceId="t1" config={{}} />);
    const badge = screen.getByRole("button", { name: /閒置/ });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);
    expect(useIdleStore.getState().isIdle("t1")).toBe(false);
  });

  it("hides the idle badge when not idle", () => {
    render(<TerminalView instanceId="t2" config={{}} />);
    expect(screen.queryByRole("button", { name: /閒置/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/panels/terminal/TerminalView.test.tsx`
Expected: FAIL — no idle badge rendered.

- [ ] **Step 3: Implement the overlay + markViewed**

In `src/panels/terminal/TerminalView.tsx`:

Add imports:

```tsx
import { useIdleStore } from "../../store/idleStore";
import { IdleIcon } from "../../components/IdleIcon";
```

Inside `TerminalView`, after `const termRef = useRef...`, subscribe to this terminal's idle state:

```tsx
  const idle = useIdleStore((st) => st.isIdle(instanceId));
```

Mark viewed on keystroke — in the existing `term.onData` subscription, change:

```tsx
    const dataSub = term.onData((data) => send(data));
```

to:

```tsx
    const dataSub = term.onData((data) => {
      useIdleStore.getState().markViewed(instanceId, Date.now());
      send(data);
    });
```

Now the JSX. The component currently returns a placeholder outside Tauri and the real terminal inside Tauri. Wrap BOTH so the idle overlay is consistent. Replace the entire `if (!isTauri()) { return (...) }` + final `return (...)` block with:

```tsx
  const markViewedNow = () =>
    useIdleStore.getState().markViewed(instanceId, Date.now());

  if (!isTauri()) {
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30 ${idle ? "idle-glow" : ""}`}
      >
        Terminal requires the desktop app (no pty backend in browser).
        <IdleOverlay idle={idle} onView={markViewedNow} />
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-full bg-black ${idle ? "idle-glow" : ""}`}
      onMouseDown={markViewedNow}
      onFocusCapture={markViewedNow}
    >
      <div ref={hostRef} className="h-full w-full" />
      <button
        type="button"
        aria-label="插入檔案路徑 (Ctrl+Shift+O)"
        title="插入檔案路徑 (Ctrl+Shift+O)"
        onClick={() => {
          const t = termRef.current;
          if (t) insertPickedFiles(t);
        }}
        className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/40 hover:text-white"
      >
        📎
      </button>
      <IdleOverlay idle={idle} onView={markViewedNow} />
    </div>
  );
}

/** Amber idle affordances: a small status icon (top-left) always present, and a
 *  clickable "此面板閒置" badge that appears only when idle. Clicking either
 *  marks the terminal viewed. */
function IdleOverlay({ idle, onView }: { idle: boolean; onView: () => void }) {
  return (
    <>
      <div className="pointer-events-none absolute left-1 top-1 z-10">
        <IdleIcon idle={idle} />
      </div>
      {idle && (
        <button
          type="button"
          aria-label="此面板閒置 — 點擊清除"
          onClick={onView}
          className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-400/25"
        >
          <IdleIcon idle size={14} />
          此面板閒置
        </button>
      )}
    </>
  );
}
```

> Note: the `}` after the `return (...)` closes `TerminalView`; `IdleOverlay` is a new sibling function before `TerminalConfigForm`. Keep `TerminalConfigForm` exactly as it is, below `IdleOverlay`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/panels/terminal/TerminalView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the broader panels suite (no regression)**

Run: `npx vitest run src/panels/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/panels/terminal/TerminalView.tsx src/panels/terminal/TerminalView.test.tsx
git commit -m "feat(idle): per-panel glow/badge + markViewed in TerminalView"
```

---

## Task 6: Toolbar idle chip

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Test: `src/components/Toolbar.test.tsx`

A status chip on the right: gray "活動中" when nothing is idle, amber animated "閒置" when `anyIdle`; clicking it clears all.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Toolbar.test.tsx` a new describe (reuse the file's existing render/setup helpers; import the idle store at the top of the file):

```tsx
import { useIdleStore } from "../store/idleStore";

describe("Toolbar idle chip", () => {
  beforeEach(() => useIdleStore.setState({ entries: {} }));

  it("shows 活動中 when nothing is idle", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: /活動中/ })).toBeInTheDocument();
  });

  it("shows 閒置 and clears all on click when a terminal is idle", () => {
    useIdleStore.getState().updateForeground("t1", true, 10);
    useIdleStore.getState().updateForeground("t1", false, 20);
    render(<Toolbar />);
    const chip = screen.getByRole("button", { name: /閒置/ });
    fireEvent.click(chip);
    expect(useIdleStore.getState().anyIdle()).toBe(false);
  });
});
```

> Confirm `render`, `screen`, `fireEvent` are imported in this file already (they are, used by the existing Toolbar tests). If not, add `import { fireEvent, render, screen } from "@testing-library/react";`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Toolbar.test.tsx`
Expected: FAIL — no 活動中/閒置 chip.

- [ ] **Step 3: Implement the chip**

In `src/components/Toolbar.tsx`:

Add imports:

```tsx
import { useIdleStore } from "../store/idleStore";
import { IdleIcon } from "./IdleIcon";
```

Read idle state inside `Toolbar()` (near the other store reads):

```tsx
  const anyIdle = useIdleStore((s) => s.anyIdle());
  const clearAllIdle = useIdleStore((s) => s.clearAll);
```

Add the chip at the end of the toolbar row, just before the closing `</div>` of the top-level toolbar `<div className="flex items-center gap-3 ...">`. Place it after `<WorkspaceMenu />` (and after the dialogs are fine too, but keep it in the flex row — put it right after `<WorkspaceMenu />`):

```tsx
      <div className="ml-auto">
        <button
          type="button"
          onClick={() => clearAllIdle(Date.now())}
          aria-label={anyIdle ? "閒置 — 點擊清除全部" : "活動中"}
          title={anyIdle ? "有 terminal 跑完待查看 — 點擊清除" : "目前無待辦"}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
            anyIdle
              ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
              : "border-white/10 text-white/40"
          }`}
        >
          <IdleIcon idle={anyIdle} />
          {anyIdle ? "閒置" : "活動中"}
        </button>
      </div>
```

> `ml-auto` pushes the chip to the far right of the toolbar flex row. The toolbar's outer element is `<div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">`; the chip must be a direct child of it (a sibling of `<WorkspaceMenu />`), placed before the `{pendingPreset && ...}` / `{mergeCandidates && ...}` dialog blocks (those render nothing inline so order doesn't matter, but keep the chip in the flex row).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Toolbar.test.tsx`
Expected: PASS (existing Toolbar tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.test.tsx
git commit -m "feat(idle): toolbar idle chip (click clears all)"
```

---

## Task 7: Tray icon assets + enable `tray-icon` feature

**Files:**
- Create: `src-tauri/icons/tray-neutral.png`, `src-tauri/icons/tray-idle.png`
- Create: `src-tauri/icons/gen-tray-icons.py` (the generator, committed for reproducibility)
- Modify: `src-tauri/Cargo.toml`

The app has no tray today. Generate two 32×32 RGBA icons — a laptop glyph in neutral gray and in amber — so the tray can swap colour (the spec's acceptance floor: amber static + tooltip).

- [ ] **Step 1: Write the generator script**

Create `src-tauri/icons/gen-tray-icons.py`:

```python
"""Generate GreedGrid tray icons (neutral + idle) as 32x32 RGBA PNGs.
Run once: `python3 src-tauri/icons/gen-tray-icons.py`. Deterministic output."""
from PIL import Image, ImageDraw

def draw(color, out):
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # laptop screen
    d.rounded_rectangle([6, 8, 26, 21], radius=2, outline=color, width=2)
    # laptop base
    d.line([3, 24, 29, 24], fill=color, width=2)
    # two z's (idle hint), drawn for both states; colour conveys idle
    d.line([20, 4, 24, 4], fill=color, width=2)
    d.line([24, 4, 20, 8], fill=color, width=2)
    d.line([20, 8, 24, 8], fill=color, width=2)
    img.save(out)

# neutral gray, amber (#fbbf24)
draw((139, 148, 158, 255), "src-tauri/icons/tray-neutral.png")
draw((251, 191, 36, 255), "src-tauri/icons/tray-idle.png")
print("wrote tray-neutral.png + tray-idle.png")
```

- [ ] **Step 2: Generate the PNGs**

Run (from repo root): `python3 src-tauri/icons/gen-tray-icons.py`
Expected: `wrote tray-neutral.png + tray-idle.png`; both files exist under `src-tauri/icons/`.

> If `PIL` is unavailable: `pip install pillow` (or `python3 -m pip install --user pillow`). PIL is only needed to regenerate the committed PNGs, not at app runtime.

- [ ] **Step 3: Enable the Tauri `tray-icon` feature**

In `src-tauri/Cargo.toml`, change:

```toml
tauri = { version = "2", features = [] }
```

to:

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 4: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: compiles (downloads tray-icon deps on first build).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/icons/gen-tray-icons.py src-tauri/icons/tray-neutral.png src-tauri/icons/tray-idle.png src-tauri/Cargo.toml
git commit -m "feat(tray): add tray icon assets + enable tray-icon feature"
```

---

## Task 8: Create the tray + `set_idle_indicator` command

**Files:**
- Create: `src-tauri/src/commands/tray.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

Build a `TrayIcon` in `.setup()` with id `"main"`; left-click shows + focuses the main window (which fires the frontend window-focus → clearAll). A `set_idle_indicator(active, tooltip)` command swaps the icon (neutral/amber) + tooltip.

- [ ] **Step 1: Add the command module declaration**

In `src-tauri/src/commands/mod.rs`, add to the module list (after `pub mod sysmon;`):

```rust
pub mod tray;
```

- [ ] **Step 2: Implement the command**

Create `src-tauri/src/commands/tray.rs`:

```rust
//! System tray indicator. The tray is created in `lib.rs` setup with id "main";
//! this command swaps its icon (neutral ↔ amber) and tooltip to reflect whether
//! any terminal is idle. Best-effort: if the tray is missing the call is a no-op.

use tauri::image::Image;
use tauri::tray::TrayIconId;
use tauri::{AppHandle, Manager};

use crate::error::AppResult;

// Pre-rendered icon bytes baked into the binary (see icons/gen-tray-icons.py).
const NEUTRAL_PNG: &[u8] = include_bytes!("../../icons/tray-neutral.png");
const IDLE_PNG: &[u8] = include_bytes!("../../icons/tray-idle.png");

/// Update the tray icon + tooltip. `active` = some terminal is idle.
#[tauri::command]
pub fn set_idle_indicator(app: AppHandle, active: bool, tooltip: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id(&TrayIconId::new("main")) {
        let bytes = if active { IDLE_PNG } else { NEUTRAL_PNG };
        if let Ok(img) = Image::from_bytes(bytes) {
            let _ = tray.set_icon(Some(img));
        }
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    Ok(())
}
```

- [ ] **Step 3: Build the tray in setup**

In `src-tauri/src/lib.rs`, add imports at the top (after the existing `use` lines):

```rust
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
```

Inside `.setup(|app| { ... })`, after the `init_overlay` block and before `Ok(())`, add:

```rust
            // System tray (Stage B IDLE). Starts neutral; the frontend flips it
            // to amber via `set_idle_indicator` when any terminal is idle.
            let neutral = Image::from_bytes(include_bytes!("../icons/tray-neutral.png"))
                .expect("tray-neutral.png must decode");
            let _tray = TrayIconBuilder::with_id("main")
                .icon(neutral)
                .tooltip("GreedGrid")
                .on_tray_icon_event(|tray, event| {
                    // Left click: surface + focus the window. The frontend's
                    // window-focus listener then clears all idle reminders.
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add to the `invoke_handler![...]` list (after the `web::*` entries):

```rust
            commands::tray::set_idle_indicator,
```

- [ ] **Step 5: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: compiles. (`cargo test` still passes — no Rust unit test for the tray; it's GUI-verified in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/tray.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tray): create tray + set_idle_indicator command"
```

---

## Task 9: Frontend tray sync

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/store/useIdlePolling.ts`
- Test: `src/store/useIdlePolling.test.ts`

Drive the tray from `anyIdle`: whenever it changes, call `set_idle_indicator(active, tooltip)`. Subscribe to the idle store inside the poll hook.

- [ ] **Step 1: Add the IPC wrapper**

In `src/lib/ipc.ts`, add (after the web panel section):

```ts
// --- System tray (Stage B IDLE) --------------------------------------------
/** Swap the tray icon/tooltip to reflect whether any terminal is idle. */
export function setIdleIndicator(active: boolean, tooltip: string): Promise<void> {
  return invoke<void>("set_idle_indicator", { active, tooltip });
}
```

- [ ] **Step 2: Write the failing test**

Append to `src/store/useIdlePolling.test.ts`. First extend the `vi.mock("../lib/ipc", ...)` factory to also export `setIdleIndicator: vi.fn()`, and import it:

```ts
// in the vi.mock factory, add:  setIdleIndicator: vi.fn(),
import { setIdleIndicator } from "../lib/ipc";
const mockSetIdle = vi.mocked(setIdleIndicator);
```

Add the test:

```ts
  it("pushes anyIdle changes to the tray", async () => {
    mockTermList.mockResolvedValue([session("term-1", true)]);
    renderHook(() => useIdlePolling());
    await vi.advanceTimersByTimeAsync(1600);

    // Transition to idle: foreground true→false then poll again.
    mockSetIdle.mockClear();
    useIdleStore.getState().updateForeground("term-1", false, Date.now());
    await waitFor(() => expect(mockSetIdle).toHaveBeenCalled());
    const lastCall = mockSetIdle.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(true); // active
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/store/useIdlePolling.test.ts`
Expected: FAIL — `setIdleIndicator` never called.

- [ ] **Step 4: Implement the tray sync in the hook**

In `src/store/useIdlePolling.ts`:

Add to the imports:

```ts
import { isTauri, termList, setIdleIndicator } from "../lib/ipc";
```

(Replace the existing `import { isTauri, termList } from "../lib/ipc";`.)

Inside the `useEffect`, after wiring `onFocus` and before the `return`, subscribe to `anyIdle` and push it to the tray on change:

```ts
    // Mirror anyIdle → tray icon/tooltip. Push the initial state, then on change.
    let lastActive: boolean | null = null;
    const syncTray = () => {
      const active = useIdleStore.getState().anyIdle();
      if (active === lastActive) return;
      lastActive = active;
      const tooltip = active ? "GreedGrid — terminal 跑完待查看" : "GreedGrid";
      void setIdleIndicator(active, tooltip).catch(() => {});
    };
    const unsub = useIdleStore.subscribe(syncTray);
    syncTray();
```

And add `unsub();` to the cleanup return (alongside the existing teardown):

```ts
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsub();
    };
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/store/useIdlePolling.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 6: Run the full frontend suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ipc.ts src/store/useIdlePolling.ts src/store/useIdlePolling.test.ts
git commit -m "feat(idle): sync anyIdle to the system tray"
```

---

## Task 10: Full verification + native GUI

**Files:** none (verification only).

- [ ] **Step 1: Backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (incl. `foreground_flips_true_while_a_command_runs_then_false`).

- [ ] **Step 2: Frontend suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 3: Native GUI verification (spec B.9)**

Use the `verify-tauri-gui` skill / `greedgrid-gui-verify-recipe`. Launch `pnpm tauri dev`. Coordinate mapping for screenshots: `screen = (image_x + 50, image_y + 50)` (gnome-screenshot `-w` includes the titlebar). Verify:

1. Place a terminal. In it run `sleep 3` and immediately click a *different* cell (don't look back at the terminal). Within ~3s of it finishing: the terminal cell shows an amber inset glow + a "此面板閒置" badge + the `IdleIcon` animates amber; the toolbar chip turns amber "閒置"; the **tray icon** turns amber with the "跑完待查看" tooltip.
2. Click the idle terminal (or its badge) → that panel's glow/badge clear; if it was the only idle one, the toolbar chip + tray return to neutral.
3. Make two terminals idle, then click the toolbar chip → both clear.
4. Make a terminal idle, minimize the window, confirm the tray is amber; click the tray → window restores + focuses and all idle clears (window-focus path).
5. Negative: an empty terminal at a fresh prompt (never ran a command) must NOT show idle; a still-running `sleep 10` must NOT show idle (foreground true).
6. (If your DE honours it) toggle `prefers-reduced-motion` and confirm the amber colour still shows but without motion.

Record screenshots. Clean up: `pkill -x greedgrid` (do not `pkill -f greedgrid` — that can match your own shell).

- [ ] **Step 4: Update memory**

Update `maximize-and-idle-reminder-spec.md` (and `MEMORY.md`) to record Stage B (IDLE) implemented + GUI-verified. Follow the project memory conventions.

---

## Self-Review (spec §B coverage)

- **B.1** isIdle three-condition AND → `entryIsIdle` (Task 2), truth-table tested.
- **B.2** backend foreground via `process_group_leader` (= `tcgetpgrp`) + `SessionInfo.foreground`, polled by `term_list` → Task 1 (uses portable-pty's built-in, no new crate). Graceful degradation when pgid is `None`.
- **B.3** `idleStore` + App poll hook + prune to placed terminals → Tasks 2 & 3.
- **B.4** viewing clears idle: keystroke (`onData`), focus/click (`onFocusCapture`/`onMouseDown`), badge click, chip click (clearAll), window-focus (clearAll), tray-click → focus → clearAll → Tasks 3, 5, 6, 8.
- **B.5** `IdleIcon` laptop+zzz SVG, amber/animated vs gray/static, reduced-motion → Task 4.
- **B.6** per-panel amber glow + badge + status icon → Task 5.
- **B.7** toolbar chip, amber on anyIdle, click clears all → Task 6.
- **B.8** system tray from scratch (feature + icons + setup + `set_idle_indicator`), colour swap + tooltip (acceptance floor), left-click focus+clear → Tasks 7, 8, 9. The optional multi-frame tray *animation* (B.8 首選) is intentionally deferred — the static amber + tooltip floor is implemented (YAGNI until the floor is proven on Cinnamon).
- **B.9** tests: idle truth table (Task 2), backend foreground integration with `sleep` (Task 1), IdleIcon class toggle + reduced-motion (Task 4), native GUI (Task 10).

**Non-goals honoured (§4):** no idle concept for sysmon/file/web; no OS notification plugin; tray shows only the idle indicator, not resource gauges.

**Deferred / flagged for implementation:** the tray multi-frame animation (kept to the static-colour acceptance floor); confirm `TrayIconEvent::Click` matches the installed Tauri 2 minor version's variant shape during Task 8 (adjust the `match` arm if the enum differs).
