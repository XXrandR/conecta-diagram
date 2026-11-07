import type { FlowDocument } from "../src/core/types";

/** Async processing and auditing join before the host requests a human decision. */
export const approvalFlow: FlowDocument = {
  schemaVersion: 1,
  id: "approval",
  nodes: [
    { id: "start", type: "start", label: "Start", position: { x: 80, y: 180 } },
    {
      id: "fork",
      type: "fork",
      label: "In parallel",
      join: "join",
      position: { x: 220, y: 180 },
    },
    {
      id: "process",
      type: "task",
      mode: "async",
      handler: "process-order",
      label: "Process order",
      position: { x: 420, y: 100 },
    },
    {
      id: "audit",
      type: "task",
      label: "Audit request",
      position: { x: 420, y: 280 },
    },
    {
      id: "join",
      type: "join",
      label: "Both finished",
      fork: "fork",
      position: { x: 620, y: 180 },
    },
    {
      id: "approval",
      type: "wait",
      signal: "approval.received",
      label: "Await approval",
      position: { x: 820, y: 180 },
    },
    {
      id: "decision",
      type: "decision",
      label: "Approved?",
      position: { x: 1020, y: 180 },
    },
    {
      id: "accepted",
      type: "end",
      label: "Accepted",
      position: { x: 1220, y: 100 },
    },
    {
      id: "rejected",
      type: "end",
      label: "Rejected",
      position: { x: 1220, y: 280 },
    },
  ],
  edges: [
    { id: "start-fork", source: "start", target: "fork" },
    { id: "fork-process", source: "fork", target: "process" },
    { id: "fork-audit", source: "fork", target: "audit" },
    { id: "process-join", source: "process", target: "join" },
    { id: "audit-join", source: "audit", target: "join" },
    { id: "join-approval", source: "join", target: "approval" },
    { id: "approval-decision", source: "approval", target: "decision" },
    {
      id: "approved",
      source: "decision",
      target: "accepted",
      label: "Yes",
      condition: { op: "eq", path: ["approved"], value: true },
    },
    {
      id: "denied",
      source: "decision",
      target: "rejected",
      label: "No",
      default: true,
    },
  ],
};
