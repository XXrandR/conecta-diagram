import { FlowError, type FlowDocument } from "./types";
import type { SimulationSnapshot } from "./simulation";
import { assertFlow } from "./validation";
import { assertJson, clone, equal, freeze } from "./json";

export type RunnerStatus =
  | "ACCEPTED"
  | "RUNNING"
  | "STREAMING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "REJECTED";
export type DisplayStatus =
  | "idle"
  | "active"
  | "waiting"
  | "accepted"
  | "running"
  | "streaming"
  | "completed"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "rejected";
export interface DisplayProgress {
  current: string;
  total?: string;
  unit: "bytes" | "rows" | "items";
}
export interface TransferObservation {
  id: string;
  offset: string;
  chunkSequence: string;
  size: string;
  totalSize?: string;
  final: boolean;
}
export interface NodeExecution {
  status: DisplayStatus;
  detail?: string;
  commandId?: string;
  sequence?: string;
  final?: boolean;
  progress?: DisplayProgress;
  transfer?: TransferObservation;
}
export interface SignalObservation {
  id: string;
  nodeId: string;
  name: string;
  direction: "in" | "out";
  summary?: string;
}
export interface DecisionObservation {
  id: string;
  nodeId: string;
  edgeId: string;
  reason: string;
}
export interface ExecutionOverlay {
  nodes: Record<string, NodeExecution>;
  edges?: Record<string, "taken" | "skipped">;
  decisions?: Record<string, DecisionObservation>;
  signals?: SignalObservation[];
}
/** A redacted presentation DTO, not a generated protobuf codec or executor. */
export interface RunnerResultPreview {
  commandId: string;
  status: RunnerStatus | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  sequence: string;
  success: boolean;
  final: boolean;
  summary?: string;
  error?: string;
  progress?: DisplayProgress;
  transfer?: TransferObservation;
}
interface TrackedCommand {
  commandId: string;
  nodeId: string;
  result?: RunnerResultPreview;
}
const statuses: RunnerStatus[] = [
  "ACCEPTED",
  "RUNNING",
  "STREAMING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "REJECTED",
];
const terminals: RunnerStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "REJECTED",
];
const uint64 = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 20 &&
  BigInt(value) <= 18446744073709551615n;
const validText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function simulationOverlay(
  snapshot: SimulationSnapshot,
): ExecutionOverlay {
  const nodes: Record<string, NodeExecution> = Object.create(null);
  for (const id of snapshot.completedNodes) nodes[id] = { status: "completed" };
  for (const token of snapshot.tokens) {
    const status =
      snapshot.status === "failed"
        ? "failed"
        : token.status === "ready"
          ? "active"
          : "waiting";
    nodes[token.nodeId] = {
      status,
      detail:
        token.status === "signal"
          ? "Awaiting external signal"
          : token.status === "async"
            ? "Awaiting async result"
            : token.status === "joining"
              ? "Waiting for parallel branches"
              : "",
    };
  }
  const edges: Record<string, "taken"> = Object.create(null);
  for (const id of snapshot.traversedEdges) edges[id] = "taken";
  return { nodes, edges };
}

/** Correlates observed runner results with plan nodes. Does not send or run commands. */
export class RunnerDisplay {
  private readonly document: FlowDocument;
  private readonly commands = new Map<string, TrackedCommand>();
  private readonly latest = new Map<string, string>();
  private readonly decisions = new Map<string, DecisionObservation>();
  private readonly signals: SignalObservation[] = [];
  private readonly seen = new Map<
    string,
    SignalObservation | DecisionObservation
  >();

  constructor(
    document: FlowDocument,
    private readonly observationLimit = 200,
  ) {
    assertFlow(document);
    if (
      !Number.isSafeInteger(observationLimit) ||
      observationLimit < 1 ||
      observationLimit > 10000
    )
      throw new FlowError(
        "INVALID_LIMIT",
        "observationLimit must be between 1 and 10000.",
      );
    this.document = freeze(clone(document));
  }
  /** Register correlation only. This does not dispatch, accept or execute a command. */
  track(commandId: string, nodeId: string): void {
    const node = this.document.nodes.find((node) => node.id === nodeId);
    if (
      !validText(commandId) ||
      !node ||
      !["task", "decision"].includes(node.type)
    )
      throw new FlowError(
        "INVALID_COMMAND_BINDING",
        "A command id must target an existing task or decision.",
      );
    const existing = this.commands.get(commandId);
    if (existing) {
      if (existing.nodeId !== nodeId)
        throw new FlowError(
          "COMMAND_BINDING_CONFLICT",
          "A command cannot move to a different node.",
        );
      return;
    }
    if (this.commands.size >= 10000)
      throw new FlowError(
        "DISPLAY_LIMIT",
        "Create a new display projection after 10000 tracked commands.",
      );
    this.commands.set(commandId, { commandId, nodeId });
    this.latest.set(nodeId, commandId);
  }
  applyResult(input: RunnerResultPreview): boolean {
    assertJson(input);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new FlowError(
        "INVALID_RESULT",
        "Expected a result preview object.",
      );
    const status =
      typeof input.status === "number"
        ? statuses[input.status - 1]
        : input.status;
    if (
      !status ||
      !statuses.includes(status) ||
      !uint64(input.sequence) ||
      typeof input.success !== "boolean" ||
      typeof input.final !== "boolean" ||
      [input.summary, input.error].some(
        (item) => item !== undefined && typeof item !== "string",
      )
    )
      throw new FlowError(
        "INVALID_RESULT",
        "Invalid result status, sequence, finality or display summary.",
      );
    const terminal = terminals.includes(status);
    if (
      input.final !== terminal ||
      (terminal && input.success !== (status === "SUCCEEDED"))
    )
      throw new FlowError(
        "INVALID_RESULT",
        "Terminal status, final and success must agree; intermediate success=false is not a failure.",
      );
    if (
      input.progress !== undefined &&
      (!input.progress ||
        !uint64(input.progress.current) ||
        (input.progress.total !== undefined &&
          (!uint64(input.progress.total) ||
            BigInt(input.progress.current) > BigInt(input.progress.total))) ||
        !["bytes", "rows", "items"].includes(input.progress.unit))
    )
      throw new FlowError(
        "INVALID_PROGRESS",
        "Expected bounded uint64 decimal progress values and a known unit.",
      );
    const transfer = input.transfer;
    if (
      transfer !== undefined &&
      (!transfer ||
        !validText(transfer.id) ||
        !uint64(transfer.offset) ||
        !uint64(transfer.chunkSequence) ||
        !uint64(transfer.size) ||
        typeof transfer.final !== "boolean" ||
        BigInt(transfer.offset) + BigInt(transfer.size) >
          18446744073709551615n ||
        (transfer.totalSize !== undefined &&
          (!uint64(transfer.totalSize) ||
            BigInt(transfer.offset) + BigInt(transfer.size) >
              BigInt(transfer.totalSize))))
    )
      throw new FlowError(
        "INVALID_TRANSFER",
        "Expected valid uint64 transfer metadata without binary data.",
      );
    const command = this.commands.get(input.commandId);
    if (!command)
      throw new FlowError(
        "UNKNOWN_COMMAND",
        `No display binding for command ${input.commandId}.`,
      );
    // Store only the redacted display fields, not arbitrary response bodies/binary data.
    const result: RunnerResultPreview = {
      commandId: input.commandId,
      status,
      sequence: input.sequence,
      success: input.success,
      final: input.final,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.progress ? { progress: clone(input.progress) } : {}),
      ...(transfer ? { transfer: clone(transfer) } : {}),
    };
    const previous = command.result;
    if (previous && BigInt(result.sequence) <= BigInt(previous.sequence)) {
      if (result.sequence === previous.sequence && !equal(result, previous))
        throw new FlowError(
          "RESULT_CONFLICT",
          "Conflicting results at the same command sequence.",
        );
      return false;
    }
    if (previous?.final)
      throw new FlowError(
        "COMMAND_FINISHED",
        "A final command result cannot be overwritten; track a new command id for a retry.",
      );
    command.result = result;
    return true;
  }
  observeSignal(observation: SignalObservation): void {
    assertJson(observation);
    if (!observation || typeof observation !== "object")
      throw new FlowError(
        "INVALID_SIGNAL_OBSERVATION",
        "Expected an observation object.",
      );
    const node = this.document.nodes.find(
      (node) => node.id === observation.nodeId,
    );
    if (
      !node ||
      !validText(observation.id) ||
      !validText(observation.name) ||
      !["in", "out"].includes(observation.direction) ||
      (observation.summary !== undefined &&
        typeof observation.summary !== "string")
    )
      throw new FlowError(
        "INVALID_SIGNAL_OBSERVATION",
        "Invalid observed signal.",
      );
    if (!this.remember(observation)) return;
    this.signals.push(clone(observation));
    if (this.signals.length > this.observationLimit) this.signals.shift();
  }
  observeDecision(observation: DecisionObservation): void {
    assertJson(observation);
    if (!observation || typeof observation !== "object")
      throw new FlowError(
        "INVALID_DECISION_OBSERVATION",
        "Expected an observation object.",
      );
    const node = this.document.nodes.find(
      (node) => node.id === observation.nodeId,
    );
    if (
      node?.type !== "decision" ||
      !validText(observation.id) ||
      typeof observation.reason !== "string" ||
      !this.document.edges.some(
        (edge) => edge.id === observation.edgeId && edge.source === node.id,
      )
    )
      throw new FlowError(
        "INVALID_DECISION_OBSERVATION",
        "Decision observation must select an output edge of that decision.",
      );
    if (!this.remember(observation)) return;
    this.decisions.set(observation.nodeId, clone(observation));
  }
  getOverlay(): ExecutionOverlay {
    const nodes: Record<string, NodeExecution> = Object.create(null);
    for (const [nodeId, commandId] of this.latest) {
      const result = this.commands.get(commandId)!.result;
      nodes[nodeId] = result
        ? {
            status: String(result.status).toLowerCase() as DisplayStatus,
            commandId,
            sequence: result.sequence,
            final: result.final,
            detail: result.error || result.summary || String(result.status),
            ...(result.progress ? { progress: clone(result.progress) } : {}),
            ...(result.transfer ? { transfer: clone(result.transfer) } : {}),
          }
        : { status: "idle", commandId, detail: "Awaiting runner observation" };
    }
    const edges: Record<string, "taken" | "skipped"> = Object.create(null);
    const decisions: Record<string, DecisionObservation> = Object.create(null);
    for (const [nodeId, observation] of this.decisions) {
      decisions[nodeId] = clone(observation);
      nodes[nodeId] = {
        ...nodes[nodeId],
        status: "succeeded",
        detail: observation.reason,
      };
      for (const edge of this.document.edges.filter(
        (edge) => edge.source === nodeId,
      ))
        edges[edge.id] = edge.id === observation.edgeId ? "taken" : "skipped";
    }
    return freeze({ nodes, edges, decisions, signals: clone(this.signals) });
  }
  private remember(
    observation: SignalObservation | DecisionObservation,
  ): boolean {
    const previous = this.seen.get(observation.id);
    if (previous) {
      if (!equal(previous, observation))
        throw new FlowError(
          "OBSERVATION_CONFLICT",
          "An observation id was reused with different content.",
        );
      return false;
    }
    this.seen.set(observation.id, clone(observation));
    if (this.seen.size > this.observationLimit)
      this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
}
