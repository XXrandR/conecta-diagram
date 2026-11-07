import { assertJson, clone, equal, freeze } from "./json";
import { assertFlow } from "./validation";
import {
  FlowError,
  type FlowDocument,
  type FlowEdge,
  type FlowNode,
  type Point,
  type GlobalVariable,
} from "./types";
import { flowCreationOrder } from "./globals";

export interface ChangeEvent {
  document: FlowDocument;
  reason: string;
  revision: number;
}
export type Unsubscribe = () => void;
export interface StoreOptions {
  historyLimit?: number;
  /** Subscriber errors never roll back an already committed transaction. */
  onListenerError?: (error: unknown) => void;
}

/** Atomic draft editing, immutable snapshots, bounded undo/redo. No DOM dependency. */
export class FlowStore {
  private document: FlowDocument;
  private past: FlowDocument[] = [];
  private future: FlowDocument[] = [];
  private listeners = new Set<(event: ChangeEvent) => void>();
  private revision = 0;
  private editing = false;
  private notifying = false;
  private readonly limit: number;

  constructor(
    document: FlowDocument,
    private readonly options: StoreOptions = {},
  ) {
    assertFlow(document);
    this.limit = options.historyLimit ?? 100;
    if (!Number.isSafeInteger(this.limit) || this.limit < 0)
      throw new FlowError(
        "INVALID_LIMIT",
        "historyLimit must be a nonnegative integer.",
      );
    this.document = freeze(clone(document));
  }
  /** Frozen at runtime; mutate through transaction() instead. */
  getSnapshot(): FlowDocument {
    return this.document;
  }
  getRevision(): number {
    return this.revision;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  subscribe(listener: (event: ChangeEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  transaction(reason: string, edit: (draft: FlowDocument) => void): void {
    this.guard();
    this.editing = true;
    let next: FlowDocument;
    try {
      next = clone(this.document);
      const result: unknown = edit(next);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new FlowError(
          "ASYNC_TRANSACTION",
          "Transactions must be synchronous.",
        );
      }
      const before = [
        ...this.document.nodes.map((node) => ["node", node.id]),
        ...this.document.edges.map((edge) => ["edge", edge.id]),
      ];
      const after = [
        ...next.nodes.map((node) => ["node", node.id]),
        ...next.edges.map((edge) => ["edge", edge.id]),
      ];
      // Preserve existing item order and append new items without rewriting old documents on a no-op edit.
      if (
        !equal(before, after) &&
        equal(next.creationOrder, this.document.creationOrder)
      ) {
        const current = new Set(
          after.map((reference) => JSON.stringify(reference)),
        );
        const order = flowCreationOrder(this.document).filter((reference) =>
          current.has(JSON.stringify([reference.type, reference.id])),
        );
        const recorded = new Set(
          order.map((reference) =>
            JSON.stringify([reference.type, reference.id]),
          ),
        );
        for (const [type, id] of after)
          if (!recorded.has(JSON.stringify([type, id])))
            order.push({ type: type as "node" | "edge", id: id! });
        next.creationOrder = order;
      }
      assertFlow(next);
      next = freeze(clone(next)); // The caller must not retain a mutable reference.
    } finally {
      this.editing = false;
    }
    if (equal(next, this.document)) return;
    if (this.limit)
      this.past = [...this.past, this.document].slice(-this.limit);
    this.future = [];
    this.document = next;
    this.emit(reason);
  }
  replace(document: FlowDocument): void {
    assertFlow(document);
    this.transaction("replace", (draft) => {
      for (const key of Object.keys(draft))
        delete (draft as unknown as Record<string, unknown>)[key];
      Object.assign(draft, clone(document));
    });
  }
  addNode(node: FlowNode): void {
    assertJson(node);
    this.transaction("add-node", (draft) => {
      draft.nodes.push(clone(node));
    });
  }
  addGlobal(variable: GlobalVariable): void {
    assertJson(variable);
    this.transaction("add-global", (draft) => {
      (draft.globals ??= []).push(clone(variable));
    });
  }
  updateGlobal(
    id: string,
    update: (variable: GlobalVariable) => GlobalVariable,
  ): void {
    this.transaction("update-global", (draft) => {
      const index =
        draft.globals?.findIndex((variable) => variable.id === id) ?? -1;
      if (index < 0)
        throw new FlowError("GLOBAL_NOT_FOUND", `Unknown global ${id}.`);
      const variable = update(draft.globals![index]!);
      if (variable.id !== id)
        throw new FlowError(
          "ID_CHANGE",
          "Global ids cannot be changed by updateGlobal.",
        );
      draft.globals![index] = variable;
    });
  }
  removeGlobal(id: string): void {
    this.transaction("remove-global", (draft) => {
      if (draft.globals)
        draft.globals = draft.globals.filter((variable) => variable.id !== id);
    });
  }
  updateNode(id: string, update: (node: FlowNode) => FlowNode): void {
    this.transaction("update-node", (draft) => {
      const index = draft.nodes.findIndex((node) => node.id === id);
      if (index < 0)
        throw new FlowError("NODE_NOT_FOUND", `Unknown node ${id}.`);
      const next = update(draft.nodes[index]!);
      if (next.id !== id)
        throw new FlowError(
          "ID_CHANGE",
          "Node ids cannot be changed by updateNode.",
        );
      draft.nodes[index] = next;
    });
  }
  moveNode(id: string, position: Point): void {
    this.updateNode(id, (node) => ({ ...node, position }));
  }
  removeNode(id: string): void {
    this.transaction("remove-node", (draft) => {
      draft.nodes = draft.nodes.filter((node) => node.id !== id);
      draft.edges = draft.edges.filter(
        (edge) => edge.source !== id && edge.target !== id,
      );
    });
  }
  addEdge(edge: FlowEdge): void {
    assertJson(edge);
    this.transaction("add-edge", (draft) => {
      draft.edges.push(clone(edge));
    });
  }
  updateEdge(id: string, update: (edge: FlowEdge) => FlowEdge): void {
    this.transaction("update-edge", (draft) => {
      const index = draft.edges.findIndex((edge) => edge.id === id);
      if (index < 0)
        throw new FlowError("EDGE_NOT_FOUND", `Unknown edge ${id}.`);
      const next = update(draft.edges[index]!);
      if (next.id !== id)
        throw new FlowError(
          "ID_CHANGE",
          "Edge ids cannot be changed by updateEdge.",
        );
      draft.edges[index] = next;
    });
  }
  removeEdge(id: string): void {
    this.transaction("remove-edge", (draft) => {
      draft.edges = draft.edges.filter((edge) => edge.id !== id);
    });
  }
  undo(): void {
    this.guard();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.document);
    this.document = previous;
    this.emit("undo");
  }
  redo(): void {
    this.guard();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.document);
    this.document = next;
    this.emit("redo");
  }
  private guard(): void {
    if (this.editing || this.notifying)
      throw new FlowError(
        "REENTRANT_EDIT",
        "Nested edits and edits during notification are not supported.",
      );
  }
  private emit(reason: string): void {
    this.revision++;
    this.notifying = true;
    try {
      for (const listener of [...this.listeners]) {
        try {
          listener({
            document: this.document,
            reason,
            revision: this.revision,
          });
        } catch (error) {
          try {
            this.options.onListenerError?.(error);
          } catch {
            /* Observer errors cannot corrupt commits. */
          }
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}
