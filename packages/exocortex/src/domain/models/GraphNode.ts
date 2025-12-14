export interface GraphNodeData {
  path: string;
  title: string;
  label: string;
  assetClass?: string;
  isArchived: boolean;
}

export interface GraphNode extends GraphNodeData {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}
