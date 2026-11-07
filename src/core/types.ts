import type { TaskAction, NodeSignals, DecisionDisplay } from "./actions";
/** The document is data only: code previews are text, never executable callbacks. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Context = Record<string, JsonValue>;
export interface Point {
  x: number;
  y: number;
}

export type Condition =
  | {
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";
      path: string[];
      value: JsonValue;
    }
  | { op: "exists"; path: string[] }
  | { op: "all" | "any"; conditions: Condition[] }
  | { op: "not"; condition: Condition };

interface NodeBase {
  id: string;
  label: string;
  position: Point;
  data?: Context;
  signals?: NodeSignals;
  /** Presentation only. Hiding a node never alters execution semantics. */
  visibleWhen?: Condition;
}
export type FlowNode = NodeBase &
  (
    | { type: "start" | "end" }
    | {
        type: "task";
        mode?: "sync" | "async";
        handler?: string;
        action?: TaskAction;
      }
    | { type: "wait"; signal: string }
    | { type: "decision"; decision?: DecisionDisplay; action?: TaskAction }
    | { type: "fork"; join: string }
    | { type: "join"; fork: string }
  );
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Only decision outputs may have conditions/defaults/priorities. */
  condition?: Condition;
  default?: boolean;
  priority?: number;
  data?: Context;
  visibleWhen?: Condition;
}
export interface FlowDocument {
  schemaVersion: 1;
  id: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  data?: Context;
  /** Diagram-owned values. They are not workflow nodes or implicit references. */
  globals?: GlobalVariable[];
  /** Stable creation order across the node and edge namespaces. */
  creationOrder?: FlowItemReference[];
}
export interface GlobalVariable {
  id: string;
  name: string;
  type: "array" | "boolean" | "integer" | "json";
  value: JsonValue;
}
export interface FlowItemReference {
  type: "node" | "edge";
  id: string;
}
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
}
export class FlowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly diagnostics: readonly Diagnostic[] = [],
  ) {
    super(message);
    this.name = "FlowError";
  }
}

export function createFlow(id: string): FlowDocument {
  return { schemaVersion: 1, id, nodes: [], edges: [] };
}
