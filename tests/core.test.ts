import { describe, expect, it, vi } from "vitest";
import { approvalFlow } from "../examples/approval";
import {
  createFlow,
  evaluateCondition,
  FlowStore,
  layoutFlow,
  parseFlow,
  serializeFlow,
  validateFlow,
  visibleElements,
  type FlowDocument,
  type FlowNode,
} from "../src/core/index";

const task = (id = "task"): FlowNode => ({
  id,
  type: "task",
  label: id,
  position: { x: 0, y: 0 },
});
const copy = (): FlowDocument => JSON.parse(JSON.stringify(approvalFlow));

describe("conditions and visibility", () => {
  it("evaluates composed conditions without coercion or inherited properties", () => {
    expect(
      evaluateCondition(
        {
          op: "all",
          conditions: [
            { op: "gte", path: ["score"], value: 5 },
            {
              op: "not",
              condition: { op: "eq", path: ["blocked"], value: true },
            },
            { op: "in", path: ["role"], value: ["admin", "editor"] },
          ],
        },
        { score: 7, blocked: false, role: "editor" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { op: "gt", path: ["score"], value: 5 },
        { score: "7" },
      ),
    ).toBe(false);
    expect(evaluateCondition({ op: "exists", path: ["toString"] }, {})).toBe(
      false,
    );
    expect(
      evaluateCondition({ op: "neq", path: ["missing"], value: true }, {}),
    ).toBe(false);
    expect(
      evaluateCondition({ op: "exists", path: ["value"] }, { value: null }),
    ).toBe(true);
    expect(evaluateCondition({ op: "any", conditions: [] }, {})).toBe(false);
  });
  it("compares JSON objects independently of key ordering", () => {
    expect(
      evaluateCondition(
        { op: "eq", path: ["object"], value: { a: 1, b: 2 } },
        { object: { b: 2, a: 1 } },
      ),
    ).toBe(true);
  });
  it("hides incident edges without changing the document", () => {
    const document = copy();
    document.nodes[2]!.visibleWhen = { op: "eq", path: ["show"], value: true };
    const visible = visibleElements(document, {});
    expect(visible.nodes).toHaveLength(8);
    expect(visible.edges).toHaveLength(7);
    expect(document.nodes).toHaveLength(9);
    expect(visibleElements(document, { show: true }).nodes).toHaveLength(9);
  });
});

describe("document boundaries and validation", () => {
  it("round trips JSON and accepts an executable structured flow", () => {
    expect(parseFlow(serializeFlow(approvalFlow))).toEqual(approvalFlow);
    expect(validateFlow(approvalFlow)).toEqual([]);
    expect(validateFlow(createFlow("draft"), { mode: "draft" })).toEqual([]);
    expect(
      validateFlow(createFlow("draft")).map((issue) => issue.code),
    ).toContain("START_COUNT");
  });
  it.each([
    undefined,
    NaN,
    Infinity,
    () => 1,
    new Date(),
    new Map(),
    Symbol("x"),
  ])("rejects non-JSON metadata %s", (value) => {
    expect(validateFlow({ ...approvalFlow, data: { value } })[0]?.code).toBe(
      "INVALID_JSON",
    );
  });
  it("rejects circular values, sparse arrays, accessors, invalid JSON and schema versions", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(validateFlow({ ...approvalFlow, data: circular })[0]?.code).toBe(
      "INVALID_JSON",
    );
    expect(
      validateFlow({ ...approvalFlow, data: { list: Array(2) } })[0]?.code,
    ).toBe("INVALID_JSON");
    const getter = vi.fn(() => true);
    expect(
      validateFlow({
        ...approvalFlow,
        data: Object.defineProperty({}, "x", { get: getter, enumerable: true }),
      })[0]?.code,
    ).toBe("INVALID_JSON");
    expect(getter).not.toHaveBeenCalled();
    expect(() => parseFlow("{")).toThrow("Invalid JSON");
    expect(() => parseFlow('{"schemaVersion":2}')).toThrow("validation");
  });
  it("rejects malformed nodes, conditions and dangling or duplicate identifiers", () => {
    const document = copy();
    document.edges.push({ id: "missing", source: "no", target: "start" });
    document.nodes.push(document.nodes[0]!);
    expect(validateFlow(document).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_NODE", "DANGLING_EDGE"]),
    );
    expect(validateFlow({ ...approvalFlow, nodes: [{}] })[0]?.code).toBe(
      "INVALID_NODE",
    );
    document.edges[0]!.condition = { op: "gt", path: ["x"], value: "bad" };
    expect(validateFlow(document)[0]?.code).toBe("INVALID_CONDITION");
  });
  it("requires explicit forks, conditional fallbacks and reciprocal join pairs", () => {
    const document = copy();
    document.edges.push({ id: "extra", source: "process", target: "approval" });
    document.edges = document.edges.filter((edge) => !edge.default);
    const fork = document.nodes.find((node) => node.id === "fork")!;
    if (fork.type === "fork") fork.join = "missing";
    expect(validateFlow(document).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["OUTPUT_COUNT", "DECISION_DEFAULT", "FORK_PAIR"]),
    );
  });
  it("rejects escapes from parallel regions and joins outside their scope", () => {
    const document = copy();
    document.edges.find((edge) => edge.id === "audit-join")!.target =
      "accepted";
    expect(validateFlow(document).map((issue) => issue.code)).toContain(
      "PARALLEL_ESCAPE",
    );
    const other = copy();
    other.edges[0]!.target = "join";
    expect(validateFlow(other).map((issue) => issue.code)).toContain(
      "PARALLEL_STRUCTURE",
    );
  });
  it("reports unreachable nodes and no-end cycles", () => {
    const document = copy();
    document.nodes.push(task("orphan"));
    document.edges.push({ id: "loop", source: "orphan", target: "orphan" });
    expect(validateFlow(document).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNREACHABLE", "NO_END_PATH"]),
    );
  });
});

describe("editing store", () => {
  it("protects inputs and snapshots and commits exactly once per transaction", () => {
    const document = copy();
    const store = new FlowStore(document);
    const listener = vi.fn();
    store.subscribe(listener);
    document.nodes[0]!.label = "changed outside";
    expect(store.getSnapshot().nodes[0]!.label).toBe("Start");
    expect(() => {
      store.getSnapshot().nodes[0]!.label = "no";
    }).toThrow();
    store.transaction("batch", (draft) => {
      draft.nodes.push(task());
      draft.nodes[0]!.label = "Updated";
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].reason).toBe("batch");
    store.transaction("noop", () => {});
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getRevision()).toBe(1);
  });
  it("rolls back invalid or thrown edits without touching history", () => {
    const store = new FlowStore(approvalFlow);
    const initial = store.getSnapshot();
    expect(() => store.addNode(initial.nodes[0]!)).toThrow();
    expect(() =>
      store.addEdge({ id: "bad", source: "missing", target: "start" }),
    ).toThrow();
    expect(() =>
      store.transaction("bad", (draft) => {
        draft.nodes = [];
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(store.getSnapshot()).toBe(initial);
    expect(store.canUndo).toBe(false);
  });
  it("removes incident edges atomically and supports undo/redo and branching history", () => {
    const store = new FlowStore(approvalFlow);
    store.removeNode("process");
    expect(store.getSnapshot().edges).toHaveLength(7);
    store.undo();
    expect(store.getSnapshot()).toEqual(approvalFlow);
    store.redo();
    expect(store.getSnapshot().nodes).toHaveLength(8);
    store.undo();
    store.moveNode("start", { x: 10, y: 10 });
    expect(store.canRedo).toBe(false);
  });
  it("bounds history and supports disabling it", () => {
    const store = new FlowStore(approvalFlow, { historyLimit: 1 });
    store.addNode(task("one"));
    store.addNode(task("two"));
    store.undo();
    store.undo();
    expect(store.getSnapshot().nodes).toHaveLength(10);
    const noHistory = new FlowStore(approvalFlow, { historyLimit: 0 });
    noHistory.addNode(task());
    expect(noHistory.canUndo).toBe(false);
  });
  it("isolates listener errors and disallows reentrant mutations", () => {
    const onListenerError = vi.fn();
    const store = new FlowStore(approvalFlow, { onListenerError });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(() => store.addNode(task("nested")));
    store.subscribe(listener);
    store.addNode(task());
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().nodes).toHaveLength(10);
    unsubscribe();
    store.removeNode("task");
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(() =>
      store.transaction("nested", () => store.addNode(task())),
    ).toThrow("Nested");
  });
  it("does not silently discard non-JSON input fields", () => {
    const store = new FlowStore(approvalFlow);
    expect(() =>
      store.addNode({
        ...task(),
        data: { bad: undefined },
      } as unknown as FlowNode),
    ).toThrow("JSON");
  });
  it("supports replacing documents and updating edges without renaming ids", () => {
    const store = new FlowStore(approvalFlow);
    store.updateEdge("approved", (edge) => ({ ...edge, label: "Proceed" }));
    expect(
      store.getSnapshot().edges.find((edge) => edge.id === "approved")!.label,
    ).toBe("Proceed");
    expect(() =>
      store.updateNode("start", (node) => ({ ...node, id: "renamed" })),
    ).toThrow("ids");
    store.replace(createFlow("new"));
    expect(store.getSnapshot().nodes).toHaveLength(0);
    store.undo();
    expect(store.getSnapshot().nodes).toHaveLength(9);
  });
});

describe("layout", () => {
  it("is deterministic, does not mutate input, and handles cycles or empty drafts", () => {
    const before = serializeFlow(approvalFlow);
    expect(layoutFlow(approvalFlow)).toEqual(layoutFlow(approvalFlow));
    expect(serializeFlow(approvalFlow)).toBe(before);
    expect(layoutFlow(createFlow("empty")).nodes).toEqual([]);
    const document = copy();
    document.edges.push({ id: "back", source: "accepted", target: "fork" });
    expect(
      layoutFlow(document, { direction: "down" }).nodes.every((node) =>
        Number.isFinite(node.position.y),
      ),
    ).toBe(true);
    expect(() => layoutFlow(document, { rowGap: -1 })).toThrow();
  });
});
