import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Exercise the actual exports, including browser entry import safety during SSR.
const require = createRequire(import.meta.url);
for (const entry of [
  "@xxrandr/conecta-diagram",
  "@xxrandr/conecta-diagram/core",
  "@xxrandr/conecta-diagram/svg",
  "@xxrandr/conecta-diagram/d3",
]) {
  const esm = await import(entry);
  const cjs = require(entry);
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  assert.ok(Object.keys(esm).length > 0);
}
const { createFlow, FlowStore, serializeFlow, parseFlow } =
  await import("@xxrandr/conecta-diagram/core");
for (const load of [
  (entry) => import(entry),
  (entry) => Promise.resolve(require(entry)),
]) {
  const root = await load("@xxrandr/conecta-diagram");
  const core = await load("@xxrandr/conecta-diagram/core");
  const svg = await load("@xxrandr/conecta-diagram/svg");
  const d3 = await load("@xxrandr/conecta-diagram/d3");
  assert.equal(root.FlowError, core.FlowError);
  assert.equal(root.FlowStore, core.FlowStore);
  assert.equal(root.SvgFlowEditor, svg.SvgFlowEditor);
  assert.equal(root.ForcePlacement, d3.ForcePlacement);
}
const document = createFlow("package-smoke");
assert.deepEqual(
  new FlowStore(parseFlow(serializeFlow(document))).getSnapshot(),
  document,
);
assert.equal(typeof globalThis.document, "undefined");
console.log("ESM, CommonJS, subpath exports and server-side imports passed.");
