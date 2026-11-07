/** Small, framework-independent line icons. No external fonts, images or HTML. */
export const iconPaths = {
  workflow: ["M4 4h6v6H4zM14 14h6v6h-6zM7 10v7h7M10 7h7v7"],
  code: ["m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"],
  api: [
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 4 4 14 0 18-4-4-4-14 0-18Z",
  ],
  database: [
    "M20 6c0 2-16 2-16 0s16-2 16 0ZM4 6v12c0 3 16 3 16 0V6M4 12c0 3 16 3 16 0",
  ],
  file: ["M13 3H6a1 1 0 0 0-1 1v16h14V9l-6-6Zm0 0v6h6M9 13h6m-6 4h4"],
  transfer: ["M4 4h9l4 4v3M13 4v4h4M4 4v16h6m3-4 3-3 3 3m-3-3v8m-3-12H8m2 4H8"],
  terminal: ["M3 5h18v14H3zM7 9l3 3-3 3m6 0h4"],
  sftp: ["M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"],
  mail: ["M3 5h18v14H3zM3 6l9 7 9-7"],
  messaging: ["M3 4h14v11H9l-4 4v-4H3zM17 8h4v12h-4l-3 3v-4"],
  event: ["m13 2-8 12h6l-1 8 9-13h-7l1-7Z"],
  decision: ["m12 3 9 9-9 9-9-9 9-9ZM9 9h3v6m0-3h4"],
  wait: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2"],
  cancel: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 8l8 8m0-8-8 8"],
  extension: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6m-3-3h6"],
  play: ["m9 5 10 7-10 7V5Z"],
  stop: ["M7 7h10v10H7z"],
  pause: ["M8 5v14m8-14v14"],
  next: ["m5 5 10 7-10 7V5Zm14 0v14"],
  reset: ["M4 10a8 8 0 1 1 1 7M4 4v6h6"],
  check: ["m5 12 4 4L19 6"],
  error: ["M12 3 2 21h20L12 3Zm0 6v5m0 3v.2"],
  in: ["M3 12h14m-5-5 5 5-5 5m6-14h3v18h-3"],
  out: ["M3 12h14m-5-5 5 5-5 5M6 3H3v18h3"],
  fork: ["M12 20v-8M6 4v5l6 3 6-3V4M4 4h4m8 0h4"],
  join: ["M6 4v5l6 5 6-5V4m-6 10v6m-3-3 3 3 3-3"],
  fit: ["M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M8 8h8v8H8z"],
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  chevron: ["m9 5 7 7-7 7"],
  search: ["M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 6 6"],
  download: ["M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"],
  copy: ["M8 8h12v13H8zM15 8V3H3v13h5"],
  locate: ["M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"],
  undo: ["m7 4-4 5 4 5M3 9h10a7 7 0 0 1 7 7v4"],
  redo: ["m17 4 4 5-4 5m4-5H11a7 7 0 0 0-7 7v4"],
  more: ["M5 11v2m7-2v2m7-2v2"],
  info: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v.1"],
} as const;
export type FlowIconName = keyof typeof iconPaths;

export function createFlowIcon(
  document: Document,
  name: FlowIconName,
  size = 20,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.65",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    "data-icon": name,
  }))
    svg.setAttribute(key, value);
  for (const d of Object.hasOwn(iconPaths, name)
    ? iconPaths[name]
    : iconPaths.extension) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function operationIcon(kind: string): FlowIconName {
  const icons: Record<string, FlowIconName> = {
    process: "code",
    api: "api",
    database: "database",
    file: "transfer",
    ssh: "terminal",
    sftp: "sftp",
    mail: "mail",
    messaging: "messaging",
    event: "event",
    cancel: "cancel",
    generic: "extension",
    task: "terminal",
    decision: "decision",
    wait: "wait",
    fork: "fork",
    join: "join",
    start: "play",
    end: "stop",
  };
  return Object.hasOwn(icons, kind) ? icons[kind]! : "extension";
}
