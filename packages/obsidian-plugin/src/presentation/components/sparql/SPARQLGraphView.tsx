import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { Triple } from "exocortex";
import type { GraphData, GraphNode, GraphEdge } from "exocortex";
import { RDFToGraphDataConverter } from '@plugin/application/utils/RDFToGraphDataConverter';

interface SPARQLGraphViewProps {
  triples: Triple[];
  onAssetClick: (path: string) => void;
}

export const extractPredicateName = (source: string | GraphNode, target: string | GraphNode, triplesData: Triple[]): string => {
  const sourcePath = typeof source === "string" ? source : source.path;
  const targetPath = typeof target === "string" ? target : target.path;

  const matchingTriple = triplesData.find((t) => {
    const subjectStr = t.subject.toString();
    const objectStr = t.object.toString();
    const subjectIRI = subjectStr.match(/^<(.+)>$/)?.[1];
    const objectIRI = objectStr.match(/^<(.+)>$/)?.[1];
    return subjectIRI === sourcePath && objectIRI === targetPath;
  });

  if (matchingTriple) {
    const predicateStr = matchingTriple.predicate.toString();
    const predicateIRI = predicateStr.match(/^<(.+)>$/)?.[1];
    if (predicateIRI) {
      const parts = predicateIRI.split(/[/#]/);
      return parts[parts.length - 1] || predicateIRI;
    }
  }

  return "relates-to";
};

export const SPARQLGraphView: React.FC<SPARQLGraphViewProps> = ({ triples, onAssetClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || triples.length === 0) return;

    const graphData: GraphData = RDFToGraphDataConverter.convert(triples);
    const { nodes, edges } = graphData;

    if (nodes.length === 0) return;

    const width = containerRef.current.clientWidth || 800;
    const height = 600;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", width).attr("height", height).attr("viewBox", [0, 0, width, height]);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id((d: GraphNode) => d.path)
          .distance(150)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(40));

    const link = g
      .append("g")
      .attr("class", "sparql-graph-links")
      .selectAll<SVGLineElement, GraphEdge>("line")
      .data(edges)
      .join("line")
      .attr("class", "sparql-graph-link")
      .attr("stroke", "var(--text-muted)")
      .attr("stroke-width", 2);

    const linkLabel = g
      .append("g")
      .attr("class", "sparql-graph-link-labels")
      .selectAll<SVGTextElement, GraphEdge>("text")
      .data(edges)
      .join("text")
      .attr("class", "sparql-graph-link-label")
      .attr("font-size", "10px")
      .attr("fill", "var(--text-faint)")
      .attr("text-anchor", "middle")
      .text((d: GraphEdge) => extractPredicateName(d.source, d.target, triples));

    const node = g
      .append("g")
      .attr("class", "sparql-graph-nodes")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("class", "sparql-graph-node")
      .attr("r", 8)
      .attr("fill", "var(--interactive-accent)")
      .attr("stroke", "var(--background-primary)")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .on("click", (_event: MouseEvent, d: GraphNode) => {
        onAssetClick(d.path);
      })
      .call(
        d3
          .drag<SVGCircleElement, GraphNode>()
          .on("start", (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d: GraphNode) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d: GraphNode) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>, d: GraphNode) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const nodeLabel = g
      .append("g")
      .attr("class", "sparql-graph-node-labels")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .attr("class", "sparql-graph-node-label")
      .attr("font-size", "12px")
      .attr("fill", "var(--text-normal)")
      .attr("text-anchor", "middle")
      .attr("dy", "20px")
      .attr("cursor", "pointer")
      .text((d: GraphNode) => d.label)
      .on("click", (_event: MouseEvent, d: GraphNode) => {
        onAssetClick(d.path);
      });

    simulation.on("tick", () => {
      link
        .attr("x1", (d: GraphEdge) => (typeof d.source === "object" ? (d.source as GraphNode).x ?? 0 : 0))
        .attr("y1", (d: GraphEdge) => (typeof d.source === "object" ? (d.source as GraphNode).y ?? 0 : 0))
        .attr("x2", (d: GraphEdge) => (typeof d.target === "object" ? (d.target as GraphNode).x ?? 0 : 0))
        .attr("y2", (d: GraphEdge) => (typeof d.target === "object" ? (d.target as GraphNode).y ?? 0 : 0));

      linkLabel
        .attr("x", (d: GraphEdge) => {
          const sx = typeof d.source === "object" ? (d.source as GraphNode).x ?? 0 : 0;
          const tx = typeof d.target === "object" ? (d.target as GraphNode).x ?? 0 : 0;
          return (sx + tx) / 2;
        })
        .attr("y", (d: GraphEdge) => {
          const sy = typeof d.source === "object" ? (d.source as GraphNode).y ?? 0 : 0;
          const ty = typeof d.target === "object" ? (d.target as GraphNode).y ?? 0 : 0;
          return (sy + ty) / 2;
        });

      node.attr("cx", (d: GraphNode) => d.x ?? 0).attr("cy", (d: GraphNode) => d.y ?? 0);

      nodeLabel.attr("x", (d: GraphNode) => d.x ?? 0).attr("y", (d: GraphNode) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [triples, onAssetClick]);

  return (
    <div ref={containerRef} className="sparql-graph-view">
      <svg ref={svgRef}></svg>
    </div>
  );
};
