import { afterEach, describe, expect, it } from "vitest";
import { __clearRegistry, allPanelTypes, getPanelType } from "./registry";
import { registerAllPanels } from "./index";

afterEach(() => __clearRegistry());

describe("registerAllPanels", () => {
  it("registers the web panel", () => {
    registerAllPanels();
    expect(getPanelType("web")?.label).toBe("Web");
  });

  it("is idempotent and re-registers after a registry clear", () => {
    registerAllPanels();
    registerAllPanels(); // second call is a no-op, must not double-register
    expect(allPanelTypes().filter((d) => d.kind === "web")).toHaveLength(1);

    __clearRegistry();
    registerAllPanels(); // after a clear, must register again (no stale flag)
    expect(getPanelType("web")?.label).toBe("Web");
  });

  it("registers the terminal panel", () => {
    registerAllPanels();
    expect(getPanelType("terminal")?.label).toBe("Terminal");
  });

  it("registers the sysmon panel", () => {
    registerAllPanels();
    expect(getPanelType("sysmon")?.label).toBe("System");
  });

  it("registers the file panel", () => {
    registerAllPanels();
    expect(getPanelType("file")?.label).toBe("Files");
  });

  it("registers all built-in panels exactly once", () => {
    registerAllPanels();
    registerAllPanels(); // idempotent
    expect(allPanelTypes()).toHaveLength(4);
  });
});
