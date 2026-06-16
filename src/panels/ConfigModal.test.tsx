import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigModal } from "./ConfigModal";
import { usePanelUiStore } from "./panelUiStore";
import { useLayoutStore } from "../store/layoutStore";
import { __clearRegistry, registerPanel } from "./registry";
import { makePreset } from "../grid/presets";
import { cellId } from "../grid/cellId";
import type { PanelTypeDef } from "./types";

const webDef: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
  ConfigForm: ({ config, onChange }) => (
    <input
      aria-label="url"
      value={(config.url as string) ?? ""}
      onChange={(e) => onChange({ ...config, url: e.target.value })}
    />
  ),
  View: () => null,
};

beforeEach(() => {
  __clearRegistry();
  registerPanel(webDef);
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [] });
  usePanelUiStore.setState({ pickerCellId: null, modal: null });
});
afterEach(() => __clearRegistry());

describe("ConfigModal", () => {
  it("renders nothing when no modal is open", () => {
    const { container } = render(<ConfigModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("create mode: OK places the panel with the edited config", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    await userEvent.type(screen.getByLabelText("url"), "https://a.com");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    const cell = useLayoutStore
      .getState()
      .layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.kind).toBe("web");
    expect(cell.panel?.config).toEqual({ url: "https://a.com" });
    expect(usePanelUiStore.getState().modal).toBeNull();
  });

  it("Cancel closes without placing", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const cell = useLayoutStore
      .getState()
      .layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel).toBeNull();
    expect(usePanelUiStore.getState().modal).toBeNull();
  });

  it("OK is disabled until ready()", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("url"), "https://a.com");
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();
  });
});
