import { create } from "zustand";
import type { PanelKind } from "../lib/types";

/** Which cell + kind a config modal is editing, and whether it's a new place. */
export interface ModalState {
  cellId: string;
  kind: PanelKind;
  mode: "create" | "edit";
}

/** A OS folder drop landed on a cell; waiting for the user to pick File or Terminal. */
export interface DropMenuState {
  cellId: string;
  path: string;     // resolved folder path (supplied by Task 5)
  x: number;        // viewport CSS coords for positioning the floating menu
  y: number;
}

interface PanelUiState {
  /** Cell whose empty-cell type picker is open, if any. */
  pickerCellId: string | null;
  /** Open config modal, if any. */
  modal: ModalState | null;
  /** Pending OS folder-drop menu, if any. */
  dropMenu: DropMenuState | null;
  /** Whether the toolbar's workspace "Load" dropdown is open (a grid overlay). */
  workspaceMenuOpen: boolean;

  openPicker: (cellId: string) => void;
  closePicker: () => void;
  openCreateModal: (cellId: string, kind: PanelKind) => void;
  openEditModal: (cellId: string, kind: PanelKind) => void;
  closeModal: () => void;
  openDropMenu: (menu: DropMenuState) => void;
  closeDropMenu: () => void;
  setWorkspaceMenuOpen: (open: boolean) => void;
}

export const usePanelUiStore = create<PanelUiState>((set) => ({
  pickerCellId: null,
  modal: null,
  dropMenu: null,
  workspaceMenuOpen: false,

  openPicker: (cellId) => set({ pickerCellId: cellId, modal: null }),
  closePicker: () => set({ pickerCellId: null }),
  openCreateModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "create" }, pickerCellId: null }),
  openEditModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "edit" }, pickerCellId: null }),
  closeModal: () => set({ modal: null }),
  openDropMenu: (menu) => set({ dropMenu: menu, pickerCellId: null, modal: null }),
  closeDropMenu: () => set({ dropMenu: null }),
  setWorkspaceMenuOpen: (open) => set({ workspaceMenuOpen: open }),
}));
