import { ExecutionConsole } from "../../ui/execution-console.js";
import { ExecutionJournal } from "../../ui/journal.js";
import { splitPane } from "../resize.js";

export const traceTab = {
  id: "trace",
  label: "Trace",
  mount({ container, sizes, source }) {
    const split = splitPane(container, "trace-left", sizes, 0.64);
    split.left.classList.add("trace-pane");
    split.right.id = "event-detail";
    split.right.classList.add("event-detail");
    split.right.setAttribute("aria-label", "Selected observation details");
    // Static chrome only. All observation content still uses the existing safe DOM renderer.
    split.left.innerHTML = `<div class="trace-options"><label>Scenario <select id="scenario" aria-label="Replay scenario"><option value="approve">Approved report</option><option value="decline">Declined approval</option><option value="failure">Transfer failure</option><option value="timeout">Transfer deadline exceeded</option></select></label><label>Speed <select id="speed" aria-label="Replay speed"><option value="600">1×</option><option value="120">5×</option><option value="1600">0.4×</option></select></label><button id="next" aria-label="Next event">Next event</button><span id="event-count"></span></div><div class="trace-metrics"><span><strong id="metric-observations">0</strong> observations</span><span><strong id="metric-commands">0</strong> commands</span><span><strong id="metric-signals">0</strong> signals</span><span><strong id="metric-errors">0</strong> errors</span><span>Observed span <strong id="metric-span">0s</strong></span></div>
      <div class="trace-filters"><input id="event-search" type="search" placeholder="Search trace, command or signal" aria-label="Search observations"><select id="event-kind" aria-label="Observation type"><option value="all">All event types</option><option value="result">Command results</option><option value="signal">Signals</option><option value="decision">Decisions</option><option value="lifecycle">Lifecycle</option></select><select id="event-outcome" aria-label="Observation outcome"><option value="all">All outcomes</option><option value="errors">Errors only</option><option value="streaming">Streaming</option><option value="succeeded">Succeeded</option><option value="waiting">Waiting</option></select><select id="event-node" aria-label="Filter observations by task"><option value="all">All tasks</option></select><select id="event-order" aria-label="Observation order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><label><input id="event-follow" type="checkbox" checked>Follow latest</label><button id="export-events" aria-label="Export complete observation trace">Export</button></div>
      <div class="table-scroll"><table id="events" aria-label="Execution observations"><thead><tr><th scope="col">Received · UTC</th><th scope="col">Event / correlation</th><th scope="col">Task / tool</th><th scope="col">State</th><th scope="col">Sequence / finality</th></tr></thead><tbody id="event-rows"></tbody></table><div id="event-empty" class="trace-empty"></div></div>
      <div class="trace-pagination"><span id="event-total">0 retained</span><span id="event-range">0 observations</span><button id="event-previous" aria-label="Previous observation page">←</button><button id="event-next" aria-label="Next observation page">→</button></div>`;
    const view = new ExecutionConsole({
      root: container,
      report: (message) => source.command("report", { message }),
      locate: (id) => source.command("locate", { id }),
    });
    container
      .querySelector("#scenario")
      .addEventListener("change", (event) =>
        source.command("scenario", { value: event.target.value }),
      );
    container
      .querySelector("#speed")
      .addEventListener("change", (event) =>
        source.command("speed", { value: event.target.value }),
      );
    container
      .querySelector("#next")
      .addEventListener("click", () => source.command("next"));
    let journal = null,
      count = 0,
      revision = -1;
    return {
      update(snapshot) {
        container.querySelector("#scenario").value = snapshot.playback.scenario;
        container.querySelector("#speed").value = String(
          snapshot.playback.speed,
        );
        container.querySelector("#next").disabled =
          !snapshot.playback.compatible;
        container.querySelector("#event-count").textContent =
          `${snapshot.playback.cursor} / ${snapshot.playback.total} · ${snapshot.playback.state}`;
        const reset =
          journal?.runId !== snapshot.journal.runId ||
          snapshot.journal.entries.length < count;
        if (reset) {
          journal = new ExecutionJournal(snapshot.journal.runId);
          count = 0;
        }
        for (const entry of snapshot.journal.entries.slice(count))
          journal.append(
            entry.observation,
            { nodes: entry.configuration ? [entry.configuration] : [] },
            entry.receivedAt,
          );
        const appended = snapshot.journal.entries.length > count;
        count = snapshot.journal.entries.length;
        if (reset || revision !== snapshot.revision) {
          view.reset(journal, snapshot.document);
          revision = snapshot.revision;
        }
        view.render({ appended });
      },
      destroy: split.destroy,
    };
  },
};
