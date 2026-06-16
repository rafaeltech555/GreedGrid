import { useEffect, useState } from "react";
import { useLayoutStore } from "../store/layoutStore";
import { getPanelType } from "./registry";
import { usePanelUiStore } from "./panelUiStore";

/** Shared modal that hosts a panel type's ConfigForm for create/edit. */
export function ConfigModal() {
  const modal = usePanelUiStore((s) => s.modal);
  const closeModal = usePanelUiStore((s) => s.closeModal);
  const setPanel = useLayoutStore((s) => s.setPanel);
  const updatePanelConfig = useLayoutStore((s) => s.updatePanelConfig);
  const cells = useLayoutStore((s) => s.layout.cells);

  const def = modal ? getPanelType(modal.kind) : undefined;
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!modal || !def) return;
    if (modal.mode === "edit") {
      const cell = cells.find((c) => c.id === modal.cellId);
      setDraft({ ...(cell?.panel?.config ?? def.defaultConfig()) });
    } else {
      setDraft({ ...def.defaultConfig() });
    }
    // Re-seed only when the modal identity changes. NOTE: if openEditModal is
    // called twice with identical args without an intervening closeModal, this
    // effect won't re-run and the draft keeps its prior state. Current UX (open
    // always pairs with a close) prevents this; revisit if edit is ever
    // triggered programmatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.cellId, modal?.kind, modal?.mode]);

  if (!modal || !def) return null;

  const ready = def.ready(draft);
  const Form = def.ConfigForm;

  const commit = () => {
    if (!ready) return;
    if (modal.mode === "create") {
      setPanel(modal.cellId, modal.kind, draft);
    } else {
      updatePanelConfig(modal.cellId, draft);
    }
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeModal}
    >
      <div
        className="w-80 rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={true}
        aria-labelledby="config-modal-title"
      >
        <h2 id="config-modal-title" className="mb-3 text-sm font-medium text-white/80">
          {def.label} settings
        </h2>
        <Form config={draft} onChange={setDraft} />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={!ready}
            className="rounded border border-emerald-400/50 px-3 py-1 text-xs text-emerald-200 enabled:hover:bg-emerald-400/10 disabled:opacity-30"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
