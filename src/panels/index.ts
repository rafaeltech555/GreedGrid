import { getPanelType, registerPanel } from "./registry";
import { webPanel } from "./web";

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (getPanelType("web")) return;
  registerPanel(webPanel);
}
