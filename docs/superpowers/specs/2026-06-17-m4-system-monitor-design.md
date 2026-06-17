# GreedGrid M4 — System Monitor Panel Design

_Date: 2026-06-17_

---

## Overview / Goals

**M4** delivers the **System Monitor panel** (`PanelKind` = `"sysmon"`, already reserved in the type union since M2): a compact, always-on readout of host vitals rendered inside a grid cell. It is the first **read-only, polled** panel — proving the panel architecture works for a metrics source without the streaming/lifecycle weight of the Terminal (M3).

**Scope (essentials only):**
- Overall CPU utilisation (%)
- Memory used / total
- Swap used / total
- Load average (1 / 5 / 15 min)
- Uptime

**Presentation:** a rolling **SVG sparkline** of recent history for **CPU%** and **Mem%**, with current numbers + a bar for each metric, and a numeric row for swap / load / uptime. Default refresh interval **2 s** (configurable).

**Architecture decision (locked): Approach A — shared backend sampler + frontend poll.** One background sampler thread owns a single `sysinfo::System`, refreshes it on a fixed cadence into a snapshot behind a `Mutex`. Frontend panels poll a cheap `sysmon_sample` command that only *reads* the latest snapshot. This keeps CPU% deltas consistent (fixed sampler cadence, not dependent on poll timing), makes the backend **O(1) regardless of panel count**, and means **no per-instance backend state, no Channel, no attach/detach lifecycle**.

**Non-goals (YAGNI — explicitly excluded):** per-core CPU; network / disk I/O rates; process list; temperatures / fans / battery; GPU; history persistence across app runs; alert thresholds; the native-webview Web fallback (unrelated, still deferred). None of these are designed here; adding any later is a new milestone.

---

## §1 Data Model

A single serialisable snapshot crosses the IPC boundary. Backend (`serde::Serialize`) and frontend (TS interface) mirror it.

```rust
// src-tauri/src/sysmon.rs
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysSnapshot {
    pub cpu: f32,          // global CPU usage, 0.0–100.0
    pub mem_used: u64,     // bytes
    pub mem_total: u64,    // bytes
    pub swap_used: u64,    // bytes
    pub swap_total: u64,   // bytes
    pub load: [f64; 3],    // 1 / 5 / 15 min load average
    pub uptime_secs: u64,
}
```

```ts
// src/panels/sysmon/types.ts
export interface SysSnapshot {
  cpu: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  load: [number, number, number];
  uptimeSecs: number;
}
```

`#[serde(rename_all = "camelCase")]` makes `mem_used` arrive as `memUsed`, matching the TS shape with no manual mapping.

The panel's per-instance `PanelConfig.config` holds only the refresh interval:

```ts
// src/panels/sysmon/types.ts
export interface SysmonConfig {
  refreshSecs?: number; // default 2; minimum enforced at 1
}
export function sysmonReady(_config: Record<string, unknown>): boolean {
  return true; // opens with defaults; placement never forces the config modal
}
```

---

## §2 Backend — Shared Sampler

New file `src-tauri/src/sysmon.rs`.

### Sampler

```rust
pub struct Sampler(pub Arc<Mutex<SysSnapshot>>);
```

- A constructor `Sampler::start()` that:
  1. Builds a `sysinfo::System`, does an initial `refresh_cpu_usage()` + `refresh_memory()`, sleeps `MINIMUM_CPU_UPDATE_INTERVAL` (~200 ms), refreshes again so the first CPU% is meaningful, and seeds the snapshot.
  2. Spawns a detached background thread that loops: `refresh_cpu_usage()` + `refresh_memory()`, recompute a `SysSnapshot`, write it into the `Mutex`, then `sleep(SAMPLE_INTERVAL)`.
  3. Returns the `Sampler` (holding the shared `Arc<Mutex<SysSnapshot>>`).
- `SAMPLE_INTERVAL` = **1 s** (constant). This is the cadence the CPU% delta is measured over and is independent of the frontend poll interval. (Frontend polling at 2 s simply reads whatever the latest 1 s-window snapshot is.)
- `fn snapshot(&self) -> SysSnapshot` — clone the current snapshot under the lock.

**sysinfo specifics** (crate `sysinfo = "0.33"`):
- Global CPU: `sys.global_cpu_usage() -> f32` after `refresh_cpu_usage()`.
- Memory (bytes in 0.30+): `sys.used_memory()`, `sys.total_memory()`, `sys.used_swap()`, `sys.total_swap()` after `refresh_memory()`.
- Load average: `System::load_average()` (associated fn) → `LoadAvg { one, five, fifteen }`.
- Uptime: `System::uptime()` (associated fn) → `u64` seconds.

The sampler thread is **started once at app startup** (negligible cost: a 1 s cpu+mem refresh) and lives for the app's lifetime — simpler than lazy start/stop, and correct when zero or many panels exist. (Rejected alternative: lazy start on first panel + refcounted stop — more moving parts for no real benefit on a desktop app.)

### Tauri command

`src-tauri/src/commands/sysmon.rs`:

```rust
#[tauri::command]
pub fn sysmon_sample(state: State<'_, Sampler>) -> SysSnapshot {
    state.snapshot()
}
```

Synchronous and cheap (a mutex read + clone) — no async needed. Registered in `commands/mod.rs` as `pub mod sysmon;`.

### Wiring (`lib.rs`)

- `mod sysmon;`
- `.manage(Sampler::start())`
- add `commands::sysmon::sysmon_sample` to `generate_handler!`.

No capability change (app-defined commands need no ACL entry, as established in M3).

---

## §3 Frontend — View, Sparkline, Formatting

New directory `src/panels/sysmon/`.

### IPC wrapper (`src/lib/ipc.ts`)

```ts
export function sysmonSample(): Promise<SysSnapshot> {
  return invoke<SysSnapshot>("sysmon_sample");
}
```

### Pure helpers (`src/panels/sysmon/format.ts`) — unit-tested

- `formatBytes(n: number): string` → e.g. `6.2G`, `512M` (binary units, 1 decimal for G).
- `formatMemPair(used, total): string` → `"6.2/16G"`.
- `formatUptime(secs: number): string` → `"3d 04:12"` (days + `HH:MM`; omit the `Nd ` prefix when < 1 day).
- `pushHistory(buf: number[], value: number, cap: number): number[]` → returns a new array with `value` appended, oldest dropped past `cap` (cap = 60). Pure, so the rolling buffer is testable without React.

### Sparkline (`src/panels/sysmon/Sparkline.tsx`) — SVG, unit-tested

```ts
export function Sparkline(props: { data: number[]; max: number; className?: string }): ReactNode
```

- Renders an `<svg>` with `viewBox="0 0 100 100"` (`preserveAspectRatio="none"`, fills its box) containing one `<polyline>`.
- Maps `data` to points: x evenly spaced across `0..100` by index, y = `100 - clamp(value / max, 0, 1) * 100` (so higher value = higher line).
- Edge cases: empty `data` → render an empty `<svg>` (no polyline); single point → a flat 2-point line. `max <= 0` treated as `1` to avoid divide-by-zero.
- Stroke via `currentColor` so the parent sets colour with a Tailwind text class.

### View (`src/panels/sysmon/SysmonView.tsx`)

- `isTauri()` guard: in a plain browser (no backend) render a centered placeholder `"System monitor requires the desktop app."` (mirrors `TerminalView`), so the Vite-only path doesn't crash.
- On mount (`useEffect` keyed on `[instanceId, config]`):
  - Read `refreshSecs` from config (`?? 2`, clamped to `>= 1`) → `intervalMs`.
  - Keep CPU% and Mem% history in `useState<number[]>` (or a `useRef` + forced re-render via a snapshot state). Simpler: store the latest `SysSnapshot | null` and two history arrays in state.
  - `setInterval`: call `sysmonSample()`, set the latest snapshot, and `pushHistory` CPU% and Mem% (Mem% = `memUsed/memTotal*100`) into their buffers (cap 60).
  - Do one immediate sample before the first interval tick so the panel isn't blank for `intervalMs`.
  - Cleanup: `clearInterval`. **No backend teardown** (the sampler is shared/global).
- Render (matches the approved mockup): CPU% number + `Sparkline` (emerald) + bar; Mem pair + `Sparkline` + bar; a compact row for Swap (bar or `used/total`), Load (`1.24 0.98 0.76`), Uptime.
- A small reusable `Bar` (or reuse a Tailwind div) for the proportion bars.

### Config form (`src/panels/sysmon/SysmonView.tsx` or a sibling)

`SysmonConfigForm`: a single number input for **refresh interval (seconds)**, default 2, `min=1`. On change writes `{ ...config, refreshSecs }`.

### Panel registration

- `src/panels/sysmon/index.ts` exports `sysmonPanel: PanelTypeDef`:
  - `kind: "sysmon"`, `label: "System"`, `glyph: "📊"`, `defaultConfig: () => ({})`, `ready: sysmonReady`, `ConfigForm: SysmonConfigForm`, `View: SysmonView`.
  - **No `onDestroy`** (no per-instance backend resource to release).
- `src/panels/index.ts`: register it alongside web + terminal (per-kind idempotent guard).

---

## §4 Testing

**Rust (`cargo test`, in `sysmon.rs`):**
- `Sampler::start()` then `snapshot()` returns plausible values: `mem_total > 0`, `0.0 <= cpu <= 100.0`, `load` finite, `uptime_secs > 0`. (One sample; no timing assertions.)

**Frontend (Vitest):**
- `sysmonReady` → always true.
- `formatBytes` / `formatMemPair` → boundaries (bytes→M→G, rounding).
- `formatUptime` → `< 1h`, `< 1d`, `> 1d` cases (e.g. `90061` → `"1d 01:01"`).
- `pushHistory` → appends; drops oldest past cap; does not mutate input.
- `Sparkline` (Testing Library + jsdom) → empty data renders no `<polyline>`; N points → a `<polyline>` whose `points` has N coords; values normalise against `max` (a value == max maps to y≈0, 0 maps to y≈100).

`SysmonView`'s live polling is **not** unit-tested (needs the Tauri runtime); covered by manual GUI verification.

**Manual GUI verification (`pnpm tauri dev` + XTest/screenshot recipe):** place a System panel, confirm numbers populate within ~2 s, CPU% reacts to load (e.g. run `yes > /dev/null` in a Terminal panel and watch CPU climb), sparklines grow over time, and changing the refresh interval via the gear takes effect.

---

## §5 File Structure & Phasing

**New / modified files:**
```
src-tauri/
  Cargo.toml                      (+ sysinfo = "0.33")
  src/sysmon.rs                   (Sampler + SysSnapshot + Rust test)         NEW
  src/commands/sysmon.rs          (sysmon_sample command)                     NEW
  src/commands/mod.rs             (+ pub mod sysmon;)
  src/lib.rs                      (mod sysmon; .manage(Sampler::start()); handler)
src/
  lib/ipc.ts                      (+ sysmonSample wrapper)
  panels/sysmon/types.ts          (SysSnapshot, SysmonConfig, sysmonReady)    NEW
  panels/sysmon/format.ts         (formatBytes/formatMemPair/formatUptime/pushHistory) NEW
  panels/sysmon/Sparkline.tsx     (SVG sparkline)                             NEW
  panels/sysmon/SysmonView.tsx    (View + ConfigForm)                         NEW
  panels/sysmon/index.ts          (sysmonPanel: PanelTypeDef)                 NEW
  panels/index.ts                 (register sysmonPanel)
  + matching *.test.ts(x) files for types/format/Sparkline/registration
```

**Phasing (implementation order, each independently testable):**
1. Backend: `sysinfo` dep + `Sampler`/`SysSnapshot` + Rust test.
2. Backend: `sysmon_sample` command + module wiring + `.manage`.
3. Frontend: `types.ts` (`SysmonConfig`/`sysmonReady`) + `format.ts` helpers + their tests.
4. Frontend: `Sparkline` + test.
5. Frontend: `sysmonSample` IPC wrapper + `SysmonView` + `SysmonConfigForm`.
6. Register `sysmonPanel` + registration test.
7. Manual GUI verification.

This mirrors the M3 cadence (backend-first, pure-logic frontend tests, GUI last) and reuses the established panel-registry, IPC-wrapper, and config-modal infrastructure unchanged.
