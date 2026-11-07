import { describe, expect, it } from "vitest";
import { approvalFlow } from "../examples/approval";
import {
  FlowSimulator,
  FlowStore,
  type FlowDocument,
  type SimulationSnapshot,
} from "../src/core/index";

const token = (snapshot: SimulationSnapshot, status: string) =>
  snapshot.tokens.find((item) => item.status === status)!;
const loopFlow = (): FlowDocument => ({
  schemaVersion: 1,
  id: "loop",
  nodes: [
    { id: "s", type: "start", label: "start", position: { x: 0, y: 0 } },
    { id: "d", type: "decision", label: "loop?", position: { x: 0, y: 0 } },
    { id: "e", type: "end", label: "end", position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "sd", source: "s", target: "d" },
    {
      id: "dd",
      source: "d",
      target: "d",
      condition: { op: "eq", path: ["loop"], value: true },
    },
    { id: "de", source: "d", target: "e", default: true },
  ],
});

describe("deterministic simulation", () => {
  it("waits for async work, joins both branches, and accepts an external approval", () => {
    const simulator = new FlowSimulator(approvalFlow);
    let state = simulator.run().snapshot;
    expect(state.status).toBe("waiting");
    expect(state.tokens.map((item) => item.status).sort()).toEqual([
      "async",
      "joining",
    ]);
    expect(state.completedNodes).not.toContain("join");
    simulator.complete(token(state, "async").id, { orderId: "123" });
    state = simulator.run().snapshot;
    expect(state.completedNodes).toContain("join");
    expect(token(state, "signal").nodeId).toBe("approval");
    simulator.signal(token(state, "signal").id, "approval.received", {
      approved: true,
    });
    state = simulator.run().snapshot;
    expect(state.status).toBe("completed");
    expect(state.completedNodes).toContain("accepted");
    expect(state.completedNodes).not.toContain("rejected");
    expect(state.context).toEqual({ orderId: "123", approved: true });
  });
  it("routes to the fallback and produces identical traces for identical inputs", () => {
    const execute = () => {
      const simulator = new FlowSimulator(approvalFlow);
      simulator.complete(token(simulator.run().snapshot, "async").id);
      simulator.signal(
        token(simulator.run().snapshot, "signal").id,
        "approval.received",
        { approved: false },
      );
      return simulator.run().snapshot;
    };
    expect(execute()).toEqual(execute());
    expect(execute().completedNodes).toContain("rejected");
  });
  it("rejects wrong or duplicate resumes without changing state", () => {
    const simulator = new FlowSimulator(approvalFlow);
    const before = simulator.run().snapshot;
    expect(() =>
      simulator.signal(token(before, "async").id, "approval.received"),
    ).toThrow();
    expect(() => simulator.complete("missing")).toThrow();
    expect(simulator.getSnapshot()).toEqual(before);
    const id = token(before, "async").id;
    simulator.complete(id);
    expect(() => simulator.complete(id)).toThrow();
    const waiting = simulator.run().snapshot;
    expect(() =>
      simulator.signal(token(waiting, "signal").id, "wrong"),
    ).toThrow("Unexpected signal");
    expect(simulator.getSnapshot()).toEqual(waiting);
  });
  it("bounds cyclic execution and traces without marking a budget pause as failure", () => {
    const simulator = new FlowSimulator(
      loopFlow(),
      { loop: true },
      { traceLimit: 5 },
    );
    expect(simulator.run(20).reason).toBe("step-limit");
    expect(simulator.getSnapshot().steps).toBe(20);
    expect(simulator.getSnapshot().events).toHaveLength(5);
    expect(simulator.run(10).snapshot.steps).toBe(30);
    expect(() => simulator.run(0)).toThrow();
    const noTrace = new FlowSimulator(loopFlow(), {}, { traceLimit: 0 });
    expect(noTrace.run().snapshot.events).toEqual([]);
  });
  it("resolves multiple matching decisions by priority then edge id", () => {
    const document = loopFlow();
    document.edges.find((edge) => edge.id === "dd")!.priority = 10;
    document.edges.push({
      id: "a-match",
      source: "d",
      target: "e",
      priority: 1,
      condition: { op: "eq", path: ["loop"], value: true },
    });
    const simulator = new FlowSimulator(document, { loop: true });
    expect(simulator.run().snapshot.traversedEdges).toContain("a-match");
    expect(simulator.getSnapshot().traversedEdges).not.toContain("dd");
  });
  it("keeps execution semantics independent of visibility and later editing", () => {
    const document = loopFlow();
    document.nodes[1]!.visibleWhen = {
      op: "eq",
      path: ["visible"],
      value: true,
    };
    const store = new FlowStore(document);
    const simulator = new FlowSimulator(store.getSnapshot());
    store.removeNode("d");
    expect(simulator.run().snapshot.completedNodes).toContain("d");
  });
  it("isolates input and output data and rejects lossy patches", () => {
    const context = { nested: { value: 1 } };
    const simulator = new FlowSimulator(approvalFlow, context);
    context.nested.value = 2;
    expect(simulator.getSnapshot().context.nested).toEqual({ value: 1 });
    expect(() => {
      simulator.getSnapshot().tokens.pop();
    }).toThrow();
    const state = simulator.run().snapshot;
    expect(() =>
      simulator.complete(token(state, "async").id, { bad: NaN }),
    ).toThrow();
    expect(simulator.getSnapshot()).toEqual(state);
  });
  it("supports explicit failure, cancellation, and terminal no-op stepping", () => {
    const simulator = new FlowSimulator(approvalFlow);
    const id = token(simulator.run().snapshot, "async").id;
    simulator.fail(id, "Remote task failed");
    expect(simulator.run().reason).toBe("failed");
    expect(simulator.getSnapshot().error).toBe("Remote task failed");
    expect(() => simulator.complete(id)).toThrow("finished");
    const other = new FlowSimulator(approvalFlow);
    other.cancel();
    expect(other.step().status).toBe("cancelled");
    expect(other.getSnapshot().tokens).toEqual([]);
  });
  it("bounds active tokens and rejects invalid documents or options", () => {
    const simulator = new FlowSimulator(approvalFlow, {}, { maxTokens: 1 });
    expect(simulator.run().snapshot.error).toContain("limit");
    expect(() => new FlowSimulator({ ...approvalFlow, nodes: [] })).toThrow(
      "validation",
    );
    expect(
      () => new FlowSimulator(approvalFlow, {}, { traceLimit: -1 }),
    ).toThrow();
  });
  it("correlates nested parallel activations correctly", () => {
    const document: FlowDocument = JSON.parse(JSON.stringify(approvalFlow));
    document.nodes.push(
      {
        id: "inner-fork",
        type: "fork",
        join: "inner-join",
        label: "inner",
        position: { x: 0, y: 0 },
      },
      {
        id: "inner-join",
        type: "join",
        fork: "inner-fork",
        label: "inner join",
        position: { x: 0, y: 0 },
      },
      {
        id: "nested-work",
        type: "task",
        mode: "async",
        label: "nested",
        position: { x: 0, y: 0 },
      },
    );
    document.edges.find((edge) => edge.id === "fork-audit")!.target =
      "inner-fork";
    document.edges.find((edge) => edge.id === "audit-join")!.target =
      "inner-join";
    document.edges.push(
      { id: "inner-audit", source: "inner-fork", target: "audit" },
      { id: "inner-work", source: "inner-fork", target: "nested-work" },
      { id: "work-inner", source: "nested-work", target: "inner-join" },
      { id: "inner-outer", source: "inner-join", target: "join" },
    );
    const simulator = new FlowSimulator(document);
    const waiting = simulator.run().snapshot;
    expect(
      waiting.tokens.filter((item) => item.status === "async"),
    ).toHaveLength(2);
    for (const item of waiting.tokens
      .filter((item) => item.status === "async")
      .reverse())
      simulator.complete(item.id);
    const state = simulator.run().snapshot;
    expect(state.completedNodes).toEqual(
      expect.arrayContaining(["inner-join", "join"]),
    );
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0]!.nodeId).toBe("approval");
    expect(state.tokens[0]!.frames).toEqual([]);
  });
  it("does not mix join arrivals from repeated loop activations of the same fork", () => {
    const document: FlowDocument = JSON.parse(JSON.stringify(approvalFlow));
    document.edges.find((edge) => edge.id === "approved")!.target = "fork";
    const simulator = new FlowSimulator(document);
    simulator.complete(token(simulator.run().snapshot, "async").id);
    simulator.signal(
      token(simulator.run().snapshot, "signal").id,
      "approval.received",
      { approved: true },
    );
    const next = simulator.run().snapshot;
    expect(next.tokens.map((item) => item.status).sort()).toEqual([
      "async",
      "joining",
    ]);
    simulator.complete(token(next, "async").id);
    simulator.signal(
      token(simulator.run().snapshot, "signal").id,
      "approval.received",
      { approved: false },
    );
    const finished = simulator.run().snapshot;
    expect(finished.status).toBe("completed");
    expect(
      finished.events.filter(
        (event) => event.type === "completed" && event.nodeId === "join",
      ),
    ).toHaveLength(2);
  });
  it("resumes only one activation when multiple tokens wait at the same node", () => {
    const document: FlowDocument = {
      schemaVersion: 1,
      id: "same-wait",
      nodes: [
        { id: "s", type: "start", label: "", position: { x: 0, y: 0 } },
        {
          id: "f",
          type: "fork",
          join: "j",
          label: "",
          position: { x: 0, y: 0 },
        },
        {
          id: "w",
          type: "wait",
          signal: "answer",
          label: "",
          position: { x: 0, y: 0 },
        },
        {
          id: "j",
          type: "join",
          fork: "f",
          label: "",
          position: { x: 0, y: 0 },
        },
        { id: "e", type: "end", label: "", position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "sf", source: "s", target: "f" },
        { id: "left", source: "f", target: "w" },
        { id: "right", source: "f", target: "w" },
        { id: "wj", source: "w", target: "j" },
        { id: "je", source: "j", target: "e" },
      ],
    };
    const simulator = new FlowSimulator(document);
    const waiting = simulator.run().snapshot.tokens;
    expect(waiting).toHaveLength(2);
    simulator.signal(waiting[0]!.id, "answer");
    const partial = simulator.run().snapshot;
    expect(partial.status).toBe("waiting");
    expect(partial.tokens.map((item) => item.status).sort()).toEqual([
      "joining",
      "signal",
    ]);
    simulator.signal(waiting[1]!.id, "answer");
    expect(simulator.run().reason).toBe("completed");
  });
});
