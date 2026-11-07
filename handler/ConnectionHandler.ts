import { BaseNode } from "../DiagramTypes";
import * as d3 from "d3";

export class ConnectionHandler {
  private diagramGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private isConnecting = false;
  private connectionSource: BaseNode | null = null;
  private tempLine: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
  > | null = null;

  constructor(group: d3.Selection<SVGGElement, unknown, null, undefined>) {
    this.diagramGroup = group;
  }

  startConnection(sourceNode: BaseNode) {
    this.isConnecting = true;
    this.connectionSource = sourceNode;

    // Create temporary line
    this.tempLine = this.diagramGroup
      .append("line")
      .attr("class", "temp-connection")
      .attr("stroke", "#555")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,5")
      .attr("marker-end", "url(#arrowhead)")
      .attr("x1", sourceNode.x)
      .attr("y1", sourceNode.y)
      .attr("x2", sourceNode.x)
      .attr("y2", sourceNode.y);

    // Update line on mouse move
    this.diagramGroup.on("mousemove.connection", (event) => {
      if (this.isConnecting && this.tempLine) {
        const [x, y] = d3.pointer(event);
        this.tempLine.attr("x2", x).attr("y2", y);
      }
    });
  }

  completeConnection(
    targetNode: BaseNode,
    onCreateLink: (source: BaseNode, target: BaseNode) => void,
  ) {
    if (!this.isConnecting || !this.connectionSource) return;

    // Create permanent connection
    onCreateLink(this.connectionSource, targetNode);

    this.cancelConnection();
  }

  cancelConnection() {
    this.isConnecting = false;
    this.connectionSource = null;
    if (this.tempLine) this.tempLine.remove();
    this.diagramGroup.on("mousemove.connection", null);
  }

  isConnectionInProgress() {
    return this.isConnecting;
  }
}
