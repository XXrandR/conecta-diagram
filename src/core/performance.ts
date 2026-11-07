import { FlowError } from "./types";
import { assertJson, clone, equal, freeze } from "./json";

/** Times are backend-run-relative milliseconds, not browser observation latency. */
export interface NodeRunPerformance {
  runId: string;
  nodeId: string;
  commandId: string;
  process: string;
  startMs: number;
  durationMs: number;
  /** Integer supplied by the backend for this node run. Never inferred by the UI. */
  cost: number;
  network?: Array<{
    startMs: number;
    durationMs: number;
    label: string;
    bytes?: string;
  }>;
  memory?: Array<{ timeMs: number; bytes: string }>;
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const uint64 = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 20 &&
  BigInt(value) <= 18446744073709551615n;

export class PerformanceTimeline {
  private runs = new Map<string, NodeRunPerformance>();
  record(sample: NodeRunPerformance): boolean {
    assertJson(sample);
    if (
      !sample ||
      ![sample.runId, sample.nodeId, sample.commandId, sample.process].every(
        text,
      ) ||
      !finite(sample.startMs) ||
      !finite(sample.durationMs) ||
      !Number.isSafeInteger(sample.cost) ||
      sample.cost < 0 ||
      !Number.isFinite(sample.startMs + sample.durationMs)
    )
      throw new FlowError(
        "INVALID_PERFORMANCE",
        "Expected backend run identity, finite times and a nonnegative safe integer cost.",
      );
    if (
      sample.network !== undefined &&
      (!Array.isArray(sample.network) ||
        sample.network.some(
          (item) =>
            !item ||
            !finite(item.startMs) ||
            !finite(item.durationMs) ||
            !Number.isFinite(item.startMs + item.durationMs) ||
            !text(item.label) ||
            (item.bytes !== undefined && !uint64(item.bytes)),
        ))
    )
      throw new FlowError(
        "INVALID_PERFORMANCE",
        "Invalid backend network interval.",
      );
    if (
      sample.memory !== undefined &&
      (!Array.isArray(sample.memory) ||
        sample.memory.some(
          (item) => !item || !finite(item.timeMs) || !uint64(item.bytes),
        ))
    )
      throw new FlowError(
        "INVALID_PERFORMANCE",
        "Invalid backend memory sample.",
      );
    const previous = this.runs.get(sample.runId);
    if (previous) {
      if (!equal(previous, sample))
        throw new FlowError(
          "PERFORMANCE_CONFLICT",
          "A node-run metric id cannot be reused with different data.",
        );
      return false;
    }
    if (this.runs.size >= 10000)
      throw new FlowError(
        "PERFORMANCE_LIMIT",
        "Start a new performance view after 10000 node runs.",
      );
    this.runs.set(sample.runId, freeze(clone(sample)));
    return true;
  }
  getSnapshot(): readonly NodeRunPerformance[] {
    return freeze(clone([...this.runs.values()]));
  }
  clear(): void {
    this.runs.clear();
  }
}
