import { resizeHandle } from "../resize.js";

const NS = "http://www.w3.org/2000/svg";
export const performanceTab = {
  id: "performance",
  label: "Performance inspection",
  mount({ container, document, sizes, source }) {
    let samples = [],
      range = null,
      labelWidth = Math.max(
        100,
        Math.min(300, sizes.get("performance-labels", 170)),
      );
    const cleanup = [];
    const el = (tag, text, parent, cls = "") => {
      const element = document.createElement(tag);
      element.textContent = text;
      element.className = cls;
      parent?.append(element);
      return element;
    };
    const svgEl = (tag, attrs = {}, parent) => {
      const element = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs))
        element.setAttribute(key, String(value));
      parent?.append(element);
      return element;
    };
    const header = el("div", "", container, "performance-controls");
    el("strong", "Backend node-run metrics", header);
    el("span", "Parent process · Network · Memory · Cost", header, "muted");
    const reset = el("button", "Reset range", header);
    reset.addEventListener("click", () => {
      range = null;
      draw();
    });
    const hint = el(
      "span",
      "Drag the ruler to inspect a time range. No metrics are inferred from trace receipt time.",
      container,
      "performance-hint",
    );
    const graph = el("div", "", container, "profiler-top-graph");
    graph.style.height = `${Math.max(220, Math.min(1000, sizes.get("performance-graph", 370)))}px`;
    const ruler = el("div", "", graph, "performance-ruler");
    el("div", "4 tracks", ruler, "track-label");
    const rulerSvg = svgEl(
      "svg",
      {
        height: 30,
        role: "img",
        "aria-label": "Backend time ruler; drag to zoom",
      },
      ruler,
    );
    const labelHandle = el(
      "div",
      "",
      graph,
      "performance-label-resizer split-handle",
    );
    labelHandle.setAttribute("aria-label", "Resize performance track labels");
    cleanup.push(
      resizeHandle(labelHandle, {
        axis: "x",
        get: () => labelWidth,
        min: () => 90,
        max: () => 320,
        set: (value) => {
          labelWidth = value;
          layout();
        },
        persist: (value) => sizes.set("performance-labels", value),
      }),
    );
    const list = el("div", "", graph, "performance-tracks");
    const tracks = [];
    for (const [key, label] of [
      ["parent", "Parent process"],
      ["network", "Network"],
      ["memory", "Memory"],
      ["cost", "Cost"],
    ]) {
      const row = el("section", "", list, "performance-track");
      row.dataset.track = key;
      row.style.height = `${Math.max(44, Math.min(240, sizes.get(`track-${key}`, key === "parent" ? 72 : 64)))}px`;
      const name = el("div", "", row, "track-label");
      el("strong", label, name);
      el(
        "small",
        key === "cost"
          ? "backend integer / node run"
          : key === "memory"
            ? "backend byte samples"
            : "backend run time",
        name,
      );
      const plot = svgEl(
        "svg",
        { role: "img", "aria-label": `${label} track` },
        row,
      );
      const handle = el("div", "", row, "track-resizer resize-horizontal");
      handle.setAttribute("aria-label", `Resize ${label} track`);
      cleanup.push(
        resizeHandle(handle, {
          axis: "y",
          get: () => row.getBoundingClientRect().height,
          min: () => 44,
          max: () => 240,
          set: (value) => {
            row.style.height = `${value}px`;
            draw();
          },
          persist: (value) => sizes.set(`track-${key}`, value),
        }),
      );
      tracks.push({ key, row, plot });
    }
    const graphHandle = el("div", "", container, "resize-horizontal");
    graphHandle.setAttribute("aria-label", "Resize performance top graph");
    cleanup.push(
      resizeHandle(graphHandle, {
        axis: "y",
        get: () => graph.getBoundingClientRect().height,
        min: () => 220,
        max: () => 1000,
        set: (value) => {
          graph.style.height = `${value}px`;
          draw();
        },
        persist: (value) => sizes.set("performance-graph", value),
      }),
    );
    const info = el(
      "output",
      "Awaiting backend metrics. Cost is never calculated in this UI.",
      container,
      "performance-info",
    );
    function domain() {
      const end = samples.reduce(
        (max, sample) =>
          Math.max(
            max,
            sample.startMs + sample.durationMs,
            ...(sample.memory ?? []).map((point) => point.timeMs),
            ...(sample.network ?? []).map(
              (point) => point.startMs + point.durationMs,
            ),
          ),
        1,
      );
      return range ?? { start: 0, end };
    }
    function layout() {
      for (const row of [ruler, ...tracks.map((track) => track.row)])
        row.style.gridTemplateColumns = `${labelWidth}px minmax(0,1fr)`;
      labelHandle.style.left = `${labelWidth}px`;
      draw();
    }
    function tooltip(element, text) {
      svgEl("title", {}, element).textContent = text;
    }
    function interval(
      svg,
      sample,
      start,
      duration,
      y,
      height,
      label,
      kind,
      width,
      d,
    ) {
      if (start + duration < d.start || start > d.end) return;
      const x = Math.max(0, ((start - d.start) / (d.end - d.start)) * width);
      const right = Math.min(
        width,
        ((start + duration - d.start) / (d.end - d.start)) * width,
      );
      const item = svgEl(
        "g",
        {
          class: `performance-interval ${kind}`,
          tabindex: 0,
          role: "button",
          "aria-label": label,
        },
        svg,
      );
      svgEl(
        "rect",
        {
          x,
          y,
          width: Math.max(2, right - x),
          height,
          rx: 2,
          fill: "var(--accent)",
          opacity: kind === "network" ? 0.55 : 0.8,
        },
        item,
      );
      tooltip(item, label);
      if (right - x > 34) {
        const text = svgEl(
          "text",
          {
            x: x + 5,
            y: y + height / 2 + 4,
            fill: "var(--surface)",
            "font-size": 10,
          },
          item,
        );
        text.textContent =
          kind === "cost" ? String(sample.cost) : sample.nodeId;
      }
      const inspect = () => {
        info.textContent = label;
        source.command("locate", { id: sample.nodeId });
      };
      item.addEventListener("click", inspect);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inspect();
        }
      });
      item.addEventListener("pointerenter", () => {
        info.textContent = label;
      });
    }
    function draw() {
      const d = domain(),
        width = Math.max(
          100,
          rulerSvg.getBoundingClientRect().width ||
            container.clientWidth - labelWidth,
        );
      rulerSvg.replaceChildren();
      rulerSvg.setAttribute("viewBox", `0 0 ${width} 30`);
      for (let index = 0; index <= 5; index++) {
        const x = (index * width) / 5;
        svgEl(
          "line",
          { x1: x, x2: x, y1: 20, y2: 30, stroke: "var(--border)" },
          rulerSvg,
        );
        const text = svgEl(
          "text",
          {
            x: Math.max(2, x - (index === 5 ? 55 : 0)),
            y: 14,
            fill: "var(--text-muted)",
            "font-size": 10,
          },
          rulerSvg,
        );
        text.textContent = `${(d.start + ((d.end - d.start) * index) / 5).toFixed(1)} ms`;
      }
      const memory = samples
        .flatMap((sample) => sample.memory ?? [])
        .sort((a, b) => a.timeMs - b.timeMs);
      const maxMemory = memory.reduce(
        (max, point) => (BigInt(point.bytes) > max ? BigInt(point.bytes) : max),
        1n,
      );
      const maxCost = samples.reduce(
        (max, sample) => Math.max(max, sample.cost),
        1,
      );
      for (const { key, row, plot } of tracks) {
        const height = Math.max(40, row.getBoundingClientRect().height - 5);
        plot.replaceChildren();
        plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
        for (let i = 0; i <= 5; i++)
          svgEl(
            "line",
            {
              x1: (i * width) / 5,
              x2: (i * width) / 5,
              y1: 0,
              y2: height,
              stroke: "var(--border)",
              opacity: 0.5,
            },
            plot,
          );
        if (!samples.length) {
          const text = svgEl(
            "text",
            {
              x: 12,
              y: height / 2 + 4,
              fill: "var(--text-muted)",
              "font-size": 11,
            },
            plot,
          );
          text.textContent = "No backend observations";
          continue;
        }
        if (key === "parent")
          samples.forEach((sample, index) =>
            interval(
              plot,
              sample,
              sample.startMs,
              sample.durationMs,
              8 + (index % 2) * 22,
              18,
              `${sample.process} · ${sample.nodeId} · ${sample.durationMs} ms · ${sample.commandId}`,
              key,
              width,
              d,
            ),
          );
        if (key === "network")
          for (const sample of samples)
            for (const request of sample.network ?? [])
              interval(
                plot,
                sample,
                request.startMs,
                request.durationMs,
                12,
                Math.max(16, height - 26),
                `${request.label} · ${request.durationMs} ms${request.bytes ? ` · ${request.bytes} bytes` : ""}`,
                key,
                width,
                d,
              );
        if (key === "memory") {
          const points = memory.filter(
            (point) => point.timeMs >= d.start && point.timeMs <= d.end,
          );
          const coordinates = points.map((point) => ({
            x: ((point.timeMs - d.start) / (d.end - d.start)) * width,
            y:
              height -
              8 -
              (Number((BigInt(point.bytes) * 10000n) / maxMemory) / 10000) *
                (height - 16),
            point,
          }));
          if (coordinates.length) {
            const path =
              `M${coordinates[0].x},${height} ` +
              coordinates
                .map((point, index) =>
                  index ? `H${point.x} V${point.y}` : `L${point.x},${point.y}`,
                )
                .join(" ") +
              `L${coordinates.at(-1).x},${height} Z`;
            svgEl(
              "path",
              {
                d: path,
                fill: "var(--accent)",
                opacity: 0.22,
                stroke: "var(--accent)",
              },
              plot,
            );
            for (const point of coordinates) {
              const dot = svgEl(
                "circle",
                { cx: point.x, cy: point.y, r: 3, fill: "var(--accent)" },
                plot,
              );
              tooltip(
                dot,
                `${point.point.timeMs} ms · ${point.point.bytes} bytes`,
              );
            }
          }
        }
        if (key === "cost")
          for (const sample of samples) {
            const bar = Math.max(2, (sample.cost / maxCost) * (height - 12));
            interval(
              plot,
              sample,
              sample.startMs,
              sample.durationMs,
              height - bar - 4,
              bar,
              `${sample.nodeId} · backend cost ${sample.cost} · ${sample.runId}`,
              key,
              width,
              d,
            );
          }
      }
    }
    let drag = null;
    rulerSvg.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        drag = { x: event.clientX, domain: domain() };
        rulerSvg.setPointerCapture(event.pointerId);
      }
    });
    rulerSvg.addEventListener("pointerup", (event) => {
      if (!drag) return;
      const rect = rulerSvg.getBoundingClientRect(),
        from = Math.max(0, Math.min(1, (drag.x - rect.left) / rect.width)),
        to = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      if (Math.abs(to - from) > 0.01) {
        const length = drag.domain.end - drag.domain.start;
        range = {
          start: drag.domain.start + Math.min(from, to) * length,
          end: drag.domain.start + Math.max(from, to) * length,
        };
      }
      drag = null;
      draw();
    });
    const observer = new document.defaultView.ResizeObserver(draw);
    observer.observe(container);
    observer.observe(graph);
    layout();
    return {
      update(snapshot) {
        samples = snapshot.performance;
        if (!samples.length) range = null;
        hint.textContent = `${snapshot.performanceSource} · drag ruler to zoom · backend milliseconds and integer cost`;
        draw();
      },
      visible: draw,
      destroy() {
        observer.disconnect();
        cleanup.forEach((destroy) => destroy());
      },
    };
  },
};
