export class PanelSizes {
  constructor(window) {
    this.window = window;
    this.values = {};
    this.reload();
  }
  reload() {
    try {
      const raw = this.window.localStorage.getItem("wf-panel-sizes");
      if (raw === null) return;
      const value = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value))
        this.values = Object.fromEntries(
          Object.entries(value).filter(
            ([, size]) => typeof size === "number" && Number.isFinite(size),
          ),
        );
    } catch {
      /* Retain in-memory sizes when storage is unavailable. */
    }
  }
  get(key, fallback) {
    return this.values[key] ?? fallback;
  }
  set(key, value) {
    if (!Number.isFinite(value)) return;
    this.reload();
    this.values[key] = value;
    try {
      this.window.localStorage.setItem(
        "wf-panel-sizes",
        JSON.stringify(this.values),
      );
    } catch {
      /* Private/storage-disabled mode still resizes in memory. */
    }
  }
}

/** Pointer + keyboard resizing; listeners and capture always belong to the pane's window. */
export function resizeHandle(
  handle,
  {
    axis,
    direction = 1,
    get,
    set,
    min = () => 0,
    max = () => Infinity,
    persist = () => {},
  },
) {
  const window = handle.ownerDocument.defaultView;
  handle.setAttribute("role", "separator");
  handle.tabIndex = 0;
  handle.setAttribute(
    "aria-orientation",
    axis === "x" ? "vertical" : "horizontal",
  );
  let drag = null;
  const apply = (value) => {
    const size = Math.max(min(), Math.min(max(), value));
    set(size);
    handle.setAttribute("aria-valuenow", String(Math.round(size)));
    return size;
  };
  const finish = () => {
    if (!drag) return;
    const pointer = drag.id;
    drag = null;
    if (handle.hasPointerCapture?.(pointer))
      handle.releasePointerCapture(pointer);
    handle.classList.remove("is-resizing");
    persist(get());
  };
  const down = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = {
      id: event.pointerId,
      at: axis === "x" ? event.clientX : event.clientY,
      size: get(),
    };
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add("is-resizing");
  };
  const move = (event) => {
    if (drag && event.pointerId === drag.id) {
      event.preventDefault();
      apply(
        drag.size +
          ((axis === "x" ? event.clientX : event.clientY) - drag.at) *
            direction,
      );
    }
  };
  const key = (event) => {
    const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp",
      increase = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (![decrease, increase, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    apply(
      event.key === "Home"
        ? min()
        : event.key === "End"
          ? max()
          : get() +
            (event.key === decrease ? -1 : 1) *
              direction *
              (event.shiftKey ? 40 : 10),
    );
    persist(get());
  };
  handle.addEventListener("pointerdown", down);
  handle.addEventListener("keydown", key);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("blur", finish);
  return () => {
    finish();
    handle.removeEventListener("pointerdown", down);
    handle.removeEventListener("keydown", key);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", finish);
  };
}

export function splitPane(container, key, sizes, ratio = 0.6) {
  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.className = "split-pane";
  const left = document.createElement("section"),
    right = document.createElement("section"),
    handle = document.createElement("div");
  left.className = "split-left pane-scroll";
  right.className = "split-right pane-scroll";
  handle.className = "split-handle";
  handle.setAttribute("aria-label", `Resize ${key} subsections`);
  root.append(left, handle, right);
  container.append(root);
  let fraction = Math.max(0.2, Math.min(0.8, sizes.get(key, ratio)));
  const layout = () => {
    left.style.flexBasis = `${fraction * 100}%`;
  };
  layout();
  const destroy = resizeHandle(handle, {
    axis: "x",
    get: () => root.clientWidth * fraction,
    min: () => Math.min(180, root.clientWidth * 0.3),
    max: () => Math.max(root.clientWidth - 160, root.clientWidth * 0.7),
    set: (value) => {
      fraction = root.clientWidth ? value / root.clientWidth : fraction;
      layout();
    },
    persist: () => sizes.set(key, fraction),
  });
  return { root, left, right, handle, destroy };
}
