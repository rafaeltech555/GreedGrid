import type { ConfigFormProps, PanelViewProps } from "../types";
import type { WebConfig } from "./types";

/** Live view: render the configured URL in an iframe. */
export function WebView({ config }: PanelViewProps) {
  const url = (config as unknown as WebConfig).url;
  return (
    <iframe
      src={url}
      title={url}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}

/** Config form: a single URL text field. */
export function WebConfigForm({ config, onChange }: ConfigFormProps) {
  const url = (config as unknown as WebConfig).url ?? "";
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      URL
      <input
        type="url"
        value={url}
        placeholder="https://…"
        autoFocus
        onChange={(e) => onChange({ ...config, url: e.target.value })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
