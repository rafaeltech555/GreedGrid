import type { PanelTypeDef } from "../types";
import { termReady } from "./types";
import { TerminalConfigForm, TerminalView } from "./TerminalView";
import { termClose } from "../../lib/ipc";

/** The Terminal panel: a real pty rendered with xterm.js. `ready` is always
 *  true, so placement never opens the config modal — the gear edits shell/cwd
 *  after the fact. `onDestroy` kills the backend pty (M3 has no detach mode). */
export const terminalPanel: PanelTypeDef = {
  kind: "terminal",
  label: "Terminal",
  glyph: "⌨",
  defaultConfig: () => ({}),
  ready: termReady,
  ConfigForm: TerminalConfigForm,
  View: TerminalView,
  onDestroy: (instanceId) => {
    void termClose(instanceId);
  },
};
