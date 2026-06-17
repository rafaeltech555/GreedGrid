interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small controlled confirm dialog (mirrors ConfigModal's a11y conventions).
 *  Shared by destructive actions — file delete and workspace delete. The confirm
 *  button is styled as a destructive (red) action. */
export function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-72 rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={true}
      >
        <p className="mb-4 text-sm text-white/80">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded border border-red-400/50 px-3 py-1 text-xs text-red-200 hover:bg-red-400/10"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
