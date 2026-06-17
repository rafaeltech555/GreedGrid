import type { PanelTypeDef } from "../types";
import { fileReady } from "./types";
import { FileConfigForm, FileView } from "./FileView";

/** The File Browser panel: navigate, open, new-folder, rename, permanent-delete.
 *  `ready` is always true (opens at a default dir); no `onDestroy` — the fs
 *  commands are stateless, nothing per-instance to release. */
export const filePanel: PanelTypeDef = {
  kind: "file",
  label: "Files",
  glyph: "📁",
  defaultConfig: () => ({}),
  ready: fileReady,
  ConfigForm: FileConfigForm,
  View: FileView,
};
