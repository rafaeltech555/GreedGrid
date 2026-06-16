import type { PanelKind } from "../lib/types";
import type { PanelTypeDef } from "./types";

const registry: Partial<Record<PanelKind, PanelTypeDef>> = {};

/** Register a panel type. Called once per panel module at app start. */
export function registerPanel(def: PanelTypeDef): void {
  registry[def.kind] = def;
}

/** Look up a registered panel type, or undefined if not implemented yet. */
export function getPanelType(kind: PanelKind): PanelTypeDef | undefined {
  return registry[kind];
}

/** All currently-registered panel types (for the palette / picker). */
export function allPanelTypes(): PanelTypeDef[] {
  return Object.values(registry) as PanelTypeDef[];
}

/** Test-only: wipe the registry between tests. */
export function __clearRegistry(): void {
  for (const k of Object.keys(registry) as PanelKind[]) {
    delete registry[k];
  }
}
