// Shared frontend types. The layout-document and panel types arrive in later
// milestones (M1 grid, M2 panel host); for M0 we only need the backend health
// contract so the IPC seam is exercised end to end.

/** Panel kinds GreedGrid will host. `web`/`sysmon`/etc. land in later milestones. */
export type PanelKind = "terminal" | "file" | "web" | "sysmon";

/** Result of the backend `ping` health check. */
export interface PingInfo {
  /** Always "greedgrid" — confirms we reached our own backend. */
  app: string;
  /** Cargo package version of the Rust side. */
  version: string;
}
