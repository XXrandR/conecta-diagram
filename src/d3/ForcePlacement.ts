import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { FlowError, type FlowDocument, type Point } from "../core/types";
import { assertFlow } from "../core/validation";
import type { Unsubscribe } from "../core/store";
import { nodeDimensions } from "../core/node-presentation";
import { boxCollision } from "./box-collision";

export interface ForcePlacementOptions {
  /** Springs retain the author's intended arrangement. Default 0.12. */
  anchorStrength?: number;
  linkDistance?: number;
  linkStrength?: number;
  /** Nonpositive repulsion. Default -80. */
  chargeStrength?: number;
  collisionPadding?: number;
  velocityDecay?: number;
  alphaDecay?: number;
  /** Hard bound around each authored position. Default 200 diagram units. */
  maxDisplacement?: number;
  fixedNodeIds?: readonly string[];
  onListenerError?: (error: unknown) => void;
}
interface PhysicsNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  halfWidth: number;
  halfHeight: number;
}

/** Presentation-only physics on detached D3 nodes; never mutates a FlowDocument. */
export class ForcePlacement {
  private readonly simulation: Simulation<PhysicsNode, undefined>;
  private nodes = new Map<string, PhysicsNode>();
  private listeners = new Set<
    (positions: ReadonlyMap<string, Point>) => void
  >();
  private signature = "";
  private destroyed = false;
  private readonly fixed: Set<string>;
  private readonly config: Required<
    Omit<ForcePlacementOptions, "fixedNodeIds" | "onListenerError">
  >;

  constructor(
    document: FlowDocument,
    private readonly options: ForcePlacementOptions = {},
  ) {
    this.config = {
      anchorStrength: options.anchorStrength ?? 0.12,
      linkDistance: options.linkDistance ?? 190,
      linkStrength: options.linkStrength ?? 0.08,
      chargeStrength: options.chargeStrength ?? -80,
      collisionPadding: options.collisionPadding ?? 12,
      velocityDecay: options.velocityDecay ?? 0.6,
      alphaDecay: options.alphaDecay ?? 0.04,
      maxDisplacement: options.maxDisplacement ?? 200,
    };
    for (const [name, value] of Object.entries(this.config)) {
      if (
        !Number.isFinite(value) ||
        (name === "chargeStrength" ? value > 0 : value < 0) ||
        ([
          "anchorStrength",
          "linkStrength",
          "velocityDecay",
          "alphaDecay",
        ].includes(name) &&
          value > 1) ||
        (["linkDistance", "alphaDecay"].includes(name) && value === 0)
      ) {
        throw new FlowError(
          "INVALID_FORCE_OPTIONS",
          `Invalid force option ${name}.`,
        );
      }
    }
    assertFlow(document);
    this.fixed = new Set(options.fixedNodeIds);
    this.simulation = forceSimulation<PhysicsNode>([])
      .stop()
      .velocityDecay(this.config.velocityDecay)
      .alphaDecay(this.config.alphaDecay)
      .force(
        "charge",
        forceManyBody<PhysicsNode>().strength(this.config.chargeStrength),
      )
      .force(
        "collision",
        boxCollision<PhysicsNode>(this.config.collisionPadding),
      )
      .force(
        "x",
        forceX<PhysicsNode>((node) => node.anchorX).strength(
          this.config.anchorStrength,
        ),
      )
      .force(
        "y",
        forceY<PhysicsNode>((node) => node.anchorY).strength(
          this.config.anchorStrength,
        ),
      )
      .on("tick.placement", () => {
        this.constrain();
        this.notify();
      });
    this.update(document);
  }
  /** Returns true only for a topology, shape, or authored-position change. */
  update(document: FlowDocument): boolean {
    this.alive();
    assertFlow(document);
    const signature = JSON.stringify([
      document.nodes.map((node) => [
        node.id,
        node.type,
        node.position.x,
        node.position.y,
        nodeDimensions(node),
      ]),
      document.edges.map((edge) => [edge.id, edge.source, edge.target]),
    ]);
    if (signature === this.signature) return false;
    this.signature = signature;
    const nodes = document.nodes.map((node) => {
      const previous = this.nodes.get(node.id);
      const moved =
        previous &&
        (previous.anchorX !== node.position.x ||
          previous.anchorY !== node.position.y);
      const next: PhysicsNode = previous ?? {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        anchorX: node.position.x,
        anchorY: node.position.y,
        halfWidth: 0,
        halfHeight: 0,
      };
      if (moved) {
        next.x = node.position.x;
        next.y = node.position.y;
        next.vx = 0;
        next.vy = 0;
        if (next.fx != null) {
          next.fx = next.x;
          next.fy = next.y;
        }
      }
      next.anchorX = node.position.x;
      next.anchorY = node.position.y;
      const dimensions = nodeDimensions(node);
      next.halfWidth = dimensions.width / 2;
      next.halfHeight = dimensions.height / 2 + (dimensions.card ? 0 : 24);
      if (this.fixed.has(node.id)) {
        next.fx = next.anchorX;
        next.fy = next.anchorY;
      }
      return next;
    });
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
    // forceLink mutates endpoints. Give it copies, never the frozen document edges.
    this.simulation
      .force("link", null)
      .nodes(nodes)
      .force(
        "link",
        forceLink<PhysicsNode, { source: string; target: string }>(
          document.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
          })),
        )
          .id((node) => node.id)
          .distance(this.config.linkDistance)
          .strength(this.config.linkStrength),
      );
    this.constrain();
    return true;
  }
  getPositions(): ReadonlyMap<string, Point> {
    this.alive();
    return new Map(
      [...this.nodes].map(([id, node]) => [
        id,
        Object.freeze({ x: node.x, y: node.y }),
      ]),
    );
  }
  subscribe(
    listener: (positions: ReadonlyMap<string, Point>) => void,
  ): Unsubscribe {
    this.alive();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  restart(alpha = 0.35): void {
    this.alive();
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1)
      throw new FlowError(
        "INVALID_ALPHA",
        "alpha must be greater than 0 and at most 1.",
      );
    if (this.nodes.size) this.simulation.alpha(alpha).restart();
  }
  stop(): void {
    this.alive();
    this.simulation.stop();
  }
  /** Manual, deterministic settling, useful for reduced motion and server-side layout. */
  tick(iterations = 1): ReadonlyMap<string, Point> {
    this.alive();
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 1 ||
      iterations > 10000
    )
      throw new FlowError(
        "INVALID_ITERATIONS",
        "iterations must be an integer between 1 and 10000.",
      );
    // Constrain after each step, not just at the end of a long manual settle.
    this.simulation.alpha(Math.max(0.35, this.simulation.alpha()));
    for (let index = 0; index < iterations; index++) {
      this.simulation.tick();
      this.constrain();
    }
    this.notify();
    return this.getPositions();
  }
  /** A temporary pin for dragging; null restores the configured fixed-node policy. */
  pin(id: string, position: Point | null): void {
    this.alive();
    const node = this.nodes.get(id);
    if (!node) throw new FlowError("NODE_NOT_FOUND", `Unknown node ${id}.`);
    if (position && ![position.x, position.y].every(Number.isFinite))
      throw new FlowError("INVALID_POSITION", "Expected finite coordinates.");
    node.fx = position?.x ?? (this.fixed.has(id) ? node.anchorX : null);
    node.fy = position?.y ?? (this.fixed.has(id) ? node.anchorY : null);
    if (node.fx != null && node.fy != null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.simulation.stop().on("tick.placement", null);
    this.listeners.clear();
    this.nodes.clear();
    this.destroyed = true;
  }
  private constrain(): void {
    for (const node of this.nodes.values()) {
      if (node.fx != null || node.fy != null) continue;
      const dx = node.x - node.anchorX;
      const dy = node.y - node.anchorY;
      const distance = Math.hypot(dx, dy);
      if (distance > this.config.maxDisplacement) {
        const ratio = this.config.maxDisplacement / distance;
        node.x = node.anchorX + dx * ratio;
        node.y = node.anchorY + dy * ratio;
        node.vx = 0;
        node.vy = 0;
      }
    }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.getPositions());
      } catch (error) {
        try {
          this.options.onListenerError?.(error);
        } catch {
          /* Physics must remain stoppable. */
        }
      }
    }
  }
  private alive(): void {
    if (this.destroyed)
      throw new FlowError(
        "PLACEMENT_DESTROYED",
        "This force placement has been destroyed.",
      );
  }
}
