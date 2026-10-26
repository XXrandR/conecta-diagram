import { BaseLink, BaseNode, NodeType } from '@/types/DiagramTypes';
import * as d3 from 'd3';
import { NodeRenderer } from './renderer/NodeRenderer';
import { LinkRenderer } from './renderer/LinkRenderer';
import { AnimationService } from './service/AnimationService';
import { ConnectionHandler } from './handler/ConnectionHandler';

export class D3FlowDiagram {
	private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
	private nodes: BaseNode[];
	private links: BaseLink[];
	private animation: AnimationService;
	private connectionHandler: ConnectionHandler;
	private currentConnectionSource: BaseNode | null = null;
	private zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
	private diagramGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
	private onChange: (nodes: BaseNode[], links: BaseLink[]) => void;

	constructor(
		svgElement: SVGSVGElement,
		width: number,
		height: number,
		nodes: BaseNode[],
		links: BaseLink[],
		onChange: (nodes: BaseNode[], links: BaseLink[]) => void
	) {
		if (!svgElement) {
			throw new Error(
				'D3FlowDiagram requires an SVG element to initialize.'
			);
		}
		this.onChange = onChange;
		this.nodes = nodes;
		this.links = links;

		this.svg = d3
			.select(svgElement)
			.attr('width', '100%')
			.attr('height', '100vh')
			.style('cursor', 'grab');

		this.diagramGroup = this.svg
			.attr('id', 'base-svg')
			.append<SVGGElement>('g')
			.attr('class', 'nodes-and-links');

		this.zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.5, 3])
			.on('zoom', (event) => {
				this.diagramGroup.attr('transform', event.transform.toString());
			});

		this.svg.call(this.zoom);
		this.createArrowMarker();

		this.animation = new AnimationService(
			this.nodes,
			this.links,
			width,
			height
		);
		this.setupTickHandler();
		this.addZoomControls();

		setTimeout(() => {
			this.nodes.forEach((node) => this.addNode(node));
			this.links.forEach((link) => this.addLink(link));
			this.fitToView({ width, height });
		}, 250);

		this.connectionHandler = new ConnectionHandler(this.diagramGroup);
		this.diagramGroup.on('click', (event) => {
			if (this.connectionHandler.isConnectionInProgress()) {
				const target = event.target as Element;
				const isInsideNode = target.closest('.node');
				if (!isInsideNode) {
					this.cancelConnection();
				}
			}
		});
	}

	private createArrowMarker() {
		this.svg
			.append('defs')
			.append('marker')
			.attr('id', 'arrowhead')
			.attr('viewBox', '0 -5 10 10')
			.attr('refX', 8)
			.attr('refY', 0)
			.attr('orient', 'auto')
			.attr('markerWidth', 6)
			.attr('markerHeight', 6)
			.attr('xoverflow', 'visible')
			.append('path')
			.attr('d', 'M0,-5L10,0L0,5')
			.attr('fill', '#777');
	}

	public addNode(node: BaseNode) {
		this.nodes.push(node);
		NodeRenderer.render(
			this.diagramGroup,
			this.diagramGroup.select<SVGGElement>(`g#node-${node.id}`),
			node,
			this.handleCreateNode,
			this.handleRemoveNode,
			this.handleCompleteConnection,
			this.handleStartConnectionFromMenu,
			this.connectionHandler
		);
		this.animation.enableDrag(
			this.svg.selectAll<SVGGElement, BaseNode>('.node')
		);
	}

	public addLink(link: BaseLink) {
		this.links.push(link);
		LinkRenderer.render(this.diagramGroup, link);
		this.animation.updateLinks(this.links);
	}

	// FUNCTIONS like remove or add
	private handleRemoveNode = (parentNode: BaseNode) => {
		this.links = this.links.filter((link) => {
			const shouldKeep =
				link.originParent.id !== parentNode.id &&
				link.finalParent.id !== parentNode.id;
			if (!shouldKeep) {
				this.diagramGroup.select(`#link-${link.id}`).remove();
			}
			return shouldKeep;
		});

		this.nodes = this.nodes.filter((node) => node.id !== parentNode.id);
		this.diagramGroup.select(`#node-${parentNode.id}`).remove();
		this.animation.updateNodes(this.nodes);
		this.animation.updateLinks(this.links);
		this.onChange(this.nodes, this.links);
	};

	private handleCreateNode = (parentNode: BaseNode, type: NodeType) => {
		console.log('parent: ' + JSON.stringify(parentNode));
		const newNode = new BaseNode({
			id: `node-${Date.now()}`,
			type: type,
			label: `${type} Node`,
			x: parentNode.x + 100,
			y: parentNode.y,
			properties: {},
		});

		this.addNode(newNode);
		this.addLink(
			new BaseLink(
				`link-${Date.now()}`,
				// "Connector",
				parentNode,
				newNode
			)
		);
		this.animation.updateNodes(this.nodes);
		this.animation.updateLinks(this.links);
		this.onChange(this.nodes, this.links);
	};

	// for animation
	private setupTickHandler() {
		this.animation.registerTickHandler(() => {
			this.nodes.forEach((node) => {
				if (node.x !== undefined && node.y !== undefined) {
					const nodeElement = this.diagramGroup.select<SVGGElement>(
						`#node-${node.id}`
					);
					if (!nodeElement.empty()) {
						nodeElement.attr(
							'transform',
							`translate(${node.x},${node.y})`
						);
					}
				}
			});
			this.links.forEach((link) =>
				LinkRenderer.render(this.diagramGroup, link)
			);
		});
	}

	// for new links only
	private handleStartConnectionFromMenu = (sourceNode: BaseNode) => {
		console.log(`Started connection from: ${sourceNode.label}`);
		this.currentConnectionSource = sourceNode;
		this.connectionHandler.startConnection(sourceNode);
		this.diagramGroup.style('cursor', 'crosshair');
		d3.select(`#node-${sourceNode.id}`).classed('connection-source', true);
		d3.select('body').on('keydown.connection', (event) => {
			if (event.key === 'Escape') this.cancelConnection();
		});
	};

	private handleCompleteConnection = (targetNode: BaseNode) => {
		console.log(
			`[D3FlowDiagram] onCompleteConnection called, source=`,
			this.currentConnectionSource,
			`target=`,
			targetNode
		);
		if (!this.currentConnectionSource) return;

		if (this.currentConnectionSource.id === targetNode.id) {
			console.warn('Cannot create connection to the same node.');
			return;
		}

		console.log(
			`Creating connection from: ${this.currentConnectionSource.label} to: ${targetNode.label}`
		);
		this.addLink(
			new BaseLink(
				`link-${Date.now()}`,
				this.currentConnectionSource,
				targetNode
			)
		);
		this.cancelConnection();
		this.onChange(this.nodes, this.links);
	};

	private cancelConnection = () => {
		console.log('Canceling creation of connnection.');
		this.connectionHandler.cancelConnection();
		this.currentConnectionSource = null;
		this.diagramGroup.style('cursor', '');
		d3.select('body').on('keydown.connection', null);
	};

	// for zoom
	private addZoomControls() {
		const leftArrow = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M15 6L9 12L15 18" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const rightArrow = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M9 6L15 12L9 18" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const upArrow = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M6 15L12 9L18 15" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const downArrow = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M6 9L12 15L18 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const homeIcon = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M2 8L11.7317 3.13416C11.9006 3.04971 12.0994 3.0497 12.2683 3.13416L22 8" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M20 11V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V11" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const zoomIn = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M8 11H11M14 11H11M11 11V8M11 11V14" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M17 17L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'
		const zoomOut = '<?xml version="1.0" encoding="UTF-8"?><svg width="20px" height="20px" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000" style="--darkreader-inline-color: var(--darkreader-text-000000, #e8e6e3);" data-darkreader-inline-color=""><path d="M17 17L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path><path d="M8 11L14 11" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: #000000;" data-darkreader-inline-stroke=""></path></svg>'

		const controls = this.svg
			.append('g')
			.attr('class', 'zoom-controls')
			.attr('transform', 'translate(-20, 10)'); // Adjusted initial position

		// Reset view button (Home)
		const resetBtn = controls
			.append('g')
			.attr('class', 'zoom-control')
			.attr('transform', 'translate(0, 0)');

		resetBtn.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		const homeNode = new DOMParser()
			.parseFromString(homeIcon, 'image/svg+xml')
			.documentElement;

		resetBtn.append('g')
			.attr('transform', 'translate(5,5) scale(1)')
			.node()?.appendChild(homeNode);

		resetBtn.on('click', () => {
			this.svg
				.transition()
				.duration(750)
				.call(this.zoom.transform, d3.zoomIdentity);
		});


		// Zoom in button (+)
		const zoomInBtn = controls
			.append('g')
			.attr('class', 'zoom-control')
			.attr('transform', 'translate(40, 0)'); // Right of reset

		zoomInBtn.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		const zoomInNode = new DOMParser()
			.parseFromString(zoomIn, 'image/svg+xml')
			.documentElement;

		zoomInBtn.append('g')
			.attr('transform', 'translate(5,5) scale(1)')
			.node()?.appendChild(zoomInNode);

		zoomInBtn.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.scale(0.7));
		});

		// zoom out
		const zoomOutBtn = controls
			.append('g')
			.attr('class', 'zoom-control')
			.attr('transform', 'translate(40, 40)');

		zoomOutBtn.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		// drop the icon centered
		const iconNode = new DOMParser()
			.parseFromString(zoomOut, 'image/svg+xml')
			.documentElement;

		// wrap in a g and position
		const iconWrapper = zoomOutBtn.append('g')
			.attr('transform', 'translate(5,5) scale(1.0)'); // tweak numbers

		iconWrapper.node()?.appendChild(iconNode);

		zoomOutBtn.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.scale(0.7));
		});

		// Pan controls (↑ ↓ ← →)

		const panUp = controls
			.append('g')
			.attr('class', 'pan-control')
			.attr('transform', 'translate(15, 80)'); // Positioned below zoom buttons

		panUp.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		// parse the arrow svg string
		const upArrowNode = new DOMParser()
			.parseFromString(upArrow, 'image/svg+xml')
			.documentElement;

		// wrap it in a g and center in the 30×30 square
		const upWrapper = panUp.append('g')
			.attr('transform', 'translate(5,5) scale(1)');
		// (30 - 24)/2 = 3 to center a 24×24 viewBox icon

		upWrapper.node()?.appendChild(upArrowNode);

		panUp.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.translate(0, -100));
		});

		// Repeat for ↓, ←, → with adjusted positions:
		const panDown = controls
			.append('g')
			.attr('class', 'pan-control')
			.attr('transform', 'translate(15, 120)'); // Below panUp

		panDown.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		// parse the down-arrow svg string
		const downArrowNode = new DOMParser()
			.parseFromString(downArrow, 'image/svg+xml')
			.documentElement;

		// wrapper to center 24x24 icon in 30x30 rect
		const downWrapper = panDown.append('g')
			.attr('transform', 'translate(5,5) scale(1)');
		// 3px offset = (30 - 24)/2

		downWrapper.node()?.appendChild(downArrowNode);

		panDown.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.translate(0, 100));
		});

		const panLeft = controls
			.append('g')
			.attr('class', 'pan-control')
			.attr('transform', 'translate(-20, 100)'); // Left of panUp/Down

		panLeft.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		const leftArrowNode = new DOMParser()
			.parseFromString(leftArrow, 'image/svg+xml')
			.documentElement;

		const leftWrapper = panLeft.append('g')
			.attr('transform', 'translate(5,5) scale(1)'); // center 24x24 in 30x30

		leftWrapper.node()?.appendChild(leftArrowNode);

		panLeft.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.translate(-100, 0));
		});


		// --- Right button ---
		const panRight = controls
			.append('g')
			.attr('class', 'pan-control')
			.attr('transform', 'translate(50, 100)'); // Right of panUp/Down

		panRight.append('rect')
			.attr('width', 30)
			.attr('height', 30)
			.attr('rx', 4)
			.attr('fill', '#fff')
			.attr('stroke', '#ccc');

		const rightArrowNode = new DOMParser()
			.parseFromString(rightArrow, 'image/svg+xml')
			.documentElement;

		const rightWrapper = panRight.append('g')
			.attr('transform', 'translate(5,5) scale(1)');

		rightWrapper.node()?.appendChild(rightArrowNode);

		panRight.on('click', () => {
			const current = d3.zoomTransform(this.svg.node() as SVGSVGElement);
			this.svg.transition().duration(300)
				.call(this.zoom.transform, current.translate(100, 0));
		});
	}

	fitToView({ width, height }: { width: any; height: any }) {
		const bounds = this.diagramGroup.node()?.getBBox();
		if (!bounds) return;

		const fullWidth = bounds.width + 100; // Add padding
		const fullHeight = bounds.height + 100;
		const scale = Math.min(width / fullWidth, height / fullHeight) * 0.9; // Add margin

		const transform = d3.zoomIdentity
			.translate(
				(width - fullWidth * scale) / 2 - bounds.x * scale,
				(height - fullHeight * scale) / 2 - bounds.y * scale
			)
			.scale(scale);

		this.svg
			.transition()
			.duration(750)
			.call(this.zoom.transform, transform);
	}
}
