import { quadtree } from "d3-quadtree";
import type { Force, SimulationNodeDatum } from "d3-force";

interface BoxNode extends SimulationNodeDatum {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/** D3 force with quadtree broad phase and actual card bounds, not giant circles. */
export function boxCollision<Node extends BoxNode>(
  padding: number,
): Force<Node, undefined> {
  let nodes: Node[] = [];
  const predictedX = (node: Node) => node.x + (node.vx ?? 0);
  const predictedY = (node: Node) => node.y + (node.vy ?? 0);
  const force: Force<Node, undefined> = () => {
    if (!nodes.length) return;
    const maxWidth =
      nodes.reduce((max, node) => Math.max(max, node.halfWidth), 0) + padding;
    const maxHeight =
      nodes.reduce((max, node) => Math.max(max, node.halfHeight), 0) + padding;
    for (let iteration = 0; iteration < 2; iteration++) {
      const tree = quadtree<Node>().x(predictedX).y(predictedY).addAll(nodes);
      for (const node of nodes) {
        const x = predictedX(node),
          y = predictedY(node);
        const reachX = node.halfWidth + maxWidth + padding;
        const reachY = node.halfHeight + maxHeight + padding;
        tree.visit((quad, x0, y0, x1, y1) => {
          if (
            x0 > x + reachX ||
            x1 < x - reachX ||
            y0 > y + reachY ||
            y1 < y - reachY
          )
            return true;
          if ("data" in quad) {
            let leaf: typeof quad | undefined = quad;
            while (leaf) {
              const other = leaf.data;
              if ((other.index ?? 0) > (node.index ?? 0)) {
                const dx = predictedX(other) - predictedX(node),
                  dy = predictedY(other) - predictedY(node);
                const overlapX =
                  node.halfWidth + other.halfWidth + padding * 2 - Math.abs(dx);
                const overlapY =
                  node.halfHeight +
                  other.halfHeight +
                  padding * 2 -
                  Math.abs(dy);
                if (overlapX > 0 && overlapY > 0) {
                  const horizontal = overlapX < overlapY;
                  const fixed = horizontal ? node.fx != null : node.fy != null;
                  const otherFixed = horizontal
                    ? other.fx != null
                    : other.fy != null;
                  const divisor = Number(!fixed) + Number(!otherFixed);
                  if (divisor) {
                    const sign = (horizontal ? dx : dy) < 0 ? -1 : 1;
                    const impulse =
                      ((horizontal ? overlapX : overlapY) * sign * 0.8) /
                      divisor;
                    if (horizontal) {
                      if (!fixed) node.vx = (node.vx ?? 0) - impulse;
                      if (!otherFixed) other.vx = (other.vx ?? 0) + impulse;
                    } else {
                      if (!fixed) node.vy = (node.vy ?? 0) - impulse;
                      if (!otherFixed) other.vy = (other.vy ?? 0) + impulse;
                    }
                  }
                }
              }
              leaf = leaf.next;
            }
          }
          return false;
        });
      }
    }
  };
  force.initialize = (initial) => {
    nodes = initial;
  };
  return force;
}
