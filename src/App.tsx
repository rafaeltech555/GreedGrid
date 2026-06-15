import { useEffect, useState } from "react";
import { isTauri, ping } from "./lib/ipc";

// M0 placeholder: a static 3×3 "hello grid" that proves the window, Tailwind,
// and the Rust IPC seam all work. The real interactive grid engine (presets,
// draggable splitters, merge) replaces this in M1.
const PLACEHOLDER_CELLS = Array.from({ length: 9 }, (_, i) => i + 1);

function App() {
  const [backend, setBackend] = useState<string>("…");

  useEffect(() => {
    if (!isTauri()) {
      setBackend("browser (no Tauri backend)");
      return;
    }
    ping()
      .then((info) => setBackend(`${info.app} v${info.version}`))
      .catch((err) => setBackend(`error: ${String(err)}`));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide">
          Greed<span className="text-emerald-400">Grid</span>
        </h1>
        <span className="text-xs text-white/40" data-testid="backend-status">
          backend: {backend}
        </span>
      </header>

      <main className="grid flex-1 grid-cols-3 grid-rows-3 gap-1 p-1">
        {PLACEHOLDER_CELLS.map((n) => (
          <div
            key={n}
            className="flex items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/30"
          >
            <span className="text-xs">cell {n}</span>
          </div>
        ))}
      </main>
    </div>
  );
}

export default App;
