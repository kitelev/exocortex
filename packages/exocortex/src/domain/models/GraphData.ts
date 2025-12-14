import type { GraphNode } from "./GraphNode";
import type { GraphEdge } from "./GraphEdge";

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
