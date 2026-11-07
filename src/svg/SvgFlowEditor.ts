import { visibleElements } from "../core/conditions";
import { assertJson, clone } from "../core/json";
import { FlowStore, type Unsubscribe } from "../core/store";
import {
  FlowError,
  type Context,
  type FlowEdge,
  type FlowNode,
  type Point,
} from "../core/types";
import type { SimulationSnapshot } from "../core/simulation";
import {
  simulationOverlay,
  type ExecutionOverlay,
  type NodeExecution,
} from "../core/runner-display";
import { formatCondition } from "../core/actions";
import { renderPhotonCard } from "./PhotonCard";
import { nodeDimensions } from "../core/node-presentation";
import { createFlowIcon, operationIcon, type FlowIconName } from "./icons";
import { NodeTooltip } from "./NodeTooltip";
import { select } from "d3-selection";
import { timer, type Timer } from "d3-timer";
import { interpolateNumber } from "d3-interpolate";
import { easeCubicOut } from "d3-ease";
import {
  ForcePlacement,
  type ForcePlacementOptions,
} from "../d3/ForcePlacement";

const NS = "http://www.w3.org/2000/svg";
let instances = 0;
export type Selection = { type: "node" | "edge" | "global"; id: string } | null;
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
export interface SvgEditorOptions {
  readOnly?: boolean;
  width?: number;
  height?: number;
  ariaLabel?: string;
  onSelect?: (selection: Selection) => void;
  onNodeActivate?: (node: FlowNode) => void;
  /** Return a unique id when interactive connection creation is enabled. */
  createEdgeId?: () => string;
  onError?: (error: unknown) => void;
  /** Native by default. False is available for static/test renderers. */
  force?: boolean | ForcePlacementOptions;
  capabilities?: readonly string[];
  motion?: "auto" | "full" | "reduced";
  animationDuration?: number;
  /** Hover/focus previews are instance-owned and never execute code. Default true. */
  tooltips?: boolean;
}
interface Drag {
  pointerId: number;
  kind: "node" | "pan";
  id?: string;
  start: Point;
  origin: Point;
  preview: Point;
  moved: boolean;
}

/** Imperative SVG adapter. Importing this module does not access browser globals. */
export class SvgFlowEditor {
  private readonly root: SVGGElement;
  private readonly background: SVGRectElement;
  private readonly viewportGroup: SVGGElement;
  private readonly edgesGroup: SVGGElement;
  private readonly nodesGroup: SVGGElement;
  private readonly markerId: string;
  private readonly cleanup: Array<() => void> = [];
  private readonly unsubscribe: Unsubscribe;
  private context: Context = {};
  private execution: ExecutionOverlay | null = null;
  private capabilities: readonly string[] | undefined;
  private viewOverrides = new Map<string, Point>();
  private selected: Selection = null;
  private connection: string | null = null;
  private reconnection: {
    edgeId: string;
    endpoint: "source" | "target";
  } | null = null;
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private drag: Drag | null = null;
  private destroyed = false;
  private suppressClick = false;
  private width: number;
  private height: number;
  private placement: ForcePlacement | null = null;
  private positions = new Map<string, Point>();
  private positionTimer: Timer | null = null;
  private viewportTimer: Timer | null = null;
  private reducedMotion = false;
  private readonly animationDuration: number;
  private readonly tooltip: NodeTooltip | null;
  private hovered: { id: string; x: number; y: number } | null = null;
  private suppressedTooltipId: string | null = null;

  constructor(
    private readonly svg: SVGSVGElement,
    public readonly store: FlowStore,
    private readonly options: SvgEditorOptions = {},
  ) {
    if (!svg || svg.namespaceURI !== NS || svg.tagName.toLowerCase() !== "svg")
      throw new FlowError("INVALID_SVG", "Expected an SVG root element.");
    this.width = options.width ?? 1000;
    this.height = options.height ?? 600;
    this.checkSize(this.width, this.height);
    this.animationDuration = options.animationDuration ?? 180;
    if (
      !Number.isFinite(this.animationDuration) ||
      this.animationDuration < 0 ||
      this.animationDuration > 5000
    )
      throw new FlowError(
        "INVALID_DURATION",
        "animationDuration must be between 0 and 5000 milliseconds.",
      );
    // Validate physics before mounting any DOM or listeners.
    if (options.force !== false)
      this.placement = new ForcePlacement(
        store.getSnapshot(),
        typeof options.force === "object" ? options.force : {},
      );
    this.capabilities = options.capabilities
      ? [...options.capabilities]
      : undefined;
    const instance = `flow-${++instances}-${Math.random().toString(36).slice(2)}`;
    this.markerId = `${instance}-arrow`;
    this.tooltip =
      options.tooltips === false
        ? null
        : new NodeTooltip(svg.ownerDocument, `${instance}-tooltip`);
    this.root = this.element("g", {
      "data-flow-root": instance,
      role: "group",
      "aria-label": options.ariaLabel ?? "Flow editor",
      tabindex: "0",
      style: "touch-action: none; user-select: none",
    });
    const defs = this.element("defs");
    const marker = this.element("marker", {
      id: this.markerId,
      viewBox: "0 -5 10 10",
      refX: "9",
      refY: "0",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto-start-reverse",
    });
    marker.append(
      this.element("path", { d: "M0,-5L10,0L0,5", fill: "context-stroke" }),
    );
    defs.append(marker);
    this.background = this.element("rect", {
      x: "0",
      y: "0",
      width: String(this.width),
      height: String(this.height),
      fill: "transparent",
    });
    this.viewportGroup = this.element("g");
    this.edgesGroup = this.element("g", { "data-layer": "edges" });
    this.nodesGroup = this.element("g", { "data-layer": "nodes" });
    this.viewportGroup.append(this.edgesGroup, this.nodesGroup);
    this.root.append(defs, this.background, this.viewportGroup);
    svg.append(this.root);
    this.listen(this.root, "pointerover", (event) =>
      this.hover(event as PointerEvent),
    );
    this.listen(this.root, "pointerout", (event) => {
      const related = (event as PointerEvent).relatedTarget as Element | null;
      if (!related || !this.target(event)?.contains(related)) {
        this.suppressedTooltipId = null;
        this.clearHover();
      }
    });
    this.listen(this.root, "focusin", (event) => this.hover(event));
    this.listen(this.root, "focusout", () => {
      this.suppressedTooltipId = null;
      this.clearHover();
    });
    this.listen(this.root, "click", (event) => this.click(event as MouseEvent));
    this.listen(this.root, "dblclick", (event) => {
      const id = this.target(event)?.getAttribute("data-node-id");
      const node = this.store
        .getSnapshot()
        .nodes.find((item) => item.id === id);
      if (node) this.options.onNodeActivate?.(node);
    });
    this.listen(this.root, "keydown", (event) =>
      this.keydown(event as KeyboardEvent),
    );
    this.listen(this.root, "pointerdown", (event) =>
      this.pointerdown(event as PointerEvent),
    );
    const window = svg.ownerDocument.defaultView;
    const media = window?.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reducedMotion =
      options.motion === "reduced" ||
      (options.motion !== "full" && Boolean(media?.matches));
    if (media && (!options.motion || options.motion === "auto")) {
      this.listen(media, "change", (event) => {
        this.reducedMotion = (event as MediaQueryListEvent).matches;
        if (this.reducedMotion) {
          this.viewportTimer?.stop();
          this.viewportTimer = null;
          this.placement?.stop();
          this.render();
        }
      });
    }
    if (window) {
      this.listen(window, "pointermove", (event) =>
        this.pointermove(event as PointerEvent),
      );
      this.listen(window, "pointerup", (event) =>
        this.pointerup(event as PointerEvent),
      );
      this.listen(window, "pointercancel", () => this.cancelDrag());
      this.listen(window, "blur", () => {
        this.clearHover();
        this.cancelDrag();
      });
      this.listen(window, "scroll", () => this.clearHover(), { capture: true });
      this.listen(window, "resize", () => this.clearHover());
    }
    this.listen(
      this.root,
      "wheel",
      (event) => {
        const wheel = event as WheelEvent;
        wheel.preventDefault();
        this.zoomBy(wheel.deltaY < 0 ? 1.1 : 1 / 1.1, this.point(wheel));
      },
      { passive: false },
    );
    this.unsubscribe = store.subscribe(() => {
      if (
        this.drag?.kind === "node" &&
        !store.getSnapshot().nodes.some((node) => node.id === this.drag!.id)
      )
        this.drag = null;
      const changed = this.placement?.update(store.getSnapshot());
      if (
        this.selected &&
        !(
          this.selected.type === "node"
            ? store.getSnapshot().nodes
            : this.selected.type === "global"
              ? (store.getSnapshot().globals ?? [])
              : store.getSnapshot().edges
        ).some((item) => item.id === this.selected!.id)
      )
        this.select(null);
      if (
        this.connection &&
        !store.getSnapshot().nodes.some((node) => node.id === this.connection)
      )
        this.connection = null;
      if (
        this.reconnection &&
        !store
          .getSnapshot()
          .edges.some((edge) => edge.id === this.reconnection!.edgeId)
      ) {
        this.reconnection = null;
        this.connection = null;
      }
      this.render();
      if (changed) this.relax();
    });
    if (this.placement) this.observePlacement();
    this.render();
    if (this.placement) this.relax();
  }
  getSelection(): Selection {
    return this.selected ? { ...this.selected } : null;
  }
  getViewport(): Viewport {
    return { ...this.viewport };
  }
  select(selection: Selection): void {
    this.alive();
    if (selection) {
      const items =
        selection.type === "node"
          ? this.store.getSnapshot().nodes
          : selection.type === "global"
            ? (this.store.getSnapshot().globals ?? [])
            : this.store.getSnapshot().edges;
      if (!items.some((item) => item.id === selection.id))
        throw new FlowError(
          "SELECTION_NOT_FOUND",
          `Unknown ${selection.type} ${selection.id}.`,
        );
    }
    this.selected = selection ? { ...selection } : null;
    this.render();
    this.options.onSelect?.(this.getSelection());
  }
  setContext(context: Context): void {
    this.alive();
    assertJson(context);
    if (!context || typeof context !== "object" || Array.isArray(context))
      throw new FlowError("INVALID_CONTEXT", "Context must be a JSON object.");
    this.context = clone(context);
    this.render();
  }
  /** Display state supplied by a simulator or mapped from a real external runtime. */
  setExecution(snapshot: SimulationSnapshot | ExecutionOverlay | null): void {
    this.alive();
    if (snapshot) assertJson(snapshot);
    this.execution = snapshot
      ? clone("nodes" in snapshot ? snapshot : simulationOverlay(snapshot))
      : null;
    this.render();
  }
  setCapabilities(types: readonly string[]): void {
    this.alive();
    if (
      !Array.isArray(types) ||
      !types.every((type) => typeof type === "string")
    )
      throw new FlowError(
        "INVALID_CAPABILITIES",
        "Expected advertised command type names.",
      );
    this.capabilities = [...types];
    this.render();
  }
  beginConnection(source: string): void {
    this.editable();
    if (!this.store.getSnapshot().nodes.some((node) => node.id === source))
      throw new FlowError("NODE_NOT_FOUND", `Unknown node ${source}.`);
    this.connection = source;
    this.reconnection = null;
    this.suppressClick = false;
    this.render();
  }
  /** Rewire an existing edge without losing its id, condition or signal metadata. */
  beginReconnection(
    edgeId: string,
    endpoint: "source" | "target" = "target",
  ): void {
    this.editable();
    if (endpoint !== "source" && endpoint !== "target")
      throw new FlowError("INVALID_ENDPOINT", "Expected source or target.");
    const edge = this.store
      .getSnapshot()
      .edges.find((edge) => edge.id === edgeId);
    if (!edge) throw new FlowError("EDGE_NOT_FOUND", `Unknown edge ${edgeId}.`);
    this.reconnection = { edgeId, endpoint };
    this.connection = endpoint === "target" ? edge.source : edge.target;
    this.suppressClick = false;
    this.render();
  }
  cancelConnection(): void {
    this.alive();
    this.connection = null;
    this.reconnection = null;
    this.render();
  }
  setViewport(viewport: Viewport): void {
    this.alive();
    if (
      ![viewport.x, viewport.y, viewport.scale].every(Number.isFinite) ||
      viewport.scale <= 0
    )
      throw new FlowError(
        "INVALID_VIEWPORT",
        "Expected finite coordinates and positive scale.",
      );
    this.viewportTimer?.stop();
    this.viewportTimer = null;
    this.applyViewport(viewport);
  }
  private applyViewport(viewport: Viewport): void {
    this.viewport = {
      ...viewport,
      scale: Math.max(0.1, Math.min(4, viewport.scale)),
    };
    this.viewportGroup.setAttribute(
      "transform",
      `translate(${this.viewport.x} ${this.viewport.y}) scale(${this.viewport.scale})`,
    );
  }
  animateViewport(viewport: Viewport, duration = this.animationDuration): void {
    this.alive();
    if (
      ![viewport.x, viewport.y, viewport.scale, duration].every(
        Number.isFinite,
      ) ||
      viewport.scale <= 0 ||
      duration < 0 ||
      duration > 5000
    )
      throw new FlowError(
        "INVALID_VIEWPORT",
        "Expected a valid viewport and a duration between 0 and 5000 milliseconds.",
      );
    this.viewportTimer?.stop();
    this.viewportTimer = null;
    if (this.reducedMotion || duration === 0) {
      this.setViewport(viewport);
      return;
    }
    const x = interpolateNumber(this.viewport.x, viewport.x);
    const y = interpolateNumber(this.viewport.y, viewport.y);
    const scale = interpolateNumber(
      this.viewport.scale,
      Math.max(0.1, Math.min(4, viewport.scale)),
    );
    this.viewportTimer = timer((elapsed) => {
      const progress = Math.min(1, elapsed / duration);
      const eased = easeCubicOut(progress);
      this.applyViewport({ x: x(eased), y: y(eased), scale: scale(eased) });
      if (progress === 1) {
        this.viewportTimer?.stop();
        this.viewportTimer = null;
      }
    });
  }
  zoomBy(
    factor: number,
    anchor: Point = { x: this.width / 2, y: this.height / 2 },
  ): void {
    if (!Number.isFinite(factor) || factor <= 0)
      throw new FlowError("INVALID_ZOOM", "Zoom factor must be positive.");
    const previous = this.viewport;
    const scale = Math.max(0.1, Math.min(4, previous.scale * factor));
    this.setViewport({
      x: anchor.x - ((anchor.x - previous.x) * scale) / previous.scale,
      y: anchor.y - ((anchor.y - previous.y) * scale) / previous.scale,
      scale,
    });
  }
  fitToView(padding = 50, animate = false): void {
    this.alive();
    if (
      !Number.isFinite(padding) ||
      padding < 0 ||
      padding * 2 >= Math.min(this.width, this.height)
    )
      throw new FlowError(
        "INVALID_PADDING",
        "Padding must fit inside the viewport.",
      );
    const nodes = visibleElements(this.store.getSnapshot(), this.context).nodes;
    if (!nodes.length) {
      this.setViewport({ x: 0, y: 0, scale: 1 });
      return;
    }
    const bounds = nodes.map((node) => ({
      point: this.positions.get(node.id) ?? node.position,
      size: nodeDimensions(node),
    }));
    const minX = Math.min(
      ...bounds.map(({ point, size }) => point.x - size.width / 2),
    );
    const maxX = Math.max(
      ...bounds.map(({ point, size }) => point.x + size.width / 2),
    );
    const minY = Math.min(
      ...bounds.map(({ point, size }) => point.y - size.height / 2),
    );
    const maxY = Math.max(
      ...bounds.map(
        ({ point, size }) => point.y + size.height / 2 + (size.card ? 0 : 24),
      ),
    );
    const scale = Math.max(
      0.1,
      Math.min(
        4,
        (this.width - padding * 2) / (maxX - minX),
        (this.height - padding * 2) / (maxY - minY),
      ),
    );
    const viewport = {
      x: this.width / 2 - ((minX + maxX) / 2) * scale,
      y: this.height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    };
    if (animate) this.animateViewport(viewport);
    else this.setViewport(viewport);
  }
  /** Rendered coordinates are detached from the authored plan. */
  getNodePositions(): ReadonlyMap<string, Point> {
    this.alive();
    return new Map(
      [...this.positions].map(([id, point]) => [id, { ...point }]),
    );
  }
  relax(): void {
    this.alive();
    const placement = this.ensurePlacement();
    if (this.reducedMotion) {
      placement.stop();
      placement.tick(120);
    } else placement.restart();
  }
  stopForce(): void {
    this.alive();
    this.placement?.stop();
  }
  settlePlacement(iterations = 120): ReadonlyMap<string, Point> {
    this.alive();
    const placement = this.ensurePlacement();
    placement.stop();
    return placement.tick(iterations);
  }
  resetPlacement(): void {
    this.alive();
    this.placement?.destroy();
    this.placement = null;
    this.viewOverrides.clear();
    if (this.options.force !== false) {
      this.ensurePlacement();
      this.relax();
    }
    this.render();
  }
  /** Move/pin a node for this view only, including in read-only monitoring views. */
  moveNodeView(id: string, position: Point): void {
    this.alive();
    if (
      !this.store.getSnapshot().nodes.some((node) => node.id === id) ||
      ![position.x, position.y].every(Number.isFinite)
    )
      throw new FlowError(
        "INVALID_POSITION",
        "Expected an existing node and finite display coordinates.",
      );
    this.viewOverrides.set(id, { ...position });
    this.placement?.pin(id, position);
    this.drawPositions(new Map(this.positions).set(id, { ...position }));
    if (!this.reducedMotion) this.placement?.restart();
  }
  resize(width: number, height: number): void {
    this.alive();
    this.checkSize(width, height);
    this.width = width;
    this.height = height;
    this.background.setAttribute("width", String(width));
    this.background.setAttribute("height", String(height));
  }
  exportSvg(): string {
    this.alive();
    const output = this.element("svg", {
      xmlns: NS,
      width: String(this.width),
      height: String(this.height),
      viewBox: `0 0 ${this.width} ${this.height}`,
    });
    output.append(this.root.cloneNode(true));
    return output.outerHTML;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.unsubscribe();
    this.placement?.destroy();
    this.tooltip?.destroy();
    this.positionTimer?.stop();
    this.viewportTimer?.stop();
    for (const cleanup of this.cleanup) cleanup();
    this.root.remove();
    this.drag = null;
    this.destroyed = true;
  }
  private render(): void {
    if (this.destroyed) return;
    const { nodes, edges } = visibleElements(
      this.store.getSnapshot(),
      this.context,
    );
    const models = new Map(nodes.map((node) => [node.id, node]));
    const physics = this.placement?.getPositions();
    const targets = new Map(
      this.store
        .getSnapshot()
        .nodes.map((node) => [
          node.id,
          this.drag?.kind === "node" && this.drag.id === node.id
            ? this.drag.preview
            : (physics?.get(node.id) ??
              this.viewOverrides.get(node.id) ??
              node.position),
        ]),
    );
    const positions = new Map(
      [...targets].map(([id, target]) => [
        id,
        this.positions.get(id) ?? target,
      ]),
    );
    const editor = this;
    // Keyed D3 joins retain each group's identity and keyboard focus across updates.
    select(this.edgesGroup)
      .selectAll<SVGGElement, FlowEdge>("g[data-edge-id]")
      .data(edges, (edge) => edge.id)
      .join("g")
      .each(function (edge) {
        editor.patchGroup(this, editor.renderEdge(edge, positions, models));
      });
    select(this.nodesGroup)
      .selectAll<SVGGElement, FlowNode>("g[data-node-id]")
      .data(nodes, (node) => node.id)
      .join("g")
      .each(function (node) {
        editor.patchGroup(
          this,
          editor.renderNode(node, positions.get(node.id)!),
        );
      });
    this.applyViewport(this.viewport);
    this.animatePositions(targets);
    this.refreshTooltip();
  }
  private hover(event: Event): void {
    if (!this.tooltip || this.drag) return;
    const target = this.target(event);
    const id = target?.getAttribute("data-node-id");
    if (!id || !target) return;
    if (id === this.suppressedTooltipId) return;
    this.suppressedTooltipId = null;
    if (this.hovered?.id === id) return;
    const bounds = target.getBoundingClientRect();
    this.hovered = {
      id,
      x:
        event.type === "focusin"
          ? bounds.right
          : (event as PointerEvent).clientX,
      y:
        event.type === "focusin" ? bounds.top : (event as PointerEvent).clientY,
    };
    this.refreshTooltip();
  }
  private refreshTooltip(): void {
    if (!this.hovered || !this.tooltip) return;
    const node = this.store
      .getSnapshot()
      .nodes.find((node) => node.id === this.hovered!.id);
    const target = [...this.nodesGroup.children].find(
      (node) => node.getAttribute("data-node-id") === this.hovered!.id,
    );
    if (!node || !target) {
      this.clearHover();
      return;
    }
    const observation =
      this.execution && Object.hasOwn(this.execution.nodes, node.id)
        ? this.execution.nodes[node.id]
        : undefined;
    this.tooltip.show(
      node,
      this.store.getSnapshot(),
      observation,
      this.capabilities,
      target,
      this.hovered,
    );
  }
  private clearHover(suppress = false): void {
    if (suppress) this.suppressedTooltipId = this.hovered?.id ?? null;
    this.hovered = null;
    this.tooltip?.hide();
  }
  private ensurePlacement(): ForcePlacement {
    if (!this.placement) {
      this.placement = new ForcePlacement(
        this.store.getSnapshot(),
        typeof this.options.force === "object" ? this.options.force : {},
      );
      this.observePlacement();
    }
    return this.placement;
  }
  private observePlacement(): void {
    this.placement!.subscribe((positions) => {
      if (this.destroyed) return;
      this.positionTimer?.stop();
      this.positionTimer = null;
      const next = new Map(positions);
      if (this.drag?.kind === "node")
        next.set(this.drag.id!, this.drag.preview);
      this.drawPositions(next);
    });
  }
  private animatePositions(targets: Map<string, Point>): void {
    this.positionTimer?.stop();
    this.positionTimer = null;
    const moved = [...targets].some(([id, point]) => {
      const current = this.positions.get(id);
      return current && (point.x !== current.x || point.y !== current.y);
    });
    if (
      !moved ||
      this.placement ||
      this.drag ||
      this.reducedMotion ||
      this.animationDuration === 0
    ) {
      this.drawPositions(targets);
      return;
    }
    const interpolators = [...targets].map(([id, end]) => {
      const start = this.positions.get(id) ?? end;
      return {
        id,
        x: interpolateNumber(start.x, end.x),
        y: interpolateNumber(start.y, end.y),
      };
    });
    this.drawPositions(
      new Map(
        interpolators.map((item) => [item.id, { x: item.x(0), y: item.y(0) }]),
      ),
    );
    this.positionTimer = timer((elapsed) => {
      const progress = Math.min(1, elapsed / this.animationDuration);
      const eased = easeCubicOut(progress);
      this.drawPositions(
        new Map(
          interpolators.map((item) => [
            item.id,
            { x: item.x(eased), y: item.y(eased) },
          ]),
        ),
      );
      if (progress === 1) {
        this.positionTimer?.stop();
        this.positionTimer = null;
      }
    });
  }
  private drawPositions(positions: ReadonlyMap<string, Point>): void {
    this.positions = new Map(positions);
    const models = new Map(
      this.store.getSnapshot().nodes.map((node) => [node.id, node]),
    );
    const editor = this;
    select(this.nodesGroup)
      .selectAll<SVGGElement, FlowNode>("g[data-node-id]")
      .each(function (node) {
        const point = positions.get(node.id)!;
        this.setAttribute("transform", `translate(${point.x} ${point.y})`);
      });
    select(this.edgesGroup)
      .selectAll<SVGGElement, FlowEdge>("g[data-edge-id]")
      .each(function (edge) {
        const geometry = editor.edgeGeometry(edge, positions, models);
        for (const path of this.querySelectorAll("path"))
          path.setAttribute("d", geometry.path);
        const label = this.querySelector("text");
        label?.setAttribute("x", String(geometry.label.x));
        label?.setAttribute("y", String(geometry.label.y));
      });
  }
  private patchGroup(target: SVGGElement, source: SVGGElement): void {
    for (const attribute of [...target.attributes])
      if (!source.hasAttribute(attribute.name))
        target.removeAttribute(attribute.name);
    for (const attribute of [...source.attributes])
      target.setAttribute(attribute.name, attribute.value);
    target.replaceChildren(...source.childNodes);
  }
  private edgeGeometry(
    edge: FlowEdge,
    positions: ReadonlyMap<string, Point>,
    models: Map<string, FlowNode>,
  ) {
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    const { x: x1, y: y1 } = this.boundary(
      models.get(edge.source)!,
      source,
      target,
    );
    const { x: x2, y: y2 } = this.boundary(
      models.get(edge.target)!,
      target,
      source,
    );
    const bend = Math.max(60, Math.abs(x2 - x1) / 2);
    const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    const direction = horizontal
      ? Math.sign(x2 - x1) || 1
      : Math.sign(y2 - y1) || 1;
    const verticalBend = Math.max(60, Math.abs(y2 - y1) / 2);
    const path =
      edge.source === edge.target
        ? `M${source.x - 20},${source.y - 25} C${source.x - 100},${source.y - 140} ${source.x + 100},${source.y - 140} ${source.x + 20},${source.y - 25}`
        : horizontal
          ? `M${x1},${y1} C${x1 + bend * direction},${y1} ${x2 - bend * direction},${y2} ${x2},${y2}`
          : `M${x1},${y1} C${x1},${y1 + verticalBend * direction} ${x2},${y2 - verticalBend * direction} ${x2},${y2}`;
    return {
      path,
      label: { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 - 9 },
    };
  }
  private renderEdge(
    edge: FlowEdge,
    positions: Map<string, Point>,
    models: Map<string, FlowNode>,
  ): SVGGElement {
    const selected =
      this.selected?.type === "edge" && this.selected.id === edge.id;
    const traversed = this.execution?.edges?.[edge.id] === "taken";
    const skipped = this.execution?.edges?.[edge.id] === "skipped";
    const group = this.element("g", {
      "data-edge-id": edge.id,
      role: "button",
      tabindex: "0",
      "aria-label": edge.label ?? `Connection ${edge.source} to ${edge.target}`,
      "aria-pressed": String(selected),
      "data-state": traversed ? "taken" : skipped ? "skipped" : "idle",
    });
    const { path, label: labelPosition } = this.edgeGeometry(
      edge,
      positions,
      models,
    );
    group.append(
      this.element("path", {
        d: path,
        fill: "none",
        stroke: "transparent",
        "stroke-width": "16",
      }),
    );
    group.append(
      this.element("path", {
        d: path,
        fill: "none",
        stroke: selected
          ? "var(--accent)"
          : traversed
            ? "var(--accent)"
            : "var(--border-strong)",
        "stroke-width": selected ? "3" : "2",
        "marker-end": `url(#${this.markerId})`,
        "pointer-events": "none",
        "stroke-dasharray": skipped ? "5 5" : "none",
        opacity: skipped ? "0.4" : "1",
      }),
    );
    const caption =
      edge.label ??
      (edge.default
        ? "otherwise"
        : edge.condition
          ? formatCondition(edge.condition)
          : "");
    if (caption) {
      const label = this.element("text", {
        x: String(labelPosition.x),
        y: String(labelPosition.y),
        "text-anchor": "middle",
        "font-size": "12",
        fill: "var(--text-secondary)",
      });
      label.textContent =
        caption.length > 55 ? `${caption.slice(0, 54)}…` : caption;
      group.append(label);
    }
    return group;
  }
  private cardIcon(
    group: SVGGElement,
    name: FlowIconName,
    x: number,
    y: number,
    size: number,
    color: string,
  ): void {
    const icon = createFlowIcon(this.svg.ownerDocument, name, size);
    icon.setAttribute("x", String(x));
    icon.setAttribute("y", String(y));
    icon.setAttribute("color", color);
    icon.setAttribute("pointer-events", "none");
    group.append(icon);
  }
  private renderCard(
    group: SVGGElement,
    node: FlowNode,
    observation: NodeExecution | undefined,
    stroke: string,
  ): void {
    const selected =
      (this.selected?.type === "node" && this.selected.id === node.id) ||
      this.connection === node.id;
    group.append(
      renderPhotonCard(
        this.svg.ownerDocument,
        node,
        this.store.getSnapshot(),
        observation,
        this.execution,
        selected,
        this.capabilities,
      ),
    );
  }
  private boundary(node: FlowNode, center: Point, toward: Point): Point {
    const dx = toward.x - center.x || (toward.y === center.y ? 1 : 0);
    const dy = toward.y - center.y;
    const length = Math.hypot(dx, dy);
    const size = nodeDimensions(node);
    const factor = size.card
      ? 1 /
        Math.max(
          Math.abs(dx) / (size.width / 2),
          Math.abs(dy) / (size.height / 2),
        )
      : node.type === "start" || node.type === "end"
        ? 28 / length
        : ["decision", "fork", "join"].includes(node.type)
          ? 1 / (Math.abs(dx) / 44 + Math.abs(dy) / 34)
          : 1 / Math.max(Math.abs(dx) / 75, Math.abs(dy) / 28);
    return {
      x: center.x + dx * factor + (dx / length) * 3,
      y: center.y + dy * factor + (dy / length) * 3,
    };
  }
  private renderNode(node: FlowNode, position: Point): SVGGElement {
    const selected =
      this.selected?.type === "node" && this.selected.id === node.id;
    const observation =
      this.execution && Object.hasOwn(this.execution.nodes, node.id)
        ? this.execution.nodes[node.id]
        : undefined;
    const state = observation?.status ?? "idle";
    const stroke =
      selected || this.connection === node.id || state !== "idle"
        ? "var(--accent)"
        : "var(--border-strong)";
    const group = this.element("g", {
      transform: `translate(${position.x} ${position.y})`,
      "data-node-id": node.id,
      "data-state": state,
      role: "button",
      tabindex: "0",
      "aria-label": `${node.label}, ${node.type}, ${state}`,
      "aria-pressed": String(selected),
      cursor: "grab",
    });
    if (nodeDimensions(node).card) {
      this.renderCard(group, node, observation, stroke);
      return group;
    }
    const attributes = {
      fill: "var(--surface)",
      stroke,
      "stroke-width": selected ? "3" : "2",
    };
    if (["decision", "fork", "join"].includes(node.type))
      group.append(
        this.element("path", {
          ...attributes,
          d: "M0,-34 L44,0 L0,34 L-44,0 Z",
        }),
      );
    else if (node.type === "start" || node.type === "end")
      group.append(
        this.element("circle", {
          ...attributes,
          r: "25",
          "stroke-width": node.type === "end" ? "5" : "2",
        }),
      );
    else
      group.append(
        this.element("rect", {
          ...attributes,
          x: "-75",
          y: "-28",
          width: "150",
          height: "56",
          rx: node.type === "wait" ? "24" : "8",
          "stroke-dasharray":
            node.type === "task" && node.mode === "async" ? "6 3" : "none",
        }),
      );
    const symbol = node.type === "task" && node.mode === "async" ? "async" : "";
    if (node.type !== "task")
      this.cardIcon(group, operationIcon(node.type), -10, -10, 20, stroke);
    const text = this.element("text", {
      "text-anchor": "middle",
      y: ["task", "wait"].includes(node.type) ? "4" : "5",
      "font-size": "13",
      "font-family": "var(--font-sans)",
      fill: "var(--text)",
      "pointer-events": "none",
    });
    text.textContent = ["task", "wait"].includes(node.type)
      ? node.label.length > 20
        ? `${node.label.slice(0, 19)}…`
        : node.label
      : symbol;
    group.append(text);
    const label = this.element("text", {
      "text-anchor": "middle",
      y: "48",
      "font-size": "12",
      "font-family": "var(--font-sans)",
      fill: "var(--text-secondary)",
      "pointer-events": "none",
    });
    label.textContent = ["task", "wait"].includes(node.type)
      ? `${node.type}${symbol ? ` · ${symbol}` : ""}`
      : node.label;
    const title = this.element("title");
    title.textContent = `${node.label} (${node.type})`;
    group.append(label, title);
    return group;
  }
  private click(event: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.attempt(() => {
      const target = this.target(event);
      const id = target?.getAttribute("data-node-id");
      if (id && this.connection) {
        if (this.reconnection) {
          const { edgeId, endpoint } = this.reconnection;
          this.store.updateEdge(edgeId, (edge) => ({
            ...edge,
            [endpoint]: id,
          }));
        } else {
          const source = this.connection;
          const edgeId =
            this.options.createEdgeId?.() ??
            `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          this.store.addEdge({ id: edgeId, source, target: id });
        }
        this.connection = null;
        this.reconnection = null;
        this.render();
      } else if (id) this.select({ type: "node", id });
      else {
        const edge = target?.getAttribute("data-edge-id");
        this.select(edge ? { type: "edge", id: edge } : null);
      }
    });
  }
  private keydown(event: KeyboardEvent): void {
    this.attempt(() => {
      if (event.key === "Escape") {
        this.clearHover(true);
        this.cancelDrag();
        this.cancelConnection();
        this.select(null);
        return;
      }
      const target = this.target(event);
      const nodeId = target?.getAttribute("data-node-id");
      const edgeId = target?.getAttribute("data-edge-id");
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (nodeId && this.connection)
          this.click(event as unknown as MouseEvent);
        else if (nodeId) this.select({ type: "node", id: nodeId });
        else if (edgeId) this.select({ type: "edge", id: edgeId });
        return;
      }
      if (
        this.selected?.type === "node" &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const point = this.positions.get(this.selected.id)!;
        const amount = event.shiftKey ? 50 : 10;
        this.moveNodeView(this.selected.id, {
          x:
            point.x +
            (event.key === "ArrowLeft"
              ? -amount
              : event.key === "ArrowRight"
                ? amount
                : 0),
          y:
            point.y +
            (event.key === "ArrowUp"
              ? -amount
              : event.key === "ArrowDown"
                ? amount
                : 0),
        });
        return;
      }
      if (this.options.readOnly) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        ["z", "y"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        if (event.key.toLowerCase() === "y" || event.shiftKey)
          this.store.redo();
        else this.store.undo();
      } else if (
        this.selected?.type === "edge" &&
        event.key.toLowerCase() === "r"
      ) {
        this.beginReconnection(
          this.selected.id,
          event.shiftKey ? "source" : "target",
        );
      } else if (
        this.selected &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        if (this.selected.type === "node")
          this.store.removeNode(this.selected.id);
        else if (this.selected.type === "global")
          this.store.removeGlobal(this.selected.id);
        else this.store.removeEdge(this.selected.id);
      } else if (
        this.selected?.type === "node" &&
        event.key.toLowerCase() === "c"
      )
        this.beginConnection(this.selected.id);
    });
  }
  private pointerdown(event: PointerEvent): void {
    if (event.button !== 0 || this.drag) return;
    this.clearHover();
    this.suppressClick = false;
    const target = this.target(event);
    const id = target?.getAttribute("data-node-id");
    if (this.connection || target?.hasAttribute("data-edge-id")) return;
    this.positionTimer?.stop();
    this.positionTimer = null;
    const origin = id ? this.positions.get(id)! : this.viewport;
    this.drag = {
      pointerId: event.pointerId,
      kind: id ? "node" : "pan",
      ...(id ? { id } : {}),
      start: this.point(event),
      origin: { x: origin.x, y: origin.y },
      preview: { x: origin.x, y: origin.y },
      moved: false,
    };
    if (id) this.placement?.pin(id, origin);
  }
  private pointermove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = this.point(event);
    const dx = current.x - drag.start.x;
    const dy = current.y - drag.start.y;
    if (Math.hypot(dx, dy) < 3 && !drag.moved) return;
    event.preventDefault();
    drag.moved = true;
    const scale = drag.kind === "node" ? this.viewport.scale : 1;
    drag.preview = {
      x: drag.origin.x + dx / scale,
      y: drag.origin.y + dy / scale,
    };
    if (drag.kind === "node") {
      this.placement?.pin(drag.id!, drag.preview);
      if (!this.reducedMotion) this.placement?.restart();
      this.drawPositions(new Map(this.positions).set(drag.id!, drag.preview));
    } else this.setViewport({ ...drag.preview, scale: this.viewport.scale });
  }
  private pointerup(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.suppressClick = drag.moved;
    if (drag.kind === "node")
      this.attempt(() => {
        if (drag.moved) this.moveNodeView(drag.id!, drag.preview);
        else
          this.placement?.pin(
            drag.id!,
            this.viewOverrides.get(drag.id!) ?? null,
          );
      });
  }
  private cancelDrag(): void {
    if (this.drag?.kind === "node" && this.placement) {
      this.placement.pin(this.drag.id!, this.drag.origin);
      if (!this.viewOverrides.has(this.drag.id!))
        this.placement.pin(this.drag.id!, null);
    }
    this.drag = null;
    this.render();
  }
  private point(event: MouseEvent): Point {
    // Account for CSS sizing, viewBox, transforms and the host's coordinate system.
    const matrix = this.svg.getScreenCTM?.();
    if (matrix && this.svg.createSVGPoint) {
      const point = this.svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      return { x: local.x, y: local.y };
    }
    const bounds = this.svg.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  private target(event: Event): Element | null {
    const target = event.target as Element | null;
    const element = target?.closest?.("[data-node-id], [data-edge-id]") ?? null;
    return element && this.root.contains(element) ? element : null;
  }
  private element<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string> = {},
  ): SVGElementTagNameMap[K] {
    const element = this.svg.ownerDocument.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, value);
    return element;
  }
  private listen(
    target: EventTarget,
    name: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(name, handler, options);
    this.cleanup.push(() => target.removeEventListener(name, handler, options));
  }
  private attempt(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.options.onError?.(error);
    }
  }
  private alive(): void {
    if (this.destroyed)
      throw new FlowError(
        "EDITOR_DESTROYED",
        "This editor has been destroyed.",
      );
  }
  private editable(): void {
    this.alive();
    if (this.options.readOnly)
      throw new FlowError("READ_ONLY", "This editor is read-only.");
  }
  private checkSize(width: number, height: number): void {
    if (![width, height].every((value) => Number.isFinite(value) && value > 0))
      throw new FlowError(
        "INVALID_SIZE",
        "Dimensions must be positive finite numbers.",
      );
  }
}
