import { BaseLink } from "../DiagramTypes";
import * as d3 from "d3";
import { getNodeEdgePoint, getNodeRadius } from "../util/UtilsBasic";

export class LinkRenderer {
  static render(
    parentGroup: d3.Selection<SVGGElement, unknown, null, unknown>,
    link: BaseLink,
  ) {
    const originRadius = getNodeRadius(link.originParent.type);
    const finalRadius = getNodeRadius(link.finalParent.type);

    const sourcePoint = getNodeEdgePoint(
      link.originParent.x,
      link.originParent.y,
      link.finalParent.x,
      link.finalParent.y,
      originRadius,
    );

    const targetPoint = getNodeEdgePoint(
      link.finalParent.x,
      link.finalParent.y,
      link.originParent.x,
      link.originParent.y,
      finalRadius,
    );

    const linkGenerator = d3
      .link(d3.curveBumpY)
      .x((d) => d[0])
      .y((d) => d[1]);

    const linkPath = parentGroup.select<SVGPathElement>(`path#link-${link.id}`);

    const pathData = linkGenerator({
      source: [sourcePoint.x, sourcePoint.y],
      target: [targetPoint.x, targetPoint.y],
    });

    if (linkPath.empty()) {
      parentGroup
        .append("path")
        .attr("id", `link-${link.id}`)
        .attr(
          "d",
          linkGenerator({
            source: [sourcePoint.x, sourcePoint.y],
            target: [targetPoint.x, targetPoint.y],
          }),
        )
        .attr("fill", "none")
        .attr("stroke", "#777")
        .attr("stroke-width", 2)
        .attr("marker-end", "url(#arrowhead)");
    } else {
      linkPath.attr("d", pathData);
    }
  }
}
