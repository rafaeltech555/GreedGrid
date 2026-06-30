import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IdleIcon } from "./IdleIcon";

afterEach(cleanup);

describe("IdleIcon", () => {
  it("renders an accessible svg and animates the z's only when idle", () => {
    const { rerender } = render(<IdleIcon idle={false} />);
    const svg = screen.getByTestId("idle-icon");
    expect(svg.getAttribute("data-idle")).toBe("false");

    rerender(<IdleIcon idle />);
    expect(screen.getByTestId("idle-icon").getAttribute("data-idle")).toBe("true");
  });
});
