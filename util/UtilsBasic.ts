import { NodeType } from "../DiagramTypes";

export function getNodeEdgePoint(
  nodeX: number,
  nodeY: number,
  targetX: number,
  targetY: number,
  radius: number,
) {
  const dx = targetX - nodeX;
  const dy = targetY - nodeY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return {
    x: nodeX + (dx / distance) * radius,
    y: nodeY + (dy / distance) * radius,
  };
}

export function getNodeRadius(nodeType: NodeType): number {
  switch (nodeType) {
    case "Task":
      return 24;
    case "Start":
      return 20;
    case "End":
      return 20;
    case "Gateway":
      return 22;
    default:
      return 20;
  }
}
