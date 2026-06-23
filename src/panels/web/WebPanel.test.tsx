import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// 非 Tauri 環境:isTauri() = false → 走 iframe fallback,但仍渲染 chrome bar。
vi.mock("../../lib/ipc", async (orig) => {
  const actual = await orig<typeof import("../../lib/ipc")>();
  return { ...actual, isTauri: () => false };
});

import { WebView } from "./WebPanel";

describe("WebView (non-Tauri fallback)", () => {
  it("renders the url and an iframe fallback", () => {
    render(<WebView instanceId="w1" config={{ url: "https://example.com" }} />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://example.com");
  });

  it("renders chrome-bar controls", () => {
    render(<WebView instanceId="w1" config={{ url: "https://example.com" }} />);
    expect(screen.getByLabelText("Reload page")).toBeInTheDocument();
    expect(screen.getByLabelText("Panel settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Move panel")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });
});
