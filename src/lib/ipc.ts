import { Channel, invoke } from "@tauri-apps/api/core";
import type { PingInfo } from "./types";
import type { TermConfig } from "../panels/terminal/types";
import type { SysSnapshot } from "../panels/sysmon/types";

// Single typed wrapper around Tauri's `invoke`, mirroring the convention used in
// the other Tauri projects (Keytainer's lib/ipc.ts). Every backend command gets
// a thin typed function here so call sites never touch raw command-name strings.

/** Whether we are running inside the Tauri webview (vs. a plain browser/Vitest). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Backend health check — confirms the Rust side is wired up. */
export function ping(): Promise<PingInfo> {
  return invoke<PingInfo>("ping");
}

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

// --- System Monitor (M4) ----------------------------------------------------
/** Read the latest host-vitals snapshot from the shared backend sampler. */
export function sysmonSample(): Promise<SysSnapshot> {
  return invoke<SysSnapshot>("sysmon_sample");
}
