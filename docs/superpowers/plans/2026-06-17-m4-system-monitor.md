# M4 System Monitor Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only System Monitor panel (`PanelKind` `"sysmon"`) showing CPU%, memory, swap, load average, and uptime — with rolling SVG sparklines for CPU% and Mem% — backed by a single shared `sysinfo` sampler thread that the frontend polls.

**Architecture:** One background sampler thread owns a `sysinfo::System`, refreshes it every 1 s, and writes a `SysSnapshot` into an `Arc<Mutex<…>>` held in Tauri app state (`Sampler`). A cheap synchronous `sysmon_sample` command returns the latest snapshot. Each panel polls it on a configurable interval (default 2 s) and keeps its own rolling history (React state) for the sparklines. No per-instance backend state, no Channel, no `onDestroy` — the sampler is global and O(1) regardless of panel count.

**Tech Stack:** Rust (`sysinfo` 0.33, `std::thread`, Tauri v2 state), TypeScript/React (SVG sparkline, `setInterval` polling), Zustand panel registry (reused unchanged).

**Spec:** `docs/superpowers/specs/2026-06-17-m4-system-monitor-design.md`.

---

## File Structure

**Rust (`src-tauri/`):**
- `Cargo.toml` — add `sysinfo` dep.
- `src/sysmon.rs` — **new**: `SysSnapshot`, `Sampler` (start + snapshot), Rust test. No Tauri types.
- `src/commands/sysmon.rs` — **new**: `sysmon_sample` command.
- `src/commands/mod.rs` — declare `pub mod sysmon;`.
- `src/lib.rs` — `mod sysmon;`, `.manage(Sampler::start())`, register handler.

**Frontend (`src/`):**
- `src/lib/ipc.ts` — `sysmonSample` wrapper.
- `src/panels/sysmon/types.ts` — `SysSnapshot`, `SysmonConfig`, `sysmonReady`. **new**
- `src/panels/sysmon/format.ts` — `formatBytes`/`formatMemPair`/`formatUptime`/`pushHistory`. **new**
- `src/panels/sysmon/Sparkline.tsx` — SVG sparkline. **new**
- `src/panels/sysmon/SysmonView.tsx` — View + ConfigForm. **new**
- `src/panels/sysmon/index.ts` — `sysmonPanel: PanelTypeDef`. **new**
- `src/panels/index.ts` — register it.
- `src/panels/index.test.ts` — extend for sysmon.
- `+ *.test.ts(x)` for types/format/Sparkline.

---

## Task 1: Rust `Sampler` + `SysSnapshot`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/sysmon.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod sysmon;`)

- [ ] **Step 1: Add the `sysinfo` dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`, add (lean feature set — only system metrics):
```toml
sysinfo = { version = "0.33", default-features = false, features = ["system"] }
```

- [ ] **Step 2: Declare the module**

In `src-tauri/src/lib.rs`, add `mod sysmon;` to the module list (alongside `mod commands; mod error; mod paths; mod pty;`):
```rust
mod commands;
mod error;
mod paths;
mod pty;
mod sysmon;
```

- [ ] **Step 3: Write the failing test**

Create `src-tauri/src/sysmon.rs` with the snapshot + sampler + test:
```rust
//! System-metrics sampler. A single background thread owns one `sysinfo::System`,
//! refreshes it on a fixed cadence, and publishes the latest snapshot behind a
//! mutex. The frontend polls a cheap command that just reads this snapshot, so
//! CPU% deltas stay consistent regardless of poll timing and the cost is O(1)
//! no matter how many sysmon panels are open. Free of Tauri types so it is
//! unit-testable with `cargo test`.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};

/// How often the background thread refreshes — the window CPU% is measured over.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// One point-in-time reading of host vitals. `camelCase` so it lands on the JS
/// side matching the TS `SysSnapshot` interface with no manual key mapping.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysSnapshot {
    pub cpu: f32,        // global CPU usage 0.0–100.0
    pub mem_used: u64,   // bytes
    pub mem_total: u64,  // bytes
    pub swap_used: u64,  // bytes
    pub swap_total: u64, // bytes
    pub load: [f64; 3],  // 1 / 5 / 15 min
    pub uptime_secs: u64,
}

fn capture(sys: &System) -> SysSnapshot {
    let la = System::load_average();
    SysSnapshot {
        cpu: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        load: [la.one, la.five, la.fifteen],
        uptime_secs: System::uptime(),
    }
}

/// Shared latest snapshot. Lives in Tauri app state via `.manage(...)`.
pub struct Sampler(pub Arc<Mutex<SysSnapshot>>);

impl Sampler {
    /// Seed an initial snapshot (with a primed CPU delta) and spawn the refresh
    /// thread. The thread runs for the app's lifetime.
    pub fn start() -> Self {
        let mut sys = System::new();
        // CPU% needs two refreshes spaced >= MINIMUM_CPU_UPDATE_INTERVAL.
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_cpu_usage();

        let shared = Arc::new(Mutex::new(capture(&sys)));
        let writer = shared.clone();
        thread::spawn(move || loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            let snap = capture(&sys);
            *writer.lock().unwrap() = snap;
            thread::sleep(SAMPLE_INTERVAL);
        });
        Sampler(shared)
    }

    /// Clone the latest snapshot (cheap mutex read).
    pub fn snapshot(&self) -> SysSnapshot {
        self.0.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampler_produces_plausible_snapshot() {
        let sampler = Sampler::start();
        let s = sampler.snapshot();
        assert!(s.mem_total > 0, "mem_total should be positive");
        assert!(s.mem_used <= s.mem_total, "used <= total");
        assert!(
            s.cpu >= 0.0 && s.cpu <= 100.0,
            "cpu in 0..100, got {}",
            s.cpu
        );
        assert!(s.uptime_secs > 0, "uptime should be positive");
        for v in s.load {
            assert!(v.is_finite(), "load values finite");
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test sysmon::tests`
Expected: PASS — 1 test. (First run compiles `sysinfo`; allow a minute.) Dead-code warnings for `Sampler`/`snapshot` (not yet called from non-test code) are expected and fine — do NOT add `#[allow(dead_code)]`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/sysmon.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
M4: sysinfo dep + Sampler/SysSnapshot background sampler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `sysmon_sample` command + state wiring

**Files:**
- Create: `src-tauri/src/commands/sysmon.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the command**

Create `src-tauri/src/commands/sysmon.rs`:
```rust
//! Tauri command for the System Monitor panel. A thin, synchronous reader of the
//! shared `Sampler` snapshot — no refresh work happens here (the background
//! thread owns that), so this is just a mutex read + clone.

use tauri::State;

use crate::sysmon::{Sampler, SysSnapshot};

#[tauri::command]
pub fn sysmon_sample(state: State<'_, Sampler>) -> SysSnapshot {
    state.snapshot()
}
```

- [ ] **Step 2: Declare the submodule**

In `src-tauri/src/commands/mod.rs`, add `pub mod sysmon;` next to the existing `pub mod pty;`:
```rust
pub mod pty;
pub mod sysmon;
```

- [ ] **Step 3: Wire state + handler in `lib.rs`**

In `src-tauri/src/lib.rs`: add the `Sampler` import next to the existing `use pty::PtyRegistry;`, add `.manage(Sampler::start())` to the builder, and register the handler. The builder becomes:
```rust
use pty::PtyRegistry;
use sysmon::Sampler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyRegistry::default())
        .manage(Sampler::start())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::pty::term_open,
            commands::pty::term_write,
            commands::pty::term_resize,
            commands::pty::term_close,
            commands::sysmon::sysmon_sample,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
(Keep the existing `mod` lines from Task 1. No capability change — app-defined commands need no ACL entry.)

- [ ] **Step 4: Verify compile + tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — `sysmon::tests` (1) + `pty::tests` (5) green, crate compiles. The `Sampler`/`snapshot` dead-code warnings from Task 1 should now be GONE (reachable through the command + `.manage`). Then `cargo build 2>&1 | grep -E "^error"` → no output.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
M4: sysmon_sample command + Sampler app state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend types + format helpers

**Files:**
- Create: `src/panels/sysmon/types.ts`
- Create: `src/panels/sysmon/types.test.ts`
- Create: `src/panels/sysmon/format.ts`
- Create: `src/panels/sysmon/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/panels/sysmon/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sysmonReady } from "./types";

describe("sysmonReady", () => {
  it("is always true — sysmon opens with defaults", () => {
    expect(sysmonReady({})).toBe(true);
    expect(sysmonReady({ refreshSecs: 5 })).toBe(true);
  });
});
```

Create `src/panels/sysmon/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatBytes, formatMemPair, formatUptime, pushHistory } from "./format";

describe("formatBytes", () => {
  it("scales to binary units", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(2048)).toBe("2K");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5M");
    expect(formatBytes(Math.round(6.2 * 1024 ** 3))).toBe("6.2G");
  });
});

describe("formatMemPair", () => {
  it("renders used/total in the larger unit", () => {
    expect(formatMemPair(Math.round(6.2 * 1024 ** 3), 16 * 1024 ** 3)).toBe("6.2/16.0G");
  });
});

describe("formatUptime", () => {
  it("formats hh:mm under a day and prefixes days over a day", () => {
    expect(formatUptime(3661)).toBe("01:01");
    expect(formatUptime(86400)).toBe("1d 00:00");
    expect(formatUptime(90061)).toBe("1d 01:01");
  });
});

describe("pushHistory", () => {
  it("appends and drops the oldest past cap without mutating input", () => {
    const a = [1, 2, 3];
    expect(pushHistory(a, 4, 5)).toEqual([1, 2, 3, 4]);
    expect(pushHistory([1, 2, 3, 4, 5], 6, 5)).toEqual([2, 3, 4, 5, 6]);
    expect(a).toEqual([1, 2, 3]); // input untouched
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/panels/sysmon/types.test.ts src/panels/sysmon/format.test.ts`
Expected: FAIL — `./types` and `./format` do not resolve.

- [ ] **Step 3: Implement types**

Create `src/panels/sysmon/types.ts`:
```ts
/** One snapshot of host vitals from the backend Sampler (camelCase from serde). */
export interface SysSnapshot {
  cpu: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  load: [number, number, number];
  uptimeSecs: number;
}

/** Per-instance config: just the poll interval. */
export interface SysmonConfig {
  refreshSecs?: number; // default 2; clamped to >= 1 at use sites
}

/** Always ready — the monitor opens with defaults, so placement never opens the
 *  config modal (the gear edits the interval later). */
export function sysmonReady(_config: Record<string, unknown>): boolean {
  return true;
}
```

- [ ] **Step 4: Implement format helpers**

Create `src/panels/sysmon/format.ts`:
```ts
/** Compact binary-unit byte string, e.g. "6.2G", "5M", "2K", "0B". */
export function formatBytes(n: number): string {
  const G = 1024 ** 3;
  const M = 1024 ** 2;
  const K = 1024;
  if (n >= G) return `${(n / G).toFixed(1)}G`;
  if (n >= M) return `${Math.round(n / M)}M`;
  if (n >= K) return `${Math.round(n / K)}K`;
  return `${n}B`;
}

/** "used/total" sharing the total's unit, e.g. "6.2/16.0G". */
export function formatMemPair(used: number, total: number): string {
  const G = 1024 ** 3;
  if (total >= G) return `${(used / G).toFixed(1)}/${(total / G).toFixed(1)}G`;
  const M = 1024 ** 2;
  return `${Math.round(used / M)}/${Math.round(total / M)}M`;
}

/** "3d 04:12" (days + HH:MM); omit the day prefix under 24h ("04:12"). */
export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return d > 0 ? `${d}d ${hm}` : hm;
}

/** Append `value`, dropping the oldest beyond `cap`. Pure — returns a new array. */
export function pushHistory(buf: number[], value: number, cap: number): number[] {
  const next = [...buf, value];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/panels/sysmon/types.test.ts src/panels/sysmon/format.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/panels/sysmon/types.ts src/panels/sysmon/types.test.ts src/panels/sysmon/format.ts src/panels/sysmon/format.test.ts
git commit -m "$(cat <<'EOF'
M4: sysmon types (SysSnapshot/SysmonConfig/sysmonReady) + format helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: SVG Sparkline

**Files:**
- Create: `src/panels/sysmon/Sparkline.tsx`
- Create: `src/panels/sysmon/Sparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/sysmon/Sparkline.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders no polyline for empty data", () => {
    const { container } = render(<Sparkline data={[]} max={100} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("maps values against max (value==max → top, 0 → bottom)", () => {
    const { container } = render(<Sparkline data={[0, 50, 100]} max={100} />);
    const pts = container.querySelector("polyline")!.getAttribute("points")!;
    expect(pts).toContain("0.00,100.00"); // first: value 0 → y bottom
    expect(pts).toContain("100.00,0.00"); // last: value==max → y top
  });

  it("draws a flat 2-point line for a single sample", () => {
    const { container } = render(<Sparkline data={[42]} max={100} />);
    const pts = container.querySelector("polyline")!.getAttribute("points")!;
    const coords = pts.trim().split(" ");
    expect(coords).toHaveLength(2);
    expect(coords[0].split(",")[1]).toBe(coords[1].split(",")[1]); // same y
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/panels/sysmon/Sparkline.test.tsx`
Expected: FAIL — `./Sparkline` does not resolve.

- [ ] **Step 3: Implement Sparkline**

Create `src/panels/sysmon/Sparkline.tsx`:
```tsx
import type { ReactNode } from "react";

interface SparklineProps {
  data: number[];
  max: number;
  className?: string;
}

/** Minimal SVG sparkline: `data` → a polyline in a 0..100 viewBox, higher value
 *  = higher line. Stroke is `currentColor` so the parent picks the colour via a
 *  Tailwind text class. Empty data renders an empty svg; a single sample renders
 *  a flat line; `max <= 0` is treated as 1 to avoid divide-by-zero. */
export function Sparkline({ data, max, className }: SparklineProps): ReactNode {
  const cap = max > 0 ? max : 1;
  const n = data.length;
  const coords: Array<[number, number]> = data.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * 100;
    const y = 100 - Math.min(Math.max(v / cap, 0), 1) * 100;
    return [x, y];
  });
  if (n === 1) coords.push([100, coords[0][1]]); // flat line for one sample
  const points = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      data-testid="sparkline"
    >
      {n > 0 && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/panels/sysmon/Sparkline.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/panels/sysmon/Sparkline.tsx src/panels/sysmon/Sparkline.test.tsx
git commit -m "$(cat <<'EOF'
M4: SVG Sparkline component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: IPC wrapper + SysmonView + ConfigForm

**Files:**
- Modify: `src/lib/ipc.ts`
- Create: `src/panels/sysmon/SysmonView.tsx`

- [ ] **Step 1: Add the IPC wrapper**

In `src/lib/ipc.ts`, add a `SysSnapshot` type import near the other type imports:
```ts
import type { SysSnapshot } from "../panels/sysmon/types";
```
and append at the end of the file:
```ts
// --- System Monitor (M4) ----------------------------------------------------
/** Read the latest host-vitals snapshot from the shared backend sampler. */
export function sysmonSample(): Promise<SysSnapshot> {
  return invoke<SysSnapshot>("sysmon_sample");
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — `SysSnapshot` resolves.

- [ ] **Step 3: Create the View + ConfigForm**

Create `src/panels/sysmon/SysmonView.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { SysSnapshot, SysmonConfig } from "./types";
import { isTauri, sysmonSample } from "../../lib/ipc";
import { Sparkline } from "./Sparkline";
import { formatMemPair, formatUptime, pushHistory } from "./format";

const HISTORY_CAP = 60;

/** Live view: polls the shared backend sampler on a configurable interval and
 *  renders current values + rolling CPU%/Mem% sparklines. No backend teardown
 *  on unmount — the sampler is global. */
export function SysmonView({ config }: PanelViewProps) {
  const [snap, setSnap] = useState<SysSnapshot | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    const cfg = config as SysmonConfig;
    const intervalMs = Math.max(1, cfg.refreshSecs ?? 2) * 1000;
    let alive = true;

    const tick = async () => {
      try {
        const s = await sysmonSample();
        if (!alive) return;
        setSnap(s);
        setCpuHist((h) => pushHistory(h, s.cpu, HISTORY_CAP));
        setMemHist((h) =>
          pushHistory(h, s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0, HISTORY_CAP),
        );
      } catch {
        // backend not ready / transient — skip this tick
      }
    };

    void tick(); // immediate first sample so the panel isn't blank
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [config]);

  if (!isTauri()) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30">
        System monitor requires the desktop app.
      </div>
    );
  }

  const memPct = snap && snap.memTotal > 0 ? (snap.memUsed / snap.memTotal) * 100 : 0;

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-2 text-xs">
      <Metric label="CPU" value={snap ? `${snap.cpu.toFixed(0)}%` : "…"} colorClass="text-emerald-400">
        <Sparkline data={cpuHist} max={100} className="h-6 w-full" />
        <Bar pct={snap?.cpu ?? 0} />
      </Metric>
      <Metric label="Mem" value={snap ? formatMemPair(snap.memUsed, snap.memTotal) : "…"} colorClass="text-sky-400">
        <Sparkline data={memHist} max={100} className="h-6 w-full" />
        <Bar pct={memPct} />
      </Metric>
      <div className="mt-auto flex flex-col gap-1 text-white/60">
        <Row label="Swap" value={snap ? formatMemPair(snap.swapUsed, snap.swapTotal) : "…"} />
        <Row label="Load" value={snap ? snap.load.map((l) => l.toFixed(2)).join("  ") : "…"} />
        <Row label="Up" value={snap ? formatUptime(snap.uptimeSecs) : "…"} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  colorClass,
  children,
}: {
  label: string;
  value: string;
  colorClass: string;
  children: ReactNode;
}) {
  // colorClass sets currentColor for both the Sparkline stroke and the Bar fill.
  return (
    <div className={`flex flex-col gap-0.5 ${colorClass}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-white/80">{value}</span>
      </div>
      {children}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded bg-white/10">
      <div
        className="h-full bg-current opacity-70"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-white/60">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Config form: the poll interval in seconds (default 2, min 1). */
export function SysmonConfigForm({ config, onChange }: ConfigFormProps) {
  const cfg = config as SysmonConfig;
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      Refresh interval (seconds)
      <input
        type="number"
        min={1}
        value={cfg.refreshSecs ?? 2}
        onChange={(e) => onChange({ ...config, refreshSecs: Number(e.target.value) })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
```

- [ ] **Step 4: Verify typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — types resolve, vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/panels/sysmon/SysmonView.tsx
git commit -m "$(cat <<'EOF'
M4: sysmonSample IPC + SysmonView (poll + sparklines) + config form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register the sysmon panel

**Files:**
- Create: `src/panels/sysmon/index.ts`
- Modify: `src/panels/index.ts`
- Modify: `src/panels/index.test.ts`

- [ ] **Step 1: Update the registration tests**

Edit `src/panels/index.test.ts`. Add a sysmon test and update the existing count test (it currently expects 2 panels — with sysmon it's 3). Inside the `describe("registerAllPanels", …)` block, add:
```ts
  it("registers the sysmon panel", () => {
    registerAllPanels();
    expect(getPanelType("sysmon")?.label).toBe("System");
  });
```
And change the existing test that asserts two panels — find:
```ts
  it("registers both built-in panels exactly once", () => {
    registerAllPanels();
    registerAllPanels(); // idempotent
    expect(allPanelTypes()).toHaveLength(2);
  });
```
Replace it with:
```ts
  it("registers all built-in panels exactly once", () => {
    registerAllPanels();
    registerAllPanels(); // idempotent
    expect(allPanelTypes()).toHaveLength(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: FAIL — `getPanelType("sysmon")` is undefined; count is 2, not 3.

- [ ] **Step 3: Create the panel definition**

Create `src/panels/sysmon/index.ts`:
```ts
import type { PanelTypeDef } from "../types";
import { sysmonReady } from "./types";
import { SysmonConfigForm, SysmonView } from "./SysmonView";

/** The System Monitor panel: polls the shared backend sampler and renders host
 *  vitals with rolling sparklines. `ready` is always true (opens with defaults);
 *  no `onDestroy` — there is no per-instance backend resource (the sampler is
 *  global). */
export const sysmonPanel: PanelTypeDef = {
  kind: "sysmon",
  label: "System",
  glyph: "📊",
  defaultConfig: () => ({}),
  ready: sysmonReady,
  ConfigForm: SysmonConfigForm,
  View: SysmonView,
};
```

- [ ] **Step 4: Register it in `panels/index.ts`**

Replace the contents of `src/panels/index.ts` with:
```ts
import { getPanelType, registerPanel } from "./registry";
import { webPanel } from "./web";
import { terminalPanel } from "./terminal";
import { sysmonPanel } from "./sysmon";

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (!getPanelType("web")) registerPanel(webPanel);
  if (!getPanelType("terminal")) registerPanel(terminalPanel);
  if (!getPanelType("sysmon")) registerPanel(sysmonPanel);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: PASS — sysmon registers (label "System"), count is 3, idempotent.

- [ ] **Step 6: Full suite + typecheck (no regressions)**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — all tests green; palette/picker now list 📊 System automatically (they read `allPanelTypes()`), no host code changed.

- [ ] **Step 7: Commit**

```bash
git add src/panels/sysmon/index.ts src/panels/index.ts src/panels/index.test.ts
git commit -m "$(cat <<'EOF'
M4: register System Monitor panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Manual GUI verification

Live polling + sparkline rendering need the Tauri runtime; verify with `pnpm tauri dev` using the project's XTest/screenshot recipe (see the `greedgrid-gui-verify-recipe` memory). This is human/screenshot verification, not a subagent task.

**Files:** none.

- [ ] **Step 1: Launch**

Run: `DISPLAY=:0 pnpm tauri dev` (background). Confirm the window opens and the header shows `backend: greedgrid v0.1.0`.

- [ ] **Step 2: Place a System panel**

Click an empty cell's `+` → the picker now lists **📊 System** (alongside Web + Terminal). Click it.
Expected: panel appears immediately (`ready` true); within ~2 s the CPU/Mem/Swap/Load/Up values populate (no longer "…").

- [ ] **Step 3: Sparklines grow**

Watch for ~15–20 s.
Expected: the CPU% and Mem% sparklines accumulate points and move left-to-right as samples arrive.

- [ ] **Step 4: CPU reacts to load**

Place a Terminal panel in another cell and run `yes > /dev/null` (a busy loop). Watch the System panel.
Expected: CPU% climbs and the CPU sparkline rises. Ctrl-C the `yes` → CPU% falls back.

- [ ] **Step 5: Config interval**

Hover the System panel → ⚙ → change Refresh interval to 1, OK.
Expected: updates become more frequent (sparkline advances faster).

- [ ] **Step 6: Removal**

Hover → ✕.
Expected: the panel clears back to `+`. (No backend process to check — the sampler is global and keeps running; that's expected.)

- [ ] **Step 7: Capture + report**

Use the `verify` skill report format. Capture a screenshot of the populated System panel (ideally with CPU spiked under `yes`). Note the interval-change observation.

---

## Self-Review

**Spec coverage (§1–§5):**
- `SysSnapshot` (Rust camelCase serde + TS) → Task 1 + Task 3. ✅
- `SysmonConfig` + `sysmonReady` → Task 3. ✅
- `Sampler` (1 s background refresh, primed CPU delta, `snapshot()`), `SAMPLE_INTERVAL`, sysinfo `global_cpu_usage`/`refresh_memory`/`load_average`/`uptime` → Task 1. ✅
- `sysmon_sample` command, `commands/sysmon.rs`, `mod.rs`, `.manage(Sampler::start())`, handler → Task 2. ✅
- `sysinfo = "0.33"` lean features → Task 1. ✅
- IPC `sysmonSample` → Task 5. ✅
- `format.ts` helpers (`formatBytes`/`formatMemPair`/`formatUptime`/`pushHistory`) → Task 3. ✅
- `Sparkline` SVG with empty/single/divide-by-zero edges → Task 4. ✅
- `SysmonView` (poll, immediate first sample, isTauri placeholder, cleanup, no teardown), `SysmonConfigForm` → Task 5. ✅
- Register `sysmonPanel` (no `onDestroy`) → Task 6. ✅
- Rust test (plausible snapshot), frontend tests (sysmonReady/format/Sparkline/registration) → Tasks 1,3,4,6. ✅
- Manual GUI (`yes` CPU spike) → Task 7. ✅

**Type consistency:** `SysSnapshot` fields (`cpu`, `memUsed`, `memTotal`, `swapUsed`, `swapTotal`, `load`, `uptimeSecs`) are defined once (Task 3) and consumed identically in `ipc.ts` (Task 5) and `SysmonView` (Task 5); the Rust struct uses the snake_case originals with `#[serde(rename_all = "camelCase")]` (Task 1) so the wire shape matches. `SysmonConfig.refreshSecs` defined Task 3, read in `SysmonView`/`SysmonConfigForm` (Task 5). `sysmonReady` (Task 3) used in `sysmonPanel` (Task 6). `Sampler::start`/`snapshot` (Task 1) called in `sysmon_sample` + `lib.rs` (Task 2). `formatMemPair`/`formatUptime`/`pushHistory` (Task 3) used in `SysmonView` (Task 5); `Sparkline` (Task 4) used in `SysmonView` (Task 5). All consistent.

**Placeholder scan:** No TBD/TODO/"handle errors appropriately". Every code step carries full code. The only narrative-only task is Task 7 (manual verification), which correctly has no code to write.
