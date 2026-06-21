export interface AreaNodeData {
  path: string;
  title: string;
  label?: string;
  isArchived: boolean;
  depth: number;
  parentPath?: string;
}

export interface AreaNode extends AreaNodeData {
  children: AreaNode[];
}
