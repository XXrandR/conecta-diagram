// Display fixtures only. No network, database, process or filesystem execution.
export const presets = {
  python: {
    type: "process.exec",
    body: {
      kind: "process",
      profile: "python-normalize",
      code: {
        language: "python",
        source:
          "def normalize(order):\n    total = round(order['total'], 2)\n    return {**order, 'total': total}\n\nresult = normalize(input_order)\nprint(result)",
      },
    },
  },
  api: {
    type: "api.request",
    body: {
      kind: "api",
      method: "GET",
      url: "https://api.example.test/orders",
      connectionId: "orders-api",
    },
  },
  database: {
    type: "database.query",
    streaming: true,
    body: {
      kind: "database",
      databaseType: "postgresql",
      datasource: "orders-readonly",
      operation: "QUERY",
      statement:
        "SELECT id, total, status\nFROM orders\nWHERE status = :status\nORDER BY created_at DESC",
    },
  },
  file: {
    type: "file.download",
    streaming: true,
    body: {
      kind: "file",
      operation: "DOWNLOAD · runner → server",
      path: "/workspace/reports/orders.csv",
      transferId: "transfer-report-1",
      resumable: true,
    },
  },
  copy: {
    type: "file.copy",
    body: {
      kind: "file",
      operation: "COPY",
      path: "/workspace/orders.csv",
      destination: "/workspace/archive/orders.csv",
    },
  },
  upload: {
    type: "file.upload",
    streaming: true,
    body: {
      kind: "file",
      operation: "UPLOAD · server → runner",
      path: "/workspace/input/orders.csv",
      transferId: "transfer-upload-1",
      resumable: true,
    },
  },
  ssh: {
    type: "ssh.exec",
    body: {
      kind: "ssh",
      connectionId: "report-host",
      command: "sha256sum /reports/orders.csv",
    },
  },
  sftp: {
    type: "sftp.put",
    body: {
      kind: "sftp",
      connectionId: "report-sftp",
      operation: "put",
      localPath: "/workspace/reports/orders.csv",
      remotePath: "/incoming/orders.csv",
    },
  },
  mail: {
    type: "mail.send",
    body: {
      kind: "mail",
      connectionId: "operations-mail",
      operation: "send",
      subject: "Order report approved",
      to: ["operations@example.test"],
    },
  },
  messaging: {
    type: "messaging.publish",
    body: {
      kind: "messaging",
      connectionId: "orders-kafka",
      operation: "publish",
      topic: "orders.approved",
    },
  },
  event: {
    type: "event.emit",
    body: { kind: "event", operation: "emit", topic: "report.completed" },
  },
  cancel: {
    type: "command.cancel",
    body: {
      kind: "cancel",
      targetCommandId: "report-command-previous",
      reason: "Superseded report",
    },
  },
  ping: {
    type: "command.ping",
    body: {
      kind: "generic",
      name: "runner.ping",
      preview: "Health-check observation",
    },
  },
  extension: {
    type: "custom",
    body: {
      kind: "generic",
      name: "vendor.enrich",
      preview: '{ "dataset": "orders" }',
    },
  },
  unsupported: {
    type: "database.transaction",
    body: {
      kind: "database",
      databaseType: "postgresql",
      datasource: "orders",
      operation: "BEGIN_TRANSACTION",
      statement: "Not supported by this runner implementation",
    },
  },
  metadata: {
    type: "database.metadata",
    body: {
      kind: "database",
      databaseType: "postgresql",
      datasource: "orders",
      operation: "METADATA",
      statement: "Not supported by this runner implementation",
    },
  },
};
export const capabilities = Object.values(presets)
  .map((action) => action.type)
  .filter(
    (type) => !["database.transaction", "database.metadata"].includes(type),
  );
export const plan = {
  schemaVersion: 1,
  id: "runner-report-demo",
  globals: [
    {
      id: "global-regions",
      name: "regions",
      type: "array",
      value: ["EU", "US"],
    },
    {
      id: "global-enabled",
      name: "notificationsEnabled",
      type: "boolean",
      value: true,
    },
    { id: "global-limit", name: "maxOrders", type: "integer", value: 200 },
    {
      id: "global-options",
      name: "reportOptions",
      type: "json",
      value: { format: "csv", compression: null },
    },
  ],
  nodes: [
    {
      id: "start",
      type: "start",
      label: "Report requested",
      position: { x: 65, y: 130 },
    },
    {
      id: "python",
      type: "task",
      mode: "async",
      label: "Normalize order",
      action: presets.python,
      signals: { inputs: ["order.received"], outputs: ["order.normalized"] },
      position: { x: 300, y: 130 },
    },
    {
      id: "api",
      type: "task",
      mode: "async",
      label: "Fetch order information",
      action: presets.api,
      signals: { inputs: ["order.normalized"], outputs: ["order.loaded"] },
      position: { x: 700, y: 130 },
    },
    {
      id: "database",
      type: "task",
      mode: "async",
      label: "Stream matching orders",
      action: presets.database,
      signals: { inputs: ["order.loaded"], outputs: ["report.rows.ready"] },
      position: { x: 1100, y: 130 },
    },
    {
      id: "file",
      type: "task",
      mode: "async",
      label: "Transfer report to server",
      action: presets.file,
      signals: {
        inputs: ["report.rows.ready"],
        outputs: ["approval.requested"],
      },
      position: { x: 1100, y: 380 },
    },
    {
      id: "wait",
      type: "wait",
      signal: "approval.received",
      label: "Wait for approval",
      signals: {
        inputs: ["approval.received"],
        outputs: ["approval.available"],
      },
      position: { x: 700, y: 380 },
    },
    {
      id: "decision",
      type: "decision",
      label: "Is the report approved?",
      decision: {
        description:
          "The server selects a branch after the external approval signal.",
        expression: {
          language: "python",
          source:
            "def choose_branch(signal):\n    if signal['approved']:\n        return 'approved'\n    return 'declined'",
        },
      },
      signals: {
        inputs: ["approval.available"],
        outputs: ["decision.selected"],
      },
      position: { x: 300, y: 380 },
    },
    {
      id: "mail",
      type: "task",
      mode: "async",
      label: "Notify operations",
      action: presets.mail,
      signals: { inputs: ["decision.selected"], outputs: ["report.completed"] },
      position: { x: 300, y: 630 },
    },
    {
      id: "yes",
      type: "end",
      label: "Report delivered",
      position: { x: 700, y: 630 },
    },
    {
      id: "no",
      type: "end",
      label: "Approval declined",
      position: { x: 65, y: 630 },
    },
  ],
  edges: [
    { id: "start-python", source: "start", target: "python" },
    { id: "python-api", source: "python", target: "api" },
    { id: "api-database", source: "api", target: "database" },
    { id: "database-file", source: "database", target: "file" },
    { id: "file-wait", source: "file", target: "wait" },
    { id: "wait-decision", source: "wait", target: "decision" },
    {
      id: "approved",
      source: "decision",
      target: "mail",
      label: "Yes · approved",
      condition: { op: "eq", path: ["approved"], value: true },
    },
    {
      id: "declined",
      source: "decision",
      target: "no",
      label: "No · otherwise",
      default: true,
    },
    { id: "mail-end", source: "mail", target: "yes" },
  ],
};
export function mockEvents(scenario = "approve") {
  const events = [];
  const signal = (nodeId, name, direction, summary) =>
    events.push({
      kind: "signal",
      observation: {
        id: `signal-${events.length}`,
        nodeId,
        name,
        direction,
        summary,
      },
    });
  const command = (nodeId, results) =>
    results.forEach((result, sequence) =>
      events.push({
        kind: "result",
        nodeId,
        result: {
          commandId: `demo-${nodeId}-1`,
          sequence: String(sequence),
          success: result.status === "SUCCEEDED",
          final: [
            "SUCCEEDED",
            "FAILED",
            "TIMED_OUT",
            "CANCELLED",
            "REJECTED",
          ].includes(result.status),
          ...result,
        },
      }),
    );
  signal(
    "python",
    "order.received",
    "in",
    "Sample order received; no runner contacted",
  );
  command("python", [
    { status: "ACCEPTED" },
    { status: "RUNNING", summary: "Python profile executing (simulated)" },
    {
      status: "SUCCEEDED",
      summary: 'stdout: {"id": "order-18", "total": 123.45}',
    },
  ]);
  signal("python", "order.normalized", "out", "Normalized sample data");
  signal("api", "order.normalized", "in", "Normalization result observed");
  command("api", [
    { status: "ACCEPTED" },
    { status: "RUNNING", summary: "GET /orders (simulated)" },
    { status: "SUCCEEDED", summary: "HTTP 200 · 12 sample orders" },
  ]);
  signal("api", "order.loaded", "out", "Sample API response available");
  signal("database", "order.loaded", "in", "Sample query input available");
  command("database", [
    { status: "ACCEPTED" },
    { status: "RUNNING", summary: "Query submitted (simulated)" },
    {
      status: "STREAMING",
      progress: { current: "100", total: "200", unit: "rows" },
      summary: "First row batch",
    },
    {
      status: "SUCCEEDED",
      progress: { current: "200", total: "200", unit: "rows" },
      summary: "200 rows streamed",
    },
  ]);
  signal(
    "database",
    "report.rows.ready",
    "out",
    "Sample rows ready for report",
  );
  signal("file", "report.rows.ready", "in", "Sample report transfer input");
  command("file", [
    { status: "ACCEPTED" },
    { status: "RUNNING", summary: "transfer-report-1 · resume offset 0" },
    {
      status: "STREAMING",
      progress: { current: "32768", total: "131072", unit: "bytes" },
      summary: "Chunk 0 received · transfer-report-1",
    },
    {
      status: "STREAMING",
      progress: { current: "98304", total: "131072", unit: "bytes" },
      summary: "Chunk 1 received · transfer-report-1",
    },
    scenario === "failure"
      ? { status: "FAILED", error: "Simulated checksum mismatch" }
      : scenario === "timeout"
        ? {
            status: "TIMED_OUT",
            error: "Simulated execution deadline exceeded",
          }
        : {
            status: "SUCCEEDED",
            progress: { current: "131072", total: "131072", unit: "bytes" },
            summary: "Final chunk · checksum verified (simulated)",
          },
  ]);
  for (const event of events.filter(
    (event) => event.kind === "result" && event.nodeId === "file",
  )) {
    const sequence = event.result.sequence;
    if (
      sequence === "2" ||
      sequence === "3" ||
      (sequence === "4" && event.result.status === "SUCCEEDED")
    )
      event.result.transfer = {
        id: "transfer-report-1",
        offset: sequence === "2" ? "0" : sequence === "3" ? "32768" : "98304",
        size: sequence === "3" ? "65536" : "32768",
        chunkSequence: String(Number(sequence) - 2),
        totalSize: "131072",
        final: sequence === "4",
      };
  }
  if (["failure", "timeout"].includes(scenario)) return events;
  signal("file", "approval.requested", "out", "External approval requested");
  events.push({ kind: "waiting", nodeId: "wait" });
  signal(
    "wait",
    "approval.received",
    "in",
    `Simulated response: approved=${scenario === "approve"}`,
  );
  signal(
    "wait",
    "approval.available",
    "out",
    "External response now available",
  );
  signal("decision", "approval.available", "in", "Observed approval input");
  events.push({
    kind: "decision",
    observation: {
      id: "decision-result-1",
      nodeId: "decision",
      edgeId: scenario === "approve" ? "approved" : "declined",
      reason: `Server observation (simulated): approved == ${scenario === "approve"}`,
    },
  });
  signal(
    "decision",
    "decision.selected",
    "out",
    scenario === "approve"
      ? "Approved branch selected"
      : "Declined branch selected",
  );
  if (scenario === "approve") {
    signal("mail", "decision.selected", "in", "Observed approved branch");
    command("mail", [
      { status: "ACCEPTED" },
      { status: "RUNNING", summary: "Sending notification (simulated)" },
      { status: "SUCCEEDED", summary: "Message accepted · simulated-mail-1" },
    ]);
    signal("mail", "report.completed", "out", "Sample run completed");
  }
  events.push({
    kind: "finished",
    nodeId: scenario === "approve" ? "yes" : "no",
  });
  return events;
}
