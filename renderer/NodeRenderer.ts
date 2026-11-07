import { BaseNode, NodeType } from "../DiagramTypes";
import * as d3 from "d3";
import { NodePopupMenu } from "../service/NodePopupMenu";
import { ConnectionHandler } from "../handler/ConnectionHandler";
import { SidePanel } from "../service/SidePanel";

// to RENDER the NODE
export class NodeRenderer {
  static render(
    parentGroup: d3.Selection<SVGGElement, unknown, null, unknown>,
    group: d3.Selection<SVGGElement, any, null, undefined>,
    node: BaseNode,
    onCreateNode: (parent: BaseNode, type: NodeType) => void,
    onRemove: (parentNode: BaseNode) => void,
    onCompleteConnection: (node: BaseNode) => void,
    onStartConnection: (node: BaseNode) => void,
    connectionHandler: ConnectionHandler,
  ) {
    if (group.empty()) {
      group = parentGroup
        .append("g")
        .attr("id", `node-${node.id}`)
        .attr("class", "node")
        .attr("transform", `translate(${node.x},${node.y})`)
        .datum(node)
        .style("cursor", "pointer");
      this.renderShape(group, node);
      this.renderLabel(group, node);
      this.addInteractions(
        group,
        node,
        onCreateNode,
        onRemove,
        onCompleteConnection,
        onStartConnection,
        connectionHandler,
      );
    } else {
      group.datum(node);
      group
        .transition()
        .duration(100)
        .attr("transform", `translate(${node.x},${node.y})`);
    }
  }

  // Shape rendering logic based on node type
  private static renderShape(
    group: d3.Selection<SVGGElement, any, null, undefined>,
    node: BaseNode,
  ) {
    group.style("pointer-events", "visiblePainted");

    if (node.type === "Start" || node.type === "End") {
      group
        .append("rect")
        .attr("class", "top-border-hover")
        .attr("x", -24)
        .attr("y", -28)
        .attr("width", 50)
        .attr("height", 3)
        .attr("fill", node.type === "End" ? "#F44336" : "#2196F3")
        .attr("opacity", 0);
    } else if (node.type === "Gateway") {
      group
        .append("rect")
        .attr("class", "top-border-hover")
        .attr("x", -24)
        .attr("y", -28)
        .attr("width", 50)
        .attr("height", 3)
        .attr("fill", "#FF9800")
        .attr("opacity", 0);
    } else {
      group
        .append("rect")
        .attr("class", "top-border-hover")
        .attr("x", -24)
        .attr("y", -18)
        .attr("width", 70)
        .attr("height", 3)
        .attr("fill", "#2196F3")
        .attr("opacity", 0);
    }

    if (node.type === "Task") {
      group
        .append("rect")
        .attr("x", -24)
        .attr("y", -12)
        .attr("width", 68)
        .attr("height", 34)
        .attr("rx", 8) // Softer, modern rounded corners
        .attr("fill", "transparent") // Crisp white background
        .attr("stroke", "#2196F3") // Modern blue border
        .attr("stroke-width", 2.5) // Thinner stroke modernizes look
        .attr("filter", "url(#soft-drop-shadow)"); // Subtle shadow for depth
    } else if (node.type === "Start") {
      group
        .append("circle")
        .attr("r", 20)
        .attr("fill", "none") // No fill for transparent background
        .attr("stroke", "#2196F3") // Circle border color
        .attr("stroke-width", 2) // Set stroke width to make the border visible
        .attr("filter", "url(#soft-drop-shadow)");

      // If you want an inner filled circle smaller than the border circle, keep this:
      group
        .append("circle")
        .attr("r", 16)
        .attr("fill", "#2196F3")
        .attr("stroke", "#2196F3")
        .attr("stroke-width", 1);
    } else if (node.type === "End") {
      group
        .append("circle")
        .attr("r", 20)
        .attr("fill", "#F44336") // Modern red
        .attr("filter", "url(#soft-drop-shadow)");
      group
        .append("circle")
        .attr("r", 16)
        .attr("fill", "transparent")
        .attr("stroke", "#F44336")
        .attr("stroke-width", 1);
      group
        .append("rect")
        .attr("x", -6)
        .attr("y", -6)
        .attr("width", 12)
        .attr("height", 12)
        .attr("rx", 1) // Slightly rounded corners for modern touch
        .attr("fill", "#F44336")
        .attr("stroke", "white")
        .attr("stroke-width", 3);
    } else if (node.type === "Gateway") {
      group
        .append("path")
        .attr("d", "M0,-22 L22,0 L0,22 L-22,0 Z")
        .attr("fill", "transparent")
        .attr("stroke", "#FF9800") // Modern orange
        .attr("stroke-width", 3)
        .attr("filter", "url(#soft-drop-shadow)");
      group
        .append("path")
        .attr("d", "M0,-8 L0,8 M-8,0 L8,0")
        .attr("stroke", "#FF9800")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round"); // Rounded caps for modern feel
    }

    group.attr("filter", "url(#drop-shadow)");

    group
      .on("mouseover.shape", function () {
        d3.select(this).raise();
        d3.select(this)
          .select(".top-border-hover")
          .transition()
          .duration(200)
          .attr("opacity", 1);
      })
      .on("mouseout.shape", function () {
        d3.select(this)
          .select(".top-border-hover")
          .transition()
          .duration(200)
          .attr("opacity", 0);
      });
  }

  private static renderLabel(
    group: d3.Selection<SVGGElement, any, null, undefined>,
    node: BaseNode,
  ) {
    group
      .append("text")
      .attr("dy", node.type === "Gateway" ? "3.4em" : "3.2em")
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("fill", "#777")
      .text(node.label);
  }

  private static addInteractions(
    group: d3.Selection<SVGGElement, any, null, undefined>,
    node: BaseNode,
    onCreateNode: (parent: BaseNode, type: NodeType) => void,
    onRemove: (parentNode: BaseNode) => void,
    onCompleteConnection: (node: BaseNode) => void,
    onStartConnection: (node: BaseNode) => void,
    connectionHandler: ConnectionHandler,
  ) {
    group.style("pointer-events", "all");

    // for the menu(creation, and remove of elements)
    group.on("mouseover.menu", function (event: MouseEvent, d: BaseNode) {
      event.preventDefault();
      NodePopupMenu.showCreationMenu(
        node,
        (type) => {
          onCreateNode(node, type);
        },
        (type) => {
          onRemove(type);
        },
        () => {
          onStartConnection(d);
        },
      );
    });

    // for the link
    group.on("click.interaction", function (event: MouseEvent, d: BaseNode) {
      event.stopPropagation();
      console.log(
        "CLICK on node:",
        d.id,
        "connectionInProgress?",
        connectionHandler.isConnectionInProgress(),
      );
      console.log("entering to complete connection");
      if (connectionHandler.isConnectionInProgress()) {
        onCompleteConnection(d);
      }
    });

    group.on("dblclick", function (event: MouseEvent) {
      event.stopPropagation();
      SidePanel.showPanel(node);
    });
  }
}
