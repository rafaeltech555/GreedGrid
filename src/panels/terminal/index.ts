import type { PanelTypeDef } from "../types";
import { termReady } from "./types";
import { TerminalConfigForm, TerminalView } from "./TerminalView";
import { termDetach } from "../../lib/ipc";

/** The Terminal panel: a real pty rendered with xterm.js. `ready` is always
 *  true, so placement never opens the config modal — the gear edits shell/cwd
 *  after the fact. `onDestroy` detaches the backend pty (M3b), keeping the
 *  session alive for reattach; killing it is a separate explicit action. */
export const terminalPanel: PanelTypeDef = {
  kind: "terminal",
  label: "Terminal",
  glyph: "⌨",
  defaultConfig: () => ({}),
  ready: termReady,
  ConfigForm: TerminalConfigForm,
  View: TerminalView,
  onDestroy: (instanceId) => {
    void termDetach(instanceId);
  },
};
