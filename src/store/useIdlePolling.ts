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
