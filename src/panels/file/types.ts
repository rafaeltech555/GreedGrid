/** One directory entry from the backend `fs_list` (camelCase from serde). */
export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
}

/** Result of `fs_list`: the canonical path actually listed + its entries. */
export interface ListResult {
  path: string;
  entries: FileEntry[];
}

/** Per-instance config: the starting directory (empty → backend uses $HOME). */
export interface FileConfig {
  path?: string;
}

/** Always ready — opens at a default directory, so placement never opens the
 *  config modal (the gear edits the starting directory later). */
export function fileReady(_config: Record<string, unknown>): boolean {
  return true;
}
