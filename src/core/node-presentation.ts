import type { FlowNode } from "./types";

/** Shared by SVG boundaries, camera fitting and D3 collision geometry. */
export function nodeDimensions(node: FlowNode) {
  const card =
    node.type === "decision" || node.type === "wait" || node.type === "task";
  if (card) return { width: 300, height: 204, card: true };
  if (node.type === "fork" || node.type === "join")
    return { width: 88, height: 68, card: false };
  return { width: 56, height: 56, card: false };
}
