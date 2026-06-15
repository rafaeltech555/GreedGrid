import { invoke } from "@tauri-apps/api/core";
import type { PingInfo } from "./types";

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
