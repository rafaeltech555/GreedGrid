import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clampToViewport, DropMenu } from "./DropMenu";
import { usePanelUiStore } from "./panelUiStore";
import { useLayoutStore } from "../store/layoutStore";
import { __clearRegistry, registerPanel } from "./registry";
import { makePreset } from "../grid/presets";
import { cellId } from "../grid/cellId";
import type { PanelTypeDef } from "./types";

// ---------------------------------------------------------------------------
// Minimal panel defs so setPanel does not no-op due to missing registry entry.
// ---------------------------------------------------------------------------

const mkDef = (kind: PanelTypeDef["kind"]): PanelTypeDef => ({
  kind,
  label: kind,
  glyph: "x",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => null,
});

beforeEach(() => {
  __clearRegistry();
  registerPanel(mkDef("file"));
  registerPanel(mkDef("terminal"));
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [], selectMode: false });
  usePanelUiStore.setState({ pickerCellId: null, modal: null, dropMenu: null });
});
afterEach(() => __clearRegistry());

const cellOf = (id: string) =>
  useLayoutStore.getState().layout.cells.find((c) => c.id === id)!;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DropMenu", () => {
  it("renders nothing when dropMenu is null", () => {
    const { container } = render(<DropMenu />);
    expect(container.firstChild).toBeNull();
  });

  describe("when dropMenu is set and target cell is empty", () => {
    const cid = cellId(1, 1);
    const menu = { cellId: cid, path: "/home/user/docs", x: 200, y: 150 };

    beforeEach(() => {
      usePanelUiStore.getState().openDropMenu(menu);
    });

    it("shows File and Terminal buttons", () => {
      render(<DropMenu />);
      expect(screen.getByRole("menuitem", { name: /File Browser/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Terminal/i })).toBeInTheDocument();
    });

    it("clicking File opens a file panel with { path } and closes the menu", async () => {
      render(<DropMenu />);
      await userEvent.click(screen.getByRole("menuitem", { name: /File Browser/i }));
      expect(cellOf(cid).panel?.kind).toBe("file");
      expect(cellOf(cid).panel?.config).toEqual({ path: "/home/user/docs" });
      expect(usePanelUiStore.getState().dropMenu).toBeNull();
    });

    it("clicking Terminal opens a terminal panel with { cwd } and closes the menu", async () => {
      render(<DropMenu />);
      await userEvent.click(screen.getByRole("menuitem", { name: /Terminal/i }));
      expect(cellOf(cid).panel?.kind).toBe("terminal");
      expect(cellOf(cid).panel?.config).toEqual({ cwd: "/home/user/docs" });
      expect(usePanelUiStore.getState().dropMenu).toBeNull();
    });
  });

  describe("when dropMenu is set and target cell is already occupied", () => {
    const cid = cellId(1, 2);
    const menu = { cellId: cid, path: "/home/user/new", x: 200, y: 150 };

    beforeEach(() => {
      // Pre-populate the cell with a terminal panel.
      useLayoutStore.getState().setPanel(cid, "terminal", { cwd: "/home/user/old" });
      usePanelUiStore.getState().openDropMenu(menu);
    });

    it("clicking File does NOT immediately overwrite — shows confirm UI", async () => {
      render(<DropMenu />);
      await userEvent.click(screen.getByRole("menuitem", { name: /File Browser/i }));
      // Still has the original terminal panel.
      expect(cellOf(cid).panel?.kind).toBe("terminal");
      expect(cellOf(cid).panel?.config).toEqual({ cwd: "/home/user/old" });
      // Confirm prompt visible.
      expect(screen.getByText(/覆蓋現有 panel/)).toBeInTheDocument();
    });

    it("clicking Terminal then 覆蓋 overwrites the existing panel", async () => {
      render(<DropMenu />);
      await userEvent.click(screen.getByRole("menuitem", { name: /Terminal/i }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Confirm overwrite/i }));
      expect(cellOf(cid).panel?.kind).toBe("terminal");
      expect(cellOf(cid).panel?.config).toEqual({ cwd: "/home/user/new" });
      expect(usePanelUiStore.getState().dropMenu).toBeNull();
    });

    it("clicking File then 取消 leaves the original panel intact and closes the menu", async () => {
      render(<DropMenu />);
      await userEvent.click(screen.getByRole("menuitem", { name: /File Browser/i }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Cancel overwrite/i }));
      // Original panel untouched.
      expect(cellOf(cid).panel?.kind).toBe("terminal");
      expect(cellOf(cid).panel?.config).toEqual({ cwd: "/home/user/old" });
      expect(usePanelUiStore.getState().dropMenu).toBeNull();
    });

    it("re-opening dropMenu on a new cell clears the stale confirm UI", async () => {
      render(<DropMenu />);
      // Put DropMenu into confirm state
      await userEvent.click(screen.getByRole("menuitem", { name: /File Browser/i }));
      expect(screen.getByText(/覆蓋現有 panel/)).toBeInTheDocument();

      // Simulate a new OS drop on a different (empty) cell
      const emptyCell = cellId(1, 3);
      act(() => {
        usePanelUiStore.getState().openDropMenu({ cellId: emptyCell, path: "/other", x: 10, y: 10 });
      });

      // Confirm UI should be gone; normal menu should be shown
      expect(screen.queryByText(/覆蓋現有 panel/)).toBeNull();
      expect(screen.getByRole("menuitem", { name: /File Browser/i })).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// clampToViewport — pure function tests
// ---------------------------------------------------------------------------

describe("clampToViewport", () => {
  it("returns original position when element fits within viewport", () => {
    expect(clampToViewport(100, 100, 160, 80, 1280, 720)).toEqual({ left: 100, top: 100 });
  });

  it("clamps right overflow: left + width + margin <= vw", () => {
    const result = clampToViewport(1200, 100, 160, 80, 1280, 720);
    expect(result.left + 160 + 8).toBeLessThanOrEqual(1280);
  });

  it("clamps bottom overflow: top + height + margin <= vh", () => {
    const result = clampToViewport(100, 700, 160, 80, 1280, 720);
    expect(result.top + 80 + 8).toBeLessThanOrEqual(720);
  });

  it("clamps both axes when position exceeds both edges", () => {
    const result = clampToViewport(9000, 9000, 160, 80, 1280, 720);
    expect(result.left + 160 + 8).toBeLessThanOrEqual(1280);
    expect(result.top + 80 + 8).toBeLessThanOrEqual(720);
  });
});
