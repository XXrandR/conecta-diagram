// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalFlow } from "../examples/approval";
import {
  FlowSimulator,
  FlowStore,
  SvgFlowEditor,
  RunnerDisplay,
} from "../src/index";
import { timerFlush } from "d3-timer";

const editors: SvgFlowEditor[] = [];
function mount(options: ConstructorParameters<typeof SvgFlowEditor>[2] = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.append(svg);
  const store = new FlowStore(approvalFlow);
  const editor = new SvgFlowEditor(svg, store, {
    animationDuration: 0,
    force: false,
    ...options,
  });
  editors.push(editor);
  return { svg, store, editor };
}
const node = (svg: SVGSVGElement, id = "start") =>
  [...svg.querySelectorAll<SVGGElement>("[data-node-id]")].find(
    (element) => element.getAttribute("data-node-id") === id,
  )!;
function pointer(target: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("SVG adapter", () => {
  it("renders model data with isolated ids and safe text, including unusual node ids", () => {
    const { svg, store } = mount();
    store.updateNode("start", (item) => ({
      ...item,
      label: "<script>alert(1)</script>",
    }));
    store.addNode({
      id: 'a #.["x"]',
      type: "task",
      label: "unusual",
      position: { x: 0, y: 0 },
    });
    expect(svg.querySelectorAll("[data-node-id]")).toHaveLength(10);
    expect(svg.querySelector("script")).toBeNull();
    expect(node(svg).textContent).toContain("<script>");
    const other = mount();
    expect(svg.querySelector("marker")!.id).not.toBe(
      other.svg.querySelector("marker")!.id,
    );
  });
  it("supports selection, keyboard movement, undo, deletion and connection creation", () => {
    const onSelect = vi.fn();
    const { svg, store, editor } = mount({
      onSelect,
      createEdgeId: () => "new-edge",
    });
    node(svg).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getSelection()).toEqual({ type: "node", id: "start" });
    node(svg).focus();
    node(svg).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect(store.getSnapshot().nodes[0]!.position.x).toBe(80);
    expect(editor.getNodePositions().get("start")!.x).toBe(90);
    expect(document.activeElement).toBe(node(svg));
    node(svg).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "z", ctrlKey: true }),
    );
    expect(store.getSnapshot().nodes[0]!.position.x).toBe(80);
    editor.beginConnection("start");
    node(svg, "audit").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(
      store.getSnapshot().edges.find((edge) => edge.id === "new-edge"),
    ).toEqual({ id: "new-edge", source: "start", target: "audit" });
    node(svg).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    expect(editor.getSelection()).toBeNull();
    expect(store.getSnapshot().nodes.some((item) => item.id === "start")).toBe(
      false,
    );
    expect(onSelect).toHaveBeenCalled();
  });
  it("moves nodes only in the view and cancels drag previews", () => {
    const { svg, store, editor } = mount();
    const listener = vi.fn();
    store.subscribe(listener);
    pointer(node(svg), "pointerdown", 80, 180);
    pointer(window, "pointermove", 100, 200);
    pointer(window, "pointermove", 120, 210);
    expect(store.getRevision()).toBe(0);
    pointer(window, "pointerup", 120, 210);
    expect(editor.getNodePositions().get("start")).toEqual({ x: 120, y: 210 });
    expect(listener).not.toHaveBeenCalled();
    editor.resetPlacement();
    expect(store.getSnapshot().nodes[0]!.position).toEqual({ x: 80, y: 180 });
    pointer(node(svg), "pointerdown", 80, 180);
    pointer(window, "pointermove", 100, 200);
    window.dispatchEvent(new Event("pointercancel"));
    pointer(window, "pointerup", 100, 200);
    expect(store.getSnapshot().nodes[0]!.position).toEqual({ x: 80, y: 180 });
  });
  it("does not edit read-only diagrams but allows viewport changes", () => {
    const { svg, store, editor } = mount({ readOnly: true });
    editor.select({ type: "node", id: "start" });
    node(svg).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    pointer(node(svg), "pointerdown", 80, 180);
    pointer(window, "pointermove", 180, 280);
    pointer(window, "pointerup", 180, 280);
    expect(store.getRevision()).toBe(0);
    expect(() => editor.beginConnection("start")).toThrow("read-only");
    editor.zoomBy(2);
    expect(editor.getViewport().scale).toBe(2);
  });
  it("projects visibility and simulation state without modifying the document", () => {
    const { svg, store, editor } = mount();
    store.updateNode("audit", (item) => ({
      ...item,
      visibleWhen: { op: "eq", path: ["showAudit"], value: true },
    }));
    expect(svg.querySelectorAll("[data-node-id]")).toHaveLength(8);
    editor.setContext({ showAudit: true });
    expect(svg.querySelectorAll("[data-node-id]")).toHaveLength(9);
    const simulator = new FlowSimulator(store.getSnapshot());
    editor.setExecution(simulator.run().snapshot);
    expect(node(svg, "process").getAttribute("data-state")).toBe("waiting");
    expect(node(svg, "audit").getAttribute("data-state")).toBe("completed");
    expect(store.getRevision()).toBe(1);
    editor.setExecution(null);
    expect(node(svg, "process").getAttribute("data-state")).toBe("idle");
  });
  it("fits, resizes, clamps zoom and exports an isolated SVG", () => {
    const { svg, editor } = mount();
    editor.resize(800, 400);
    editor.fitToView();
    expect(editor.getViewport().scale).toBeGreaterThan(0);
    editor.zoomBy(100);
    expect(editor.getViewport().scale).toBe(4);
    expect(editor.exportSvg()).toContain('viewBox="0 0 800 400"');
    expect(editor.exportSvg()).toContain("Process order");
    expect(() => editor.resize(-1, 10)).toThrow();
    expect(() => editor.zoomBy(0)).toThrow();
    expect(svg.querySelector('[data-layer="edges"]')).not.toBeNull();
  });
  it("cleans up subscriptions/listeners and preserves host and sibling SVG content", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const host = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "title",
    );
    host.textContent = "Host content";
    svg.append(host);
    document.body.append(svg);
    const store = new FlowStore(approvalFlow);
    const first = new SvgFlowEditor(svg, store);
    editors.push(first);
    const sibling = new SvgFlowEditor(svg, store);
    editors.push(sibling);
    first.destroy();
    first.destroy();
    expect(svg.querySelectorAll("[data-flow-root]")).toHaveLength(1);
    expect(svg.contains(host)).toBe(true);
    store.updateNode("start", (item) => ({ ...item, label: "new" }));
    expect(node(svg).textContent).toContain("new");
    expect(() => first.select(null)).toThrow("destroyed");
    sibling.destroy();
    expect(svg.childNodes).toHaveLength(1);
    store.addNode({
      id: "later",
      type: "task",
      label: "later",
      position: { x: 0, y: 0 },
    });
    expect(svg.childNodes).toHaveLength(1);
  });
  it("reports interaction errors without corrupting the document", () => {
    const onError = vi.fn();
    const { svg, editor, store } = mount({
      createEdgeId: () => "start-fork",
      onError,
    });
    editor.beginConnection("start");
    node(svg, "audit").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.getRevision()).toBe(0);
  });
  it("retains node and edge group identity during D3 joins and physics ticks", () => {
    const { svg, store, editor } = mount();
    const start = node(svg);
    const edge = svg.querySelector("[data-edge-id]");
    start.focus();
    editor.select({ type: "node", id: "start" });
    editor.setExecution(new FlowSimulator(store.getSnapshot()).run().snapshot);
    editor.settlePlacement(20);
    expect(node(svg)).toBe(start);
    expect(svg.querySelector("[data-edge-id]")).toBe(edge);
    expect(document.activeElement).toBe(start);
  });
  it("keeps placement ephemeral without saving controls or history", () => {
    const { store, editor } = mount();
    const before = store.getSnapshot();
    editor.settlePlacement(100);
    expect(editor.getNodePositions().get("start")).not.toEqual(
      before.nodes[0]!.position,
    );
    expect(store.getSnapshot()).toBe(before);
    editor.moveNodeView("start", { x: 200, y: 300 });
    expect(store.getRevision()).toBe(0);
    expect(store.getSnapshot()).toBe(before);
    editor.resetPlacement();
    expect(editor.getNodePositions().get("start")).toEqual(
      before.nodes[0]!.position,
    );
  });
  it("respects reduced motion while allowing explicit static force settling", () => {
    const { svg, editor, store } = mount({
      motion: "reduced",
      animationDuration: 500,
      force: { fixedNodeIds: ["start"] },
    });
    const before = store.getSnapshot();
    const after = editor.getNodePositions();
    timerFlush();
    expect(editor.getNodePositions()).toEqual(after);
    expect(after.get("start")).toEqual(before.nodes[0]!.position);
    editor.animateViewport({ x: 100, y: 50, scale: 2 });
    expect(editor.getViewport()).toEqual({ x: 100, y: 50, scale: 2 });
    expect(node(svg)).not.toBeNull();
    expect(store.getRevision()).toBe(0);
  });
  it("animates authored movement and viewport changes to their final positions", async () => {
    const { editor, store, svg } = mount({
      motion: "full",
      animationDuration: 20,
    });
    store.moveNode("start", { x: 180, y: 180 });
    editor.animateViewport({ x: 20, y: 30, scale: 2 }, 20);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editor.getNodePositions().get("start")).toEqual({ x: 180, y: 180 });
    expect(node(svg).getAttribute("transform")).toBe("translate(180 180)");
    expect(editor.getViewport()).toEqual({ x: 20, y: 30, scale: 2 });
  });
  it("preserves edge identity and branch metadata when reconnecting an endpoint", () => {
    const { svg, store, editor } = mount();
    const original = store
      .getSnapshot()
      .edges.find((edge) => edge.id === "approved")!;
    editor.beginReconnection("approved", "target");
    node(svg, "rejected").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(
      store.getSnapshot().edges.find((edge) => edge.id === "approved"),
    ).toEqual({ ...original, target: "rejected" });
    expect(store.getRevision()).toBe(1);
    store.undo();
    expect(
      store.getSnapshot().edges.find((edge) => edge.id === "approved"),
    ).toEqual(original);
    editor.beginReconnection("approved", "source");
    editor.cancelConnection();
    expect(store.getRevision()).toBe(2);
  });
  it("allows arranging a read-only view but not rewiring the plan", () => {
    const { editor, store } = mount({ readOnly: true, motion: "reduced" });
    editor.relax();
    expect(editor.getNodePositions().size).toBe(9);
    editor.moveNodeView("start", { x: 200, y: 300 });
    expect(editor.getNodePositions().get("start")).toEqual({ x: 200, y: 300 });
    expect(() => editor.beginReconnection("approved")).toThrow("read-only");
    expect(store.getRevision()).toBe(0);
  });
  it("removes active force and transition timers on destroy", () => {
    const { editor, store, svg } = mount({
      force: true,
      motion: "full",
      animationDuration: 500,
    });
    editor.animateViewport({ x: 200, y: 300, scale: 2 });
    editor.destroy();
    const viewport = editor.getViewport();
    timerFlush();
    expect(editor.getViewport()).toEqual(viewport);
    expect(store.getRevision()).toBe(0);
    expect(svg.querySelector("[data-flow-root]")).toBeNull();
  });
  it("starts native placement without a button and never writes physics coordinates", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.append(svg);
    const store = new FlowStore(approvalFlow);
    const editor = new SvgFlowEditor(svg, store, { motion: "reduced" });
    editors.push(editor);
    expect(editor.getNodePositions().get("start")).not.toEqual(
      store.getSnapshot().nodes[0]!.position,
    );
    editor.moveNodeView("start", { x: 300, y: 300 });
    expect(editor.getNodePositions().get("start")).toEqual({ x: 300, y: 300 });
    expect(store.getRevision()).toBe(0);
    expect(store.canUndo).toBe(false);
  });
  it("shows action/code previews, signals and streamed results as text without execution", () => {
    const { svg, store, editor } = mount({ capabilities: ["process.exec"] });
    store.updateNode("process", (current) => ({
      ...current,
      action: {
        type: "process.exec",
        body: {
          kind: "process",
          profile: "python-profile",
          code: {
            language: "python",
            source:
              "print('preview')\n<script>globalThis.executed=true</script>",
          },
        },
      },
      signals: { inputs: ["report.ready"], outputs: ["report.complete"] },
    }));
    const display = new RunnerDisplay(store.getSnapshot());
    display.track("command-1", "process");
    display.applyResult({
      commandId: "command-1",
      status: "STREAMING",
      sequence: "9007199254740993",
      success: false,
      final: false,
      progress: { current: "100", total: "200", unit: "rows" },
    });
    display.observeSignal({
      id: "signal-1",
      nodeId: "process",
      direction: "in",
      name: "report.ready",
    });
    editor.setExecution(display.getOverlay());
    expect(node(svg, "process").textContent).toContain("process.exec");
    expect(node(svg, "process").textContent).toContain("100 / 200 rows");
    expect(node(svg, "process").getAttribute("data-state")).toBe("streaming");
    expect(
      node(svg, "process")
        .querySelector('[data-field="signals-in"]')!
        .getAttribute("data-observed"),
    ).toBe("true");
    expect(
      node(svg, "process").querySelector('svg[data-icon="check"]'),
    ).not.toBeNull();
    expect(svg.querySelector("script")).toBeNull();
    editor.setCapabilities([]);
    expect(node(svg, "process").textContent).toContain("unsupported");
  });
  it("shows observed decision choices rather than evaluating code in the viewer", () => {
    const { svg, store, editor } = mount();
    store.updateNode("decision", (current) => ({
      ...current,
      decision: {
        expression: {
          language: "python",
          source: "raise RuntimeError('display only')",
        },
      },
    }));
    const display = new RunnerDisplay(store.getSnapshot());
    display.observeDecision({
      id: "observed",
      nodeId: "decision",
      edgeId: "approved",
      reason: "External decision chose yes",
    });
    editor.setExecution(display.getOverlay());
    expect(node(svg, "decision").textContent).toContain("Selected: Yes");
    expect(
      svg
        .querySelector('[data-edge-id="approved"]')!
        .getAttribute("data-state"),
    ).toBe("taken");
    expect(
      svg.querySelector('[data-edge-id="denied"]')!.getAttribute("data-state"),
    ).toBe("skipped");
  });
  it("shows safe hover/focus tool details and dismisses them on Escape or destruction", () => {
    const { svg, store, editor } = mount();
    store.updateNode("process", (current) => ({
      ...current,
      action: {
        type: "process.exec",
        body: {
          kind: "process",
          profile: "python",
          code: {
            language: "python",
            source: "print('<script>not executed</script>')",
          },
        },
      },
    }));
    node(svg, "process").focus();
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("python");
    expect(tooltip.textContent).toContain("<script>not executed</script>");
    expect(tooltip.querySelector("script")).toBeNull();
    expect(node(svg, "process").getAttribute("aria-describedby")).toBe(
      tooltip.id,
    );
    node(svg, "process").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(tooltip.hidden).toBe(true);
    node(svg, "process").dispatchEvent(
      new MouseEvent("pointerover", {
        bubbles: true,
        clientX: 50,
        clientY: 50,
      }),
    );
    expect(tooltip.hidden).toBe(true); // DOM/state updates must not undo an explicit Escape dismissal.
    editor.destroy();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
  it("renders precise local SVG operation icons and supports disabling hover previews", () => {
    const { svg, store } = mount({ tooltips: false });
    store.updateNode("process", (current) => ({
      ...current,
      action: {
        type: "database.query",
        body: {
          kind: "database",
          databaseType: "postgresql",
          datasource: "orders",
          operation: "QUERY",
          statement: "SELECT 1",
        },
      },
    }));
    expect(
      node(svg, "process")
        .querySelector('svg[data-icon="database"]')!
        .getAttribute("viewBox"),
    ).toBe("0 0 24 24");
    expect(svg.querySelector("image")).toBeNull();
    node(svg, "process").focus();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
