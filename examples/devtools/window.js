import { DevToolsShell } from "./shell.js";
import { registerDefaultTabs } from "./tabs/index.js";
import { applyTheme, initializeTheme } from "./theme.js";

const session = location.hash.slice(1),
  origin = location.origin,
  opener = window.opener;
const subscribers = new Set(),
  pending = new Map();
let snapshot = null,
  shell = null,
  counter = 0;
const source = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
  command(name, payload = {}) {
    if (!opener || opener.closed)
      return Promise.reject(
        new Error(
          "The opener is unavailable. Reopen DevTools from the workflow.",
        ),
      );
    const requestId = String(++counter);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("The opener did not acknowledge this action."));
      }, 10000);
      pending.set(requestId, { resolve, reject, timeout });
      opener.postMessage(
        {
          channel: "workflow-devtools",
          session,
          kind: "command",
          requestId,
          name,
          payload,
        },
        origin,
      );
    });
  },
};
function install(value) {
  if (!value || (snapshot && value.version < snapshot.version)) return;
  snapshot = value;
  applyTheme(document, snapshot.theme);
  if (!shell) {
    shell = new DevToolsShell(document.getElementById("detached-root"), {
      source,
      activeTab: snapshot.devtools.tab,
      detached: true,
      onLayout: (action) => source.command("devtools-layout", { action }),
    });
    registerDefaultTabs(shell);
  }
  for (const listener of subscribers) listener(snapshot);
  document.getElementById("sync-state").textContent =
    `Synced · ${snapshot.document.id} · revision ${snapshot.revision} · ${snapshot.playback.state}`;
}
const receive = (event) => {
  const message = event.data;
  if (
    event.origin !== origin ||
    event.source !== opener ||
    !message ||
    message.channel !== "workflow-devtools" ||
    message.session !== session
  )
    return;
  if (message.kind === "snapshot") install(message.snapshot);
  if (message.kind === "ack") {
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.requestId);
    if (message.ok) {
      install(message.snapshot);
      request.resolve();
    } else request.reject(new Error(message.error));
  }
};
window.addEventListener("message", receive);
const destroyTheme = initializeTheme(document);
document
  .querySelector(".theme-toggle")
  .addEventListener("click", () =>
    source.command("theme", {
      theme:
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    }),
  );
if (opener && session)
  opener.postMessage(
    { channel: "workflow-devtools", session, kind: "ready" },
    origin,
  );
else
  document.getElementById("sync-state").textContent =
    "No opener. Launch this window from Workflow DevTools.";
const heartbeat = setInterval(() => {
  if (!opener || opener.closed) {
    document.getElementById("sync-state").textContent =
      "Opener disconnected. This view is read-only until reopened.";
    for (const button of document.querySelectorAll(
      "button,input,textarea,select",
    ))
      button.disabled = true;
  }
}, 1000);
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(heartbeat);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.resolve();
    }
    pending.clear();
    destroyTheme();
    shell?.destroy();
    window.removeEventListener("message", receive);
    if (opener && !opener.closed)
      opener.postMessage(
        { channel: "workflow-devtools", session, kind: "closing" },
        origin,
      );
  },
  { once: true },
);
