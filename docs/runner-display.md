# Runner operation and signal display

The viewer can now describe the command families from `maximus.runner.commands` and display observed results. **It is not a protobuf client, command sender, Python interpreter, HTTP client, SQL engine or file-transfer implementation.** Nothing is executed by clicking, drawing, dragging, rendering, replaying, or receiving an observation.

## Action previews

Task and decision nodes may carry `action: TaskAction`. Its open-string `type` matches a runner command type. `body.kind` selects a small, sanitized presentation model, not the full protobuf body. The type and known body family must agree; unknown extension types use `generic`. A decision may also carry `decision: { description, expression: { language, source } }`. Expression/code source is text only; it never replaces executable graph conditions or evaluates a real decision in the viewer.

| Runner family                                           | Display fields                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `api.request` / `api`                                   | Method, redacted URL, logical connection id, optional sanitized body preview    |
| `database.*` / `database`                               | Backend, logical datasource, operation, SQL/procedure/document preview          |
| `file.*` / `file`                                       | Operation, path/destination, transfer id and resume policy                      |
| `process.exec` / `process`                              | Configured executable profile, arguments, optional code-language/source preview |
| `ssh.exec` / `ssh`                                      | Logical connection id and command preview                                       |
| `sftp.*` / `sftp`                                       | Operation, connection id and local/remote/destination paths                     |
| `mail.*` / `mail`                                       | Operation, connection id, subject and sanitized recipients                      |
| `messaging.*` / `messaging`                             | Operation, connection id and topic/queue                                        |
| `event.*` / `event`                                     | Operation, topic and optional watched path                                      |
| `command.cancel` / `cancel`                             | Target command id and reason; this does not cancel anything                     |
| `command.ping`, `custom`, vendor extensions / `generic` | Logical name and sanitized textual preview                                      |

Python has **no separate typed body** in the supplied protocol. Show it as a `process.exec` configured profile with optional Python source for explanation; do not invent a supported `python.execute` capability or assume a source preview is executable stdin.

```ts
store.updateNode("process", (node) => ({
  ...node,
  action: {
    type: "process.exec",
    body: {
      kind: "process",
      profile: "python-report",
      code: {
        language: "python",
        source: "print('illustrative preview only')",
      },
    },
  },
  signals: { inputs: ["report.requested"], outputs: ["report.ready"] },
}));
```

Photon task cards show tool identity, IN/OUT chips, a preview row and observed status; hover offers language/tool detail. Decision cards show a condition preview and the **observed** selected branch. Taken edges are highlighted; unselected decision outputs are dashed. Node/global definitions are edited only through DevTools Assemble; command correlation, exact progress, transfers and signal observations are inspected in Trace. All user content is text, never executable HTML.

`capabilities` in editor options or `editor.setCapabilities(commandTypes)` is an advertised command-type list supplied by the host. A declared protobuf body or command name is not evidence that a runner supports it. Without a catalog, support is unverified; the supplied implementation's `database.transaction` and `database.metadata` are marked unsupported by default. With a catalog, absence means unsupported. Sample capabilities in the demo are explicitly fixtures, not a discovery request.

No credentials, private connection details, full binary bodies or unrestricted result payloads belong in the diagram. The host must redact source, SQL, paths, recipients and payload previews before handing them to this library. API URL presentation strips embedded credentials, query values and fragments, but that is not a universal secret scanner. Raw planning JSON is still application data; do not populate it with secrets.

## Observed results

`RunnerDisplay` is a bounded in-memory presentation projection. It correlates command ids to existing task/decision nodes and accepts `RunnerResultPreview` DTOs. The host/backend maps generated protobuf messages to these redacted DTOs. It has no networking, persistence, dispatch or worker code.

```ts
import { RunnerDisplay } from "@xxrandr/conecta-diagram/core";

const display = new RunnerDisplay(store.getSnapshot());
display.track("command-42", "process"); // Correlation only, not command dispatch
display.applyResult({
  commandId: "command-42",
  status: "STREAMING",
  sequence: "9007199254740993",
  success: false,
  final: false,
  summary: "Rows received",
  progress: { current: "100", total: "200", unit: "rows" },
});
editor.setExecution(display.getOverlay());
```

- Status names follow the supplied enum: `ACCEPTED`, `RUNNING`, `STREAMING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `REJECTED`. Numeric enum values 1–8 are also accepted. Unspecified/legacy messages require an explicit host policy; the projection does not guess a terminal state.
- `success=false` on an intermediate result is **not a failure**. Terminal status, `final=true`, and success must agree. Success is true only for `SUCCEEDED` terminal results. All terminal outcomes display distinctly.
- Sequences are uint64 **decimal strings**, compared using `BigInt`, never lossy JavaScript numbers. They are per command, not the Java/SSE run-event cursor. A first result may start at 0 or 1; later values must increase. Gaps are not synthesized or interpreted as command completion.
- Older/identical results are ignored. Conflicting content at the latest sequence and results after a final result are rejected. A retry uses a new command id. Re-registering an old id never replaces a newer binding. Up to 10000 commands are retained per projection; create a fresh projection for a new run/window.
- `progress` contains exact decimal counters and a unit (`bytes`, `rows`, `items`). `transfer` optionally carries file-chunk `{id, offset, chunkSequence, size, totalSize?, final}` metadata. These are independent of the command sequence/finality: a final file chunk does not itself imply a final command result. Raw `data` bytes are not stored/displayed. No chunks are sent, resumed or checksummed by the viewer.
- A node may have several tracked command ids; the most recently registered id is the current card summary. This is not a complete concurrent-activation inspector. Old results cannot replace that current summary; host-provided `ExecutionOverlay` can supply an explicit aggregate instead.
- `RunnerDisplay` captures the plan at construction. Recreate it when changing runs/revisions. Snapshots are frozen; live rendering never changes the plan.

## Signals and decisions

```ts
display.observeSignal({
  id: "event-104",
  nodeId: "approval",
  name: "approval.received",
  direction: "in",
  summary: "Redacted approval received outside the diagram",
});
display.observeDecision({
  id: "event-105",
  nodeId: "decision",
  edgeId: "approved",
  reason: "Observed server result: approved == true",
});
editor.setExecution(display.getOverlay());
```

Decision observations must reference a real output of that decision. Signals indicate observed ingress/egress; they do not match subscriptions, emit business events, collect input, or trigger execution. The bounded signal/observation-id tail defaults to 200. Replay deduplication outside that tail belongs to the host's durable cursor/reducer, not this visual cache. Signal names in the plan are display descriptors, not the complete future Java binding schema.

`editor.setExecution()` accepts an `ExecutionOverlay` directly and still accepts old `SimulationSnapshot` values through an internal compatibility projection. The core `FlowSimulator` remains useful for local control-flow exploration, but it does not execute action previews or reproduce every production runner behavior.

## Example replay and development

Run `npm run dev`, then open `http://127.0.0.1:4173/examples/index.html`. The command builds before serving, disables browser caching, and watches/reloads library source changes. This avoids using an old `dist/` implementation with newer demo buttons. Static serving after `npm run build` remains supported.

Placement and animations start natively. Drag/arrow movements are local view pins, including in read-only views. No placement saving, storage or undo entries are involved. `position` remains an initial layout seed in existing documents; this viewer never persists its adjustments.

The replay controls advance **sample observations**, not operations. Approved/declined scenarios show external approval signals and selected branches; failure/timeout scenarios show terminal transfer results. The mock event sequence includes Python output, HTTP status, streamed database row counts, transfer offsets/chunk progress, mail notification and inbound/outbound signals. Other families and unsupported operations are available as addable preview presets. There are no real runner connections or human-response forms in this example.

Play / Stop / Reset now live only in the dockable DevTools top bar and call the original replay handlers. Trace reuses the original list/detail controller; Performance inspection shows only the profiler-style top graph, with backend-supplied integer cost (explicitly labeled fixtures in the demo). See [DevTools refactor](devtools-refactor.md) for the real-window sync mechanism and persisted pane/theme keys.
