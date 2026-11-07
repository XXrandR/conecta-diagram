import { describe, expect, it } from "vitest";
import { PanelSizes } from "../examples/devtools/resize.js";
describe("DevTools size persistence", () => {
  it("persists all pane/track sizes under the required single key", () => {
    const storage = new Map();
    const window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    };
    const sizes = new PanelSizes(window);
    sizes.set("dock-bottom", 390);
    sizes.set("assemble-left", 0.6);
    sizes.set("track-cost", 85);
    expect([...storage.keys()]).toEqual(["wf-panel-sizes"]);
    const loaded = new PanelSizes(window);
    expect(loaded.get("dock-bottom", 0)).toBe(390);
    expect(loaded.get("track-cost", 0)).toBe(85);
  });
  it("handles malformed/unavailable storage without losing in-memory resize state", () => {
    const window = {
      localStorage: {
        getItem() {
          throw new Error("disabled");
        },
        setItem() {
          throw new Error("disabled");
        },
      },
    };
    const sizes = new PanelSizes(window);
    sizes.set("a", 10);
    sizes.set("b", 20);
    expect(sizes.get("a", 0)).toBe(10);
    const malformed = new PanelSizes({
      localStorage: { getItem: () => "{", setItem() {} },
    });
    expect(malformed.get("missing", 0.5)).toBe(0.5);
  });
});
