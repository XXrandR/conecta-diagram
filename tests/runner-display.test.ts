import { describe, expect, it } from "vitest";
import { approvalFlow } from "../examples/approval";
import {
  RunnerDisplay,
  FlowStore,
  validateFlow,
  actionPresentation,
  capabilityState,
  displayUrl,
  formatCondition,
  type RunnerResultPreview,
  type TaskAction,
} from "../src/core/index";

const success = (sequence = "2"): RunnerResultPreview => ({
  commandId: "cmd",
  status: "SUCCEEDED",
  sequence,
  success: true,
  final: true,
  summary: "Finished",
});
const pending = (): RunnerResultPreview => ({
  commandId: "cmd",
  status: "RUNNING",
  sequence: "0",
  success: false,
  final: false,
});
function display() {
  const result = new RunnerDisplay(approvalFlow);
  result.track("cmd", "process");
  return result;
}

describe("runner display projection (no execution)", () => {
  it("correlates results and does not interpret intermediate success=false as failure", () => {
    const projection = display();
    expect(projection.getOverlay().nodes.process!.status).toBe("idle");
    projection.applyResult(pending());
    expect(projection.getOverlay().nodes.process!.status).toBe("running");
    projection.applyResult({
      ...pending(),
      sequence: "1",
      status: "STREAMING",
      progress: { current: "100", total: "200", unit: "rows" },
    });
    expect(projection.getOverlay().nodes.process!.progress!.current).toBe(
      "100",
    );
    projection.applyResult(success());
    expect(projection.getOverlay().nodes.process!.status).toBe("succeeded");
    expect(projection.getOverlay().nodes.process!.final).toBe(true);
  });
  it("compares uint64 sequences without precision loss and ignores replay duplicates", () => {
    const projection = display();
    const result = { ...pending(), sequence: "9007199254740993" };
    expect(projection.applyResult(result)).toBe(true);
    expect(
      projection.applyResult({ ...result, sequence: "9007199254740992" }),
    ).toBe(false);
    expect(projection.applyResult(result)).toBe(false);
    expect(projection.getOverlay().nodes.process!.sequence).toBe(
      "9007199254740993",
    );
    expect(() =>
      projection.applyResult({ ...result, summary: "Conflicting replay" }),
    ).toThrow("Conflicting");
    expect(() =>
      projection.applyResult({ ...result, sequence: "18446744073709551616" }),
    ).toThrow();
  });
  it.each(["FAILED", "CANCELLED", "TIMED_OUT", "REJECTED"] as const)(
    "displays terminal %s distinctly",
    (status) => {
      const projection = display();
      projection.applyResult({
        ...success(),
        status,
        success: false,
        error: "Observed outcome",
      });
      expect(projection.getOverlay().nodes.process!.status).toBe(
        status.toLowerCase(),
      );
      expect(() => projection.applyResult(success("3"))).toThrow("final");
    },
  );
  it("accepts protobuf enum numbers but rejects contradictory finality atomically", () => {
    const projection = display();
    projection.applyResult({ ...pending(), status: 1 });
    const before = projection.getOverlay();
    expect(() =>
      projection.applyResult({ ...success(), final: false }),
    ).toThrow();
    expect(() =>
      projection.applyResult({ ...pending(), sequence: "1", final: true }),
    ).toThrow();
    expect(projection.getOverlay()).toEqual(before);
  });
  it("keeps file-chunk and command finality/sequence separate without binary data", () => {
    const projection = display();
    projection.applyResult({
      ...pending(),
      status: "STREAMING",
      sequence: "19",
      transfer: {
        id: "transfer",
        offset: "9007199254740993",
        size: "10",
        totalSize: "9007199254741003",
        chunkSequence: "3",
        final: true,
      },
    });
    const node = projection.getOverlay().nodes.process!;
    expect(node.final).toBe(false);
    expect(node.transfer!.final).toBe(true);
    expect(node.transfer!.offset).toBe("9007199254740993");
    expect(node.transfer!.chunkSequence).toBe("3");
    expect(() =>
      projection.applyResult({
        ...pending(),
        sequence: "20",
        progress: { current: "11", total: "10", unit: "bytes" },
      }),
    ).toThrow();
  });
  it("binds decisions only to their own branch and records input/output observations", () => {
    const projection = display();
    projection.observeSignal({
      id: "in",
      nodeId: "approval",
      name: "approval.received",
      direction: "in",
      summary: "approved=true",
    });
    projection.observeSignal({
      id: "out",
      nodeId: "decision",
      name: "decision.selected",
      direction: "out",
    });
    projection.observeDecision({
      id: "choice",
      nodeId: "decision",
      edgeId: "approved",
      reason: "External approved=true",
    });
    expect(projection.getOverlay().edges).toEqual({
      approved: "taken",
      denied: "skipped",
    });
    expect(projection.getOverlay().nodes.decision!.detail).toBe(
      "External approved=true",
    );
    expect(projection.getOverlay().signals).toHaveLength(2);
    expect(() =>
      projection.observeDecision({
        id: "bad",
        nodeId: "decision",
        edgeId: "start-fork",
        reason: "Invalid owner",
      }),
    ).toThrow();
  });
  it("deduplicates signal ids, bounds the visual history and isolates snapshots", () => {
    const projection = new RunnerDisplay(approvalFlow, 2);
    const observation = {
      id: "s1",
      nodeId: "approval",
      name: "approval.received",
      direction: "in" as const,
    };
    projection.observeSignal(observation);
    projection.observeSignal(observation);
    expect(projection.getOverlay().signals).toHaveLength(1);
    expect(() =>
      projection.observeSignal({ ...observation, name: "different" }),
    ).toThrow();
    projection.observeSignal({ ...observation, id: "s2" });
    projection.observeSignal({ ...observation, id: "s3" });
    expect(projection.getOverlay().signals!.map((signal) => signal.id)).toEqual(
      ["s2", "s3"],
    );
    expect(() => projection.getOverlay().signals!.pop()).toThrow();
  });
  it("does not run handlers, mutate plans or reuse command ids for retries", () => {
    const store = new FlowStore(approvalFlow);
    const before = store.getSnapshot();
    const projection = new RunnerDisplay(before);
    projection.track("cmd", "process");
    projection.applyResult(success());
    projection.track("retry-2", "process");
    expect(projection.getOverlay().nodes.process!.commandId).toBe("retry-2");
    expect(store.getSnapshot()).toBe(before);
    expect(store.getRevision()).toBe(0);
    expect(() => projection.track("cmd", "audit")).toThrow();
    expect(() =>
      projection.applyResult({ ...pending(), commandId: "unknown" }),
    ).toThrow();
  });
});

describe("action descriptions and capabilities", () => {
  const python: TaskAction = {
    type: "process.exec",
    body: {
      kind: "process",
      profile: "python-profile",
      code: { language: "python", source: "print('preview only')" },
    },
  };
  it("round trips code as data and validates command body families", () => {
    const store = new FlowStore(approvalFlow);
    store.updateNode("process", (node) => ({ ...node, action: python }));
    expect(actionPresentation(python).code!.source).toBe(
      "print('preview only')",
    );
    expect(validateFlow(store.getSnapshot())).toEqual([]);
    const bad = JSON.parse(JSON.stringify(store.getSnapshot()));
    bad.nodes.find(
      (node: { id: string }) => node.id === "process",
    ).action.type = "api.request";
    expect(validateFlow(bad).map((issue) => issue.code)).toContain(
      "INVALID_ACTION",
    );
  });
  it("does not assume protobuf families imply advertised capabilities", () => {
    expect(capabilityState("ssh.exec")).toBe("unverified");
    expect(capabilityState("database.transaction")).toBe("unsupported");
    expect(capabilityState("database.metadata", ["api.request"])).toBe(
      "unsupported",
    );
    expect(capabilityState("api.request", ["api.request"])).toBe("available");
    expect(capabilityState("vendor.future", [])).toBe("unsupported");
  });
  it("redacts URL credentials/query values and prints readable decision conditions", () => {
    const preview = displayUrl(
      "https://user:password@example.test/orders?token=secret#private",
    );
    expect(preview).not.toContain("password");
    expect(preview).not.toContain("secret");
    expect(preview).not.toContain("private");
    expect(formatCondition({ op: "eq", path: ["approved"], value: true })).toBe(
      "approved == true",
    );
  });
  it.each([
    {
      type: "api.request",
      body: { kind: "api", method: "GET", url: "/orders" },
    },
    {
      type: "database.query",
      body: {
        kind: "database",
        databaseType: "postgresql",
        datasource: "orders",
        operation: "QUERY",
        statement: "SELECT 1",
      },
    },
    {
      type: "file.copy",
      body: { kind: "file", operation: "COPY", path: "a", destination: "b" },
    },
    {
      type: "ssh.exec",
      body: { kind: "ssh", connectionId: "host", command: "uptime" },
    },
    {
      type: "sftp.put",
      body: {
        kind: "sftp",
        connectionId: "host",
        operation: "put",
        remotePath: "/incoming",
      },
    },
    {
      type: "mail.send",
      body: {
        kind: "mail",
        connectionId: "mail",
        operation: "send",
        subject: "Report",
      },
    },
    {
      type: "messaging.publish",
      body: {
        kind: "messaging",
        connectionId: "kafka",
        operation: "publish",
        topic: "reports",
      },
    },
    {
      type: "event.emit",
      body: { kind: "event", operation: "emit", topic: "done" },
    },
    {
      type: "command.cancel",
      body: { kind: "cancel", targetCommandId: "cmd" },
    },
    { type: "custom", body: { kind: "generic", name: "vendor.operation" } },
  ] as TaskAction[])("describes %s without execution", (action) => {
    const store = new FlowStore(approvalFlow);
    store.updateNode("process", (node) => ({ ...node, action }));
    expect(validateFlow(store.getSnapshot())).toEqual([]);
    expect(actionPresentation(action).title).toBeTruthy();
  });
});
