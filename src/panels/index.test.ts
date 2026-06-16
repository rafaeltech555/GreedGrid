import { afterEach, describe, expect, it } from "vitest";
import { __clearRegistry, getPanelType } from "./registry";
import { registerAllPanels } from "./index";

afterEach(() => __clearRegistry());

describe("registerAllPanels", () => {
  it("registers the web panel", () => {
    registerAllPanels();
    expect(getPanelType("web")?.label).toBe("Web");
  });
});
