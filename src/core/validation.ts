import { assertJson, clone } from "./json";
import { isCodePreview, isTaskAction } from "./actions";
import {
  FlowError,
  type Condition,
  type Diagnostic,
  type FlowDocument,
} from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function condition(value: unknown): value is Condition {
  if (!record(value)) return false;
  if (value.op === "all" || value.op === "any")
    return Array.isArray(value.conditions) && value.conditions.every(condition);
  if (value.op === "not") return condition(value.condition);
  if (
    !Array.isArray(value.path) ||
    !value.path.every((key) => typeof key === "string")
  )
    return false;
  if (value.op === "exists") return true;
  if (
    !["eq", "neq", "gt", "gte", "lt", "lte", "in"].includes(String(value.op)) ||
    !Object.hasOwn(value, "value")
  )
    return false;
  if (value.op === "in") return Array.isArray(value.value);
  if (["gt", "gte", "lt", "lte"].includes(String(value.op)))
    return finite(value.value);
  return true;
}

/** Draft validation permits incomplete flows, but never malformed or dangling data. */
export function validateFlow(
  value: unknown,
  options: { mode?: "draft" | "executable" } = {},
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const add = (
    code: string,
    message: string,
    path: string,
    severity: Diagnostic["severity"] = "error",
  ) => issues.push({ code, message, path, severity });
  try {
    assertJson(value);
  } catch (error) {
    add(
      "INVALID_JSON",
      error instanceof Error ? error.message : "Invalid JSON.",
      "",
    );
    return issues;
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !text(value.id) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    add(
      "INVALID_DOCUMENT",
      "Expected schemaVersion 1, a nonempty id, nodes and edges arrays.",
      "",
    );
    return issues;
  }
  if (value.data !== undefined && !record(value.data))
    add("INVALID_DATA", "data must be an object.", "data");
  if (value.globals !== undefined) {
    if (!Array.isArray(value.globals))
      add("INVALID_GLOBAL", "globals must be an array.", "globals");
    else {
      const ids = new Set<string>(),
        names = new Set<string>();
      for (const [index, variable] of value.globals.entries()) {
        const path = `globals[${index}]`;
        if (
          !record(variable) ||
          !text(variable.id) ||
          !text(variable.name) ||
          !["array", "boolean", "integer", "json"].includes(
            String(variable.type),
          ) ||
          !Object.hasOwn(variable, "value")
        ) {
          add(
            "INVALID_GLOBAL",
            "Expected a global id, name, explicit type and JSON value.",
            path,
          );
          continue;
        }
        if (
          (variable.type === "array" && !Array.isArray(variable.value)) ||
          (variable.type === "boolean" &&
            typeof variable.value !== "boolean") ||
          (variable.type === "integer" && !Number.isSafeInteger(variable.value))
        )
          add(
            "GLOBAL_TYPE_MISMATCH",
            "Global value does not match its type badge.",
            path,
          );
        if (ids.has(variable.id) || names.has(variable.name))
          add("DUPLICATE_GLOBAL", "Global ids and names must be unique.", path);
        ids.add(variable.id);
        names.add(variable.name);
      }
    }
  }
  for (const [index, node] of value.nodes.entries()) {
    const path = `nodes[${index}]`;
    if (
      !record(node) ||
      !text(node.id) ||
      typeof node.label !== "string" ||
      !["start", "end", "task", "wait", "decision", "fork", "join"].includes(
        String(node.type),
      ) ||
      !record(node.position) ||
      !finite(node.position.x) ||
      !finite(node.position.y)
    ) {
      add(
        "INVALID_NODE",
        "Expected node id, type, label and finite position.",
        path,
      );
      continue;
    }
    if (
      node.type === "task" &&
      ((node.mode !== undefined &&
        !["sync", "async"].includes(String(node.mode))) ||
        (node.handler !== undefined && !text(node.handler)))
    )
      add("INVALID_TASK", "Invalid task mode or handler.", path);
    if (node.type === "wait" && !text(node.signal))
      add("INVALID_WAIT", "Wait nodes require a signal name.", path);
    if (
      node.action !== undefined &&
      (!["task", "decision"].includes(String(node.type)) ||
        !isTaskAction(node.action))
    )
      add(
        "INVALID_ACTION",
        "Expected a display-only action with a matching command family and valid preview fields.",
        `${path}.action`,
      );
    if (
      node.decision !== undefined &&
      (node.type !== "decision" ||
        !record(node.decision) ||
        (node.decision.description !== undefined &&
          typeof node.decision.description !== "string") ||
        (node.decision.expression !== undefined &&
          !isCodePreview(node.decision.expression)))
    )
      add(
        "INVALID_DECISION_DISPLAY",
        "Invalid decision display description or expression preview.",
        `${path}.decision`,
      );
    if (
      node.signals !== undefined &&
      (!record(node.signals) ||
        ![node.signals.inputs, node.signals.outputs].every(
          (items) => Array.isArray(items) && items.every(text),
        ))
    )
      add(
        "INVALID_SIGNALS",
        "Signal inputs/outputs must be arrays of nonempty names.",
        `${path}.signals`,
      );
    if (node.type === "fork" && !text(node.join))
      add("INVALID_FORK", "Fork nodes require a paired join id.", path);
    if (node.type === "join" && !text(node.fork))
      add("INVALID_JOIN", "Join nodes require a paired fork id.", path);
    if (node.data !== undefined && !record(node.data))
      add("INVALID_DATA", "data must be an object.", `${path}.data`);
    if (node.visibleWhen !== undefined && !condition(node.visibleWhen))
      add(
        "INVALID_CONDITION",
        "Invalid visibility condition.",
        `${path}.visibleWhen`,
      );
  }
  for (const [index, edge] of value.edges.entries()) {
    const path = `edges[${index}]`;
    if (
      !record(edge) ||
      !text(edge.id) ||
      !text(edge.source) ||
      !text(edge.target)
    ) {
      add("INVALID_EDGE", "Expected edge id, source and target.", path);
      continue;
    }
    if (edge.label !== undefined && typeof edge.label !== "string")
      add("INVALID_EDGE", "Edge label must be text.", path);
    if (edge.condition !== undefined && !condition(edge.condition))
      add(
        "INVALID_CONDITION",
        "Invalid routing condition.",
        `${path}.condition`,
      );
    if (edge.visibleWhen !== undefined && !condition(edge.visibleWhen))
      add(
        "INVALID_CONDITION",
        "Invalid visibility condition.",
        `${path}.visibleWhen`,
      );
    if (edge.default !== undefined && typeof edge.default !== "boolean")
      add("INVALID_EDGE", "default must be boolean.", path);
    if (edge.priority !== undefined && !Number.isSafeInteger(edge.priority))
      add("INVALID_EDGE", "priority must be a safe integer.", path);
    if (edge.data !== undefined && !record(edge.data))
      add("INVALID_DATA", "data must be an object.", `${path}.data`);
  }
  if (issues.length) return issues;
  const document = value as unknown as FlowDocument;
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set<string>();
  if (nodes.size !== document.nodes.length)
    add("DUPLICATE_NODE", "Node ids must be unique.", "nodes");
  for (const edge of document.edges) {
    if (edgeIds.has(edge.id))
      add("DUPLICATE_EDGE", `Duplicate edge ${edge.id}.`, "edges");
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      add(
        "DANGLING_EDGE",
        `Edge ${edge.id} references a missing node.`,
        "edges",
      );
  }
  if (document.creationOrder !== undefined) {
    const seen = new Set<string>();
    if (!Array.isArray(document.creationOrder))
      add(
        "INVALID_CREATION_ORDER",
        "creationOrder must be an array.",
        "creationOrder",
      );
    else {
      for (const reference of document.creationOrder) {
        if (
          !record(reference) ||
          !["node", "edge"].includes(String(reference.type)) ||
          !text(reference.id) ||
          !(reference.type === "node"
            ? nodes.has(reference.id)
            : edgeIds.has(reference.id))
        ) {
          add(
            "INVALID_CREATION_ORDER",
            "Creation order references an unknown item.",
            "creationOrder",
          );
          continue;
        }
        const key = JSON.stringify([reference.type, reference.id]);
        if (seen.has(key))
          add(
            "INVALID_CREATION_ORDER",
            "Creation order contains duplicates.",
            "creationOrder",
          );
        seen.add(key);
      }
      if (seen.size !== document.nodes.length + document.edges.length)
        add(
          "INVALID_CREATION_ORDER",
          "Creation order must include every node and edge exactly once.",
          "creationOrder",
        );
    }
  }
  if (issues.length || options.mode === "draft") return issues;
  const incoming = new Map(
    document.nodes.map((node) => [
      node.id,
      document.edges.filter((edge) => edge.target === node.id),
    ]),
  );
  const outgoing = new Map(
    document.nodes.map((node) => [
      node.id,
      document.edges.filter((edge) => edge.source === node.id),
    ]),
  );
  const starts = document.nodes.filter((node) => node.type === "start");
  if (starts.length !== 1)
    add(
      "START_COUNT",
      "An executable flow requires exactly one start node.",
      "nodes",
    );
  if (!document.nodes.some((node) => node.type === "end"))
    add("END_REQUIRED", "An executable flow requires an end node.", "nodes");
  for (const [index, node] of document.nodes.entries()) {
    const path = `nodes[${index}]`;
    const inputs = incoming.get(node.id)!;
    const outputs = outgoing.get(node.id)!;
    if (node.type === "start" && inputs.length)
      add("START_INPUT", "Start nodes cannot have incoming edges.", path);
    if (node.type === "end" && outputs.length)
      add("END_OUTPUT", "End nodes cannot have outgoing edges.", path);
    if (
      !["end", "fork", "decision"].includes(node.type) &&
      outputs.length !== 1
    ) {
      add(
        "OUTPUT_COUNT",
        "This node requires exactly one outgoing edge; use a fork for parallel work.",
        path,
      );
    }
    if (node.type === "decision") {
      if (outputs.length < 2)
        add(
          "DECISION_OUTPUTS",
          "Decisions require at least two branches.",
          path,
        );
      if (outputs.filter((edge) => edge.default).length !== 1)
        add(
          "DECISION_DEFAULT",
          "Decisions require exactly one fallback branch.",
          path,
        );
      if (
        outputs.some((edge) =>
          edge.default ? edge.condition !== undefined : !edge.condition,
        )
      ) {
        add(
          "DECISION_CONDITION",
          "Each non-default branch needs a condition; the fallback cannot have one.",
          path,
        );
      }
    } else if (
      outputs.some(
        (edge) =>
          edge.condition !== undefined ||
          edge.default !== undefined ||
          edge.priority !== undefined,
      )
    ) {
      add(
        "UNEXPECTED_ROUTING",
        "Conditions, defaults and priorities are only allowed on decision outputs.",
        path,
      );
    }
    if (node.type === "fork") {
      const join = nodes.get(node.join);
      if (outputs.length < 2)
        add("FORK_OUTPUTS", "Forks require at least two branches.", path);
      if (join?.type !== "join" || join.fork !== node.id)
        add("FORK_PAIR", "Fork/join references must be reciprocal.", path);
    }
    if (node.type === "join") {
      const fork = nodes.get(node.fork);
      if (fork?.type !== "fork" || fork.join !== node.id)
        add("JOIN_PAIR", "Fork/join references must be reciprocal.", path);
    }
  }
  // Parallel regions must be structured. Validate with a stack; loops are allowed
  // within a region, but cannot re-enter an active fork or escape its paired join.
  if (starts.length === 1) {
    const visited = new Set<string>();
    const reached = new Set<string>();
    const queue: Array<{ id: string; stack: string[] }> = [
      { id: starts[0]!.id, stack: [] },
    ];
    while (queue.length) {
      const item = queue.pop()!;
      const key = JSON.stringify([item.id, item.stack]);
      if (visited.has(key)) continue;
      visited.add(key);
      if (visited.size > 100000) {
        add(
          "VALIDATION_LIMIT",
          "Parallel control-flow complexity exceeds the validation limit.",
          "nodes",
        );
        break;
      }
      reached.add(item.id);
      const node = nodes.get(item.id)!;
      let stack = item.stack;
      if (node.type === "fork") {
        if (stack.includes(node.id)) {
          add(
            "PARALLEL_REENTRY",
            `Fork ${node.id} re-enters before joining.`,
            "nodes",
          );
          continue;
        }
        stack = [...stack, node.id];
      } else if (node.type === "join") {
        if (stack.at(-1) !== node.fork) {
          add(
            "PARALLEL_STRUCTURE",
            `Join ${node.id} is entered outside its matching fork.`,
            "nodes",
          );
          continue;
        }
        stack = stack.slice(0, -1);
      } else if (node.type === "end" && stack.length) {
        add(
          "PARALLEL_ESCAPE",
          `End ${node.id} bypasses a required join.`,
          "nodes",
        );
      }
      for (const edge of outgoing.get(node.id)!)
        queue.push({ id: edge.target, stack });
    }
    for (const node of document.nodes)
      if (!reached.has(node.id))
        add(
          "UNREACHABLE",
          `Node ${node.id} is unreachable.`,
          "nodes",
          "warning",
        );
    // Report nodes with no possible route to an end (cycles remain legal).
    const canEnd = new Set(
      document.nodes
        .filter((node) => node.type === "end")
        .map((node) => node.id),
    );
    const pending = [...canEnd];
    while (pending.length)
      for (const edge of incoming.get(pending.pop()!)!) {
        if (!canEnd.has(edge.source)) {
          canEnd.add(edge.source);
          pending.push(edge.source);
        }
      }
    for (const node of document.nodes)
      if (!canEnd.has(node.id))
        add("NO_END_PATH", `Node ${node.id} has no path to an end.`, "nodes");
  }
  return issues;
}

export function assertFlow(
  value: unknown,
  mode: "draft" | "executable" = "draft",
): asserts value is FlowDocument {
  const diagnostics = validateFlow(value, { mode });
  if (diagnostics.some((item) => item.severity === "error"))
    throw new FlowError("INVALID_FLOW", "Flow validation failed.", diagnostics);
}
export function parseFlow(json: string): FlowDocument {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new FlowError("INVALID_JSON", "Invalid JSON document.");
  }
  assertFlow(value);
  return value;
}
export function serializeFlow(document: FlowDocument): string {
  assertFlow(document);
  return JSON.stringify(document, null, 2);
}
export function copyFlow(document: FlowDocument): FlowDocument {
  assertFlow(document);
  return clone(document);
}
