import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FlowStore,
  createFlow,
  globalValueType,
  orderedFlowItems,
  parseFlow,
  serializeFlow,
  PerformanceTimeline,
  validateFlow,
  type NodeRunPerformance,
} from "../src/core/index";
import { approvalFlow } from "../examples/approval";

describe("diagram-owned globals and creation order", () => {
  it("supports typed arrays, booleans, safe integers and arbitrary JSON", () => {
    const store = new FlowStore(createFlow("globals"));
    for (const [index, value] of [
      [1, 2],
      true,
      42,
      { nested: { ok: null } },
    ].entries())
      store.addGlobal({
        id: `g-${index}`,
        name: `var${index}`,
        type: globalValueType(value),
        value,
      });
    expect(
      store.getSnapshot().globals!.map((variable) => variable.type),
    ).toEqual(["array", "boolean", "integer", "json"]);
    expect(parseFlow(serializeFlow(store.getSnapshot()))).toEqual(
      store.getSnapshot(),
    );
    expect(() => {
      store.getSnapshot().globals![0]!.value = null;
    }).toThrow();
    store.updateGlobal("g-2", (variable) => ({ ...variable, value: 43 }));
    expect(store.getSnapshot().globals![2]!.value).toBe(43);
    store.undo();
    expect(store.getSnapshot().globals![2]!.value).toBe(42);
    store.removeGlobal("g-0");
    expect(store.getSnapshot().globals).toHaveLength(3);
  });
  it("rejects duplicate identities/names, type mismatches and lossy values atomically", () => {
    const store = new FlowStore(createFlow("draft"));
    store.addGlobal({ id: "g", name: "enabled", type: "boolean", value: true });
    const before = store.getSnapshot();
    expect(() =>
      store.addGlobal({ id: "g2", name: "enabled", type: "integer", value: 1 }),
    ).toThrow();
    expect(() =>
      store.updateGlobal("g", (variable) => ({ ...variable, value: "wrong" })),
    ).toThrow();
    expect(() =>
      store.addGlobal({
        id: "g3",
        name: "count",
        type: "integer",
        value: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      store.addGlobal({ id: "g4", name: "bad", type: "json", value: NaN }),
    ).toThrow();
    expect(store.getSnapshot()).toBe(before);
  });
  it("pins globals before items while tracking interleaved node/edge creation", () => {
    const store = new FlowStore(createFlow("order"));
    store.addNode({
      id: "a",
      label: "A",
      type: "task",
      position: { x: 0, y: 0 },
    });
    store.addNode({
      id: "b",
      label: "B",
      type: "task",
      position: { x: 0, y: 0 },
    });
    store.addEdge({ id: "ab", source: "a", target: "b" });
    store.addNode({
      id: "c",
      label: "C",
      type: "task",
      position: { x: 0, y: 0 },
    });
    store.addGlobal({
      id: "global",
      name: "settings",
      type: "json",
      value: {},
    });
    expect(
      orderedFlowItems(store.getSnapshot()).map(
        (item) => `${item.type}:${item.id}`,
      ),
    ).toEqual(["global:global", "node:a", "node:b", "edge:ab", "node:c"]);
    store.removeNode("b");
    expect(store.getSnapshot().creationOrder!.map((item) => item.id)).toEqual([
      "a",
      "c",
    ]);
    store.undo();
    expect(store.getSnapshot().creationOrder!.map((item) => item.id)).toEqual([
      "a",
      "b",
      "ab",
      "c",
    ]);
  });
  it("preserves legacy documents and rejects invalid explicit item order", () => {
    const store = new FlowStore(approvalFlow);
    expect(store.getSnapshot()).toEqual(approvalFlow);
    expect(
      validateFlow({
        ...approvalFlow,
        creationOrder: [{ type: "node", id: "missing" }],
      }).some((item) => item.code === "INVALID_CREATION_ORDER"),
    ).toBe(true);
  });
});

const sample: NodeRunPerformance = {
  runId: "r1",
  nodeId: "n1",
  commandId: "c1",
  process: "Parent process",
  startMs: 0,
  durationMs: 100,
  cost: 7,
  network: [
    {
      startMs: 5,
      durationMs: 90,
      label: "GET /orders",
      bytes: "9007199254740993",
    },
  ],
  memory: [{ timeMs: 10, bytes: "9007199254740993" }],
};
describe("backend performance observations", () => {
  it("retains the backend integer cost and exact byte counters without deriving values", () => {
    const timeline = new PerformanceTimeline();
    expect(timeline.getSnapshot()).toEqual([]);
    timeline.record(sample);
    expect(timeline.getSnapshot()[0]!.cost).toBe(7);
    expect(timeline.getSnapshot()[0]!.memory![0]!.bytes).toBe(
      "9007199254740993",
    );
    expect(timeline.record(sample)).toBe(false);
    expect(() => timeline.record({ ...sample, cost: 8 })).toThrow("reused");
    expect(() => {
      timeline.getSnapshot()[0]!.cost = 99;
    }).toThrow();
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid backend cost %s",
    (cost) => {
      expect(() =>
        new PerformanceTimeline().record({ ...sample, cost }),
      ).toThrow();
    },
  );
  it("rejects malformed intervals, missing cost and invalid counters", () => {
    const timeline = new PerformanceTimeline();
    expect(() => timeline.record({ ...sample, durationMs: -1 })).toThrow();
    expect(() =>
      timeline.record({
        ...sample,
        memory: [{ timeMs: 0, bytes: "18446744073709551616" }],
      }),
    ).toThrow();
    const missing = { ...sample } as Partial<NodeRunPerformance>;
    delete missing.cost;
    expect(() => timeline.record(missing as NodeRunPerformance)).toThrow();
    expect(timeline.getSnapshot()).toEqual([]);
  });
});

describe("frozen Photon palette", () => {
  const css = readFileSync("src/svg/photon.css", "utf8");
  it("uses no alternate app palette", () => {
    expect(readFileSync("examples/styles.css", "utf8")).not.toMatch(
      /#[0-9a-f]{3,8}\b/i,
    );
    expect(css).toContain(".flow-node::before");
    expect(css).toContain(".node-footer");
  });
});
