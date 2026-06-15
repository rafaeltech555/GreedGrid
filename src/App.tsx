import { useEffect, useState } from "react";
import { isTauri, ping } from "./lib/ipc";
import { Toolbar } from "./components/Toolbar";
import { GridHost } from "./grid/GridHost";

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

      <Toolbar />

      <main className="flex-1 p-1">
        <GridHost />
      </main>
    </div>
  );
}

export default App;
