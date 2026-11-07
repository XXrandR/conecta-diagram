export type NodeType = "Task" | "Start" | "End" | "Gateway";

export class BaseLink {
  id: string;
  originParent: BaseNode;
  finalParent: BaseNode;
  constructor(id: string, originParent: BaseNode, finalParent: BaseNode) {
    this.id = id;
    this.originParent = originParent;
    this.finalParent = finalParent;
  }
  public obtainLinkForceCompatible(): {
    source: string;
    target: string;
  } {
    return {
      source: this.originParent.id,
      target: this.finalParent.id,
    };
  }
}

export class BaseNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  properties: any;
  constructor(props: BaseNode) {
    this.id = props.id;
    this.type = props.type;
    this.label = props.label;
    this.x = props.x;
    this.y = props.y;
  }
}
