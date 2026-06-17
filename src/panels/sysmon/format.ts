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
