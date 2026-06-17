import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { SysSnapshot, SysmonConfig } from "./types";
import { isTauri, sysmonSample } from "../../lib/ipc";
import { Sparkline } from "./Sparkline";
import { formatMemPair, formatUptime, pushHistory } from "./format";

const HISTORY_CAP = 60;

/** Live view: polls the shared backend sampler on a configurable interval and
 *  renders current values + rolling CPU%/Mem% sparklines. No backend teardown
 *  on unmount — the sampler is global. */
export function SysmonView({ config }: PanelViewProps) {
  const [snap, setSnap] = useState<SysSnapshot | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    const cfg = config as SysmonConfig;
    const intervalMs = Math.max(1, cfg.refreshSecs ?? 2) * 1000;
    let alive = true;

    const tick = async () => {
      try {
        const s = await sysmonSample();
        if (!alive) return;
        setSnap(s);
        setCpuHist((h) => pushHistory(h, s.cpu, HISTORY_CAP));
        setMemHist((h) =>
          pushHistory(h, s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0, HISTORY_CAP),
        );
      } catch {
        // backend not ready / transient — skip this tick
      }
    };

    void tick(); // immediate first sample so the panel isn't blank
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [config]);

  if (!isTauri()) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30">
        System monitor requires the desktop app.
      </div>
    );
  }

  const memPct = snap && snap.memTotal > 0 ? (snap.memUsed / snap.memTotal) * 100 : 0;

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-2 text-xs">
      <Metric label="CPU" value={snap ? `${snap.cpu.toFixed(0)}%` : "…"} colorClass="text-emerald-400">
        <Sparkline data={cpuHist} max={100} className="h-6 w-full" />
        <Bar pct={snap?.cpu ?? 0} />
      </Metric>
      <Metric label="Mem" value={snap ? formatMemPair(snap.memUsed, snap.memTotal) : "…"} colorClass="text-sky-400">
        <Sparkline data={memHist} max={100} className="h-6 w-full" />
        <Bar pct={memPct} />
      </Metric>
      <div className="mt-auto flex flex-col gap-1 text-white/60">
        <Row label="Swap" value={snap ? formatMemPair(snap.swapUsed, snap.swapTotal) : "…"} />
        <Row label="Load" value={snap ? snap.load.map((l) => l.toFixed(2)).join("  ") : "…"} />
        <Row label="Up" value={snap ? formatUptime(snap.uptimeSecs) : "…"} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  colorClass,
  children,
}: {
  label: string;
  value: string;
  colorClass: string;
  children: ReactNode;
}) {
  // colorClass sets currentColor for both the Sparkline stroke and the Bar fill.
  return (
    <div className={`flex flex-col gap-0.5 ${colorClass}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-white/80">{value}</span>
      </div>
      {children}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded bg-white/10">
      <div
        className="h-full bg-current opacity-70"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-white/60">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Config form: the poll interval in seconds (default 2, min 1). */
export function SysmonConfigForm({ config, onChange }: ConfigFormProps) {
  const cfg = config as SysmonConfig;
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      Refresh interval (seconds)
      <input
        type="number"
        min={1}
        value={cfg.refreshSecs ?? 2}
        onChange={(e) => onChange({ ...config, refreshSecs: Number(e.target.value) })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
