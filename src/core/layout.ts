import type { FlowDocument } from "./types";
import { assertFlow } from "./validation";
import { clone } from "./json";

/** Stable breadth-first layout. Cyclic/unreachable nodes are placed without moving input data. */
export function layoutFlow(
  document: FlowDocument,
  options: {
    direction?: "right" | "down";
    columnGap?: number;
    rowGap?: number;
  } = {},
): FlowDocument {
  assertFlow(document);
  const columnGap = options.columnGap ?? 220;
  const rowGap = options.rowGap ?? 120;
  if (
    !Number.isFinite(columnGap) ||
    columnGap <= 0 ||
    !Number.isFinite(rowGap) ||
    rowGap <= 0
  )
    throw new RangeError("Layout gaps must be positive finite numbers.");
  const result = clone(document);
  const levels = new Map<string, number>();
  const queue = result.nodes
    .filter(
      (node) =>
        node.type === "start" ||
        !result.edges.some((edge) => edge.target === node.id),
    )
    .map((node) => node.id);
  for (const id of queue) levels.set(id, 0);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const edge of result.edges.filter((edge) => edge.source === id)) {
      if (!levels.has(edge.target)) {
        levels.set(edge.target, levels.get(id)! + 1);
        queue.push(edge.target);
      }
    }
  }
  let fallback = Math.max(0, ...levels.values()) + 1;
  const rows = new Map<number, number>();
  for (const node of result.nodes) {
    const level = levels.get(node.id) ?? fallback++;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    node.position =
      options.direction === "down"
        ? { x: 100 + row * columnGap, y: 80 + level * rowGap }
        : { x: 100 + level * columnGap, y: 80 + row * rowGap };
  }
  return result;
}
