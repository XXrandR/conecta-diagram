import { BaseLink, BaseNode } from '@/types/DiagramTypes';
import * as d3 from 'd3';

export class AnimationService {
    private simulation: d3.Simulation<BaseNode, undefined>;
    private tickHandlers: (() => void)[] = [];

    constructor(
        nodes: BaseNode[],
        links: BaseLink[],
        width: number,
        height: number
    ) {
        const forceLinks = links.map((l) => l.obtainLinkForceCompatible());

        const verticalSpacing = 100;
        const centerX = width / 2;

        nodes.forEach((node, index) => {
            node.x = centerX + (Math.random() - 0.5) * 20; // add slight horizontal variation
            node.y = 100 + index * verticalSpacing;
        });

        this.simulation = d3
            .forceSimulation(nodes)
            .alphaDecay(0.03)
            .velocityDecay(0.4)
            .force('charge', d3.forceManyBody().strength(-80))
            .force('collision', d3.forceCollide(20))
            .force(
                'link',
                d3
                    .forceLink(forceLinks)
                    .id((d: any) => d.id)
                    .distance(80)
                    .strength(0.07)
            )
            .force('center', d3.forceCenter(width / 2, height / 2))
            .on('tick', () => this.tickHandlers.forEach((h) => h()));

        this.simulation.alpha(1).restart();
    }

    registerTickHandler(handler: () => void) {
        this.tickHandlers.push(handler);
    }

    updateNodes(nodes: BaseNode[]) {
        this.simulation.nodes(nodes);
        this.simulation.alpha(1).restart();
    }

    updateLinks(links: BaseLink[]) {
        const linkForce = this.simulation.force('link') as d3.ForceLink<
            BaseNode,
            any
        >;
        linkForce.links(links.map((l) => l.obtainLinkForceCompatible()));
        this.simulation.alpha(1).restart();
    }

    enableDrag(
        selection: d3.Selection<SVGGElement, BaseNode, SVGSVGElement, unknown>
    ) {
        const drag = d3
            .drag<SVGGElement, BaseNode>()
            .on('start', this.dragStarted.bind(this))
            .on('drag', this.dragged.bind(this))
            .on('end', this.dragEnded.bind(this));
        selection.call(drag);
    }

    private dragStarted(
        event: d3.D3DragEvent<SVGGElement, BaseNode, BaseNode>
    ) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        // Clear any previous fixed position
        event.subject.fx = null;
        event.subject.fy = null;
        // Update position directly
        event.subject.x = event.x;
        event.subject.y = event.y;
    }

    private dragged(event: d3.D3DragEvent<SVGGElement, BaseNode, BaseNode>) {
        // Update both position and fixed position
        event.subject.x = event.x;
        event.subject.y = event.y;
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }

    private dragEnded(event: d3.D3DragEvent<SVGGElement, BaseNode, BaseNode>) {
        if (!event.active) this.simulation.alphaTarget(0);
        // Release fixed position but keep current position
        event.subject.fx = null;
        event.subject.fy = null;
        event.subject.x = event.x;
        event.subject.y = event.y;
    }
}
