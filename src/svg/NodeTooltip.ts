import {
  actionPresentation,
  capabilityState,
  formatCondition,
} from "../core/actions";
import type { FlowDocument, FlowNode } from "../core/types";
import type { NodeExecution } from "../core/runner-display";
import { createFlowIcon, operationIcon } from "./icons";

/** An instance-owned, CSS-pixel tooltip. No portals/framework or HTML injection. */
export class NodeTooltip {
  readonly element: HTMLDivElement;
  private target: Element | null = null;

  constructor(
    private readonly document: Document,
    id: string,
  ) {
    this.element = document.createElement("div");
    this.element.id = id;
    this.element.setAttribute("role", "tooltip");
    this.element.hidden = true;
    this.element.style.cssText =
      "position:fixed;z-index:10000;pointer-events:none;width:312px;max-width:calc(100vw - 24px);padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);box-shadow:var(--shadow-card-hover);font:12px/1.6 var(--font-sans)";
    (document.body ?? document.documentElement).append(this.element);
  }
  show(
    node: FlowNode,
    flow: FlowDocument,
    observation: NodeExecution | undefined,
    capabilities: readonly string[] | undefined,
    target: Element,
    anchor: { x: number; y: number },
  ): void {
    this.hide();
    this.target = target;
    this.element.replaceChildren();
    const action = "action" in node ? node.action : undefined;
    const preview = action ? actionPresentation(action) : undefined;
    const heading = this.document.createElement("div");
    heading.style.cssText =
      "display:flex;align-items:center;gap:9px;font-weight:600;color:var(--text);margin-bottom:8px";
    heading.append(
      createFlowIcon(
        this.document,
        operationIcon(action?.body.kind ?? node.type),
        18,
      ),
    );
    const title = this.document.createElement("span");
    title.textContent = node.label;
    heading.append(title);
    this.element.append(heading);
    const meta = this.document.createElement("div");
    meta.style.cssText =
      "color:var(--accent);font:11px var(--font-mono);margin-bottom:10px";
    meta.textContent = action
      ? `${action.type} · ${capabilityState(action.type, capabilities)}`
      : node.type === "decision"
        ? "Decision · observed routing"
        : node.type === "wait"
          ? `Waiting for ${node.signal}`
          : node.type;
    this.element.append(meta);
    const code =
      node.type === "decision" ? node.decision?.expression : preview?.code;
    const content = this.document.createElement("pre");
    content.style.cssText =
      "margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.65 var(--font-mono);color:var(--text-secondary)";
    const lines =
      code?.source.split(/\r?\n/) ??
      preview?.lines ??
      (node.type === "decision"
        ? flow.edges
            .filter((edge) => edge.source === node.id)
            .map(
              (edge) =>
                `${edge.label ?? edge.target}: ${edge.default ? "otherwise" : edge.condition ? formatCondition(edge.condition) : "unconfigured"}`,
            )
        : []);
    content.textContent =
      (code ? `${code.language}\n` : "") +
      lines.slice(0, 5).join("\n").slice(0, 480) +
      (lines.length > 5 ? "\n…" : "");
    this.element.append(content);
    if (observation?.detail) {
      const detail = this.document.createElement("p");
      detail.style.cssText = "margin:10px 0 0;color:var(--text-secondary)";
      detail.textContent = observation.detail.slice(0, 160);
      this.element.append(detail);
    }
    const hint = this.document.createElement("div");
    hint.style.cssText =
      "margin-top:12px;padding-top:10px;border-top:1px solid var(--border);color:var(--text-muted);font-size:10px;letter-spacing:.04em";
    hint.textContent = "SELECT TO ASSEMBLE · DISPLAY ONLY";
    this.element.append(hint);
    target.setAttribute("aria-describedby", this.element.id);
    this.element.hidden = false;
    const bounds = this.element.getBoundingClientRect();
    const viewport = this.document.defaultView;
    const width = viewport?.innerWidth ?? 1024,
      height = viewport?.innerHeight ?? 768;
    this.element.style.left = `${Math.max(12, Math.min(anchor.x + 16, width - bounds.width - 12))}px`;
    this.element.style.top = `${Math.max(12, Math.min(anchor.y + 14, height - bounds.height - 12))}px`;
  }
  hide(): void {
    this.target?.removeAttribute("aria-describedby");
    this.target = null;
    this.element.hidden = true;
  }
  destroy(): void {
    this.hide();
    this.element.remove();
  }
}
