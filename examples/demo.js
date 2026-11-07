import {
  FlowStore,
  SvgFlowEditor,
  RunnerDisplay,
  PerformanceTimeline,
  validateFlow,
  parseFlow,
  serializeFlow,
  actionPresentation,
} from "../dist/index.js";
import { plan, presets, capabilities, mockEvents } from "./showcase.js";
import { ExecutionJournal } from "./ui/journal.js";
import { DevToolsManager } from "./devtools/manager.js";
import { initializeTheme, applyTheme } from "./devtools/theme.js";
import { performanceFixtures } from "./performance-fixtures.js";

const $ = (id) => document.getElementById(id);
let initial = plan;
try {
  const saved = localStorage.getItem("wf-document");
  if (saved) initial = parseFlow(saved);
} catch {
  /* Invalid drafts never replace the validated sample. */
}
const store = new FlowStore(initial);
let projection = new RunnerDisplay(store.getSnapshot());
const performance = new PerformanceTimeline();
let events = [],
  cursor = 0,
  playback = null,
  playbackState = "Ready",
  scenario = "approve",
  speed = 600;
let hostNodes = {},
  hostEdges = {},
  runNumber = 0,
  journal,
  devtools = null,
  version = 0,
  cached = null,
  revealSelection = true;
const listeners = new Set();
const report = (message) => {
  $("status").textContent = message;
  $("status").title = message;
};
const showError = (error) =>
  report(
    error.diagnostics
      ?.map((issue) => `${issue.code}: ${issue.message}`)
      .join("\n") ||
      error.message ||
      String(error),
  );
const editor = new SvgFlowEditor($("canvas"), store, {
  width: 1320,
  height: 820,
  capabilities,
  onSelect: () => {
    if (revealSelection && devtools) {
      devtools.state.tab = "assemble";
      if (!devtools.state.open) devtools.open();
      devtools.shell?.selectTab("assemble", false);
    }
    renderGlobals();
    publish();
  },
  onError: showError,
});

function compatible() {
  return (
    [
      "python",
      "api",
      "database",
      "file",
      "wait",
      "decision",
      "mail",
      "yes",
      "no",
    ].every((id) => store.getSnapshot().nodes.some((node) => node.id === id)) &&
    ["approved", "declined"].every((id) =>
      store
        .getSnapshot()
        .edges.some((edge) => edge.id === id && edge.source === "decision"),
    )
  );
}
function overlay() {
  const observed = projection.getOverlay();
  return {
    ...observed,
    nodes: { ...hostNodes, ...observed.nodes },
    edges: { ...hostEdges, ...observed.edges },
  };
}
function snapshot() {
  return {
    version,
    document: store.getSnapshot(),
    revision: store.getRevision(),
    selection: editor.getSelection(),
    overlay: overlay(),
    theme: document.documentElement.dataset.theme,
    journal: {
      runId: journal?.runId ?? "demo-run-0000",
      entries: journal?.entries ?? [],
    },
    performance: performance.getSnapshot(),
    performanceSource: "Simulated backend metric fixtures",
    playback: {
      state: playbackState,
      scenario,
      speed,
      cursor,
      total: events.length,
      compatible: compatible(),
    },
    devtools: devtools
      ? { ...devtools.state }
      : { tab: "assemble", dock: "bottom", open: true },
  };
}
function publish() {
  version++;
  cached = snapshot();
  for (const listener of [...listeners]) {
    try {
      listener(cached);
    } catch (error) {
      showError(error);
    }
  }
}
function renderGlobals() {
  const root = $("global-variables");
  root.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = "Global variables";
  root.append(label);
  for (const variable of store.getSnapshot().globals ?? []) {
    const chip = document.createElement("button");
    chip.className = "signal variable-chip";
    chip.type = "button";
    chip.dataset.globalId = variable.id;
    chip.dataset.variableType = variable.type;
    chip.setAttribute(
      "aria-pressed",
      String(
        editor.getSelection()?.type === "global" &&
          editor.getSelection().id === variable.id,
      ),
    );
    for (const [className, text] of [
      ["variable-name", variable.name],
      ["variable-type", variable.type.toUpperCase()],
      ["variable-value", JSON.stringify(variable.value)],
    ]) {
      const item = document.createElement("span");
      item.className = className;
      item.textContent = text;
      item.title = text;
      chip.append(item);
    }
    chip.addEventListener("click", () =>
      editor.select({ type: "global", id: variable.id }),
    );
    root.append(chip);
  }
  const add = document.createElement("button");
  add.textContent = "Manage variables";
  add.addEventListener("click", () => {
    editor.select(null);
    devtools.open();
    devtools.setTab("assemble");
  });
  root.append(add);
}
function renderObservations() {
  editor.setExecution(overlay());
  publish();
}

// Existing tracer handlers retained. DevTools commands call these exact functions;
// neither the shell nor the detached window owns another timer, reducer or replay.
function pause() {
  clearTimeout(playback);
  playback = null;
  playbackState =
    cursor === events.length && events.length
      ? "Complete"
      : cursor
        ? "Paused"
        : "Ready";
  publish();
}
function reset() {
  pause();
  projection = new RunnerDisplay(store.getSnapshot());
  events = mockEvents(scenario);
  cursor = 0;
  hostNodes = { start: { status: "completed" } };
  hostEdges = {};
  journal = new ExecutionJournal(
    `demo-run-${String(++runNumber).padStart(4, "0")}`,
  );
  performance.clear();
  playbackState = "Ready";
  $("node-count").textContent = `${store.getSnapshot().nodes.length} nodes`;
  renderObservations();
  report(
    compatible()
      ? "Ready to replay sample observations. Nothing will execute or connect to a runner."
      : "Custom plan displayed. Sample replay requires the original demo nodes and decision edges.",
  );
}
function next() {
  if (cursor >= events.length) {
    pause();
    return false;
  }
  const event = events[cursor];
  if (event.kind === "result") {
    projection.track(event.result.commandId, event.nodeId);
    projection.applyResult(event.result);
    for (const edge of store
      .getSnapshot()
      .edges.filter((edge) => edge.target === event.nodeId))
      hostEdges[edge.id] = "taken";
  } else if (event.kind === "signal") {
    projection.observeSignal(event.observation);
    if (
      event.observation.nodeId === "wait" &&
      event.observation.direction === "in"
    ) {
      hostNodes.wait = {
        status: "completed",
        detail: event.observation.summary,
      };
      hostEdges["wait-decision"] = "taken";
    }
  } else if (event.kind === "decision") {
    projection.observeDecision(event.observation);
  } else if (event.kind === "waiting") {
    hostNodes[event.nodeId] = {
      status: "waiting",
      detail: "Waiting for external approval.received",
    };
    hostEdges["file-wait"] = "taken";
  } else if (event.kind === "finished") {
    hostNodes[event.nodeId] = { status: "completed" };
    if (event.nodeId === "yes") hostEdges["mail-end"] = "taken";
  }
  cursor++;
  journal.append(event, store.getSnapshot());
  // A separate observation sink, using explicit backend-shaped fixtures only.
  if (
    event.kind === "result" &&
    event.result.final &&
    performanceFixtures[event.nodeId]
  )
    performance.record({
      ...performanceFixtures[event.nodeId],
      runId: `${journal.runId}:${event.result.commandId}`,
      nodeId: event.nodeId,
      commandId: event.result.commandId,
    });
  if (cursor === events.length) playbackState = "Complete";
  renderObservations();
  report(
    cursor === events.length
      ? `Replay completed · ${scenario} scenario · no operations executed.`
      : `Displaying observation ${cursor}/${events.length}. Code and operations are previews only.`,
  );
  return cursor < events.length;
}
function play() {
  pause();
  if (cursor >= events.length) reset();
  playbackState = "Replaying";
  publish();
  const tick = () => {
    try {
      if (next()) playback = setTimeout(tick, speed);
    } catch (error) {
      pause();
      showError(error);
    }
  };
  tick();
}
const source = {
  getSnapshot: () => cached ?? snapshot(),
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async command(name, payload = {}) {
    const mutations = [
      "update-node",
      "update-edge",
      "add-global",
      "update-global",
      "remove-global",
    ];
    if (
      mutations.includes(name) &&
      payload.expectedRevision !== store.getRevision()
    )
      throw new Error(
        "The diagram changed in another view. Reselect the item before saving.",
      );
    switch (name) {
      case "play":
        if (compatible()) play();
        break;
      case "stop":
        pause();
        break;
      case "reset":
        reset();
        break;
      case "next":
        pause();
        if (compatible()) next();
        break;
      case "scenario":
        if (
          !["approve", "decline", "failure", "timeout"].includes(payload.value)
        )
          throw new Error("Unknown scenario.");
        scenario = payload.value;
        reset();
        break;
      case "speed":
        if (![120, 600, 1600].includes(Number(payload.value)))
          throw new Error("Unknown replay speed.");
        speed = Number(payload.value);
        break;
      case "select":
        editor.select(payload.selection);
        break;
      case "locate": {
        if (!store.getSnapshot().nodes.some((node) => node.id === payload.id))
          break;
        revealSelection = false;
        try {
          editor.select({ type: "node", id: payload.id });
        } finally {
          revealSelection = true;
        }
        const point = editor.getNodePositions().get(payload.id),
          scale = Math.max(1, editor.getViewport().scale);
        editor.animateViewport({
          x: 660 - point.x * scale,
          y: 410 - point.y * scale,
          scale,
        });
        break;
      }
      case "update-node":
        store.updateNode(payload.id, () => payload.value);
        break;
      case "update-edge":
        store.updateEdge(payload.id, () => payload.value);
        break;
      case "add-global":
        store.addGlobal(payload.variable);
        editor.select({ type: "global", id: payload.variable.id });
        break;
      case "update-global":
        store.updateGlobal(payload.variable.id, () => payload.variable);
        break;
      case "remove-global":
        store.removeGlobal(payload.id);
        editor.select(null);
        break;
      case "devtools-layout":
        devtools.layout(payload.action);
        break;
      case "devtools-tab":
        devtools.setTab(payload.id);
        break;
      case "theme":
        applyTheme(document, payload.theme);
        break;
      case "report":
        report(payload.message);
        break;
      default:
        throw new Error(`Unknown DevTools command: ${name}`);
    }
    publish();
  },
};
const destroyTheme = initializeTheme(document);
$("theme-toggle").addEventListener("click", () =>
  source.command("theme", {
    theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  }),
);
reset();
devtools = new DevToolsManager({
  root: $("devtools-root"),
  handle: $("dock-resizer"),
  workspace: $("workspace-layout"),
  source,
  changed: publish,
});
publish();
renderGlobals();
function action(id, callback) {
  $(id).addEventListener("click", () => {
    try {
      Promise.resolve(callback()).catch(showError);
    } catch (error) {
      showError(error);
    }
  });
}
action("open-devtools", () => devtools.open());
action("fit", () => editor.fitToView(35, true));
action("zoom-in", () => editor.zoomBy(1.3));
action("zoom-out", () => editor.zoomBy(1 / 1.3));
action("undo", () => store.undo());
action("redo", () => store.redo());
action("add", () => {
  const id = crypto.randomUUID(),
    action = structuredClone(presets[$("preset").value]);
  store.addNode({
    id,
    type: "task",
    mode: "async",
    label: actionPresentation(action).title,
    action,
    position: { x: 1500, y: 500 },
  });
  editor.select({ type: "node", id });
  editor.fitToView(35, true);
});
action("connect", () => {
  const selection = editor.getSelection();
  if (selection?.type !== "node") throw new Error("Select a source node.");
  editor.beginConnection(selection.id);
});
action("reconnect", () => {
  const selection = editor.getSelection();
  if (selection?.type !== "edge") throw new Error("Select an edge.");
  editor.beginReconnection(selection.id);
});
action("validate", () => {
  const issues = validateFlow(store.getSnapshot());
  report(
    issues.length
      ? issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")
      : "Plan structure is valid.",
  );
});
action("download", () => {
  const url = URL.createObjectURL(
    new Blob([serializeFlow(store.getSnapshot())], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "runner-plan.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("import").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (file) {
      store.replace(parseFlow(await file.text()));
      editor.fitToView();
    }
  } catch (error) {
    showError(error);
  }
  event.target.value = "";
});
const unsubscribe = store.subscribe(() => {
  try {
    localStorage.setItem("wf-document", serializeFlow(store.getSnapshot()));
  } catch {
    /* Host can still edit without storage. */
  }
  renderGlobals();
  reset();
  report("Plan updated. Only simulated observations are replayed.");
});
window.addEventListener(
  "pagehide",
  () => {
    pause();
    unsubscribe();
    destroyTheme();
    devtools.destroy();
    editor.destroy();
  },
  { once: true },
);
for (const [value, preset] of Object.entries(presets)) {
  const option = document.createElement("option");
  option.textContent = `${preset.type} · ${value}`;
  option.value = value;
  $("preset").append(option);
}
editor.settlePlacement(40);
editor.fitToView(50);
editor.relax();
export const app = {
  source,
  store,
  editor,
  devtools,
  recordPerformance(sample) {
    if (!store.getSnapshot().nodes.some((node) => node.id === sample.nodeId))
      throw new Error("Unknown metric node.");
    performance.record(sample);
    publish();
  },
};
