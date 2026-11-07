import { orderedFlowItems } from "../../../dist/index.js";
import { splitPane } from "../resize.js";

export const assembleTab = {
  id: "assemble",
  label: "Assemble",
  mount({ container, document, sizes, source }) {
    const split = splitPane(container, "assemble-left", sizes, 0.6);
    split.left.classList.add("assemble-editor");
    split.right.classList.add("construction-pane");
    split.right.textContent = "In construction";
    let latest,
      key = "",
      selectionKey = "",
      dirty = false;
    const el = (tag, text, parent, className = "") => {
      const item = document.createElement(tag);
      item.textContent = text;
      item.className = className;
      parent?.append(item);
      return item;
    };
    const field = (form, label, input) => {
      const wrap = el("label", label, form, "form-field");
      wrap.append(input);
      return input;
    };
    const input = (value = "") => {
      const element = document.createElement("input");
      element.value = value;
      return element;
    };
    const area = (value) => {
      const element = document.createElement("textarea");
      element.value = value;
      element.spellcheck = false;
      return element;
    };
    const button = (text, parent, action) => {
      const item = el("button", text, parent);
      item.type = "button";
      item.addEventListener("click", action);
      return item;
    };
    async function send(name, payload, status) {
      try {
        await source.command(name, payload);
        dirty = false;
        key = "";
        update(source.getSnapshot());
      } catch (error) {
        status.textContent = error.message;
        status.setAttribute("role", "alert");
      }
    }
    function heading(text) {
      split.left.replaceChildren();
      el("h2", text, split.left);
    }
    function watch(form, status) {
      form.addEventListener("input", () => {
        dirty = true;
        status.textContent = "Unsaved changes";
      });
    }
    function variableEditor(variable) {
      const base = latest.revision;
      heading(variable ? `Global · ${variable.name}` : "New global variable");
      el(
        "p",
        "Arrays, booleans, safe integers, or arbitrary JSON. Variables belong to this diagram; no node references are introduced here.",
        split.left,
        "muted",
      );
      const form = el("form", "", split.left);
      form.addEventListener("submit", (event) => event.preventDefault());
      const name = field(form, "Name", input(variable?.name ?? ""));
      name.name = "global-name";
      const type = document.createElement("select");
      type.name = "global-type";
      for (const value of ["array", "boolean", "integer", "json"]) {
        const option = el(
          "option",
          value === "json" ? "JSON · any value" : value,
          type,
        );
        option.value = value;
      }
      type.value = variable?.type ?? "json";
      field(form, "Type", type);
      const value = field(
        form,
        "Value · JSON",
        area(JSON.stringify(variable?.value ?? null, null, 2)),
      );
      value.name = "global-value";
      const status = el("p", "", form, "form-status");
      watch(form, status);
      button("Save variable", form, async () => {
        try {
          const record = {
            id: variable?.id ?? document.defaultView.crypto.randomUUID(),
            name: name.value.trim(),
            type: type.value,
            value: JSON.parse(value.value),
          };
          await send(
            variable ? "update-global" : "add-global",
            { variable: record, expectedRevision: base },
            status,
          );
        } catch (error) {
          status.textContent = error.message;
        }
      });
      if (variable)
        button("Delete variable", form, () =>
          send(
            "remove-global",
            { id: variable.id, expectedRevision: base },
            status,
          ),
        );
      button("Reload from diagram", form, () => {
        dirty = false;
        key = "";
        update(source.getSnapshot());
      });
      button("Back to all items", form, () => {
        dirty = false;
        source.command("select", { selection: null });
        key = "";
        update(source.getSnapshot());
      });
    }
    function itemEditor(selection, item) {
      const base = latest.revision;
      heading(
        selection.type === "node"
          ? "Edit selected node"
          : "Edit selected connection",
      );
      el("p", `${item.id} · ${item.type ?? "edge"}`, split.left, "mono muted");
      const form = el("form", "", split.left);
      form.addEventListener("submit", (event) => event.preventDefault());
      const label = field(form, "Display name", input(item.label ?? ""));
      label.name = "node-label";
      const json = field(
        form,
        "Definition · action previews and signals are data only",
        area(JSON.stringify(item, null, 2)),
      );
      json.name = "node-json";
      const status = el("p", "", form, "form-status");
      watch(form, status);
      button(
        selection.type === "node" ? "Save node" : "Save connection",
        form,
        () => {
          try {
            const value = JSON.parse(json.value);
            value.label = label.value;
            send(
              selection.type === "node" ? "update-node" : "update-edge",
              { id: item.id, value, expectedRevision: base },
              status,
            );
          } catch (error) {
            status.textContent = error.message;
          }
        },
      );
      button("Back to all items", form, () => {
        dirty = false;
        source.command("select", { selection: null });
      });
      button("Reload from diagram", form, () => {
        dirty = false;
        key = "";
        update(source.getSnapshot());
      });
    }
    function list() {
      heading("Diagram contents");
      const header = el("div", "", split.left, "list-heading");
      el("h3", "Global variables · pinned", header);
      button("Add global variable", header, () => {
        dirty = false;
        variableEditor();
      });
      const globals = latest.document.globals ?? [];
      if (!globals.length)
        el(
          "p",
          "No globals yet. Add an array, boolean, integer or JSON value.",
          split.left,
          "muted",
        );
      const items = el("div", "", split.left, "assemble-items");
      let otherHeading = false;
      for (const reference of orderedFlowItems(latest.document)) {
        if (reference.type !== "global" && !otherHeading) {
          el("h3", "Workflow items · creation order", items);
          otherHeading = true;
        }
        const item = (
          reference.type === "global"
            ? globals
            : reference.type === "node"
              ? latest.document.nodes
              : latest.document.edges
        ).find((item) => item.id === reference.id);
        if (!item) continue;
        const row = button("", items, () =>
          source.command("select", { selection: reference }),
        );
        row.className = "assemble-item";
        row.dataset.itemType = reference.type;
        row.dataset.itemId = item.id;
        el("strong", item.name ?? item.label ?? item.id, row);
        el(
          "span",
          reference.type === "global"
            ? item.type.toUpperCase()
            : reference.type === "edge"
              ? "CONNECTION"
              : item.type,
          row,
          "signal variable-type",
        );
        el(
          "code",
          reference.type === "global"
            ? JSON.stringify(item.value)
            : reference.type === "edge"
              ? `${item.source} → ${item.target}`
              : (item.action?.type ?? item.id),
          row,
          "item-preview",
        );
      }
    }
    function update(snapshot) {
      latest = snapshot;
      const nextKey = JSON.stringify([snapshot.selection, snapshot.revision]);
      if (nextKey === key) return;
      const nextSelection = JSON.stringify(snapshot.selection);
      if (dirty && nextSelection === selectionKey) {
        const status = split.left.querySelector(".form-status");
        if (status)
          status.textContent =
            "The diagram changed. Save will reject a stale revision; reselect this item to reload.";
        return;
      }
      key = nextKey;
      selectionKey = nextSelection;
      dirty = false;
      const selection = snapshot.selection;
      if (!selection) {
        list();
        return;
      }
      const item = (
        selection.type === "global"
          ? (snapshot.document.globals ?? [])
          : selection.type === "node"
            ? snapshot.document.nodes
            : snapshot.document.edges
      ).find((item) => item.id === selection.id);
      if (!item) {
        list();
        return;
      }
      if (selection.type === "global") variableEditor(item);
      else itemEditor(selection, item);
    }
    return { update, destroy: split.destroy };
  },
};
