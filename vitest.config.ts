import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest runs against the frontend only; the Tauri-tuned vite.config.ts stays
// dedicated to dev/build so the two concerns don't fight over server options.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // src-tauri holds Rust; never let Vitest crawl it.
    exclude: ["**/node_modules/**", "**/dist/**", "**/src-tauri/**"],
  },
});
