/** Parent directory of an absolute path; root's parent is root. */
export function parentPath(p: string): string {
  const trimmed = p.replace(/\/+$/, ""); // drop trailing slashes
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** Join a directory and a child name without doubling the separator. */
export function joinPath(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, "");
  return base === "" ? `/${name}` : `${base}/${name}`;
}

/** Compact binary-unit file size, e.g. "4.2M", "2.1K", "512B". */
export function formatSize(n: number): string {
  const G = 1024 ** 3;
  const M = 1024 ** 2;
  const K = 1024;
  if (n >= G) return `${(n / G).toFixed(1)}G`;
  if (n >= M) return `${(n / M).toFixed(1)}M`;
  if (n >= K) return `${(n / K).toFixed(1)}K`;
  return `${n}B`;
}

/** A new/renamed entry name must be non-empty, contain no path separator, and
 *  not be "." or ".." (matches the backend `validate_name`). */
export function isValidName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !name.includes("/");
}
