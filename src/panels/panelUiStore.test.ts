import { beforeEach, describe, expect, it } from "vitest";
import { usePanelUiStore } from "./panelUiStore";

const u = () => usePanelUiStore.getState();

beforeEach(() =>
  usePanelUiStore.setState({ pickerCellId: null, modal: null, dropMenu: null }),
);

describe("panelUiStore", () => {
  it("opens and closes the picker", () => {
    u().openPicker("c1-r1");
    expect(u().pickerCellId).toBe("c1-r1");
    u().closePicker();
    expect(u().pickerCellId).toBeNull();
  });

  it("opens a create modal and an edit modal", () => {
    u().openCreateModal("c1-r1", "web");
    expect(u().modal).toEqual({ cellId: "c1-r1", kind: "web", mode: "create" });
    u().openEditModal("c2-r1", "web");
    expect(u().modal).toEqual({ cellId: "c2-r1", kind: "web", mode: "edit" });
    u().closeModal();
    expect(u().modal).toBeNull();
  });

  it("opening the picker closes any open modal", () => {
    u().openCreateModal("c1-r1", "web");
    u().openPicker("c2-r1");
    expect(u().modal).toBeNull();
  });

  describe("dropMenu", () => {
    const menu = { cellId: "c1-r1", path: "/home/user/projects", x: 120, y: 80 };

    it("openDropMenu sets dropMenu", () => {
      u().openDropMenu(menu);
      expect(u().dropMenu).toEqual(menu);
    });

    it("closeDropMenu sets dropMenu to null", () => {
      u().openDropMenu(menu);
      u().closeDropMenu();
      expect(u().dropMenu).toBeNull();
    });

    it("openDropMenu clears pickerCellId", () => {
      u().openPicker("c2-r1");
      expect(u().pickerCellId).toBe("c2-r1");
      u().openDropMenu(menu);
      expect(u().pickerCellId).toBeNull();
    });

    it("openDropMenu clears modal", () => {
      u().openCreateModal("c1-r1", "web");
      expect(u().modal).not.toBeNull();
      u().openDropMenu(menu);
      expect(u().modal).toBeNull();
    });
  });
});
