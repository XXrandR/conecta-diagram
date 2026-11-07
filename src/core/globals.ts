import type {
  FlowDocument,
  GlobalVariable,
  JsonValue,
  FlowItemReference,
} from "./types";

export function globalValueType(value: JsonValue): GlobalVariable["type"] {
  return Array.isArray(value)
    ? "array"
    : typeof value === "boolean"
      ? "boolean"
      : typeof value === "number" && Number.isSafeInteger(value)
        ? "integer"
        : "json";
}
export function flowCreationOrder(document: FlowDocument): FlowItemReference[] {
  return document.creationOrder
    ? [...document.creationOrder]
    : [
        ...document.nodes.map((node) => ({
          type: "node" as const,
          id: node.id,
        })),
        ...document.edges.map((edge) => ({
          type: "edge" as const,
          id: edge.id,
        })),
      ];
}
/** Globals are always pinned above the other items, independent of creation time. */
export function orderedFlowItems(
  document: FlowDocument,
): Array<{ type: "global" | "node" | "edge"; id: string }> {
  return [
    ...(document.globals ?? []).map((variable) => ({
      type: "global" as const,
      id: variable.id,
    })),
    ...flowCreationOrder(document),
  ];
}
