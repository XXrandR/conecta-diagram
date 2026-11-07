import { BaseNode, NodeType } from "../DiagramTypes";
import * as d3 from "d3";

export class NodePopupMenu {
  private static nodeTypes: {
    type: NodeType;
    icon: string;
    label: string;
  }[] = [];

  static showCreationMenu(
    parentNode: BaseNode,
    onCreate: (type: NodeType) => void,
    onRemove: (parentNode: BaseNode) => void,
    onStartConnection: () => void,
  ) {
    this.removeMenu();

    const svg = d3.select("#base-svg");

    const transform = d3.zoomTransform(svg.node() as SVGSVGElement);
    let transformedX = parentNode.x * transform.k + transform.x;
    let transformedY = parentNode.y * transform.k + transform.y;

    const trashIcon =
      '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" stroke-width="1.5" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9" fill="#000000" style="--darkreader-inline-fill: #000000;" data-darkreader-inline-fill=""></path><path d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9H20Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M21 6H15.375M3 6H8.625M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6H15.375" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>';
    const arrowIcon =
      '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M4 14C2.89543 14 2 13.1046 2 12C2 10.8954 2.89543 10 4 10C5.10457 10 6 10.8954 6 12C6 13.1046 5.10457 14 4 14Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M9 12H22M22 12L19 9M22 12L19 15" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>';

    if (parentNode.type == "Task") {
      transformedY += 100;
      transformedX += 220;
    } else if (parentNode.type == "End") {
      transformedY += 240;
      transformedX += 290;
    } else if (parentNode.type == "Gateway") {
      transformedY += 180;
      transformedX += 220;
    } else {
      transformedY += 240;
      transformedX += 290;
    }

    this.setTypesOfTask(parentNode);

    console.log("Position transformedY => " + transformedY);
    console.log("Position transformedX => " + transformedX);

    const menu = d3
      .select("body")
      .append("div")
      .attr("class", "node-creator-menu")
      .style("position", "absolute")
      .style("left", `${transformedX}px`)
      .style("top", `${transformedY}px`)
      .style("background", "transparent")
      .style("border-radius", "8px")
      .style("padding", "1px")
      .style("z-index", "1000")
      .style("display", "flex")
      .style("gap", "8px");

    menu
      .append("div")
      .attr("class", "menu-arrow")
      .style("position", "absolute")
      .style("left", "8px")
      .style("top", "50%")
      .style("transform", "translateY(-50%)")
      .style("width", "0")
      .style("height", "0")
      .style("border-top", "8px solid transparent")
      .style("border-bottom", "8px solid transparent")
      .style("border-left", "8px solid transparent");

    this.nodeTypes.forEach((nodeType) => {
      const option = menu
        .append("div")
        .attr("class", "node-creator-option")
        .attr("title", nodeType.label) // Tooltip
        .style("width", "56px")
        .style("height", "56px")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("align-items", "center")
        .style("justify-content", "center")
        .style("border-radius", "6px")
        .style("background", "#f8f9fa")
        .style("cursor", "pointer")
        .style("transition", "all 0.2s");

      option
        .append("div")
        .style("font-size", "24px") // icon size
        .html(nodeType.icon);

      option
        .append("div")
        .style("font-size", "12px") // label font size
        .style("margin-top", "4px") // added margin to separate label from icon
        .style("text-align", "center")
        .style("color", "#777")
        .text(nodeType.label); // label text

      option
        .on("mouseover", function () {
          d3.select(this)
            .style("background", "#e9ecef")
            .style("transform", "scale(1.1)");
        })
        .on("mouseout", function () {
          d3.select(this)
            .style("background", "#f8f9fa")
            .style("transform", "scale(1)");
        })
        .on("click", () => {
          onCreate(nodeType.type);
          this.removeMenu();
        });
    });

    menu
      .append("div")
      .attr("class", "connection-source")
      .style("width", "56px")
      .style("height", "56px")
      .style("display", "flex")
      .style("flex-direction", "column")
      .style("align-items", "center")
      .style("justify-content", "center")
      .style("border-radius", "6px")
      .style("background", "#f8f9fa")
      .style("cursor", "pointer")
      .style("transition", "all 0.2s")
      .append("div")
      .style("font-size", "20px")
      .html(arrowIcon)
      .style("margin-bottom", "4px");
    menu
      .select(".connection-source")
      .append("div")
      .style("font-size", "12px")
      .style("text-align", "center")
      .text("Connect")
      .style("color", "#777");
    menu
      .select(".connection-source")
      .on("mouseover", function () {
        d3.select(this)
          .style("background", "#e9ecef")
          .style("transform", "scale(1.1)");
      })
      .on("mouseout", function () {
        d3.select(this)
          .style("background", "#f8f9fa")
          .style("transform", "scale(1)");
      })
      .on("click", () => {
        this.removeMenu();
        onStartConnection();
      });

    if (parentNode.type !== "Start") {
      menu
        .append("div")
        .attr("class", "node-remover-option")
        .style("width", "56px")
        .style("height", "56px")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("align-items", "center")
        .style("justify-content", "center")
        .style("border-radius", "6px")
        .style("background", "#f8f9fa")
        .style("cursor", "pointer")
        .style("transition", "all 0.2s")
        .append("div")
        .style("font-size", "20px")
        .html(trashIcon)
        .style("margin-bottom", "4px");
      menu
        .select(".node-remover-option")
        .append("div")
        .style("font-size", "12px")
        .style("text-align", "center")
        .text("Delete")
        .style("color", "#777");
      menu
        .select(".node-remover-option")
        .on("mouseover", function () {
          d3.select(this)
            .style("background", "#e9ecef")
            .style("transform", "scale(1.1)");
        })
        .on("mouseout", function () {
          d3.select(this)
            .style("background", "#f8f9fa")
            .style("transform", "scale(1)");
        })
        .on("click", () => {
          onRemove(parentNode);
          this.removeMenu();
        });
    }
  }

  static setTypesOfTask(parentNode: BaseNode): void {
    const endIcon =
      '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>';
    const gatewayIcon =
      '<svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000"><polygon points="12 3.6 3.6 12 12 20.4 20.4 12" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="12" font-size="10" text-anchor="middle" dominant-baseline="middle">+</text></svg>';
    const taskIcon =
      '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>';

    if (parentNode.type === "Task") {
      this.nodeTypes = [
        { type: "Task", icon: taskIcon, label: "Task" },
        { type: "Gateway", icon: gatewayIcon, label: "Condition" },
        { type: "End", icon: endIcon, label: "End" },
      ];
    } else if (parentNode.type === "End") {
      this.nodeTypes = [];
    } else if (parentNode.type === "Start" || parentNode.type === "Gateway") {
      this.nodeTypes = [{ type: "Task", icon: taskIcon, label: "Task" }];
    }
  }

  static removeMenu() {
    d3.selectAll(".node-creator-menu").remove();
  }
}
