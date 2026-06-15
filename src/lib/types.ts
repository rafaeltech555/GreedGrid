// Shared frontend types. These mirror the serializable layout document that the
// persistence milestone (M6) will read/write, so the geometry shapes here are the
// long-lived contract — keep them plain and JSON-friendly.

/** Panel kinds GreedGrid will host. `web`/`sysmon`/etc. land in later milestones. */
export type PanelKind = "terminal" | "file" | "web" | "sysmon";

/** Result of the backend `ping` health check. */
export interface PingInfo {
  /** Always "greedgrid" — confirms we reached our own backend. */
  app: string;
  /** Cargo package version of the Rust side. */
  version: string;
}

/**
 * Grid track sizing. `cols`/`rows` are `fr` ratios (length = track count); a
 * splitter drag just rewrites two adjacent numbers. `gap` is the gutter in px.
 */
export interface GridTracks {
  cols: number[];
  rows: number[];
  gap: number;
}

/**
 * What a populated cell hosts. Opaque-to-host `config` is owned/validated by the
 * panel-type plugin (M2). M1 leaves every cell's `panel` null.
 */
export interface PanelConfig {
  /** Stable runtime identity — maps to a backend resource (pty, sysmon sub). */
  instanceId: string;
  kind: PanelKind;
  config: Record<string, unknown>;
}

/**
 * One grid cell. `col`/`row` are 1-based track coordinates of the top-left
 * corner; `colSpan`/`rowSpan` > 1 means the cell was merged across tracks.
 */
export interface Cell {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  panel: PanelConfig | null;
}

/** A complete grid layout: track sizing + the cells placed on it. */
export interface GridLayout {
  grid: GridTracks;
  cells: Cell[];
}
