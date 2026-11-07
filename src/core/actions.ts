import type { Condition } from "./types";

/** Safe, display-only descriptions, NOT executable Command protobuf messages. */
export interface CodePreview {
  language: string;
  source: string;
}
export type ActionBody =
  | {
      kind: "api";
      method: string;
      url: string;
      connectionId?: string;
      bodyPreview?: string;
    }
  | {
      kind: "database";
      databaseType: string;
      datasource: string;
      operation: string;
      statement: string;
    }
  | {
      kind: "file";
      operation: string;
      path: string;
      destination?: string;
      transferId?: string;
      resumable?: boolean;
    }
  | {
      kind: "process";
      profile: string;
      arguments?: string[];
      code?: CodePreview;
    }
  | { kind: "ssh"; connectionId: string; command: string }
  | {
      kind: "sftp";
      connectionId: string;
      operation: string;
      remotePath: string;
      localPath?: string;
      destination?: string;
    }
  | {
      kind: "mail";
      connectionId: string;
      operation: string;
      subject?: string;
      to?: string[];
    }
  | {
      kind: "messaging";
      connectionId: string;
      operation: string;
      topic: string;
    }
  | { kind: "event"; operation: string; topic: string; path?: string }
  | { kind: "cancel"; targetCommandId: string; reason?: string }
  | { kind: "generic"; name: string; preview?: string };
export interface TaskAction {
  /** Open string, as in the runner protocol. Availability comes from capabilities. */
  type: string;
  version?: number;
  streaming?: boolean;
  expectsResult?: boolean;
  body: ActionBody;
}
export interface NodeSignals {
  inputs: string[];
  outputs: string[];
}
export interface DecisionDisplay {
  description?: string;
  expression?: CodePreview;
}
export type CapabilityState = "available" | "unsupported" | "unverified";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
export const isCodePreview = (value: unknown): value is CodePreview =>
  object(value) &&
  typeof value.language === "string" &&
  typeof value.source === "string";
export function isTaskAction(value: unknown): value is TaskAction {
  if (
    !object(value) ||
    typeof value.type !== "string" ||
    !value.type.trim() ||
    !object(value.body)
  )
    return false;
  if (
    value.version !== undefined &&
    (!Number.isSafeInteger(value.version) || (value.version as number) < 0)
  )
    return false;
  if (
    [value.streaming, value.expectsResult].some(
      (item) => item !== undefined && typeof item !== "boolean",
    )
  )
    return false;
  const body = value.body;
  const fields: Record<string, string[]> = {
    api: ["method", "url"],
    database: ["databaseType", "datasource", "operation", "statement"],
    file: ["operation", "path"],
    process: ["profile"],
    ssh: ["connectionId", "command"],
    sftp: ["connectionId", "operation", "remotePath"],
    mail: ["connectionId", "operation"],
    messaging: ["connectionId", "operation", "topic"],
    event: ["operation", "topic"],
    cancel: ["targetCommandId"],
    generic: ["name"],
  };
  if (
    typeof body.kind !== "string" ||
    !Object.hasOwn(fields, body.kind) ||
    !fields[body.kind]!.every((key) => typeof body[key] === "string")
  )
    return false;
  const family = value.type.split(".")[0];
  const expected =
    family === "command"
      ? value.type === "command.cancel"
        ? "cancel"
        : "generic"
      : [
            "api",
            "database",
            "file",
            "process",
            "ssh",
            "sftp",
            "mail",
            "messaging",
            "event",
          ].includes(family!)
        ? family
        : "generic";
  if (body.kind !== expected) return false;
  if (body.code !== undefined && !isCodePreview(body.code)) return false;
  if (body.arguments !== undefined && !strings(body.arguments)) return false;
  if (body.to !== undefined && !strings(body.to)) return false;
  if (body.resumable !== undefined && typeof body.resumable !== "boolean")
    return false;
  return [
    "connectionId",
    "bodyPreview",
    "destination",
    "transferId",
    "localPath",
    "subject",
    "path",
    "reason",
    "preview",
  ].every((key) => body[key] === undefined || typeof body[key] === "string");
}
export function capabilityState(
  type: string,
  advertised?: readonly string[],
): CapabilityState {
  if (advertised)
    return advertised.includes(type) ? "available" : "unsupported";
  return ["database.transaction", "database.metadata"].includes(type)
    ? "unsupported"
    : "unverified";
}
/** URL previews never expose embedded basic auth, query values or fragments. */
export function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch {
    return value
      .replace(/([?&][^=&#]+)=([^&#]*)/g, "$1=[redacted]")
      .split("#")[0]!;
  }
}
export function actionPresentation(action: TaskAction): {
  title: string;
  lines: string[];
  code?: CodePreview;
} {
  const body = action.body;
  switch (body.kind) {
    case "api":
      return {
        title: `HTTP · ${body.method}`,
        lines: [
          displayUrl(body.url),
          body.connectionId
            ? `Connection: ${body.connectionId}`
            : "Logical API target",
          body.bodyPreview ?? "",
        ],
      };
    case "database":
      return {
        title: `${body.databaseType} · ${body.operation}`,
        lines: [
          `Datasource: ${body.datasource}`,
          ...body.statement.split(/\r?\n/),
        ],
        code: { language: "sql", source: body.statement },
      };
    case "file":
      return {
        title: `File · ${body.operation}`,
        lines: [
          body.path,
          body.destination
            ? `→ ${body.destination}`
            : body.transferId
              ? `Transfer: ${body.transferId}`
              : "",
          body.resumable ? "Resumable transfer" : "",
        ],
      };
    case "process":
      return {
        title: body.code ? `${body.code.language} · process` : "Process",
        lines: [
          `Profile: ${body.profile}`,
          ...(body.code?.source.split(/\r?\n/) ?? [
            body.arguments?.join(" ") ?? "",
          ]),
        ],
        ...(body.code ? { code: body.code } : {}),
      };
    case "ssh":
      return {
        title: "SSH · exec",
        lines: [`Connection: ${body.connectionId}`, body.command],
        code: { language: "shell", source: body.command },
      };
    case "sftp":
      return {
        title: `SFTP · ${body.operation}`,
        lines: [
          `Connection: ${body.connectionId}`,
          body.remotePath,
          body.localPath ?? body.destination ?? "",
        ],
      };
    case "mail":
      return {
        title: `Mail · ${body.operation}`,
        lines: [
          body.subject ?? "",
          body.to?.join(", ") ?? "",
          `Connection: ${body.connectionId}`,
        ],
      };
    case "messaging":
      return {
        title: `Messaging · ${body.operation}`,
        lines: [body.topic, `Connection: ${body.connectionId}`],
      };
    case "event":
      return {
        title: `Event · ${body.operation}`,
        lines: [body.topic, body.path ?? ""],
      };
    case "cancel":
      return {
        title: "Command · cancel",
        lines: [`Target: ${body.targetCommandId}`, body.reason ?? ""],
      };
    case "generic":
      return { title: "Extension", lines: [body.name, body.preview ?? ""] };
  }
}
export function formatCondition(condition: Condition): string {
  if (condition.op === "all" || condition.op === "any")
    return `(${condition.conditions.map(formatCondition).join(condition.op === "all" ? " AND " : " OR ")})`;
  if (condition.op === "not")
    return `NOT ${formatCondition(condition.condition)}`;
  if (!("path" in condition)) return "";
  const path = condition.path.join(".") || "$context";
  if (condition.op === "exists") return `exists(${path})`;
  const operators = {
    eq: "==",
    neq: "!=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    in: "IN",
  };
  return `${path} ${operators[condition.op]} ${JSON.stringify(condition.value)}`;
}
