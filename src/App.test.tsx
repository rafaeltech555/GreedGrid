import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

// M0 smoke test: outside the Tauri webview, App must render the placeholder grid
// and report that no backend is attached (no invoke() call is made).
describe("App (M0 scaffold)", () => {
  it("renders the brand and the 9 placeholder cells", () => {
    render(<App />);
    expect(screen.getByText("Greed")).toBeInTheDocument();
    expect(screen.getByText("cell 1")).toBeInTheDocument();
    expect(screen.getByText("cell 9")).toBeInTheDocument();
  });

  it("reports no Tauri backend when run in a plain browser/jsdom", () => {
    render(<App />);
    expect(screen.getByTestId("backend-status")).toHaveTextContent(
      "browser (no Tauri backend)",
    );
  });
});
