import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

// Smoke test: outside the Tauri webview, App renders the toolbar + grid and
// reports that no backend is attached (no invoke() call is made).
describe("App", () => {
  it("renders the brand and the default 4-cell grid", () => {
    render(<App />);
    expect(screen.getByText("Greed")).toBeInTheDocument();
    // default preset is 4 -> four empty drop-target cells
    expect(screen.getAllByText("empty")).toHaveLength(4);
  });

  it("renders the layout toolbar presets", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument();
  });

  it("reports no Tauri backend when run in a plain browser/jsdom", () => {
    render(<App />);
    expect(screen.getByTestId("backend-status")).toHaveTextContent(
      "browser (no Tauri backend)",
    );
  });
});
