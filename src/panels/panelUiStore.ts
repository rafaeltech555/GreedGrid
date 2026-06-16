import { create } from "zustand";
import type { PanelKind } from "../lib/types";

/** Which cell + kind a config modal is editing, and whether it's a new place. */
export interface ModalState {
  cellId: string;
  kind: PanelKind;
  mode: "create" | "edit";
}

interface PanelUiState {
  /** Cell whose empty-cell type picker is open, if any. */
  pickerCellId: string | null;
  /** Open config modal, if any. */
  modal: ModalState | null;

  openPicker: (cellId: string) => void;
  closePicker: () => void;
  openCreateModal: (cellId: string, kind: PanelKind) => void;
  openEditModal: (cellId: string, kind: PanelKind) => void;
  closeModal: () => void;
}

export const usePanelUiStore = create<PanelUiState>((set) => ({
  pickerCellId: null,
  modal: null,

  openPicker: (cellId) => set({ pickerCellId: cellId, modal: null }),
  closePicker: () => set({ pickerCellId: null }),
  openCreateModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "create" }, pickerCellId: null }),
  openEditModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "edit" }, pickerCellId: null }),
  closeModal: () => set({ modal: null }),
}));
