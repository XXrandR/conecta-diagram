import {
  el,
  icon,
  badge,
  section,
  fields,
  emptyState,
  progressBlock,
  iconButton,
  copyText,
  downloadJson,
} from "./dom.js";

const PAGE_SIZE = 30;
function clock(iso) {
  return new Date(iso).toISOString().slice(11, 23);
}
function offset(ms) {
  return `+${(ms / 1000).toFixed(3)}s`;
}
const kindLabels = {
  result: "Command result",
  signal: "Signal",
  decision: "Decision",
  waiting: "Wait state",
  finished: "Run terminal",
};

/** Presentation controller: filters, paging and inspection never alter execution. */
export class ExecutionConsole {
  constructor({ report, locate, root = globalThis.document }) {
    const owner = root.ownerDocument ?? root;
    // Migration shim: preserve the original list/detail logic, but scope all lookups
    // to the Trace tab so it also runs in a detached document without duplicate UI.
    const document = (this.view = {
      getElementById: (id) => root.querySelector(`[id="${id}"]`),
      get activeElement() {
        return owner.activeElement;
      },
    });
    this.report = report;
    this.locate = locate;
    this.page = 0;
    this.selected = null;
    this.detailSignature = "";
    this.body = document.getElementById("event-rows");
    this.detail = document.getElementById("event-detail");
    for (const id of [
      "event-search",
      "event-kind",
      "event-outcome",
      "event-node",
      "event-order",
    ]) {
      document
        .getElementById(id)
        .addEventListener(id === "event-search" ? "input" : "change", () => {
          this.page = 0;
          this.render();
        });
    }
    document.getElementById("event-previous").addEventListener("click", () => {
      document.getElementById("event-follow").checked = false;
      this.page = Math.max(0, this.page - 1);
      this.render();
    });
    document.getElementById("event-next").addEventListener("click", () => {
      document.getElementById("event-follow").checked = false;
      this.page++;
      this.render();
    });
    document
      .getElementById("export-events")
      .addEventListener("click", () =>
        downloadJson(
          this.journal.export(),
          `${this.journal.runId}-observations.json`,
        ),
      );
    document.getElementById("event-follow").addEventListener("change", () => {
      if (document.getElementById("event-follow").checked)
        this.render({ appended: true });
    });
    this.body.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-event-id]");
      if (!row) return;
      this.selected = row.dataset.eventId;
      document.getElementById("event-follow").checked = false;
      this.render();
    });
  }
  reset(journal, flow) {
    const document = this.view;
    this.journal = journal;
    this.page = 0;
    this.selected = null;
    this.detailSignature = "";
    this.detail.replaceChildren();
    const filter = document.getElementById("event-node"),
      previous = filter.value;
    filter.replaceChildren();
    const all = el("option", "All tasks", filter);
    all.value = "all";
    for (const node of flow.nodes) {
      const option = el("option", node.label, filter);
      option.value = node.id;
    }
    filter.value = [...filter.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : "all";
    this.render();
  }
  render({ appended = false } = {}) {
    const document = this.view;
    if (!this.journal) return;
    const newestFirst =
      document.getElementById("event-order").value === "newest";
    const query = {
      search: document.getElementById("event-search").value,
      kind: document.getElementById("event-kind").value,
      outcome: document.getElementById("event-outcome").value,
      nodeId: document.getElementById("event-node").value,
      descending: newestFirst,
    };
    const matching = this.journal.query(query);
    if (this.selected && !matching.some((entry) => entry.id === this.selected))
      this.selected = null;
    const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    if (appended && document.getElementById("event-follow").checked) {
      this.page = newestFirst ? 0 : pageCount - 1;
      this.selected =
        (newestFirst ? matching[0] : matching.at(-1))?.id ?? this.selected;
    }
    this.page = Math.min(this.page, pageCount - 1);
    const rows = matching.slice(
      this.page * PAGE_SIZE,
      (this.page + 1) * PAGE_SIZE,
    );
    const focused = this.body.contains(document.activeElement)
      ? document.activeElement.closest("tr")?.dataset.eventId
      : null;
    this.body.replaceChildren();
    for (const entry of rows) {
      const row = el(
        "tr",
        "",
        this.body,
        entry.id === this.selected ? "is-selected" : "",
      );
      row.dataset.eventId = entry.id;
      const time = el("td", "", row, "event-time");
      el("time", clock(entry.receivedAt), time).dateTime = entry.receivedAt;
      el("span", offset(entry.elapsedMs), time, "muted");
      const event = el("td", "", row);
      const button = el("button", "", event, "event-title");
      button.type = "button";
      button.setAttribute("aria-pressed", String(entry.id === this.selected));
      button.setAttribute(
        "aria-label",
        `Inspect observation ${entry.ordinal}: ${kindLabels[entry.kind]}`,
      );
      button.append(
        icon(
          entry.kind === "signal"
            ? entry.observation.observation.direction
            : entry.kind === "decision"
              ? "decision"
              : entry.kind === "result"
                ? "terminal"
                : "event",
          14,
        ),
      );
      el(
        "span",
        entry.kind === "signal"
          ? entry.observation.observation.name
          : kindLabels[entry.kind],
        button,
      );
      const correlation = el(
        "span",
        entry.commandId ??
          entry.observation.observation?.id ??
          `Local observation ${entry.ordinal}`,
        event,
        "event-correlation",
      );
      correlation.title = correlation.textContent;
      const task = el("td", "", row, "event-task");
      el("span", entry.nodeLabel, task);
      el("code", entry.actionType, task);
      el("td", "", row).append(badge(entry.status.toLowerCase()));
      const sequence = el("td", "", row, "event-sequence");
      el("code", entry.sequence ?? "—", sequence);
      if (entry.final !== null)
        el(
          "span",
          entry.final ? "FINAL" : "INTERMEDIATE",
          sequence,
          entry.final ? "final-label" : "intermediate-label",
        );
      row.title = entry.summary;
      if (entry.id === focused) button.focus({ preventScroll: true });
    }
    const empty = document.getElementById("event-empty");
    empty.hidden = rows.length > 0;
    empty.textContent = this.journal.entries.length
      ? "No observations match these filters. The complete trace is still retained."
      : "No observations yet. Replay the sample to inspect every result, signal and routing decision.";
    document.getElementById("event-range").textContent = matching.length
      ? `${this.page * PAGE_SIZE + 1}–${Math.min((this.page + 1) * PAGE_SIZE, matching.length)} of ${matching.length}`
      : "0 observations";
    document.getElementById("event-total").textContent =
      `${this.journal.entries.length} retained`;
    document.getElementById("event-previous").disabled = this.page === 0;
    document.getElementById("event-next").disabled =
      this.page === pageCount - 1;
    const stats = this.journal.stats();
    for (const [id, count] of [
      ["metric-commands", stats.commands],
      ["metric-signals", stats.signals],
      ["metric-errors", stats.errors],
      ["metric-observations", stats.total],
    ])
      document.getElementById(id).textContent = String(count);
    document.getElementById("metric-span").textContent =
      `${(stats.spanMs / 1000).toFixed(2)}s`;
    if (appended && document.getElementById("event-follow").checked) {
      const scroll = this.body.closest(".table-scroll");
      if (scroll) scroll.scrollTop = newestFirst ? 0 : scroll.scrollHeight;
    }
    this.renderDetail();
  }
  renderDetail() {
    const entry = this.journal.entries.find(
      (entry) => entry.id === this.selected,
    );
    if (
      (entry?.id ?? "") === this.detailSignature &&
      this.detail.childNodes.length
    )
      return;
    this.detailSignature = entry?.id ?? "";
    this.detail.replaceChildren();
    this.detail.scrollTop = 0;
    if (!entry) {
      emptyState(
        this.detail,
        "Observation details",
        "Choose a row to inspect exact correlation, progress, transfer metadata and the full redacted observation.",
        "search",
      );
      return;
    }
    const header = el("div", "", this.detail, "event-detail-heading");
    const title = el("div", "", header);
    el(
      "span",
      `LOCAL #${String(entry.ordinal).padStart(4, "0")}`,
      title,
      "eyebrow",
    );
    el("h3", kindLabels[entry.kind], title);
    header.append(
      iconButton("Copy complete observation", "copy", () =>
        copyText(JSON.stringify(entry, null, 2), this.report),
      ),
    );
    const result = entry.observation.result;
    const outcome = section(this.detail, "Outcome");
    outcome.append(badge(entry.status.toLowerCase()));
    el(
      "p",
      entry.summary,
      outcome,
      entry.error ? "observation-summary error-message" : "observation-summary",
    );
    fields(outcome, [
      ["Received · UTC", entry.receivedAt],
      ["Since first receipt", offset(entry.elapsedMs)],
      ["Direction", entry.direction],
      ["Success flag", result?.success],
      ["Command final", result?.final],
    ]);
    const correlation = section(this.detail, "Correlation");
    fields(correlation, [
      ["Demo run", entry.runId],
      ["Command ID", entry.commandId],
      ["Result sequence", entry.sequence],
      ["Node ID", entry.nodeId],
      ["Command type", entry.actionType],
      ["Observation ID", entry.observation.observation?.id],
    ]);
    const locate = el("button", "Locate task", correlation, "locate-button");
    locate.prepend(icon("locate", 14));
    locate.addEventListener("click", () => this.locate(entry.nodeId));
    if (result?.progress)
      progressBlock(section(this.detail, "Observed progress"), result.progress);
    if (result?.transfer) {
      const transfer = result.transfer;
      fields(section(this.detail, "File transfer", "METADATA ONLY"), [
        ["Transfer ID", transfer.id],
        ["Chunk sequence", transfer.chunkSequence],
        ["Byte offset", transfer.offset],
        ["Chunk size · bytes", transfer.size],
        ["Total size · bytes", transfer.totalSize],
        ["Chunk final", transfer.final],
      ]);
    }
    if (entry.kind === "signal") {
      const signal = entry.observation.observation;
      fields(section(this.detail, "Signal"), [
        ["Name", signal.name],
        [
          "Relative direction",
          signal.direction === "in" ? "Into node" : "Out of node",
        ],
        ["Signal observation", signal.id],
      ]);
    }
    if (entry.kind === "decision")
      fields(section(this.detail, "Branch selection"), [
        ["Selected edge", entry.observation.observation.edgeId],
        ["Reason", entry.observation.observation.reason],
      ]);
    const configuration = entry.configuration;
    if (configuration?.action)
      fields(section(this.detail, "Operation context"), [
        ["Tool", configuration.action.body.kind],
        ["Profile", configuration.action.body.profile],
        ["Connection", configuration.action.body.connectionId],
        ["Datasource", configuration.action.body.datasource],
        ["Streaming requested", configuration.action.streaming],
        ["Version", configuration.action.version],
      ]);
    const raw = el("details", "", this.detail, "raw-disclosure");
    el("summary", "Complete redacted observation JSON", raw);
    el("pre", JSON.stringify(entry, null, 2), raw);
  }
}
