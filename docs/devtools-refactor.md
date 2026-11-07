# Photon diagram + DevTools refactor

## Source of truth and palette

`docs/photon-template.html` is the design source. `src/svg/photon.css` contains its **verbatim** `:root` and `html[data-theme="dark"]` blocks, its existing component names, and the process/service accent blocks. The asset-copy build step and unit tests enforce those token blocks byte-for-byte. All other app chrome uses those same tokens. Additional operation categories reuse the template's blue/cyan families; no extra hues are introduced.

**New theme/color tokens: none.** `--node-accent` and `--node-accent-soft` already exist in the template. Pane dimensions use inline geometry, not additional theme tokens.

The library now exports `@maximus/diagram/photon.css`. Import it explicitly alongside the renderer. HTML cards inside SVG `foreignObject` preserve the actual template structure and `::before` stripe: `.node-header` → `.signals` → `.action-preview` → `.node-divider` → `.node-footer`. Hover, selection, focus-visible, shadows and the 32px icon chip come from that shared stylesheet. SVG control shapes and edges also use Photon tokens. No node kinds were added.

## W1: diagram structure and globals

The fixed right-side DETAILS panel, `TaskInspector`, metadata editor shell and their styles/wiring have been removed. No fallback inspector remains beside the diagram. Selection editing is available only in **Assemble**.

`FlowDocument.globals` is an optional, backward-compatible, diagram-owned array:

```ts
{ id: 'limit', name: 'maxOrders', type: 'integer', value: 200 }
```

Types are `array`, `boolean`, `integer` (safe JSON/JS integer), and `json` (any serializable JSON). The store exposes `addGlobal`, `updateGlobal`, `removeGlobal`; edits are atomic, frozen, undoable and validated for type/unique identity/name. Global chips are visually distinct from nodes, share `.signal`, and always show a type badge plus value preview. No variable-reference UX or runtime interpolation was added.

`creationOrder` records interleaved node/edge creation. `orderedFlowItems()` pins globals first and preserves that order below them. Legacy documents without the field use their node-then-edge input order; history that was never recorded cannot be reconstructed. Host-created multi-item transactions can provide an explicit creation order. The demo persists edited documents under `wf-document`; the library itself does not impose browser persistence.

## W2/W3: one DevTools surface

`examples/devtools/shell.js` owns only the top bar, tab selection and tab-body lifecycle. Its sole top row contains **Assemble / Trace / Performance inspection**, then **Play / Stop / Reset / More / Close**. More contains the five requested docking/window/close actions. The old bottom-section shell and wiring no longer exist.

`DevToolsManager` docks the one surface bottom/right/left, hides/opens it, and handles a real second window. `resize.js` supplies pointer-capture and keyboard separators. Toolbar subsections, the outer dock, Assemble/Trace subsections, graph height, track label width and every performance track are resizable. Sizes are merged into **`localStorage['wf-panel-sizes']`**. Dock/tab/open preferences are in `wf-devtools-state`; theme is **`wf-theme`**, with only `light` or `dark` values. Storage-disabled mode remains usable in memory.

Assemble's left pane shows a selected node/connection/global editor; background selection shows all globals pinned first and then workflow items in creation order. Node edits expose a display name and the full validated JSON definition. Globals expose name, explicit type and JSON value. Unsaved drafts are not overwritten by replay updates; stale revisions are rejected and can be reloaded explicitly. The right pane's entire content is exactly **`In construction`**.

### Stable tab registration

```js
app.devtools.registerTab({
  id: "diagnostics",
  label: "Diagnostics",
  mount({ container, document, sizes, source }) {
    // Own this tab body only. Use source.command for owner actions.
    return {
      update(snapshot) {},
      visible() {},
      destroy() {},
    };
  },
});
```

Shell files do not change when adding a tab. Built-ins are registered in `examples/devtools/tabs/index.js`. Plugins that must also appear in a detached window should be registered from that shared registry/module entry: executable mount functions are deliberately **not** serialized through `postMessage`.

## Existing replay call path (not a second implementation)

Both docked and detached controls follow the same path:

```text
DevToolsShell Play → source.command('play') → examples/demo.js play()
                                           → existing next()
                                           → existing RunnerDisplay / journal
DevToolsShell Stop → source.command('stop') → existing pause() / clearTimeout()
DevToolsShell Reset → source.command('reset') → existing reset()
```

`next()` retains the same result/signal/decision/wait/finished branches. The existing `src/core/runner-display.ts` reducer and `examples/ui/journal.js` action model were not forked or rewritten. The separate window does not run a replay timer. Stop retains the old tracer's pause semantics; it is not a runner command cancellation. Closing DevTools does not cancel execution or start/reset a replay.

## W4: Trace migration

`examples/devtools/tabs/trace.js` supplies the tab's left action-list chrome and right selected-action pane. It mounts the existing `ExecutionConsole` controller. Its only migration shim scopes DOM lookups to the tab/document, allowing the same list/detail logic to run docked or detached. Existing filters, paging, selection, exact counters, transfer inspection, copy and complete export remain intact. The tab reconstructs its view cache with the existing `ExecutionJournal` class from owner snapshots; it does not dispatch/reduce operations again.

Scenario/speed/step controls live inside Trace, not in a second Play/Stop/Reset bar. Receipt time remains receipt time, not backend performance time. All sample observations are retained; pagination and filters do not truncate export.

## Separate-window synchronization

1. A user gesture calls `window.open('/examples/devtools.html#<random-session>', ...)`.
2. The new window sends a ready handshake. The opener validates **origin, source window and random session**, then sends a versioned, JSON-compatible snapshot.
3. The opener is the only owner of `FlowStore`, replay timer, `RunnerDisplay`, journal and `PerformanceTimeline`. Snapshots include document revision, selection, overlay, complete sample journal, metrics, theme, replay state and active tab.
4. The child sends allowlisted commands with request ids; mutations carry the expected document revision. The owner validates and applies the action, publishes a new snapshot, and acknowledges success/error. Stale edits fail without overwriting newer data.
5. The child ignores older versions. It only renders; no cloned store/reducer/timer executes workflow behavior. Theme also shares the same `wf-theme` storage value.
6. Detaching destroys the docked UI, preventing duplicate panel shells. Closing the child reattaches the latest state; choosing a dock or explicit Close follows that requested action. The opener cleans up listeners/timers and closes the child on unload. Popup blocking produces a visible diagnostic, not a fake in-page window.

This is same-origin UI synchronization, not a replacement for the future Java/SSE protocol. Tab-local filters/drafts belong to their view; authoritative model/execution/selection/theme state belongs to the opener.

## W5: profiler-style top graph only

The layout was informed by Firefox Profiler's `FullTimeline.tsx` (ruler/selection/global-track structure) and its counter/network track conventions. No Profiler source or non-Photon colors are copied. There is **no lower trace strip**.

`PerformanceTimeline.record(NodeRunPerformance)` accepts backend-run-relative start/duration, process identity, network intervals, exact decimal byte samples and a **backend-supplied integer cost per node run**. Cost is never derived from duration, memory, receipts, progress or command count. Invalid/fractional costs and conflicting duplicate run ids are rejected. The four tracks share one ruler/range: Parent process, Network, Memory, Cost. Graph/labels/tracks resize independently; range selection operates only on the view.

The demo uses explicit, labeled simulated-backend fixtures in `examples/performance-fixtures.js`, fed into this separate metrics sink after final mock results. A real host can use the exported core model or `app.recordPerformance(sample)` without changing the Trace reducer. Live Java endpoints remain outside this refactor.

## Verification

`npm run check` covers typed globals, interleaved creation order, performance integer/precision rules, palette fidelity, size persistence, existing core/replay behavior and dual-format/SSR package imports.

`npm run test:browser` checks actual Photon card geometry, old-shell removal, global chips, background item order, node/global edit persistence, resizers/reload, all four replay outcomes, migrated Trace filters/paging/export, performance tracks/cost, all docks, real popup editing/selection/theme/play/stop sync, Close/Open and the tab-registration API. Popup assertions wait for owner acknowledgements/state; they do not mistake queued asynchronous commands for completed actions.
