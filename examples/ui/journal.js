// Data layer only. This is an observation journal, never an executor or transport.
const statusNames = [
  "ACCEPTED",
  "RUNNING",
  "STREAMING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "REJECTED",
];
const errorStatuses = new Set(["FAILED", "TIMED_OUT", "REJECTED"]);
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

export class ExecutionJournal {
  #entries = [];
  constructor(runId) {
    this.runId = runId;
    this.startedAt = null;
  }
  get entries() {
    return Object.freeze([...this.#entries]);
  }
  append(event, flow, receivedAt = new Date().toISOString()) {
    const timestamp = Date.parse(receivedAt);
    if (!Number.isFinite(timestamp))
      throw new Error("Invalid observation receipt timestamp.");
    this.startedAt ??= timestamp;
    const nodeId = event.nodeId ?? event.observation?.nodeId;
    const node = flow.nodes.find((node) => node.id === nodeId);
    const result = event.result;
    const status = result
      ? typeof result.status === "number"
        ? statusNames[result.status - 1]
        : result.status
      : event.kind === "signal"
        ? event.observation.direction === "in"
          ? "RECEIVED"
          : "EMITTED"
        : event.kind === "decision"
          ? "SELECTED"
          : event.kind === "waiting"
            ? "WAITING"
            : "COMPLETED";
    const summary = result
      ? result.error || result.summary || `${status.toLowerCase()} observation`
      : event.kind === "signal"
        ? (event.observation.summary ?? event.observation.name)
        : event.kind === "decision"
          ? event.observation.reason
          : event.kind === "waiting"
            ? "Waiting for an external approval signal"
            : "Sample run reached its terminal node";
    const entry = freeze({
      id: `observation-${this.#entries.length + 1}`,
      ordinal: this.#entries.length + 1,
      runId: this.runId,
      receivedAt,
      elapsedMs: Math.max(0, timestamp - this.startedAt),
      kind: event.kind,
      nodeId,
      nodeLabel: node?.label ?? nodeId ?? "Run",
      actionType: node?.action?.type ?? node?.type ?? "run",
      status,
      summary,
      error: errorStatuses.has(status),
      commandId: result?.commandId ?? null,
      sequence: result?.sequence ?? null,
      final: result?.final ?? null,
      direction: result
        ? "RUNNER → SERVER"
        : event.kind === "signal"
          ? event.observation.direction === "in"
            ? "NODE INPUT"
            : "NODE OUTPUT"
          : "SERVER OBSERVATION",
      configuration: structuredClone(node ?? null),
      observation: structuredClone(event),
    });
    this.#entries.push(entry);
    return entry;
  }
  query({
    kind = "all",
    outcome = "all",
    nodeId = "all",
    search = "",
    descending = true,
  } = {}) {
    const needle = search.trim().toLowerCase();
    const rows = this.#entries.filter(
      (entry) =>
        (kind === "all" ||
          entry.kind === kind ||
          (kind === "lifecycle" &&
            ["waiting", "finished"].includes(entry.kind))) &&
        (outcome === "all" ||
          (outcome === "errors"
            ? entry.error
            : entry.status.toLowerCase() === outcome)) &&
        (nodeId === "all" || entry.nodeId === nodeId) &&
        (!needle || JSON.stringify(entry).toLowerCase().includes(needle)),
    );
    return descending ? rows.reverse() : rows;
  }
  stats() {
    const commands = new Map();
    for (const entry of this.#entries)
      if (entry.commandId) commands.set(entry.commandId, entry.status);
    return {
      total: this.#entries.length,
      commands: commands.size,
      signals: this.#entries.filter((entry) => entry.kind === "signal").length,
      errors: this.#entries.filter((entry) => entry.error).length,
      decisions: this.#entries.filter((entry) => entry.kind === "decision")
        .length,
      spanMs: this.#entries.at(-1)?.elapsedMs ?? 0,
    };
  }
  export() {
    return {
      schemaVersion: 1,
      source: "simulated-observations",
      runId: this.runId,
      exportedAt: new Date().toISOString(),
      entries: this.entries,
    };
  }
}
