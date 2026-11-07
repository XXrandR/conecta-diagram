import { FlowError } from "./types";

/** Reject lossy JSON (undefined, NaN, Dates, functions, cycles) at API boundaries. */
export function assertJson(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 128)
    throw new FlowError("INVALID_JSON", "JSON nesting exceeds 128 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object")
    throw new FlowError(
      "INVALID_JSON",
      "Expected finite, serializable JSON data.",
    );
  if (ancestors.has(value))
    throw new FlowError("INVALID_JSON", "Circular data is not supported.");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new FlowError(
      "INVALID_JSON",
      "Only plain JSON objects are supported.",
    );
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new FlowError("INVALID_JSON", "Symbol properties are not supported.");
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))
      throw new FlowError(
        "INVALID_JSON",
        "Non-enumerable properties are not supported.",
      );
    if (!("value" in descriptor))
      throw new FlowError("INVALID_JSON", "Accessors are not supported.");
    assertJson(descriptor.value, ancestors, depth + 1);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) {
    throw new FlowError(
      "INVALID_JSON",
      "Sparse or extended arrays are not supported.",
    );
  }
  ancestors.delete(value);
}
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}
