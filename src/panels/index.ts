import { registerPanel } from "./registry";
import { webPanel } from "./web";

let registered = false;

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (registered) return;
  registered = true;
  registerPanel(webPanel);
}
