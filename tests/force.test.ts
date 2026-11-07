import { afterEach, describe, expect, it, vi } from "vitest";
import { timerFlush } from "d3-timer";
import { ForcePlacement } from "../src/d3/index";
import { createFlow, FlowStore, type FlowDocument } from "../src/core/index";
import { approvalFlow } from "../examples/approval";

const placements: ForcePlacement[] = [];
function create(
  document: FlowDocument = approvalFlow,
  options: ConstructorParameters<typeof ForcePlacement>[1] = {},
) {
  const placement = new ForcePlacement(document, options);
  placements.push(placement);
  return placement;
}
const crowded = (): FlowDocument => ({
  schemaVersion: 1,
  id: "crowded",
  nodes: [
    { id: "a", type: "task", label: "A", position: { x: 0, y: 0 } },
    { id: "b", type: "task", label: "B", position: { x: 0, y: 0 } },
  ],
  edges: [{ id: "ab", source: "a", target: "b" }],
});
afterEach(() => {
  for (const placement of placements.splice(0)) placement.destroy();
});

describe("D3 presentation physics", () => {
  it("separates overlaps deterministically without mutating frozen plan data", () => {
    const store = new FlowStore(crowded());
    const listener = vi.fn();
    store.subscribe(listener);
    const first = create(store.getSnapshot());
    const second = create(store.getSnapshot());
    expect(first.tick(160)).toEqual(second.tick(160));
    const a = first.getPositions().get("a")!;
    const b = first.getPositions().get("b")!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100);
    expect(store.getSnapshot()).toEqual(crowded());
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().edges[0]!.source).toBe("a");
  });
  it("bounds drift and honors fixed nodes and temporary drag pins", () => {
    const placement = create(crowded(), {
      maxDisplacement: 20,
      fixedNodeIds: ["a"],
    });
    placement.tick(200);
    expect(placement.getPositions().get("a")).toEqual({ x: 0, y: 0 });
    const b = placement.getPositions().get("b")!;
    expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(20.00001);
    placement.pin("a", { x: 500, y: 100 });
    placement.tick();
    expect(placement.getPositions().get("a")).toEqual({ x: 500, y: 100 });
    placement.pin("a", null);
    placement.tick();
    expect(placement.getPositions().get("a")).toEqual({ x: 0, y: 0 });
  });
  it("updates topology/anchors while ignoring non-geometric edits", () => {
    const store = new FlowStore(approvalFlow);
    const placement = create(store.getSnapshot());
    placement.tick(10);
    store.updateNode("start", (node) => ({ ...node, label: "Changed" }));
    expect(placement.update(store.getSnapshot())).toBe(false);
    store.moveNode("start", { x: 900, y: 700 });
    expect(placement.update(store.getSnapshot())).toBe(true);
    expect(placement.getPositions().get("start")).toEqual({ x: 900, y: 700 });
    store.removeNode("audit");
    placement.update(store.getSnapshot());
    expect(placement.getPositions().has("audit")).toBe(false);
  });
  it("returns detached snapshots and isolates observer failures", () => {
    const onListenerError = vi.fn();
    const placement = create(crowded(), { onListenerError });
    const good = vi.fn();
    placement.subscribe(() => {
      throw new Error("observer");
    });
    const unsubscribe = placement.subscribe(good);
    placement.tick();
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    unsubscribe();
    placement.tick();
    expect(good).toHaveBeenCalledTimes(1);
    const positions = placement.getPositions();
    expect(() => {
      positions.get("a")!.x = 50;
    }).toThrow();
    (positions as Map<string, unknown>).clear();
    expect(placement.getPositions().size).toBe(2);
  });
  it("stops animation and cleans callbacks on destruction", () => {
    const placement = create(crowded());
    const listener = vi.fn();
    placement.subscribe(listener);
    placement.restart();
    timerFlush();
    expect(listener).toHaveBeenCalled();
    placement.stop();
    listener.mockClear();
    timerFlush();
    expect(listener).not.toHaveBeenCalled();
    placement.restart();
    placement.destroy();
    timerFlush();
    expect(listener).not.toHaveBeenCalled();
    placement.destroy();
    expect(() => placement.tick()).toThrow("destroyed");
  });
  it.each([
    { anchorStrength: -1 },
    { chargeStrength: 10 },
    { linkDistance: 0 },
    { velocityDecay: 2 },
    { collisionPadding: NaN },
    { alphaDecay: 0 },
    { maxDisplacement: Infinity },
  ])("rejects invalid physics configuration %o", (options) => {
    expect(() => create(approvalFlow, options)).toThrow("force option");
  });
  it("handles empty drafts and rejects invalid operations", () => {
    const placement = create(createFlow("empty"));
    placement.restart();
    expect(placement.tick().size).toBe(0);
    expect(() => placement.tick(0)).toThrow();
    expect(() => placement.tick(10001)).toThrow();
    expect(() => placement.restart(2)).toThrow();
    expect(() => placement.pin("missing", null)).toThrow();
  });
  it("uses rectangular card bounds rather than pushing separated rows apart as circles", () => {
    const document = crowded();
    document.nodes = [
      {
        id: "a",
        type: "wait",
        signal: "response",
        label: "A",
        position: { x: 0, y: 0 },
      },
      {
        id: "b",
        type: "wait",
        signal: "response",
        label: "B",
        position: { x: 0, y: 240 },
      },
    ];
    document.edges = [];
    const placement = create(document);
    placement.tick(100);
    expect(
      placement.getPositions().get("b")!.y -
        placement.getPositions().get("a")!.y,
    ).toBeLessThan(260);
  });
});
