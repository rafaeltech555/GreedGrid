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
