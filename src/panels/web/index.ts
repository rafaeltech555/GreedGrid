import type { PanelTypeDef } from "../types";
import { webReady } from "./types";
import { WebConfigForm, WebView } from "./WebPanel";

export const webPanel: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: webReady,
  ConfigForm: WebConfigForm,
  View: WebView,
};
