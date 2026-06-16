import type { ReactNode } from "react";
import type { PanelKind } from "../lib/types";

/** Props the host passes to a panel's live content view. */
export interface PanelViewProps {
  instanceId: string;
  config: Record<string, unknown>;
}

/** Props the host passes to a panel's config form (inside the modal). */
export interface ConfigFormProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

/**
 * One pluggable panel type. The host only knows this interface; adding a new
 * panel never touches grid/host code. `config` is the opaque-to-host record
 * stored in `PanelConfig.config`; each panel casts it to its own typed shape.
 */
export interface PanelTypeDef {
  kind: PanelKind;
  label: string;
  glyph: string;
  defaultConfig: () => Record<string, unknown>;
  ready: (config: Record<string, unknown>) => boolean;
  ConfigForm: (props: ConfigFormProps) => ReactNode;
  View: (props: PanelViewProps) => ReactNode;
  onDestroy?: (instanceId: string, config: Record<string, unknown>) => void;
}
