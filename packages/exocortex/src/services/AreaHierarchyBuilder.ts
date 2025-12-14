import { injectable, inject } from "tsyringe";
import { AreaNode, AreaNodeData } from "../domain/models/AreaNode";
import { AssetClass } from "../domain/constants";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

export interface AssetRelation {
  path: string;
  title: string;
  propertyName?: string;
  isArchived?: boolean;
  metadata: Record<string, any>;
}

@injectable()
export class AreaHierarchyBuilder {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  buildHierarchy(
    currentAreaPath: string,
    _relations: AssetRelation[],
  ): AreaNode | null {
    const currentFile = this.vault.getAbstractFileByPath(currentAreaPath);
    if (!this.isFile(currentFile)) {
      return null;
    }

    const metadata = this.vault.getFrontmatter(currentFile as IFile) || {};
    const instanceClass = this.extractInstanceClass(metadata);

    if (instanceClass !== AssetClass.AREA) {
      return null;
    }

    const allAreas = this.collectAllAreasFromVault();
    const visited = new Set<string>();
    return this.buildTree(currentAreaPath, allAreas, visited, 0);
  }

  private isFile(file: any): file is IFile {
    return (
      file && typeof file === "object" && "basename" in file && "path" in file
    );
  }

  private extractInstanceClass(metadata: Record<string, any>): string {
    const instanceClass = metadata.exo__Instance_class || "";
    if (Array.isArray(instanceClass)) {
      return this.cleanWikiLink(instanceClass[0] || "");
    }
    return this.cleanWikiLink(instanceClass);
  }

  private cleanWikiLink(value: string): string {
    if (typeof value !== "string") return "";
    return value.replace(/^\[\[|\]\]$/g, "").trim();
  }

  private collectAllAreasFromVault(): Map<string, AreaNodeData> {
    const areas = new Map<string, AreaNodeData>();
    const pathByBasename = new Map<string, string>();

    const allFiles = this.vault.getAllFiles();

    for (const file of allFiles) {
      const metadata = this.vault.getFrontmatter(file) || {};
      const instanceClass = this.extractInstanceClass(metadata);

      if (instanceClass === AssetClass.AREA) {
        const parentPath = this.extractParentPath(metadata);
        areas.set(file.path, {
          path: file.path,
          title: file.basename,
          label: metadata.exo__Asset_label || undefined,
          isArchived: this.isArchived(metadata),
          depth: 0,
          parentPath: parentPath || undefined,
        });
        pathByBasename.set(file.basename, file.path);
      }
    }

    for (const [, area] of areas.entries()) {
      if (area.parentPath && pathByBasename.has(area.parentPath)) {
        area.parentPath = pathByBasename.get(area.parentPath);
      }
    }

    return areas;
  }

  private extractParentPath(metadata: Record<string, any>): string | null {
    const parentProperty = metadata.ems__Area_parent;
    if (!parentProperty) {
      return null;
    }

    if (Array.isArray(parentProperty)) {
      const firstParent = parentProperty[0] || "";
      return this.cleanWikiLink(firstParent);
    }

    return this.cleanWikiLink(parentProperty);
  }

  private isArchived(metadata: Record<string, any>): boolean {
    const archivedProp = metadata.exo__Asset_archived;
    if (archivedProp === true || archivedProp === "true") {
      return true;
    }
    if (Array.isArray(archivedProp) && archivedProp.length > 0) {
      const first = archivedProp[0];
      return first === true || first === "true";
    }
    return false;
  }

  private buildTree(
    path: string,
    areas: Map<string, AreaNodeData>,
    visited: Set<string>,
    depth: number,
  ): AreaNode | null {
    if (visited.has(path)) {
      return null;
    }

    visited.add(path);

    const area = areas.get(path);
    if (!area) {
      return null;
    }

    const children: AreaNode[] = [];
    for (const [childPath, childData] of areas.entries()) {
      if (childData.parentPath === path) {
        const childNode = this.buildTree(childPath, areas, visited, depth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }
    }

    children.sort((a, b) => {
      const aLabel = a.label || a.title;
      const bLabel = b.label || b.title;
      return aLabel.localeCompare(bLabel);
    });

    return {
      path: area.path,
      title: area.title,
      label: area.label,
      isArchived: area.isArchived,
      depth,
      parentPath: area.parentPath,
      children,
    };
  }
}
