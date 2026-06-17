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
