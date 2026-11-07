# Maximus Diagram

A TypeScript library for **planning program flows**, editing diagrams, and simulating control flow. Framework-independent: React and Angular are hosts, not dependencies. The core has no D3 imports; presentation uses focused D3 modules for physics, keyed joins, easing, interpolation and frame scheduling.

## Development

Use Node 22.18+ for the development tools. The built core supports Node 20+; the SVG adapter requires a browser when instantiated.

```sh
npm ci
npm run dev               # Builds first, serves current demo, watches/reloads changes
npm run check             # types, tests, dual-format build, package import checks
npm run test:browser      # After build; requires Chromium on PATH (or BROWSER_BINARY)
npm audit
npm pack --dry-run
```

Use `npm run dev` and open `http://127.0.0.1:4173/examples/index.html` for the runner-operation viewer and simulated result/signal replay. This builds before serving and avoids stale `dist` imports. Static serving after a fresh build also works. `examples/approval.ts` remains a typed async/parallel/human-approval control-flow example.

The proposed npm name is `@maximus/diagram`. **Confirm ownership/availability of that scope and choose a license before publishing.** Nothing is published automatically. The publish allowlist includes only `dist/`, the README and integration documentation, not the old prototype, tests, examples, or editor swap files.

## Quick start

Load the shared visual system once in your browser entry: `import '@maximus/diagram/photon.css';`.

```ts
import { FlowStore, SvgFlowEditor, type FlowDocument } from "@maximus/diagram";

const flow: FlowDocument = {
  schemaVersion: 1,
  id: "hello",
  nodes: [
    {
      id: "start",
      type: "start",
      label: "Start",
      position: { x: 100, y: 150 },
    },
    {
      id: "task",
      type: "task",
      mode: "async",
      handler: "send-email",
      label: "Send email",
      position: { x: 350, y: 150 },
    },
    { id: "end", type: "end", label: "Done", position: { x: 600, y: 150 } },
  ],
  edges: [
    { id: "a", source: "start", target: "task" },
    { id: "b", source: "task", target: "end" },
  ],
};

const store = new FlowStore(flow);
// <svg viewBox="0 0 1000 600" width="100%" height="600"></svg>
const editor = new SvgFlowEditor(svgElement, store, {
  width: 1000,
  height: 600,
  onNodeActivate: (node) => openYourInspector(node),
  onError: (error) => console.error(error),
});
editor.fitToView();

const unsubscribe = store.subscribe(({ document, reason, revision }) => {
  // Persist document or synchronize with your host application's state.
});

// On unmount:
unsubscribe();
editor.destroy();
```

Use `@maximus/diagram/core` for Node/server simulations and authoring without a renderer. Use `@maximus/diagram/svg` for the SVG adapter. ESM and CommonJS exports include TypeScript declarations. Even the root entry is safe to import during SSR; only instantiate the adapter after a browser mount.

## Flow model

Documents are versioned JSON. Nodes and edges have unique ids in their respective namespaces, and edges reference node **ids**, never mutable node objects. Coordinates represent node centers. Use `data` objects for application-specific JSON metadata.

| Node                             | Meaning                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `start`                          | One entry, one output; exactly one per executable document    |
| `task`, `mode: 'sync'` (default) | A simulated operation that advances immediately               |
| `task`, `mode: 'async'`          | Wait for `complete(tokenId, patch)` from the host             |
| `wait`, `signal`                 | Wait for `signal(tokenId, signalName, patch)` from the host   |
| `decision`                       | Take one matching conditional branch or its required fallback |
| `fork`, `join: id`               | Activate all output branches; names the matching join         |
| `join`, `fork: id`               | Wait for every branch of the corresponding fork activation    |
| `end`                            | Finish this token; no outputs                                 |

Normal nodes have exactly one output. Multiple inputs on a normal node **do not synchronize**: each incoming token activates it separately. Use an explicit join to synchronize. Parallel regions must be properly nested; branches cannot bypass their join or enter a join from outside its fork. Multiple end nodes and sequential loops are supported.

### Conditions

Conditions are a data AST, not JavaScript strings. No `eval`, expression compiler, or arbitrary property traversal. Paths use arrays, including nested properties and array indices as strings.

```ts
import type { Condition } from "@maximus/diagram/core";

const condition: Condition = {
  op: "all",
  conditions: [
    { op: "gte", path: ["order", "total"], value: 100 },
    { op: "eq", path: ["approval", "accepted"], value: true },
  ],
};

store.addEdge({
  id: "accepted",
  source: "decision",
  target: "success",
  label: "Approved",
  condition: { op: "eq", path: ["approved"], value: true },
  priority: 0,
});
store.addEdge({
  id: "fallback",
  source: "decision",
  target: "rejected",
  label: "Otherwise",
  default: true,
});
```

Supported operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`, `all`, `any`, `not`. Equality is structural JSON equality, with no type coercion; numeric ordering requires numbers. Missing paths make comparisons false, including `neq`. `exists` is true for explicit `null`. Empty `all` is true, empty `any` is false. Only own properties are resolved.

Each decision needs exactly one unconditional default and conditions on all other outputs. If several conditions match, lower `priority` wins (default `0`), then lexicographic edge id. A fallback cannot also have a condition.

`visibleWhen` on nodes/edges is **presentation only**. `editor.setContext(context)` controls visibility; incident edges of hidden nodes are hidden. Execution always uses the full document. Changing a node's visibility must never silently change the program.

## Authoring APIs

```ts
store.addNode(node);
store.updateNode(id, (node) => ({ ...node, label: "New label" }));
store.moveNode(id, { x: 100, y: 200 });
store.removeNode(id); // Also removes incident edges
store.addEdge(edge);
store.updateEdge(id, (edge) => ({ ...edge, label: "Yes" }));
store.removeEdge(id);
store.replace(document);
store.undo();
store.redo();
store.canUndo;
store.canRedo;

store.transaction("insert-branch", (draft) => {
  // Perform several related mutations on a detached draft.
  draft.nodes.push(newNode);
  draft.edges.push(newEdge);
});
```

Transactions are synchronous and atomic. Invalid changes throw `FlowError` without changing history or publishing an event. Unchanged transactions do not notify. Snapshots are deeply frozen and stable until the next edit, suitable for external-store integration. Inputs are copied and undo history is bounded (default 100). Dragging is view-only and does not create a transaction. Async/nested transactions and edits from inside notification callbacks are rejected. Use `onListenerError` in store options to observe subscriber failures without corrupting a committed edit.

```ts
import {
  validateFlow,
  parseFlow,
  serializeFlow,
  layoutFlow,
} from "@maximus/diagram/core";

const draftIssues = validateFlow(value, { mode: "draft" });
const executionIssues = validateFlow(value); // Default: executable
const document = parseFlow(importedJson); // Draft validation; unknown versions rejected
const exportedJson = serializeFlow(document);
store.replace(layoutFlow(document, { direction: "right" }));
```

Drafts may be incomplete. Draft validation still requires well-formed JSON, valid node/condition shapes, unique ids, and non-dangling edges. Executable validation also checks routing, entry/exit rules, structured parallel regions, reachability warnings, and routes to an end. Errors contain structured diagnostics (`code`, `path`, `severity`, `message`). Reachability/termination of arbitrary conditions cannot be proven statically; loops must be bounded at runtime.

## Simulations and external runtimes

```ts
import { FlowSimulator } from "@maximus/diagram/core";

const simulation = new FlowSimulator(store.getSnapshot(), { approved: false });
let result = simulation.run(1000);
editor.setExecution(result.snapshot);

// Async work is deliberately not executed by this library.
const pendingTask = result.snapshot.tokens.find(
  (token) => token.status === "async",
);
if (pendingTask) simulation.complete(pendingTask.id, { result: "ok" });

result = simulation.run();
const pendingInput = result.snapshot.tokens.find(
  (token) => token.status === "signal",
);
if (pendingInput) {
  // Your application collects a response elsewhere, then delivers it here.
  simulation.signal(pendingInput.id, "approval.received", { approved: true });
}
editor.setExecution(simulation.run().snapshot);
```

- `step()` processes one ready token. `run(maxSteps)` stops on a wait, completion, failure, cancellation, or step budget. A `step-limit` result is resumable, not a failure.
- Async completion and signals target **activation token ids**, not node ids. This prevents one response from completing unrelated loop/parallel activations. Wrong signals, wrong token states, and duplicate responses are rejected atomically.
- Fork instances have correlation frames; nested and repeated forks do not mix their join arrivals. Ready tokens run FIFO to avoid starving other branches.
- Context is one shared JSON object. Completion/signal patches are shallow top-level merges. Concurrent results are applied in the order the host submits them; use separate context keys for independent branches.
- `fail(tokenId, message)` fails the run; `cancel()` terminates it. There are no implicit retries, side effects, clocks, promises, or network requests.
- A simulator captures an immutable document revision. Later edits do not rewrite an active run. Create a new simulator for a new plan.
- Snapshots include tokens, completed node ids, traversed edge ids, bounded ordered events, context and step count. `traceLimit` defaults to 1000, `maxTokens` to 10000. Snapshots are observation data, not durable checkpoints to restore.
- Feed snapshots to `editor.setExecution(snapshot)` to visualize local simulations. For runner observations, use `RunnerDisplay` or supply an `ExecutionOverlay` directly. `setExecution(null)` clears the overlay. Rendering never mutates the plan.

## Task actions, decisions and runner observations

Task/decision nodes can carry validated `action` previews for API, database, file/transfer, process/Python, SSH, SFTP, mail, messaging, event, cancellation and generic extension families. `signals` describes displayed IN/OUT names. Decision `decision.expression` is a code preview, not executable logic. Photon cards show operation details and observed status; Assemble is the only node/global editing surface, and Trace owns execution detail.

See **[Runner display guide](docs/runner-display.md)** for the types, protobuf mapping boundary, advertised capabilities, uint64 result sequences, independent command/file-chunk finality, and safe result projection. No generated protocol client or real API integration is included. Code/SQL/requests are never executed by the diagram. The demo replays fake runner events/signals rather than asking the user to execute tasks manually.

The demo uses one dockable **DevTools** section with Assemble, Trace and Performance inspection tabs. The old fixed DETAILS and bottom-console shells are removed. DevTools docks bottom/right/left or opens in a real synchronized window; pane sizes and light/dark preferences persist. See **[Photon + DevTools refactor](docs/devtools-refactor.md)** for the complete architecture, unchanged replay call path, sync protocol and acceptance checks.

## SVG interaction

Drag nodes, drag empty space to pan, scroll to zoom, click nodes/edges to select, and double-click a node to open a host-provided inspector. Keyboard: Enter/Space selects, arrows move a selected node (Shift = larger step), Delete removes, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes, C starts a connection, Escape cancels. Choose a target node to finish the connection. With an edge selected, R reconnects its target (Shift+R reconnects its source). `beginReconnection(edgeId, endpoint)` rewires in one undoable edit while preserving edge id, condition and metadata. Interactive edges are draft edges; configure their conditions/defaults in your inspector before executing.

The library does not impose a toolbar, modal, global side panel, or input form. Create nodes and edit properties through the store using your framework's components. `readOnly: true` disables planning edits but retains selection, view-only node movement, pan/zoom and overlays; it is a UI mode, not an authorization boundary for the store.

Adapter API: `select`, `getSelection`, `beginConnection`, `beginReconnection`, `cancelConnection`, `setContext`, `setExecution`, `getViewport`, `setViewport`, `animateViewport`, `zoomBy`, `fitToView`, `resize`, `exportSvg`, `destroy`, plus the placement APIs below. Selection callbacks receive `{ type: 'node' | 'edge' | 'global', id }` or `null`. Viewport changes do not enter document history. Coordinate units follow the host SVG's viewBox; update that viewBox alongside `resize(width, height)` if your host uses one.

Import `@maximus/diagram/photon.css` with the renderer. Its light/dark token blocks use the Photon palette from `docs/photon-template.html`. Set `html[data-theme="light" | "dark"]`; the demo persists `wf-theme`. Node cards use the template's real `.flow-node` structure inside SVG foreignObjects, including category stripe, signals, preview and footer. No extra theme tokens were added. Groups expose `data-node-id`/`data-state`, edges expose `data-edge-id`. All user-provided text is inserted safely through DOM APIs. `destroy()` removes only instance-owned content/listeners.

Diagram globals are optional `FlowDocument.globals` values with explicit `array`, `boolean`, `integer` or `json` types. `FlowStore.addGlobal/updateGlobal/removeGlobal` validate and preserve undo history. `orderedFlowItems()` pins globals before nodes/connections in recorded creation order. Globals are not new workflow nodes and have no implicit reference/execution behavior.

## D3 placement and motion

```ts
const editor = new SvgFlowEditor(svgElement, store, {
  force: {
    anchorStrength: 0.12,
    maxDisplacement: 200,
    fixedNodeIds: ["start"],
  },
  motion: "auto", // Honors prefers-reduced-motion; also 'full' or 'reduced'
  animationDuration: 180, // Milliseconds; 0 disables authored-position tweens
});

// Physics starts automatically; no placement button or saving step is required.
editor.getNodePositions(); // Detached map of currently displayed coordinates
editor.moveNodeView("start", { x: 200, y: 150 }); // Local visual pin, not a plan edit
editor.resetPlacement(); // Clear local pins and restore the native initial placement
editor.fitToView(50, true); // Fit displayed positions with an animated camera
editor.animateViewport({ x: 20, y: 30, scale: 1.5 }, 250);
```

Force placement is **native/default**; an optional `force` object tunes it, and `force: false` is available for static/testing views. D3 operates on detached mutable physics nodes and cloned link endpoints. It cannot mutate frozen plans, stream runtime commands, or flood undo history. Initial-position springs, link springs, charge and quadtree-backed rectangular collisions gently arrange nodes rather than globally recentering the plan. Existing `position` values are initial seeds, not persisted drag coordinates. `maxDisplacement` bounds drift around each seed; dense/pinned graphs may still overlap. This is gentle placement, not a guaranteed nonoverlap/obstacle-routing solver.

Dragging/arrow keys pin the displayed node while neighbors relax. Everything remains local to the view: no position saving, plan mutation or history entries. `commitPlacement()` and the old placement controls have been removed. Optional programmatic `relax()`, `stopForce()` and `settlePlacement()` remain available for compatibility/controlled rendering, but normal users never need them. Read-only views can be arranged without rewiring edges. Geometry ticks update transforms, paths and labels without replacing group elements. Keyed D3 joins preserve group identity/focus; motion uses D3 timers, interpolation and easing.

With reduced motion, camera/position tweens are immediate and a requested force relaxation settles synchronously for 120 ticks rather than running an animated simulation. Automatic preference changes stop ongoing animations. Metadata, selection and execution-overlay updates do not reheat physics; topology/authored-coordinate edits do. `destroy()` stops force and animation timers and removes listeners, including the motion-preference listener.

For headless D3 placement use the dedicated entry (no DOM required):

```ts
import { ForcePlacement } from "@maximus/diagram/d3";
const placement = new ForcePlacement(document, { maxDisplacement: 150 });
const positions = placement.tick(120); // Constructor is stopped; same inputs/ticks are deterministic
placement.destroy();
```

`ForcePlacement` also exposes `update`, `getPositions`, `subscribe`, `pin`, `restart`, `stop`, and idempotent `destroy`. Tick counts are bounded to 1–10000 per call. D3 modules are bundled into the presentation build so CommonJS and the static browser demo work without bare ESM imports; the `/core` build remains separate.

## Java execution API and signal-stream plan

See **[Java runtime integration plan](docs/java-runtime-integration.md)** for the proposed contracts and phased implementation. It covers task/decision signal bindings, immutable revision ownership, Java REST endpoints, snapshot + SSE projection, durable replay cursors, reconnect/resnapshot handling, command idempotency, authorization and concurrency tests. These endpoints and the production streaming client are **planned, not implemented**. The diagram remains the planner/viewer; Java remains the executor and the host website owns signal forms and network transport.

## React and Angular

React: keep the store outside the render cycle (or create it once with `useState`), mount in an effect, destroy in cleanup. The imperative adapter does not require React to reconcile SVG children.

```tsx
function FlowCanvas({ store }: { store: FlowStore }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const editor = new SvgFlowEditor(ref.current!, store, {
      width: 1000,
      height: 600,
    });
    editor.fitToView();
    return () => editor.destroy();
  }, [store]);
  return <svg ref={ref} viewBox="0 0 1000 600" width="100%" height="600" />;
}
```

For inspector state use `useSyncExternalStore` with `callback => store.subscribe(() => callback())` and `() => store.getSnapshot()` (including an appropriate server snapshot). Angular: instantiate in `ngAfterViewInit` using `@ViewChild`, then call `destroy()` in `ngOnDestroy`; bridge subscriptions into your component's preferred signals/change-detection mechanism. No framework-specific wrapper is required.

## Migration from the prototype

The original root-level D3 files and their existing local changes are preserved. They are **not the package entry point**, are excluded from the new TypeScript build, and are not published. New development lives in `src/`; the old prototype is not a compatibility layer.

- `BaseNode` instances become plain `FlowNode` data: lowercase `type`, `{ x, y }` becomes `position`, `properties` becomes JSON `data`.
- `BaseLink.originParent/finalParent` become `source/target` ids.
- Replace generic `Gateway` nodes with explicit `decision`, `fork` or `join` nodes. Branch labels alone are not execution conditions. Set conditional expressions and one fallback explicitly.
- The prototype's implicit fan-out becomes an explicit fork/join pair. Do not infer these semantics automatically from geometry.
- Replace `D3FlowDiagram` with `FlowStore` + `SvgFlowEditor`. Subscribe to store changes instead of mutable node arrays; always destroy the adapter when unmounting.
- Document-global menus are intentionally not carried forward. D3 force placement is a native, isolated presentation controller. Coordinates in old documents are initial seeds; dragging does not write back to them.

## Current boundaries / release gate

This release provides a tested core and a D3-assisted SVG authoring adapter, not every feature of an established visual IDE. It does **not** yet include obstacle-avoiding edge routing, multi-selection, signal ports/bindings UI, groups/subflows, collaboration, persisted simulation checkpoints, cancellation scopes, retries/timeouts, inclusive/event gateways, BPMN import/export, or built-in React/Angular components. Static layout is deterministic breadth-first placement; force placement is a bounded, approximate visual aid. Multiple edges between the same pair currently share a route. Group elements use keyed joins and physics ticks update geometry only, but large-graph performance still needs benchmarking.

Before declaring production maturity: exercise framework integrations, cross-browser accessibility and visual regressions, add large-graph performance tests, settle the package name/license, and review the public API against real execution-system requirements. Automated coverage exercises core editing/simulation, action previews, runner-result correlation/finality/uint64 handling, signals, D3 placement/motion, SVG lifecycle, and package imports. Chromium checks exercise real SVG coordinates, focus, motion, view-only dragging, operation/code inspection and approved/declined/failure/timeout event replays. Other browsers and exhaustive visual/accessibility checks are not yet covered.
