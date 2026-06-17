import type { PanelTypeDef } from "../types";
import { sysmonReady } from "./types";
import { SysmonConfigForm, SysmonView } from "./SysmonView";

/** The System Monitor panel: polls the shared backend sampler and renders host
 *  vitals with rolling sparklines. `ready` is always true (opens with defaults);
 *  no `onDestroy` — there is no per-instance backend resource (the sampler is
 *  global). */
export const sysmonPanel: PanelTypeDef = {
  kind: "sysmon",
  label: "System",
  glyph: "📊",
  defaultConfig: () => ({}),
  ready: sysmonReady,
  ConfigForm: SysmonConfigForm,
  View: SysmonView,
};
