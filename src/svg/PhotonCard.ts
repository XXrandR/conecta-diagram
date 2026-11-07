import {
  actionPresentation,
  capabilityState,
  formatCondition,
} from "../core/actions";
import type { FlowDocument, FlowNode } from "../core/types";
import type { ExecutionOverlay, NodeExecution } from "../core/runner-display";
import { nodeDimensions } from "../core/node-presentation";
import { createFlowIcon, operationIcon } from "./icons";

/** Template-native HTML card inside SVG. No HTML strings, callbacks or execution. */
export function renderPhotonCard(
  document: Document,
  node: FlowNode,
  flow: FlowDocument,
  observation: NodeExecution | undefined,
  overlay: ExecutionOverlay | null,
  selected: boolean,
  capabilities: readonly string[] | undefined,
): SVGForeignObjectElement {
  const size = nodeDimensions(node);
  const object = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "foreignObject",
  );
  object.setAttribute("x", String(-size.width / 2 - 4));
  object.setAttribute("y", String(-size.height / 2 - 4));
  object.setAttribute("width", String(size.width + 8));
  object.setAttribute("height", String(size.height + 8));
  object.setAttribute("overflow", "visible");
  const el = (
    tag: string,
    text: string,
    parent: Element,
    className: string,
  ) => {
    const element = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElement;
    element.textContent = text;
    element.className = className;
    parent.append(element);
    return element;
  };
  const action = "action" in node ? node.action : undefined;
  const presentation = action ? actionPresentation(action) : undefined;
  const state = observation?.status ?? "idle";
  const article = el(
    "article",
    "",
    object,
    `flow-node flow-node--embedded${selected ? " selected" : ""}`,
  );
  article.dataset.kind =
    action?.body.kind === "api" ? "service" : (action?.body.kind ?? node.type);
  article.dataset.state = state;
  const header = el("header", "", article, "node-header");
  el("div", "", header, "node-icon").append(
    createFlowIcon(document, operationIcon(action?.body.kind ?? node.type), 18),
  );
  const labels = el("div", "", header, "");
  const title = el("div", node.label, labels, "node-title");
  title.title = node.label;
  el(
    "div",
    presentation?.title ??
      (node.type === "decision"
        ? "Conditional · Decision"
        : node.type === "wait"
          ? "External response · Wait"
          : `${node.type} · Plan`),
    labels,
    "node-subtitle",
  );
  const signals = el("div", "", article, "signals");
  const observations =
    overlay?.signals?.filter((signal) => signal.nodeId === node.id) ?? [];
  const inputs =
    node.signals?.inputs ?? (node.type === "wait" ? [node.signal] : []);
  const outputs = node.signals?.outputs ?? [];
  for (const [direction, names] of [
    ["in", inputs],
    ["out", outputs],
  ] as const) {
    for (const name of names.length ? names : ["—"]) {
      const observed = observations.some(
        (signal) => signal.name === name && signal.direction === direction,
      );
      const chip = el("span", "", signals, "signal");
      chip.dataset.field = `signals-${direction}`;
      chip.dataset.observed = String(observed);
      chip.title = `${direction === "in" ? "Input" : "Output"}: ${name}${observed ? " · observed" : ""}`;
      chip.append(createFlowIcon(document, observed ? "check" : direction, 12));
      el("span", name, chip, "");
    }
  }
  let label = "Handler",
    preview: string = node.type;
  if (action) {
    const body = action.body;
    switch (body.kind) {
      case "process":
        label = "Profile";
        preview = body.profile;
        break;
      case "api":
        label = "Endpoint";
        preview = `${body.method} ${presentation!.lines[0]}`;
        break;
      case "database":
        label = "Datasource";
        preview = body.datasource;
        break;
      case "file":
        label = "Path";
        preview = body.path;
        break;
      case "ssh":
      case "sftp":
      case "mail":
      case "messaging":
        label = "Connection";
        preview = body.connectionId;
        break;
      case "event":
        label = "Topic";
        preview = body.topic;
        break;
      case "cancel":
        label = "Target";
        preview = body.targetCommandId;
        break;
      case "generic":
        label = "Extension";
        preview = body.name;
        break;
    }
  } else if (node.type === "wait") {
    label = "Signal";
    preview = node.signal;
  } else if (node.type === "decision") {
    label = "Condition";
    const branch = flow.edges.find(
      (edge) => edge.source === node.id && edge.condition,
    );
    preview = branch?.condition
      ? formatCondition(branch.condition)
      : "Not configured";
  } else if (node.type === "task") preview = node.handler ?? "Not configured";
  const row = el("div", "", article, "action-preview");
  el("span", label, row, "preview-label");
  const value = el("code", preview, row, "preview-value");
  value.title = preview;
  value.dataset.field = "action-preview";
  el("div", "", article, "node-divider");
  const footer = el("div", "", article, "node-footer");
  const execution = el("span", "", footer, "execution");
  el("span", "", execution, "status-dot");
  const choice =
    overlay?.decisions && Object.hasOwn(overlay.decisions, node.id)
      ? overlay.decisions[node.id]
      : undefined;
  const edge = choice
    ? flow.edges.find((edge) => edge.id === choice.edgeId)
    : undefined;
  const status = choice
    ? `Selected: ${edge?.label ?? choice.edgeId}`
    : state
        .replaceAll("_", " ")
        .replace(/^./, (letter) => letter.toUpperCase());
  const statusText = el("span", status, execution, "");
  statusText.dataset.field = "execution-status";
  const progress = observation?.progress;
  const detail =
    action && capabilityState(action.type, capabilities) === "unsupported"
      ? "Not advertised / unsupported by runner"
      : (choice?.reason ??
        (progress
          ? `${progress.current}${progress.total ? ` / ${progress.total}` : ""} ${progress.unit}`
          : (observation?.detail ?? "Display only")));
  execution.title = detail;
  const accessible = el("span", detail, execution, "execution-detail");
  accessible.dataset.field = "execution-detail";
  const type = el("code", action?.type ?? node.type, footer, "action-type");
  type.title = type.textContent ?? "";
  type.dataset.field = "action-type";
  return object;
}
