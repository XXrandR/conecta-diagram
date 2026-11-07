import { evaluateCondition } from "./conditions";
import { assertJson, clone, freeze } from "./json";
import { assertFlow } from "./validation";
import {
  FlowError,
  type Context,
  type FlowDocument,
  type FlowEdge,
} from "./types";

export interface ForkFrame {
  group: string;
  fork: string;
  join: string;
  branch: string;
  expected: number;
}
export interface SimulationToken {
  id: string;
  nodeId: string;
  status: "ready" | "async" | "signal" | "joining";
  frames: ForkFrame[];
}
export interface SimulationEvent {
  sequence: number;
  type:
    "entered" | "completed" | "traversed" | "waiting" | "failed" | "cancelled";
  nodeId?: string;
  tokenId?: string;
  edgeId?: string;
  message?: string;
}
export interface SimulationSnapshot {
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  context: Context;
  tokens: SimulationToken[];
  completedNodes: string[];
  traversedEdges: string[];
  events: SimulationEvent[];
  steps: number;
  error?: string;
}
export interface SimulationOptions {
  traceLimit?: number;
  maxTokens?: number;
}
export interface RunResult {
  reason: SimulationSnapshot["status"] | "step-limit";
  snapshot: SimulationSnapshot;
}

/** Deterministic token simulation. Never invokes handlers, evaluates code or creates timers. */
export class FlowSimulator {
  private readonly document: FlowDocument;
  private state: SimulationSnapshot;
  private nextId = 1;
  private sequence = 0;
  private readonly traceLimit: number;
  private readonly maxTokens: number;

  constructor(
    document: FlowDocument,
    context: Context = {},
    options: SimulationOptions = {},
  ) {
    assertFlow(document, "executable");
    this.checkContext(context);
    this.traceLimit = options.traceLimit ?? 1000;
    this.maxTokens = options.maxTokens ?? 10000;
    if (
      !Number.isSafeInteger(this.traceLimit) ||
      this.traceLimit < 0 ||
      !Number.isSafeInteger(this.maxTokens) ||
      this.maxTokens < 1
    ) {
      throw new FlowError(
        "INVALID_LIMIT",
        "traceLimit must be nonnegative and maxTokens positive integers.",
      );
    }
    this.document = freeze(clone(document));
    this.state = {
      status: "running",
      context: clone(context),
      tokens: [
        {
          id: this.id(),
          nodeId: document.nodes.find((node) => node.type === "start")!.id,
          status: "ready",
          frames: [],
        },
      ],
      completedNodes: [],
      traversedEdges: [],
      events: [],
      steps: 0,
    };
  }
  getSnapshot(): SimulationSnapshot {
    return freeze(clone(this.state));
  }

  /** Process one ready token, using stable FIFO order. */
  step(): SimulationSnapshot {
    if (this.terminal()) return this.getSnapshot();
    const token = this.state.tokens.find((item) => item.status === "ready");
    if (!token) {
      this.refresh();
      return this.getSnapshot();
    }
    const node = this.document.nodes.find((item) => item.id === token.nodeId)!;
    const outputs = this.document.edges.filter(
      (edge) => edge.source === node.id,
    );
    this.state.steps++;
    this.event({ type: "entered", nodeId: node.id, tokenId: token.id });
    if (node.type === "task" && node.mode === "async") {
      token.status = "async";
      this.event({ type: "waiting", nodeId: node.id, tokenId: token.id });
    } else if (node.type === "wait") {
      token.status = "signal";
      this.event({
        type: "waiting",
        nodeId: node.id,
        tokenId: token.id,
        message: node.signal,
      });
    } else if (node.type === "end") {
      this.completed(token);
      this.remove(token);
    } else if (node.type === "decision") {
      const edge =
        outputs
          .filter((item) => !item.default)
          .sort(
            (a, b) =>
              (a.priority ?? 0) - (b.priority ?? 0) ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          )
          .find(
            (item) =>
              item.condition &&
              evaluateCondition(item.condition, this.state.context),
          ) ?? outputs.find((item) => item.default)!;
      this.advance(token, edge);
    } else if (node.type === "fork") {
      if (this.state.tokens.length - 1 + outputs.length > this.maxTokens) {
        this.failToken(token, "Active token limit exceeded.");
      } else {
        const group = this.id();
        this.completed(token);
        this.remove(token);
        for (const edge of outputs) {
          const child: SimulationToken = {
            id: this.id(),
            nodeId: node.id,
            status: "ready",
            frames: [
              ...clone(token.frames),
              {
                group,
                fork: node.id,
                join: node.join,
                branch: edge.id,
                expected: outputs.length,
              },
            ],
          };
          this.state.tokens.push(child);
          this.traverse(child, edge);
        }
      }
    } else if (node.type === "join") {
      const frame = token.frames.at(-1);
      if (!frame || frame.join !== node.id || frame.fork !== node.fork) {
        this.failToken(token, "Token reached a join outside its fork scope.");
      } else {
        token.status = "joining";
        const siblings = this.state.tokens.filter(
          (item) =>
            item.nodeId === node.id &&
            item.status === "joining" &&
            item.frames.at(-1)?.group === frame.group,
        );
        const branches = new Set(
          siblings.map((item) => item.frames.at(-1)!.branch),
        );
        if (branches.size !== siblings.length)
          this.failToken(
            token,
            "A parallel branch arrived at the join more than once.",
          );
        else if (siblings.length === frame.expected) {
          for (const sibling of siblings) this.remove(sibling);
          token.frames.pop();
          token.status = "ready";
          this.state.tokens.push(token);
          this.advance(token, outputs[0]!);
        } else
          this.event({ type: "waiting", nodeId: node.id, tokenId: token.id });
      }
    } else this.advance(token, outputs[0]!);
    this.refresh();
    return this.getSnapshot();
  }
  run(maxSteps = 1000): RunResult {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
      throw new FlowError(
        "INVALID_LIMIT",
        "maxSteps must be a positive integer.",
      );
    for (
      let index = 0;
      index < maxSteps && this.state.status === "running";
      index++
    )
      this.step();
    return {
      reason:
        this.state.status === "running" ? "step-limit" : this.state.status,
      snapshot: this.getSnapshot(),
    };
  }
  /** Complete one async activation, not every activation of the same node. */
  complete(tokenId: string, patch: Context = {}): SimulationSnapshot {
    return this.resume(tokenId, "async", patch);
  }
  /** External applications collect user input and explicitly deliver it here. */
  signal(
    tokenId: string,
    signal: string,
    patch: Context = {},
  ): SimulationSnapshot {
    const token = this.findWaiting(tokenId, "signal");
    const node = this.document.nodes.find((item) => item.id === token.nodeId)!;
    if (node.type !== "wait" || node.signal !== signal)
      throw new FlowError("SIGNAL_MISMATCH", `Unexpected signal ${signal}.`);
    return this.resume(tokenId, "signal", patch);
  }
  fail(tokenId: string, message: string): SimulationSnapshot {
    if (this.terminal())
      throw new FlowError(
        "TERMINAL_SIMULATION",
        "The simulation has finished.",
      );
    const token = this.state.tokens.find((item) => item.id === tokenId);
    if (!token)
      throw new FlowError("TOKEN_NOT_FOUND", `Unknown token ${tokenId}.`);
    this.failToken(token, message);
    return this.getSnapshot();
  }
  cancel(): SimulationSnapshot {
    if (!this.terminal()) {
      this.state.status = "cancelled";
      this.state.tokens = [];
      this.event({ type: "cancelled" });
    }
    return this.getSnapshot();
  }
  private resume(
    tokenId: string,
    status: "async" | "signal",
    patch: Context,
  ): SimulationSnapshot {
    const token = this.findWaiting(tokenId, status);
    this.checkContext(patch);
    this.state.context = { ...this.state.context, ...clone(patch) };
    this.advance(
      token,
      this.document.edges.find((edge) => edge.source === token.nodeId)!,
    );
    this.refresh();
    return this.getSnapshot();
  }
  private findWaiting(id: string, status: "async" | "signal"): SimulationToken {
    if (this.terminal())
      throw new FlowError(
        "TERMINAL_SIMULATION",
        "The simulation has finished.",
      );
    const token = this.state.tokens.find((item) => item.id === id);
    if (!token || token.status !== status)
      throw new FlowError(
        "TOKEN_NOT_WAITING",
        `Token ${id} is not waiting for ${status}.`,
      );
    return token;
  }
  private advance(token: SimulationToken, edge: FlowEdge): void {
    this.completed(token);
    this.traverse(token, edge);
    // Rotate to the back so a cyclic branch cannot starve its siblings.
    this.remove(token);
    this.state.tokens.push(token);
  }
  private traverse(token: SimulationToken, edge: FlowEdge): void {
    this.event({ type: "traversed", edgeId: edge.id, tokenId: token.id });
    if (!this.state.traversedEdges.includes(edge.id))
      this.state.traversedEdges.push(edge.id);
    token.nodeId = edge.target;
    token.status = "ready";
  }
  private completed(token: SimulationToken): void {
    if (!this.state.completedNodes.includes(token.nodeId))
      this.state.completedNodes.push(token.nodeId);
    this.event({ type: "completed", nodeId: token.nodeId, tokenId: token.id });
  }
  private failToken(token: SimulationToken, message: string): void {
    this.state.status = "failed";
    this.state.error = message;
    this.event({
      type: "failed",
      nodeId: token.nodeId,
      tokenId: token.id,
      message,
    });
  }
  private remove(token: SimulationToken): void {
    this.state.tokens = this.state.tokens.filter(
      (item) => item.id !== token.id,
    );
  }
  private id(): string {
    return `t${this.nextId++}`;
  }
  private terminal(): boolean {
    return ["completed", "failed", "cancelled"].includes(this.state.status);
  }
  private refresh(): void {
    if (this.terminal()) return;
    if (!this.state.tokens.length) this.state.status = "completed";
    else if (this.state.tokens.some((token) => token.status === "ready"))
      this.state.status = "running";
    else if (this.state.tokens.every((token) => token.status === "joining")) {
      this.failToken(this.state.tokens[0]!, "Parallel join deadlock.");
    } else this.state.status = "waiting";
  }
  private event(event: Omit<SimulationEvent, "sequence">): void {
    this.sequence++;
    if (this.traceLimit) {
      this.state.events.push({ ...event, sequence: this.sequence });
      if (this.state.events.length > this.traceLimit) this.state.events.shift();
    }
  }
  private checkContext(context: Context): void {
    assertJson(context);
    if (!context || typeof context !== "object" || Array.isArray(context))
      throw new FlowError("INVALID_CONTEXT", "Context must be a JSON object.");
  }
}
