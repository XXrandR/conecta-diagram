import { DevToolsShell } from "./shell.js";
import { PanelSizes, resizeHandle } from "./resize.js";
import { registerDefaultTabs } from "./tabs/index.js";

export class DevToolsManager {
  constructor({ root, handle, workspace, source, changed }) {
    this.root = root;
    this.handle = handle;
    this.workspace = workspace;
    this.source = source;
    this.changed = changed;
    this.window = root.ownerDocument.defaultView;
    this.sizes = new PanelSizes(this.window);
    this.plugins = new Map();
    this.state = { dock: "bottom", tab: "assemble", open: true };
    this.popup = null;
    this.explicitClosing = false;
    try {
      const saved = JSON.parse(
        this.window.localStorage.getItem("wf-devtools-state") ?? "null",
      );
      if (saved) {
        if (["bottom", "left", "right"].includes(saved.dock))
          this.state.dock = saved.dock;
        if (["assemble", "trace", "performance"].includes(saved.tab))
          this.state.tab = saved.tab;
        this.state.open = saved.open !== false;
      }
    } catch {
      /* Defaults survive malformed storage. */
    }
    this.message = (event) => this.receive(event);
    this.window.addEventListener("message", this.message);
    this.unsubscribe = source.subscribe(() => this.sendState());
    this.createShell();
    this.applyLayout();
    this.resizeWindow = () => this.applyLayout();
    this.window.addEventListener("resize", this.resizeWindow);
    this.watchPopup = this.window.setInterval(() => {
      if (this.popup?.closed) this.returnFromWindow();
    }, 500);
  }
  createShell() {
    this.shell?.destroy();
    this.root.replaceChildren();
    this.shell = new DevToolsShell(this.root, {
      source: this.source,
      activeTab: this.state.tab,
      onLayout: (action) => this.layout(action),
    });
    registerDefaultTabs(this.shell);
    for (const tab of this.plugins.values()) this.shell.registerTab(tab);
  }
  registerTab(tab) {
    if (this.plugins.has(tab.id)) throw new Error(`Duplicate tab ${tab.id}`);
    this.plugins.set(tab.id, tab);
    this.shell?.registerTab(tab);
  }
  persist() {
    try {
      this.window.localStorage.setItem(
        "wf-devtools-state",
        JSON.stringify(this.state),
      );
    } catch {
      /* In-memory state remains usable. */
    }
  }
  applyLayout() {
    this.removeResize?.();
    this.removeResize = null;
    const visible = this.state.open && !this.popup;
    this.root.hidden = !visible;
    this.handle.hidden = !visible;
    this.workspace.dataset.dock = visible ? this.state.dock : "closed";
    this.root.style.width = "";
    this.root.style.height = "";
    for (const edge of ["bottom", "left", "right"]) this.handle.style[edge] = "";
    if (!visible) return;
    const vertical = this.state.dock !== "bottom",
      key = `dock-${this.state.dock}`;
    const max = () =>
      Math.max(
        220,
        (vertical ? this.workspace.clientWidth : this.workspace.clientHeight) -
          180,
      );
    let size = Math.max(
      220,
      Math.min(max(), this.sizes.get(key, vertical ? 560 : 360)),
    );
    const set = (value) => {
      size = value;
      this.root.style[vertical ? "width" : "height"] = `${value}px`;
      this.handle.style[this.state.dock] = `${value}px`;
    };
    set(size);
    this.handle.className = vertical
      ? "dock-resizer split-handle"
      : "dock-resizer resize-horizontal";
    this.handle.setAttribute(
      "aria-label",
      `Resize DevTools docked ${this.state.dock}`,
    );
    this.removeResize = resizeHandle(this.handle, {
      axis: vertical ? "x" : "y",
      direction: this.state.dock === "left" ? 1 : -1,
      get: () => size,
      min: () => 220,
      max,
      set,
      persist: (value) => this.sizes.set(key, value),
    });
    this.shell?.update(this.source.getSnapshot());
  }
  open() {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }
    this.state.open = true;
    this.applyLayout();
    this.persist();
    this.changed();
  }
  layout(action) {
    if (action === "window") {
      this.detach();
      return;
    }
    this.explicitClosing = true;
    if (this.popup) {
      this.popup.close();
      this.popup = null;
      this.createShell();
    }
    this.explicitClosing = false;
    if (action === "close") this.state.open = false;
    else if (["bottom", "left", "right"].includes(action)) {
      this.state.dock = action;
      this.state.open = true;
    }
    this.applyLayout();
    this.persist();
    this.changed();
  }
  setTab(id) {
    if (
      !["assemble", "trace", "performance"].includes(id) &&
      !this.plugins.has(id)
    )
      throw new Error("Unknown DevTools tab.");
    this.state.tab = id;
    this.shell?.selectTab(id, false);
    this.persist();
    this.changed();
  }
  detach() {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }
    this.session = this.window.crypto.randomUUID();
    const url = new URL("./devtools.html", this.window.location.href);
    url.hash = this.session;
    const popup = this.window.open(
      url,
      "_blank",
      "popup,width=1100,height=760",
    );
    if (!popup) {
      this.source.command("report", {
        message:
          "Popup blocked. Allow this site's popup to open DevTools in a separate window.",
      });
      return;
    }
    this.popup = popup;
    this.state.open = true;
    this.shell?.destroy();
    this.shell = null;
    this.applyLayout();
    this.changed();
  }
  sendState() {
    if (this.popup && !this.popup.closed)
      this.popup.postMessage(
        {
          channel: "workflow-devtools",
          session: this.session,
          kind: "snapshot",
          snapshot: this.source.getSnapshot(),
        },
        this.window.location.origin,
      );
  }
  async receive(event) {
    const message = event.data;
    if (
      event.origin !== this.window.location.origin ||
      event.source !== this.popup ||
      !message ||
      message.channel !== "workflow-devtools" ||
      message.session !== this.session
    )
      return;
    if (message.kind === "ready") {
      this.sendState();
      return;
    }
    if (message.kind === "closing") {
      if (!this.explicitClosing) this.returnFromWindow();
      return;
    }
    if (message.kind !== "command" || typeof message.requestId !== "string")
      return;
    const popup = this.popup;
    try {
      await this.source.command(message.name, message.payload);
      if (popup && !popup.closed)
        popup.postMessage(
          {
            channel: "workflow-devtools",
            session: this.session,
            kind: "ack",
            requestId: message.requestId,
            ok: true,
            snapshot: this.source.getSnapshot(),
          },
          this.window.location.origin,
        );
    } catch (error) {
      if (popup && !popup.closed)
        popup.postMessage(
          {
            channel: "workflow-devtools",
            session: this.session,
            kind: "ack",
            requestId: message.requestId,
            ok: false,
            error: error.message,
          },
          this.window.location.origin,
        );
    }
  }
  returnFromWindow() {
    if (!this.popup) return;
    this.popup = null;
    this.state.open = true;
    this.createShell();
    this.applyLayout();
    this.persist();
    this.changed();
  }
  destroy() {
    this.explicitClosing = true;
    this.popup?.close();
    this.window.clearInterval(this.watchPopup);
    this.window.removeEventListener("message", this.message);
    this.window.removeEventListener("resize", this.resizeWindow);
    this.unsubscribe();
    this.removeResize?.();
    this.shell?.destroy();
  }
}
