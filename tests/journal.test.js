import { describe, expect, it } from "vitest";
import { ExecutionJournal } from "../examples/ui/journal.js";
import { plan, mockEvents } from "../examples/showcase.js";

function journal(scenario = "approve") {
  const journal = new ExecutionJournal("test-run");
  const events = mockEvents(scenario);
  events.forEach((event, index) =>
    journal.append(
      event,
      plan,
      new Date(Date.UTC(2026, 9, 27, 12, 0, 0, index * 100)).toISOString(),
    ),
  );
  return journal;
}
describe("complete observation journal", () => {
  it("retains every observation, including full progress, transfer and decision details", () => {
    const trace = journal();
    expect(trace.entries.length).toBe(mockEvents().length);
    for (let index = 0; index < 20; index++)
      trace.append({ kind: "waiting", nodeId: "wait" }, plan);
    expect(trace.entries.length).toBeGreaterThan(40);
    const transfer = trace.entries.find(
      (entry) => entry.observation.result?.transfer?.chunkSequence === "1",
    );
    expect(transfer.observation.result.transfer).toEqual({
      id: "transfer-report-1",
      offset: "32768",
      size: "65536",
      chunkSequence: "1",
      totalSize: "131072",
      final: false,
    });
    expect(
      trace.query({ kind: "decision" })[0].observation.observation.edgeId,
    ).toBe("approved");
    expect(trace.export().entries).toHaveLength(trace.entries.length);
  });
  it("filters complete history by type, outcome, task, nested data and stable order", () => {
    const trace = journal("timeout");
    expect(trace.query({ outcome: "errors" })).toHaveLength(1);
    expect(trace.query({ outcome: "errors" })[0].status).toBe("TIMED_OUT");
    expect(trace.query({ nodeId: "file", kind: "result" })).toHaveLength(5);
    expect(trace.query({ search: "transfer-report-1" }).length).toBeGreaterThan(
      1,
    );
    expect(
      trace.query({ kind: "signal" }).every((entry) => entry.kind === "signal"),
    ).toBe(true);
    expect(trace.query({ descending: false })[0].ordinal).toBe(1);
    expect(trace.query()[0].ordinal).toBe(trace.entries.length);
    expect(trace.entries[0].ordinal).toBe(1);
  });
  it("keeps exact uint64 counters and distinguishes chunk/command finality", () => {
    const trace = new ExecutionJournal("uint64");
    trace.append(
      {
        kind: "result",
        nodeId: "file",
        result: {
          commandId: "cmd",
          status: "STREAMING",
          sequence: "9007199254740993",
          final: false,
          success: false,
          transfer: {
            id: "t",
            offset: "9007199254740993",
            size: "10",
            chunkSequence: "2",
            final: true,
          },
        },
      },
      plan,
    );
    const entry = trace.entries[0];
    expect(entry.sequence).toBe("9007199254740993");
    expect(entry.final).toBe(false);
    expect(entry.observation.result.transfer.final).toBe(true);
    expect(JSON.stringify(trace.export())).toContain(
      '"offset":"9007199254740993"',
    );
  });
  it("counts command identities separately from intermediate result events", () => {
    const trace = journal();
    const stats = trace.stats();
    expect(stats.commands).toBe(5);
    expect(stats.errors).toBe(0);
    expect(stats.decisions).toBe(1);
    expect(stats.total).toBe(trace.entries.length);
    expect(stats.spanMs).toBe((trace.entries.length - 1) * 100);
    expect(journal("failure").stats().errors).toBe(1);
  });
  it("captures immutable, isolated observation and configuration snapshots without executing source", () => {
    const trace = new ExecutionJournal("isolated");
    const event = structuredClone(mockEvents()[1]);
    trace.append(event, plan);
    event.result.status = "FAILED";
    expect(trace.entries[0].status).toBe("ACCEPTED");
    expect(trace.entries[0].configuration.action.body.code.source).toContain(
      "def normalize",
    );
    expect(() => {
      trace.entries[0].observation.result.success = true;
    }).toThrow();
  });
});
