import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCell } from "./GridCell";
import { GridHost } from "./GridHost";
import { useLayoutStore } from "../store/layoutStore";
import { usePanelUiStore } from "../panels/panelUiStore";
import { __clearRegistry, registerPanel } from "../panels/registry";
import { makePreset } from "./presets";
import { cellId } from "./cellId";
import type { PanelTypeDef } from "../panels/types";
import { PANEL_KIND_DND, PANEL_MOVE_DND } from "../panels/dnd";

// Mock the ipc module so pickFolder is controllable in tests.
vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    pickFolder: vi.fn().mockResolvedValue(null),
  };
});

import { pickFolder } from "../lib/ipc";
const mockPickFolder = vi.mocked(pickFolder);

const webDef: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
  ConfigForm: () => null,
  View: ({ config }) => <div data-testid="web-view">{config.url as string}</div>,
};

const fileDef: PanelTypeDef = {
  kind: "file",
  label: "Files",
  glyph: "📁",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => <div data-testid="file-view" />,
};

const terminalDef: PanelTypeDef = {
  kind: "terminal",
  label: "Terminal",
  glyph: "⌨",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => <div data-testid="terminal-view" />,
};

beforeEach(() => {
  __clearRegistry();
  registerPanel(webDef);
  registerPanel(fileDef);
  registerPanel(terminalDef);
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [], selectMode: false });
  usePanelUiStore.setState({ pickerCellId: null, modal: null, maximizedCellId: null });
  mockPickFolder.mockResolvedValue(null);
});
afterEach(() => {
  __clearRegistry();
  vi.clearAllMocks();
});

const cellOf = (id: string) =>
  useLayoutStore.getState().layout.cells.find((c) => c.id === id)!;

describe("GridCell", () => {
  it("empty cell: + opens the picker", async () => {
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "+" }));
    expect(usePanelUiStore.getState().pickerCellId).toBe(cellId(1, 1));
  });

  it("renders the panel View when the cell hosts a panel", () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    expect(screen.getByTestId("web-view")).toHaveTextContent("https://x");
  });

  it("✕ clears the panel", async () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove panel" }));
    expect(cellOf(cellId(1, 1)).panel).toBeNull();
  });

  it("gear opens the edit modal", async () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(usePanelUiStore.getState().modal).toEqual({
      cellId: cellId(1, 1),
      kind: "web",
      mode: "edit",
    });
  });

  it("dropping a palette kind on an empty cell starts placement", () => {
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    const cellEl = screen.getByTestId(`cell-${cellId(1, 1)}`);
    const dataTransfer = {
      getData: (type: string) => (type === PANEL_KIND_DND ? "web" : ""),
    };
    fireEvent.drop(cellEl, { dataTransfer });
    // web is not ready by default (empty url) -> placement opens the create modal
    expect(usePanelUiStore.getState().modal).toEqual({
      cellId: cellId(1, 1),
      kind: "web",
      mode: "create",
    });
  });

  describe("selection", () => {
    it("no ◉ handle button is rendered (handle removed)", () => {
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("Ctrl+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).not.toContain(id);
    });

    it("Meta(Cmd)+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { metaKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("Ctrl+click does NOT open the picker", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { ctrlKey: true });
      expect(usePanelUiStore.getState().pickerCellId).toBeNull();
    });

    it("select mode: overlay click toggles selectedIds (even on a panel cell)", async () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      useLayoutStore.setState({ selectMode: true });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: "Select cell" }));
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("select mode overlay is absent when selectMode is false", () => {
      useLayoutStore.setState({ selectMode: false });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("selected cell outer div has ring-2 ring-emerald-400 class", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      expect(cellEl.className).not.toMatch(/ring-2/);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(cellEl.className).toMatch(/ring-2/);
      expect(cellEl.className).toMatch(/ring-inset/);
      expect(cellEl.className).toMatch(/ring-emerald-400/);
    });
  });

  describe("drag-move grip", () => {
    it("grip exists and is draggable when cell has a panel", () => {
      useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      const grip = screen.getByRole("button", { name: "Move panel" });
      expect(grip).toBeTruthy();
      expect(grip).toHaveAttribute("draggable", "true");
    });

    it("grip is absent when cell has no panel", () => {
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Move panel" })).toBeNull();
    });

    it("dragStart sets PANEL_MOVE_DND key to source cellId", () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      render(<GridCell cell={cellOf(id)} />);
      const grip = screen.getByRole("button", { name: "Move panel" });
      const fakeTransfer = { setData: vi.fn(), effectAllowed: "" as string };
      fireEvent.dragStart(grip, { dataTransfer: fakeTransfer });
      expect(fakeTransfer.setData).toHaveBeenCalledWith(PANEL_MOVE_DND, id);
    });

    it("drop with PANEL_MOVE_DND calls movePanel and swaps panels", () => {
      const fromId = cellId(1, 1);
      const toId = cellId(1, 2);
      useLayoutStore.getState().setPanel(fromId, "web", { url: "https://from" });
      // toId is empty initially
      render(<GridCell cell={cellOf(toId)} />);
      const toEl = screen.getByTestId(`cell-${toId}`);
      const fakeTransfer = {
        getData: (type: string) => (type === PANEL_MOVE_DND ? fromId : ""),
      };
      fireEvent.drop(toEl, { dataTransfer: fakeTransfer });
      // source cell should now be null (was swapped with empty target)
      expect(cellOf(fromId).panel).toBeNull();
      // target cell should now have the panel
      expect(cellOf(toId).panel?.config).toEqual({ url: "https://from" });
    });

    it("drop with PANEL_MOVE_DND to same cell is a no-op", () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      const fakeTransfer = {
        getData: (type: string) => (type === PANEL_MOVE_DND ? id : ""),
      };
      fireEvent.drop(cellEl, { dataTransfer: fakeTransfer });
      // panel should remain unchanged
      expect(cellOf(id).panel?.config).toEqual({ url: "https://x" });
    });
  });

  describe("selfChrome panels", () => {
    // A web def that declares selfChrome and renders its own chrome bar
    // (including a "Remove panel" button) — just like the real web panel will.
    const webSelfChromeDef: PanelTypeDef = {
      kind: "web",
      label: "Web",
      glyph: "🌐",
      defaultConfig: () => ({ url: "" }),
      ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
      ConfigForm: () => null,
      selfChrome: true,
      View: () => (
        <div data-testid="web-self-chrome-view">
          {/* simulates the native chrome bar that the web panel will provide */}
          <button aria-label="Remove panel">✕</button>
        </div>
      ),
    };

    beforeEach(() => {
      // Override the registry entry for "web" with the selfChrome version.
      registerPanel(webSelfChromeDef);
    });

    it("hides host hover controls for selfChrome panels (web)", () => {
      useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      // The web View renders exactly 1 "Remove panel" button (its own chrome).
      // The host overlay must NOT render a second one.
      expect(screen.getAllByLabelText("Remove panel")).toHaveLength(1);
    });

    it("shows host hover controls for normal panels (file)", () => {
      useLayoutStore.getState().setPanel(cellId(1, 2), "file", {});
      render(<GridCell cell={cellOf(cellId(1, 2))} />);
      // file panel has no selfChrome, so the host overlay renders the button.
      expect(screen.getByLabelText("Remove panel")).toBeInTheDocument();
    });
  });

  describe("GridCell maximize rendering", () => {
    it("maximized cell is absolute/inset and others are display:none but still mounted", () => {
      const ids = useLayoutStore.getState().layout.cells.map((c) => c.id);
      usePanelUiStore.setState({ maximizedCellId: ids[0] });
      render(<GridHost />);

      const max = screen.getByTestId(`cell-${ids[0]}`);
      const other = screen.getByTestId(`cell-${ids[1]}`);

      expect(max.style.position).toBe("absolute");
      expect(other.style.display).toBe("none");
      // Hidden cell is still in the DOM (component kept alive).
      expect(other).toBeTruthy();
    });

    it("renders a Maximize button in populated-panel chrome", () => {
      const id = useLayoutStore.getState().layout.cells[0].id;
      useLayoutStore.getState().setPanel(id, "terminal");
      render(<GridCell cell={useLayoutStore.getState().layout.cells[0]} />);
      expect(
        screen.getByRole("button", { name: "Maximize panel" }),
      ).toBeTruthy();
    });
  });

  describe("placeKind — file/terminal use native folder picker", () => {
    it("picking Files with a selected dir sets panel with { path }", async () => {
      const id = cellId(1, 1);
      mockPickFolder.mockResolvedValue("/some/dir");
      // Open the picker for the cell
      usePanelUiStore.setState({ pickerCellId: id, modal: null });
      render(<GridCell cell={cellOf(id)} />);
      // Click the "Files" button in the PanelPicker
      await userEvent.click(screen.getByRole("button", { name: /Files/ }));
      await waitFor(() => {
        const cell = cellOf(id);
        expect(cell.panel?.kind).toBe("file");
        expect(cell.panel?.config).toEqual({ path: "/some/dir" });
      });
    });

    it("picking Files when folder dialog is cancelled sets panel with default config", async () => {
      const id = cellId(1, 1);
      mockPickFolder.mockResolvedValue(null);
      usePanelUiStore.setState({ pickerCellId: id, modal: null });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: /Files/ }));
      await waitFor(() => {
        const cell = cellOf(id);
        expect(cell.panel?.kind).toBe("file");
        // null dir → undefined initialConfig → defaultConfig() = {}
        expect(cell.panel?.config).toEqual({});
      });
    });

    it("picking Terminal with a selected dir sets panel with { cwd }", async () => {
      const id = cellId(1, 1);
      mockPickFolder.mockResolvedValue("/some/dir");
      usePanelUiStore.setState({ pickerCellId: id, modal: null });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: /Terminal/ }));
      await waitFor(() => {
        const cell = cellOf(id);
        expect(cell.panel?.kind).toBe("terminal");
        expect(cell.panel?.config).toEqual({ cwd: "/some/dir" });
      });
    });

    it("picking Terminal when folder dialog is cancelled sets panel with default config", async () => {
      const id = cellId(1, 1);
      mockPickFolder.mockResolvedValue(null);
      usePanelUiStore.setState({ pickerCellId: id, modal: null });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: /Terminal/ }));
      await waitFor(() => {
        const cell = cellOf(id);
        expect(cell.panel?.kind).toBe("terminal");
        expect(cell.panel?.config).toEqual({});
      });
    });

    it("closePicker is called before pickFolder (picker dismissed before native dialog)", async () => {
      const id = cellId(1, 1);
      const calls: string[] = [];
      mockPickFolder.mockImplementation(async () => {
        calls.push("pickFolder");
        return null;
      });
      // Spy on closePicker via store
      const originalClosePicker = usePanelUiStore.getState().closePicker;
      usePanelUiStore.setState({
        pickerCellId: id,
        modal: null,
        closePicker: () => {
          calls.push("closePicker");
          originalClosePicker();
        },
      });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: /Files/ }));
      await waitFor(() => expect(calls).toContain("pickFolder"));
      expect(calls.indexOf("closePicker")).toBeLessThan(calls.indexOf("pickFolder"));
    });

    it("picking Files from palette drop (kind=file) calls pickFolder, sets panel with dir", async () => {
      const id = cellId(1, 1);
      mockPickFolder.mockResolvedValue("/palette/dir");
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      const dataTransfer = {
        getData: (type: string) => (type === PANEL_KIND_DND ? "file" : ""),
      };
      fireEvent.drop(cellEl, { dataTransfer });
      await waitFor(() => {
        const cell = cellOf(id);
        expect(cell.panel?.kind).toBe("file");
        expect(cell.panel?.config).toEqual({ path: "/palette/dir" });
      });
    });

    it("picking web kind from palette still uses ready/openCreateModal (not pickFolder)", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      const dataTransfer = {
        getData: (type: string) => (type === PANEL_KIND_DND ? "web" : ""),
      };
      fireEvent.drop(cellEl, { dataTransfer });
      // web is not ready → opens create modal, pickFolder not called
      expect(mockPickFolder).not.toHaveBeenCalled();
      expect(usePanelUiStore.getState().modal).toEqual({
        cellId: id,
        kind: "web",
        mode: "create",
      });
    });
  });
});
