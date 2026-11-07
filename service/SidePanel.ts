import { BaseNode } from "../DiagramTypes";
import * as d3 from "d3";

export class SidePanel {
  private static panel: d3.Selection<
    HTMLDivElement,
    unknown,
    HTMLElement,
    unknown
  >;
  private static currentNode: BaseNode | null = null;

  public static init() {
    const existingPanel = d3.select("body").selectAll(".side-panel");
    if (existingPanel.size() > 0) {
      existingPanel.remove();
    }

    // Create panel container
    this.panel = d3
      .select("body")
      .append("div")
      .attr("class", "side-panel")
      .style("position", "fixed")
      .style("right", "-400px") // Start hidden
      .style("top", "0")
      .style("width", "380px")
      .style("height", "100vh")
      .style("background", "white")
      .style("box-shadow", "-2px 0 20px rgba(0,0,0,0.1)")
      .style("transition", "right 0.3s ease")
      .style("z-index", "1000")
      .style("padding", "20px")
      .style("display", "flex")
      .style("flex-direction", "column");

    // Add header
    this.panel
      .append("div")
      .attr("class", "panel-header")
      .style("display", "flex")
      .style("justify-content", "space-between")
      .style("align-items", "center")
      .style("margin-bottom", "20px")
      .append("h2")
      .text("Node Properties");

    // Add close button
    this.panel
      .select(".panel-header")
      .append("button")
      .attr("class", "close-button")
      .html("&times;")
      .on("click", () => this.hide());

    // Create content container
    this.panel.append("div").attr("class", "panel-content");
  }

  public static showPanel(node: BaseNode) {
    this.init();
    this.currentNode = node;
    this.updateContent();
    this.panel.style("right", "0");
  }

  public static hide() {
    this.panel.style("right", "-400px");
  }

  private static updateContent() {
    if (!this.currentNode) return;

    const content = this.panel.select(".panel-content").html("");

    // Node ID
    content
      .append("div")
      .attr("class", "property-group")
      .append("label")
      .text("Node ID")
      .attr("class", "property-label");

    content
      .select(".property-group")
      .append("div")
      .text(this.currentNode.id)
      .attr("class", "property-value");

    // Node Type
    content
      .append("div")
      .attr("class", "property-group")
      .append("label")
      .text("Type")
      .attr("class", "property-label");

    content
      .select(".property-group:last-child")
      .append("div")
      .text(this.currentNode.type)
      .attr("class", "property-value");

    // Label Editor
    content
      .append("div")
      .attr("class", "property-group")
      .append("label")
      .text("Label")
      .attr("class", "property-label");

    content
      .select(".property-group:last-child")
      .append("input")
      .attr("type", "text")
      .attr("class", "property-input")
      .attr("value", this.currentNode.label)
      .on("change", (event) => {
        if (this.currentNode) {
          this.currentNode.label = (event.target as HTMLInputElement).value;
          d3.select(`#node-${this.currentNode.id} text`).text(
            this.currentNode.label,
          );
        }
      });

    content
      .append("div")
      .attr("class", "section-header")
      .text("Custom Properties");

    content
      .append("button")
      .attr("class", "add-property-button")
      .text("+ Add Property")
      .style("margin-top", "12px")
      .style("padding", "10px 16px")
      .style("font-size", "14px")
      .style("background", "#0070f3")
      .style("color", "white")
      .style("border", "none")
      .style("border-radius", "8px")
      .style("cursor", "pointer")
      .style("align-self", "flex-start")
      .style("transition", "background 0.2s")
      .on("mouseover", function () {
        d3.select(this).style("background", "#005fd2");
      })
      .on("mouseout", function () {
        d3.select(this).style("background", "#0070f3");
      })
      .on("click", () => this.addNewProperty());
  }

  private static addNewProperty() {
    if (!this.currentNode) return;

    const key = prompt("Enter property name:");
    if (key && !this.currentNode.properties[key]) {
      this.currentNode.properties[key] = "";
      this.updateContent();
    }
  }
}
