/** Config for the Terminal panel. Both fields are optional — the backend falls
 *  back to $SHELL/$HOME when they are absent. */
export interface TermConfig {
  shell?: string;
  cwd?: string;
}

/** A live pty session reported by the backend `term_list` command (camelCase).
 *  A "detached" session is `alive && !attached` — a candidate for reattach. */
export interface SessionInfo {
  instanceId: string;
  shell: string;
  cwd: string | null;
  alive: boolean;
  attached: boolean;
  /** True when a foreground command is currently running (best-effort). */
  foreground: boolean;
}

/** A terminal is always ready: it can open with defaults, so placement never
 *  forces the config modal. (Contrast with Web, which needs a non-empty url.) */
export function termReady(_config: Record<string, unknown>): boolean {
  return true;
}
