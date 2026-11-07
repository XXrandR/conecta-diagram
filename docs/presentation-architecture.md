# Presentation architecture

The current presentation is defined by **[the Photon + DevTools refactor](devtools-refactor.md)**. The old fixed DETAILS inspector and bottom console shell have been deleted; do not build on those obsolete surfaces.

## Library boundary

- `src/svg/photon.css`: shared template tokens and component classes; import `@maximus/diagram/photon.css` explicitly.
- `src/svg/PhotonCard.ts`: safe HTML/SVG template structure; all text is inserted with DOM APIs, never interpolated into executable HTML.
- `src/svg/SvgFlowEditor.ts`: keyed SVG groups, selection, connections, camera and native D3 movement. It owns no application panel or runtime transport.
- `src/svg/icons.ts` / `NodeTooltip.ts`: small local SVG glyphs and instance-owned, theme-token tool previews. Destroy removes listeners, timers and tooltip elements.
- `src/core/globals.ts`: typed diagram globals and creation-ordered item projections.
- `src/core/performance.ts`: immutable backend metric observations, including integer cost. No UI-derived costs.
- `src/d3/box-collision.ts`: shape-aware placement, separate from persistent plan/execution state.

## Host UI boundary

- `examples/demo.js`: the single authoritative store/replay owner and command dispatcher.
- `examples/devtools/shell.js`: stable tab registration and the one DevTools top bar.
- `manager.js`, `window.js`: docking and same-origin real-window command/snapshot synchronization.
- `resize.js`: pointer/keyboard resize mechanics and `wf-panel-sizes` persistence.
- `tabs/assemble.js`: the only node/global editing surface; right pane is exactly `In construction`.
- `tabs/trace.js`: relocation adapter for the existing `ExecutionConsole` list/detail logic and original `ExecutionJournal` model.
- `tabs/performance.js`: shared-ruler Parent process / Network / Memory / Cost top graph; no lower trace strip.
- `examples/styles.css`: app chrome expressed entirely in the shared Photon tokens.

## Display guarantees

Nothing executes from a card, tooltip, editor, trace row, graph, layout tick or detached window. The sample replay remains explicitly simulated. The complete retained sample trace remains searchable, pageable, inspectable and exportable; success/finality/uint64 counters and independent file-chunk finality are not coerced away.

Receipt timing is distinct from backend execution time. The UI does not invent missing logs, costs, checksums, binary data or credentials. Real backend transport, durable recovery, collaborative document editing and per-concurrent-activation inspectors remain separate work. No formal accessibility certification or exhaustive cross-browser performance claim is made.
