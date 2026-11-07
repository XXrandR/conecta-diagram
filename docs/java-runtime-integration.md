# Java runtime + diagram integration plan

**Status: proposed architecture and contracts, not an implemented Java server or streaming client.** The D3 editor and local simulator exist today. All REST/SSE endpoints, executable signal-binding types and durable production projections below are planned. Settle these contracts with the actual Java executor before implementing them.

**Current display layer:** action previews, `ExecutionOverlay` and a bounded `RunnerDisplay` projection now exist for display-only runner observations. See [runner display guide](runner-display.md). The production transport, durable projection/recovery, per-activation inspector and executable signal bindings described here remain planned. No code/SQL/request/transfer is executed by the diagram.

## 1. Responsibility boundaries

```text
Planning website                         Java platform
FlowStore + editor  --draft/revision-->  Plan API + semantic validator
Host inspector     <--signal catalog--  Signal/handler registry

Host input forms   --REST commands---->  Runtime command API + authorization
                                         |
                                         v
Read-only diagram  <--snapshot + SSE---  Durable execution engine
Runtime projection                       + transactional event log/outbox
```

- **Diagram library:** edit the planned graph; display signal bindings; render externally supplied activation/edge/signal status. D3 position ticks never emit business signals, alter execution or make network requests.
- **Website host:** authentication, permissions, persistence, streaming connection, reconnection UX, external forms, command submission, runtime-event reduction. Mount the live diagram read-only. A disconnected indicator is separate from the run's state.
- **Java API/executor:** validate and publish plans; own all authoritative execution, routing, waits, signal matching, timeouts, retries, cancellation, side effects and access control. A server decision is never recomputed in the viewer to guess its result.
- **Local FlowSimulator:** planning/testing only. Its synthetic token ids, state and simulated conditions are not production activation ids or a command source.

Do not embed HTTP calls or subscriptions into individual SVG nodes. Use one host-owned connection/projection per open run, reusable across React/Angular views. Unmounting a view closes its subscription; it does **not** cancel a server run.

## 2. Versioned plans and signal bindings

Publish an immutable **flow revision** containing `{ document, bindings }`. Keep bindings as a separate versioned JSON object rather than stuffing execution code into labels or D3 objects. This preserves the existing `FlowDocument` v1 and allows the same diagram to be bound to different environments. Both parts are hashed/versioned together. The Java service must reject invalid references before publishing.

Proposed binding contract (illustrative, not current exported types):

```ts
interface SignalRef {
  name: string;
  version: number;
}
interface ValueMapping {
  targetPath: string[];
  sourcePath: string[];
}
interface RuntimeBindings {
  schemaVersion: 1;
  nodes: Array<{
    nodeId: string;
    handlerRef?: { name: string; version: number };
    inputs?: Array<{
      portId: string;
      signal: SignalRef;
      purpose: "start-task" | "resume-wait" | "decision-input";
      mapPayload: ValueMapping[];
    }>;
    outputs?: Array<{
      portId: string;
      signal: SignalRef;
      on: "started" | "completed" | "failed" | "decision-selected";
      edgeId?: string; // Required for decision-selected, points to that decision's output
      mapPayload: ValueMapping[];
    }>;
  }>;
}
```

The `purpose` choices are catalog/schema capabilities, **not arbitrary instruction strings**. For the first implementation, support `resume-wait` and outputs on completion/decision selection. Defer `start-task` and `decision-input` until their enablement/buffering semantics have been agreed with the executor. A task is not automatically signal-gated merely because it has an input port in a drawing.

### Signal catalog

Java publishes allowed signal definitions: stable name/version, display name, description, JSON Schema 2020-12 payload schema, direction/capabilities, and sensitivity classification. Handler definitions specify accepted inputs/outputs and permitted node types. Restrict schema resolution to a controlled registry; no arbitrary external `$ref` fetches. Versioned schemas are immutable. Apply schema size/depth/payload limits.

- A task completion may emit `order.processed@1`; Java writes the output once for that activation/attempt transition using an outbox. The browser only animates the recorded event.
- A wait node may subscribe to `approval.received@1`. The host shows an approval form elsewhere; an authorized command targets a concrete subscription/activation.
- A decision may use context populated by a preceding signal wait. Recommended v1 flow: **wait → decision**, not a decision that secretly waits. Record the selected edge id and context version in the server event.
- An output linked to a selected decision branch emits only when that branch is actually selected, not when it becomes visible or when a condition happens to be true in the browser.
- Bindings use node/edge/port ids, not labels or positions. Rewiring an edge preserves its id but may invalidate a binding; publishing must validate the new owner/type/endpoint constraints. Existing runs keep their original revision.
- Mapping is a constrained own-property path mapping, not JavaScript, SpEL or arbitrary Java class names. Define collision, missing-value and type-error rules; reject ambiguous mappings at publication. Payloads and schemas remain data only.

If Java executes the document's condition AST, specify the same structural equality, own-property/missing-path behavior and deterministic priority/edge-id ordering as the simulator. Numeric comparisons must use a common finite IEEE-754 domain; reject unsafe integer requirements for numeric conditions rather than silently comparing Java `BigDecimal` values differently from browser `Number`. Carry monetary/64-bit domain values as schema-defined strings and evaluate them with a versioned domain handler when exact ordering is required. The server remains authoritative even when a planning simulation differs.

### Signal matching and delivery policy

Use a durable subscription id issued by Java when an activation begins waiting. The command contains `runId`, `activationId`, `attemptId`, `subscriptionId`, `signalRef` and payload. Tenant identity comes from the authenticated principal, not a trusted client field. The server checks that all identifiers belong together and that the subscription is still open.

Default: targeted, single-consumer, no implicit broadcast; no matching by node id alone. Two loop visits to the same node are distinct activations; two parallel waiters cannot consume one response accidentally. Repeated submissions with the same idempotency key return the original receipt. A different command for an already-consumed subscription returns `409 SUBSCRIPTION_CLOSED`.

For external producer integrations, provide a separately authorized service-to-service ingress with an explicit, registered correlation policy. Do not let public website callers choose arbitrary tenant-wide correlation expressions. By default, an early signal without an active subscription is rejected. Durable early-message inboxes, TTLs, broadcast and multi-consumer delivery are later capabilities with explicit policy—not silent buffering.

## 3. REST surface (`/api/v1`)

All identifiers in path segments must be URL-encoded. Every resource and command is tenant-authorized. JSON responses are bounded; use cursor pagination for catalogs/history.

| Method | Endpoint                                 | Contract                                                                                                   |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/signal-definitions`                    | Versioned signal catalog; optional name/version filters and pagination                                     |
| GET    | `/handler-definitions`                   | Allowlisted handler capabilities for the inspector                                                         |
| POST   | `/flows`                                 | Create an editable flow draft; returns id and ETag                                                         |
| GET    | `/flows/{flowId}/draft`                  | `{document, bindings}` and strong ETag                                                                     |
| PUT    | `/flows/{flowId}/draft`                  | Atomically replace draft + bindings with `If-Match`; `412` for stale edits, `428` for missing precondition |
| POST   | `/flows/{flowId}/validate`               | Validate supplied draft + bindings without executing; structured diagnostics                               |
| POST   | `/flows/{flowId}/revisions`              | Publish immutable revision from the ETag-matched draft; requires idempotency key and `If-Match`            |
| GET    | `/flows/{flowId}/revisions/{revisionId}` | Exact immutable graph, bindings, schema versions and content hash                                          |
| POST   | `/runs`                                  | Start a run pinned to a published revision, input and idempotency key; `202` + run id/Location             |
| GET    | `/runs/{runId}/snapshot`                 | Consistent runtime projection **and its included cursor**, capabilities and pinned revision reference      |
| GET    | `/runs/{runId}/events?after={cursor}`    | SSE replay then live tail, exclusive of cursor                                                             |
| GET    | `/runs/{runId}/pending-inputs`           | Authorized pending subscriptions/forms, paginated; UI helper, not source of runtime ordering               |
| POST   | `/runs/{runId}/signals`                  | Deliver a targeted signal from a host form; `202` + durable command receipt                                |
| POST   | `/runs/{runId}/commands`                 | Cancel/retry/resume where supported; idempotent command with expected version                              |
| GET    | `/runs/{runId}/commands/{commandId}`     | Receipt/result for lost responses or asynchronous processing                                               |

Do not expose worker task-completion endpoints to ordinary website users. Actual worker completion uses a separately authorized internal API/message channel with activation/attempt fencing. The browser's local simulator `complete()` is not a credential to complete real work.

### Signal command example

```http
POST /api/v1/runs/run-42/signals
Idempotency-Key: 47315cd4-a3fb-4a7c-8ed1-b013c8239420
Content-Type: application/json
X-CSRF-Token: <host-token-if-cookie-authenticated>

{
  "activationId": "activation-19",
  "attemptId": "attempt-1",
  "subscriptionId": "subscription-7",
  "signal": { "name": "approval.received", "version": 1 },
  "expectedSubscriptionVersion": "3",
  "payload": { "approved": true, "comment": "Approved by manager" }
}
```

`202 { commandId, status: 'accepted', statusUrl }` means durably accepted, not executed. The stream eventually records `signal.received`, `signal.consumed` or a rejection result. Reuse the **same** key and body after a network timeout; never generate a new key for an uncertain retry. A key reused with a different body returns `409 IDEMPOTENCY_CONFLICT`. Scope keys by tenant, operation and resource; store a request hash and receipt durably. Advertise/enforce retention (initial recommendation: at least the run's active lifetime plus replay/command retry window); do not silently accept late retries as new commands after expiration.

Use subscription-specific optimistic versions for signals; requiring the whole run version would reject independent parallel responses unnecessarily. Cancellation/retry commands may require the run/control or activation version appropriate to their scope. Authorization and version checks happen atomically with acceptance.

Errors: RFC 9457 `application/problem+json`, plus stable `code`, `traceId`, optional diagnostics. Define `400` malformed, `401/403` auth, `404` not found, `409` state/idempotency conflict, `410` expired stream cursor, `412/428` draft preconditions, `422` invalid plans/payloads, `429` quotas and `503` transient overload. Never treat every error as reconnectable.

## 4. Runtime event and snapshot contract

Use a **per-run durable contiguous sequence**, allocated in the same transaction as the state transition and outbox write. Encode counters as decimal strings (Java `long` can exceed JavaScript's safe integer range). A cursor is an opaque, signed encoding of tenant/run/stream-schema/sequence; it is not a bare sequence number. `eventId` and SSE `id` equal that event's cursor. Validate scope/signature on reconnect so a cursor from another run cannot silently attach. Compare the event's decimal `sequence` in the reducer, never the opaque cursor. Rotate signing keys with overlap sufficient for retained cursors.

```json
{
  "schemaVersion": 1,
  "runId": "run-42",
  "revisionId": "revision-8",
  "sequence": "104",
  "cursor": "cur-run42-104-signed",
  "eventId": "cur-run42-104-signed",
  "type": "decision.selected",
  "occurredAt": "2026-10-27T12:00:00Z",
  "activationId": "activation-20",
  "attemptId": "attempt-1",
  "nodeId": "decision",
  "causationId": "command-23",
  "correlationId": "order-18",
  "payload": { "edgeId": "approved", "contextVersion": "12" }
}
```

Minimum event families:

- `run.started`, `run.completed`, `run.failed`, `run.cancelled`.
- `activation.started`, `activation.waiting`, `activation.completed`, `activation.failed`, `activation.cancelled`, `activation.retry-scheduled`.
- `subscription.opened`, `subscription.closed` (public, authorized descriptors, not secrets).
- `signal.received`, `signal.consumed`, `signal.emitted`, `signal.rejected` (redacted payload summaries).
- `decision.selected`, `edge.traversed`, `command.resolved`.

Each activation snapshot includes `activationId`, `attemptId`, `nodeId`, status, version and permitted actions. Carry correlation/parent fork activation ids when displaying concurrent branches. Never deduplicate state by node id. A single node can have running, completed and waiting activations at the same time; the renderer should show counts/status summaries and let the inspector select an activation.

Proposed snapshot:

```ts
interface RuntimeSnapshot {
  schemaVersion: 1;
  runId: string;
  flowId: string;
  revisionId: string;
  cursor: string; // All events <= cursor are included atomically
  sequence: string; // Last included decimal sequence; "0" before any events
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  activations: RuntimeActivation[];
  traversedEdges: Array<{ edgeId: string; count: number }>;
  pendingInputs: PendingSubscription[];
  allowedActions: string[];
}
```

Do not put a full execution history or unbounded payloads into each snapshot. Paginate history separately. The snapshot must come from a projection at its declared cursor/sequence; it cannot combine newer engine state with an older projection cursor. Include only viewer-authorized, redacted context summaries. All authorized viewers of a run observe the same sequence; redact sensitive payload fields rather than silently filtering whole events and creating gaps. If an event must be fully hidden, send a versioned `event.redacted` no-op at its sequence. If even event existence is confidential, use a separate scoped stream/sequence instead of this per-run contract.

### Diagram projection

Current library: `ExecutionOverlay` and `RunnerDisplay` are separate from `SimulationSnapshot` and can show command statuses, progress, signal observations and selected branches. Next production phase: extend this into a durable `RuntimeProjection` with per-activation identities/counts, edge traversal counts and signal-link state (`unbound`, `waiting`, `received`, `emitted`, `failed`). It must support concurrent/retried activations and authoritative snapshot recovery, beyond the latest-command-per-node visual summary.

For now, the host can map redacted results through `RunnerDisplay` or provide an `ExecutionOverlay` to `setExecution()`. The old simulator-snapshot adapter is still available for local simulations. Neither is the production wire format: a latest-command-per-node summary lacks concurrent-activation history/inspectors and durable retry/recovery semantics. Do not pretend a real run can be resumed by the local simulator.

## 5. Website streaming: SSE first

Use SSE for server → website observations and REST for website → server commands. This matches mostly one-way monitoring, supports HTTP infrastructure, and avoids inventing WebSocket acknowledgements/replay. D3 animations run locally between received updates; do not stream animation frames. Reconsider WebSockets only for concrete bidirectional collaboration requirements.

```text
GET /api/v1/runs/run-42/events?after=cur-run42-103-signed
Accept: text/event-stream

retry: 2000
id: cur-run42-104-signed
event: runtime.event
data: {"schemaVersion":1,"runId":"run-42","sequence":"104",...}

: heartbeat

```

### Initial attach and reconnect algorithm

1. Enter `connecting`. Fetch snapshot `S`, its `cursor=C`, and the exact pinned revision. Validate versions/ids and install snapshot atomically in the host projection.
2. Open SSE **after C**, exclusive, then replay retained events and continue live on the same logical stream. Backend replay/live handoff must not miss events committed while replaying; use a durable-log tail or subscribe+buffer+deduplicate. It cannot be a naive historical query followed by an in-memory subscription.
3. A host-owned reducer tracks `lastApplied={cursor, sequence}` initialized from the snapshot. Ignore duplicates `sequence <= lastApplied.sequence`. Apply exactly `lastApplied.sequence+1`, then advance both fields **after a successful validated application**. Use decimal-string/`BigInt` comparisons, not floating-point `Number` conversions. Unknown schema/event type, wrong run/revision, malformed data, or a gap triggers resync rather than speculative application.
4. On disconnect, retain the last projection, mark it stale/reconnecting, and disable unsafe command UI. Reconnect from `lastApplied.cursor` with exponential full-jitter backoff (e.g. base 1s, cap 30s), online/visibility awareness, and one in-flight connection per run. Heartbeats every ~15s; an idle watchdog around 45s should reconnect. Heartbeat comments advance neither cursor nor domain state. Do not substitute offline status for run failure.
5. If the cursor has expired or exceeds the server head, stop the stream, fetch a fresh snapshot/revision, install it, and attach again. Clear old queued events. For a stream already opened, Java can emit `event: stream.reset` with a reason **without an id**, then close; the host must resnapshot, not reduce this as a domain event. A connection attempt with expired cursor should return `410` with a snapshot URL.
6. On `401/403`, pause/stop, refresh host authentication if permitted, and avoid retry storms. On `429/503`, honor `Retry-After` where available. Fail closed on protocol/schema errors with a visible diagnostic and bounded resync attempts. On unmount/run switch, close/abort the old connection and ignore late callbacks via a connection generation id.
7. Persist a cursor only together with the corresponding projection and revision. A bare cursor in local storage is not sufficient after a page reload. Safest first release: always fetch a fresh snapshot on reload.

### Native EventSource vs authenticated fetch

- Native `EventSource` works well for same-origin secure HttpOnly cookie auth. Automatic reconnect sends `Last-Event-ID`, but this is the **browser's last dispatched event**, not necessarily the reducer's last successfully applied event. On application/schema/reduction errors, close it and reopen with an explicit `after=lastApplied.cursor`, or resnapshot. Server rule: use `Last-Event-ID` when present on native automatic reconnect, otherwise the initial `after` query; validate both and document precedence.
- Native EventSource cannot set arbitrary bearer headers and hides non-200 response details. For bearer auth, precise `410/Retry-After` handling or a fully controlled cursor, prefer a **fetch-based SSE client** owned by the host, using Authorization/AbortController and `after=lastApplied.cursor`. Never put long-lived access tokens in URLs. Use an audited SSE parser: events can span chunks, lines can split, multiple `data:` lines must join, UTF-8 can split, comments/CRLF must be handled, and incomplete events must not dispatch. Bound message size and parse buffers.
- Use one reconnect mechanism: either native EventSource's reconnect or the fetch client's policy, not both layered simultaneously. Unknown run ids and logout must close streams immediately. Set correct CORS allowlist/credentials policy; cookie-authenticated commands require CSRF protection.

Replay is **at least once**. The viewer reducer is idempotent; commands and engine transitions are durably idempotent. Do not claim end-to-end exactly-once networking.

## 6. Java implementation sketch

Recommended reference stack: Spring Boot + WebFlux `Flux<ServerSentEvent<RuntimeEvent>>` (or Spring MVC `SseEmitter` if that matches the existing stack). Do not migrate the whole backend solely for SSE. Blocking database/worker calls must not run on a reactive event loop.

- PostgreSQL tables: drafts + draft version; immutable revisions + bindings/hash; runs; activations/attempts; active signal subscriptions with versions; command receipts with unique idempotency scope; durable inbox; ordered per-run event log; transactional outbox. Include tenant keys in indexes/uniqueness/access checks.
- A state transition transaction locks/fences the relevant activation/subscription, validates the command, updates state, assigns the next per-run sequence, appends public events and enqueues side effects. Publish only committed outbox rows. A database sequence that creates permanent holes on rollback is **not** a contiguous per-run event allocator; use an atomic per-run counter in the transaction.
- Serialize run transitions or use optimistic state/version checks. Parallel completions may arrive concurrently but must result in one ordered event log and correct fork-instance joins. Never use client timestamps for order.
- Redis/Kafka can notify SSE instances of new events; they are not the sole source of replay truth. Multiple Java instances must replay the same durable events after failover without relying on sticky sessions.
- SSE controller authenticates/authorizes, validates cursor, then exposes replay+tail with a **bounded** per-client queue. On slow consumers, disconnect/reset for replay or resnapshot rather than buffering without limit or silently dropping a middle event. Honor cancellation on socket close.
- Return `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`; disable reverse-proxy response buffering/compression-induced delays where needed (e.g. `X-Accel-Buffering: no`). Set idle timeouts above the heartbeat cadence. Verify ingress/load balancer behavior in staging.
- Define retention by time/volume (initial target e.g. 7 days for hot public events, configurable); snapshots make older cursors recoverable. Advertise `earliestCursor` and `headCursor` in snapshot/stream metadata. Apply quotas by tenant/user/run and cap concurrent streams. HTTP/2 is recommended for multi-tab monitoring.
- Observe open connections, reconnect rate, replay lag/length, cursor resets, dropped slow consumers, command dedupe/conflicts, signal consumption latency, outbox backlog and per-run transition contention. Use trace/correlation ids, not raw signal payloads or tokens, in logs.

## 7. Reconnection UX vs graph rewiring

These are different operations:

- **Stream reconnect:** transparent replay/resnapshot; do not recreate the plan or reset the camera on every event. Keep the last known diagram with a stale badge. Re-enable forms only after confirming the subscription is current; refetch a pending-input descriptor before submitting after a long outage.
- **Edge reconnection in the planner:** `beginReconnection(edgeId, 'source' | 'target')` or `store.updateEdge()` changes an endpoint in one undoable draft edit, preserving edge id/condition/metadata. Revalidate signal bindings and decision ownership. Never rewire an immutable revision under an active run; publish a new revision and start/migrate explicitly using executor policy.
- **Signal binding reconnection:** the inspector changes which port/signal reference is bound. This is a draft/binding edit, not a live `unsubscribe` command. Existing server subscriptions are unaffected until a separately authorized runtime operation exists.

## 8. Delivery phases and acceptance tests

1. **Contracts first:** confirm engine vocabulary/statuses, signal catalog/schema, immutable revision envelope, identity/attempt semantics and authorization with Java owners. Produce OpenAPI 3.1 + JSON Schemas for REST/events and shared fixtures. Java and TypeScript must pass the same fixtures (including conditions/numeric boundaries if Java interprets the condition AST).
2. **Bindings authoring:** typed binding validator and inspector APIs; signal in/out port decorations with visible status and accessible labels; reject removed/stale node/edge/port references on publish. Preserve flow v1 compatibility and keep runtime networking outside the editor.
3. **Read-only runtime:** Java snapshot + retained log + SSE; independent TypeScript reducer and host transport package; dedicated `ExecutionOverlay`; status/activation inspector; stale/reconnecting/resync/auth UX. Batch high-frequency display updates to browser animation frames without skipping reducer events.
4. **External commands:** signal forms, subscription-scoped optimistic concurrency, durable idempotency receipts, role-based permissions and command result display. Never submit from render/tick/replay handlers.
5. **Hardening/release:** real-browser tests, proxy failover/restart drills, load tests, accessibility and payload redaction/security review.

Required acceptance scenarios: snapshot-to-stream race; disconnect before/after command acceptance; duplicate/out-of-order events; events above `2^53`; cursor expiration/reset; token expiration/logout; multi-tab/multi-instance reconnect; slow consumers; schema mismatch; run switching/unmount; terminal runs; two responses racing for one subscription; multiple activations of the same node; retries with stale attempt ids; nested parallel joins; node/edge deleted from a new draft while an old revision runs; a signal arriving too early; business completion while the browser is offline. Reconnect must not re-execute a task, re-emit a signal, or reapply a user response.

### Decisions to confirm before backend implementation

- Existing Java stack, event store/broker and tenant/auth model.
- Signal schema registry and who can publish/consume each definition.
- Initial policies for early signals, payload mapping, retries/timeouts and run migration.
- Event/receipt retention and maximum stream/snapshot/payload sizes.
- Whether human responses always target a pending subscription (recommended).
- Whether the first release needs only same-origin cookie SSE or bearer/fetch streaming too.
