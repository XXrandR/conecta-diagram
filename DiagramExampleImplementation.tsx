import { BaseLink, BaseNode } from "../DiagramTypes";
import React, { useRef, useEffect, useState } from "react";
import { D3FlowDiagram } from "./diagram/D3FlowDiagram";

interface DiagramProps {}

export const Diagram: React.FC<DiagramProps> = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const nodes = [
    // Start and initial tasks
    new BaseNode({
      id: "start",
      type: "Start",
      label: "Start Process",
      x: 100,
      y: 150,
      properties: {},
    }),
    new BaseNode({
      id: "auth",
      type: "Task",
      label: "Authenticate",
      x: 250,
      y: 100,
      properties: { priority: "high" },
    }),
    new BaseNode({
      id: "validate",
      type: "Task",
      label: "Validate Input",
      x: 250,
      y: 200,
      properties: {},
    }),

    // Main workflow path
    new BaseNode({
      id: "process",
      type: "Task",
      label: "Process Data",
      x: 400,
      y: 150,
      properties: { batch: "true" },
    }),
    new BaseNode({
      id: "gateway1",
      type: "Gateway",
      label: "Approval?",
      x: 550,
      y: 150,
      properties: {},
    }),

    // Approval path
    new BaseNode({
      id: "approve",
      type: "Task",
      label: "Get Approval",
      x: 700,
      y: 100,
      properties: { role: "manager" },
    }),
    new BaseNode({
      id: "log-approval",
      type: "Task",
      label: "Log Decision",
      x: 850,
      y: 100,
      properties: {},
    }),

    // Rejection path
    new BaseNode({
      id: "reject",
      type: "Task",
      label: "Handle Rejection",
      x: 700,
      y: 200,
      properties: {},
    }),
    new BaseNode({
      id: "notify",
      type: "Task",
      label: "Notify User",
      x: 850,
      y: 200,
      properties: { channel: "email" },
    }),

    // Parallel processing
    new BaseNode({
      id: "audit",
      type: "Task",
      label: "Audit Trail",
      x: 550,
      y: 300,
      properties: {},
    }),
    new BaseNode({
      id: "backup",
      type: "Task",
      label: "Create Backup",
      x: 700,
      y: 300,
      properties: {},
    }),

    // Final nodes
    new BaseNode({
      id: "gateway2",
      type: "Gateway",
      label: "Complete?",
      x: 1000,
      y: 150,
      properties: {},
    }),
    new BaseNode({
      id: "end-success",
      type: "End",
      label: "Success",
      x: 1150,
      y: 100,
      properties: {},
    }),
    new BaseNode({
      id: "end-fail",
      type: "End",
      label: "Failed",
      x: 1150,
      y: 200,
      properties: {},
    }),

    // Additional parallel tasks
    new BaseNode({
      id: "report",
      type: "Task",
      label: "Generate Report",
      x: 1000,
      y: 300,
      properties: {},
    }),
    new BaseNode({
      id: "archive",
      type: "Task",
      label: "Archive Data",
      x: 1150,
      y: 300,
      properties: {},
    }),
  ];

  // Define connections between nodes
  const links = [
    // Initial flow
    new BaseLink("link1", nodes[0], nodes[1]), // Start → Authenticate
    new BaseLink("link2", nodes[0], nodes[2]), // Start → Validate (parallel)
    new BaseLink("link3", nodes[1], nodes[3]), // Authenticate → Process
    new BaseLink("link4", nodes[2], nodes[3]), // Validate → Process

    // Decision path
    new BaseLink("link5", nodes[3], nodes[4]), // Process → Approval?
    new BaseLink("link6", nodes[4], nodes[5]), // Approval? → Get Approval (yes)
    new BaseLink("link7", nodes[4], nodes[7]), // Approval? → Handle Rejection (no)

    // Approval path
    new BaseLink("link8", nodes[5], nodes[6]), // Get Approval → Log Decision
    new BaseLink("link9", nodes[6], nodes[10]), // Log Decision → Complete?

    // Rejection path
    new BaseLink("link10", nodes[7], nodes[8]), // Handle Rejection → Notify
    new BaseLink("link11", nodes[8], nodes[10]), // Notify → Complete?

    // Parallel processin
    new BaseLink("link12", nodes[3], nodes[9]), // Process → Audit Trail
    new BaseLink("link13", nodes[9], nodes[10]), // Audit Trail → Create Backup
    new BaseLink("link14", nodes[10], nodes[11]), // Create Backup → Complete?

    // Final decisions
    new BaseLink("link15", nodes[11], nodes[12]), // Complete? → Success
    new BaseLink("link16", nodes[11], nodes[13]), // Complete? → Failed

    // Additional paralle
    new BaseLink("link17", nodes[11], nodes[14]), // Complete? → Generate Report
    new BaseLink("link18", nodes[14], nodes[15]), // Generate Report → Archive
  ];

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const onChangeItems = (nodes: BaseNode[], links: BaseLink[]) => {
    console.log(
      "A change has appeared, the new its this: " +
        JSON.stringify(nodes) +
        ", in: " +
        JSON.stringify(links),
    );
  };

  useEffect(() => {
    if (
      svgRef.current &&
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      nodes.length > 0 &&
      links.length > 0
    ) {
      const svgElement = svgRef.current;
      while (svgElement.firstChild)
        svgElement.removeChild(svgElement.firstChild);

      new D3FlowDiagram(
        svgElement,
        dimensions.width,
        dimensions.height,
        nodes,
        links,
        (newNodes, newLinks) => onChangeItems(newNodes, newLinks),
      );
    }
  }, [dimensions]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid meet"
      />
    </div>
  );
};
