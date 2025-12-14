export interface GraphEdge {
  source: string;
  target: string;
  type: "backlink" | "forward-link";
}
