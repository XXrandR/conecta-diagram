import type { Condition, Context, FlowDocument } from "./types";
import { equal } from "./json";

export function evaluateCondition(
  condition: Condition,
  context: Context,
): boolean {
  if (condition.op === "all" || condition.op === "any") {
    return condition.op === "all"
      ? condition.conditions.every((item) => evaluateCondition(item, context))
      : condition.conditions.some((item) => evaluateCondition(item, context));
  }
  if (condition.op === "not")
    return !evaluateCondition(condition.condition, context);
  if (!("path" in condition)) return false;
  let actual: unknown = context;
  for (const key of condition.path) {
    if (
      actual === null ||
      typeof actual !== "object" ||
      !Object.hasOwn(actual, key)
    ) {
      actual = undefined;
      break;
    }
    actual = (actual as Record<string, unknown>)[key];
  }
  if (condition.op === "exists") return actual !== undefined;
  if (actual === undefined) return false;
  switch (condition.op) {
    case "eq":
      return equal(actual, condition.value);
    case "neq":
      return !equal(actual, condition.value);
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.some((item) => equal(actual, item))
      );
    case "gt":
      return (
        typeof actual === "number" &&
        typeof condition.value === "number" &&
        actual > condition.value
      );
    case "gte":
      return (
        typeof actual === "number" &&
        typeof condition.value === "number" &&
        actual >= condition.value
      );
    case "lt":
      return (
        typeof actual === "number" &&
        typeof condition.value === "number" &&
        actual < condition.value
      );
    case "lte":
      return (
        typeof actual === "number" &&
        typeof condition.value === "number" &&
        actual <= condition.value
      );
  }
}

/** A filtered projection, not a replacement execution document. */
export function visibleElements(document: FlowDocument, context: Context) {
  const nodes = document.nodes.filter(
    (node) => !node.visibleWhen || evaluateCondition(node.visibleWhen, context),
  );
  const ids = new Set(nodes.map((node) => node.id));
  const edges = document.edges.filter(
    (edge) =>
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      (!edge.visibleWhen || evaluateCondition(edge.visibleWhen, context)),
  );
  return { nodes, edges };
}
