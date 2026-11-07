import { createFlowIcon } from "../../dist/index.js";
import { PanelSizes, resizeHandle } from "./resize.js";

/** Stable plugin boundary: adding a tab never requires modifying this shell. */
export class DevToolsShell {
  constructor(
    root,
    { source, onLayout, activeTab = "assemble", detached = false },
  ) {
    this.root = root;
    this.document = root.ownerDocument;
    this.source = source;
    this.onLayout = onLayout;
    this.detached = detached;
    this.tabs = new Map();
    this.instances = new Map();
    this.activeTab = activeTab;
    this.sizes = new PanelSizes(this.document.defaultView);
    root.className = "devtools";
    root.setAttribute("aria-label", "Workflow DevTools");
    const bar = this.document.createElement("header");
    bar.className = "devtools-bar";
    this.tablist = this.document.createElement("div");
    this.tablist.className = "devtools-tabs";
    this.tablist.setAttribute("role", "tablist");
    this.tablist.setAttribute("aria-label", "DevTools tabs");
    const handle = this.document.createElement("div");
    handle.className = "split-handle toolbar-split";
    handle.setAttribute("aria-label", "Resize DevTools top-bar subsections");
    const actions = this.document.createElement("div");
    actions.className = "devtools-actions";
    this.play = this.button("Play simulated events", "play", () =>
      source.command("play"),
    );
    this.stop = this.button("Stop replay", "stop", () =>
      source.command("stop"),
    );
    this.reset = this.button("Reset events", "reset", () =>
      source.command("reset"),
    );
    const more = this.document.createElement("details");
    more.className = "devtools-more";
    const summary = this.document.createElement("summary");
    summary.setAttribute("aria-label", "More DevTools options");
    summary.title = "More options";
    summary.append(createFlowIcon(this.document, "more", 17));
    const menu = this.document.createElement("div");
    menu.className = "devtools-menu";
    for (const [label, value] of [
      ["Dock to bottom", "bottom"],
      ["Dock to right", "right"],
      ["Dock to left", "left"],
      ["Separate window", "window"],
      ["Close", "close"],
    ]) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        more.open = false;
        onLayout(value);
      });
      menu.append(button);
    }
    more.append(summary, menu);
    actions.append(
      this.play,
      this.stop,
      this.reset,
      more,
      this.button("Close DevTools", "cancel", () => onLayout("close")),
    );
    bar.append(this.tablist, handle, actions);
    this.body = this.document.createElement("div");
    this.body.className = "devtools-bodies";
    root.append(bar, this.body);
    this.destroyBarResize = resizeHandle(handle, {
      axis: "x",
      get: () => this.tablist.getBoundingClientRect().width,
      min: () => 150,
      max: () => Math.max(150, root.clientWidth - 170),
      set: (value) => {
        this.tablist.style.flex = `0 1 ${value}px`;
      },
      persist: (value) => this.sizes.set("toolbar-tabs", value),
    });
    const tabWidth = this.sizes.get("toolbar-tabs", 0);
    if (tabWidth) this.tablist.style.flex = `0 1 ${tabWidth}px`;
    this.unsubscribe = source.subscribe((snapshot) => this.update(snapshot));
    this.tablist.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const keys = [...this.tabs.keys()],
        index = keys.indexOf(this.activeTab);
      const id =
        keys[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? keys.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) %
                keys.length
        ];
      this.selectTab(id);
      this.tabs.get(id).button.focus();
    });
  }
  button(label, name, callback) {
    const button = this.document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createFlowIcon(this.document, name, 17));
    button.addEventListener("click", callback);
    return button;
  }
  registerTab({ id, label, mount }) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || this.tabs.has(id))
      throw new Error(`Invalid or duplicate DevTools tab: ${id}`);
    const button = this.document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.id = `tab-${id}`;
    const panel = this.document.createElement("section");
    panel.className = "devtools-tab-body";
    panel.id = `panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    button.setAttribute("aria-controls", panel.id);
    button.addEventListener("click", () => this.selectTab(id));
    this.tablist.append(button);
    this.body.append(panel);
    this.tabs.set(id, { button, panel });
    const instance = mount({
      container: panel,
      document: this.document,
      sizes: this.sizes,
      source: this.source,
    });
    this.instances.set(id, instance);
    this.selectTab(this.activeTab, false);
    this.update(this.source.getSnapshot());
    return () => {
      instance.destroy?.();
      this.instances.delete(id);
      this.tabs.delete(id);
      panel.remove();
      button.remove();
    };
  }
  selectTab(id, notify = true) {
    const changed = this.activeTab !== id;
    this.activeTab = id;
    for (const [key, { button, panel }] of this.tabs) {
      const selected = key === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
    this.instances.get(id)?.visible?.();
    if (changed && notify) this.source.command("devtools-tab", { id });
  }
  update(snapshot) {
    if (!snapshot) return;
    this.play.disabled =
      !snapshot.playback.compatible || snapshot.playback.state === "Replaying";
    this.stop.disabled = snapshot.playback.state !== "Replaying";
    if (snapshot.devtools?.tab && this.tabs.has(snapshot.devtools.tab))
      this.selectTab(snapshot.devtools.tab, false);
    for (const instance of this.instances.values()) instance.update?.(snapshot);
  }
  destroy() {
    this.unsubscribe();
    this.destroyBarResize();
    for (const instance of this.instances.values()) instance.destroy?.();
    this.root.replaceChildren();
  }
}
