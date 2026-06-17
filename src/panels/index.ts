import { getPanelType, registerPanel } from "./registry";
import { webPanel } from "./web";
import { terminalPanel } from "./terminal";
import { sysmonPanel } from "./sysmon";
import { filePanel } from "./file";

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (!getPanelType("web")) registerPanel(webPanel);
  if (!getPanelType("terminal")) registerPanel(terminalPanel);
  if (!getPanelType("sysmon")) registerPanel(sysmonPanel);
  if (!getPanelType("file")) registerPanel(filePanel);
}
