import { createFlowIcon } from "../../dist/index.js";

export function el(tag, text = "", parent, className = "") {
  const element = document.createElement(tag);
  element.textContent = String(text);
  if (className) element.className = className;
  parent?.append(element);
  return element;
}
export function icon(name, size = 18) {
  return createFlowIcon(document, name, size);
}
export function iconButton(label, name, callback, className = "icon-button") {
  const button = el("button", "", null, className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(name));
  button.addEventListener("click", callback);
  return button;
}
export function badge(status, label = status) {
  const span = el(
    "span",
    String(label).replaceAll("_", " "),
    null,
    `badge status-${String(status)
      .toLowerCase()
      .replace(/[^a-z_]/g, "")}`,
  );
  const dot = el("span", "", null, "status-dot");
  dot.setAttribute("aria-hidden", "true");
  span.prepend(dot);
  return span;
}
export function section(parent, title, subtitle) {
  const section = el("section", "", parent, "detail-section");
  const heading = el("div", "", section, "section-heading");
  el("h3", title, heading);
  if (subtitle) el("span", subtitle, heading, "section-meta");
  return section;
}
export function fields(parent, entries) {
  const list = el("dl", "", parent, "key-values");
  for (const [label, value] of entries) {
    if (value === undefined || value === null || value === "") continue;
    el("dt", label, list);
    const cell = el(
      "dd",
      typeof value === "boolean" ? (value ? "Yes" : "No") : value,
      list,
    );
    cell.title = cell.textContent;
  }
  return list;
}
export async function copyText(text, report) {
  try {
    await navigator.clipboard.writeText(text);
    report?.("Copied to clipboard.");
  } catch {
    report?.(
      "Clipboard is unavailable. Select and copy the displayed text instead.",
    );
  }
}
export function downloadJson(value, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = el("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function codeBlock(parent, language, source, report) {
  const frame = el("div", "", parent, "code-frame");
  const heading = el("div", "", frame, "code-heading");
  heading.append(icon("code", 14));
  el("span", language, heading);
  el("span", "PREVIEW", heading, "micro-label");
  heading.append(
    iconButton("Copy source preview", "copy", () => copyText(source, report)),
  );
  const list = el("ol", "", frame, "code-lines");
  for (const line of source.split(/\r?\n/)) {
    const cell = el("code", "", el("li", "", list));
    const tokens =
      /(#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|return|if|else|True|False|None|SELECT|FROM|WHERE|ORDER|BY|DESC|AND|OR|IN|print|import|as|for|in|class|raise)\b|\b\d+(?:\.\d+)?\b)/g;
    let offset = 0;
    for (const match of line.matchAll(tokens)) {
      cell.append(document.createTextNode(line.slice(offset, match.index)));
      const token = match[0];
      el(
        "span",
        token,
        cell,
        token.startsWith("#") || token.startsWith("--")
          ? "token-comment"
          : /^["']/.test(token)
            ? "token-string"
            : /^\d/.test(token)
              ? "token-number"
              : "token-keyword",
      );
      offset = match.index + token.length;
    }
    cell.append(
      document.createTextNode(line.slice(offset) || (line.length ? "" : " ")),
    );
  }
  return frame;
}
export function emptyState(parent, title, description, name = "info") {
  const state = el("div", "", parent, "empty-state");
  state.append(icon(name, 28));
  el("h3", title, state);
  el("p", description, state);
  return state;
}
export function counter(value) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return String(value ?? "—");
  }
}
export function percentage(progress) {
  try {
    if (!progress?.total || BigInt(progress.total) <= 0n) return null;
    return Math.max(
      0,
      Math.min(
        100,
        Number((BigInt(progress.current) * 100n) / BigInt(progress.total)),
      ),
    );
  } catch {
    return null;
  }
}
export function progressBlock(parent, progress) {
  const block = el("div", "", parent, "progress-block");
  const heading = el("div", "", block, "progress-heading");
  el(
    "span",
    `${counter(progress.current)}${progress.total ? ` / ${counter(progress.total)}` : ""} ${progress.unit}`,
    heading,
  );
  const percent = percentage(progress);
  if (percent !== null) el("strong", `${percent}%`, heading);
  if (percent !== null) {
    const track = el("div", "", block, "progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `Observed ${progress.unit}`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(percent));
    const fill = el("span", "", track);
    fill.style.width = `${percent}%`;
  }
  return block;
}
