import { loadDefaultSpec, orderProperties } from "../services/OrderSpecResolver";

export class MetadataHelpers {
  static findAllReferencingProperties(
    metadata: Record<string, unknown>,
    currentFileName: string,
  ): string[] {
    const properties: string[] = [];
    for (const [key, value] of Object.entries(metadata)) {
      if (this.containsReference(value, currentFileName)) {
        properties.push(key);
      }
    }
    return properties;
  }

  static findReferencingProperty(
    metadata: Record<string, unknown>,
    currentFileName: string,
  ): string | undefined {
    for (const [key, value] of Object.entries(metadata)) {
      if (this.containsReference(value, currentFileName)) {
        return key;
      }
    }
    return undefined;
  }

  /**
   * Check if a value contains a reference to a file via wiki-link syntax.
   * Only explicit wiki-links [[...]] are matched, plain text is ignored.
   *
   * @param value - The value to check (string, array, etc.)
   * @param fileName - The target file name to look for
   * @returns true if value contains a wiki-link reference to the file
   *
   * @example
   * containsReference("[[Project]]", "Project.md") // true
   * containsReference("[[Project|Alias]]", "Project.md") // true
   * containsReference("[[folder/Project]]", "Project.md") // true
   * containsReference("Project", "Project.md") // false (plain text, not a wiki-link)
   */
  static containsReference(value: unknown, fileName: string): boolean {
    if (!value) return false;

    const cleanName = fileName.replace(/\.md$/, "");

    if (typeof value === "string") {
      // Match only wiki-link syntax: [[Page]], [[Page|Alias]], [[folder/Page]]
      // Use [^[\]]+ instead of [^\]]+ to avoid catastrophic backtracking (ReDoS)
      // This pattern doesn't allow nested brackets, which is correct for wiki-links
      const wikiLinkRegex = /\[\[([^[\]]+)\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(value)) !== null) {
        const linkContent = match[1];
        // Handle [[Page|Alias]] format - use the target part before |
        const target = linkContent.split("|")[0].trim();

        // Check if target matches filename (with or without path)
        // Match: "Project" === "Project" OR "folder/Project" ends with "/Project"
        if (target === cleanName || target.endsWith(`/${cleanName}`)) {
          return true;
        }
      }
      return false; // No wiki-link match found
    }

    if (Array.isArray(value)) {
      return value.some((v) => this.containsReference(v, fileName));
    }

    return false;
  }

  static isAssetArchived(metadata: Record<string, unknown>): boolean {
    // Check exo__Asset_isArchived field with full truthy value support
    const exoArchivedValue = metadata?.exo__Asset_isArchived;
    if (exoArchivedValue !== undefined && exoArchivedValue !== null) {
      if (exoArchivedValue === true || exoArchivedValue === 1) {
        return true;
      }
      if (typeof exoArchivedValue === "string") {
        const normalized = exoArchivedValue.toLowerCase().trim();
        if (normalized === "true" || normalized === "yes" || normalized === "1") {
          return true;
        }
      }
      if (typeof exoArchivedValue === "boolean") {
        return exoArchivedValue;
      }
    }

    // Fallback to legacy 'archived' field
    const archivedValue = metadata?.archived;

    if (archivedValue === undefined || archivedValue === null) {
      return false;
    }

    if (typeof archivedValue === "boolean") {
      return archivedValue;
    }

    if (typeof archivedValue === "number") {
      return archivedValue !== 0;
    }

    if (typeof archivedValue === "string") {
      const normalized = archivedValue.toLowerCase().trim();
      return (
        normalized === "true" || normalized === "yes" || normalized === "1"
      );
    }

    return false;
  }

  static getPropertyValue(
    relation: {
      title: string;
      created: number;
      modified: number;
      path: string;
      metadata?: Record<string, unknown>;
    },
    propertyName: string,
  ): string | number | unknown {
    if (propertyName === "Name") return relation.title;
    if (propertyName === "title") return relation.title;
    if (propertyName === "created") return relation.created;
    if (propertyName === "modified") return relation.modified;
    if (propertyName === "path") return relation.path;
    return relation.metadata?.[propertyName];
  }

  static ensureQuoted(value: string): string {
    if (!value || value === '""') return '""';
    if (value.startsWith('"') && value.endsWith('"')) return value;
    return `"${value}"`;
  }

  static buildFileContent(
    frontmatter: Record<string, unknown>,
    bodyContent?: string,
  ): string {
    const ordered = orderProperties(frontmatter, loadDefaultSpec());
    const frontmatterLines = Object.entries(ordered)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const arrayItems = value.map((item) => `  - ${String(item)}`).join("\n");
          return `${key}:\n${arrayItems}`;
        }
        return `${key}: ${String(value)}`;
      })
      .join("\n");

    let effectiveBody = bodyContent;
    if (effectiveBody === undefined) {
      const label = ordered["exo__Asset_label"];
      if (typeof label === "string" && label.trim() !== "") {
        effectiveBody = `# ${label}`;
      }
    }

    const body = effectiveBody ? `\n${effectiveBody}\n` : "\n";
    return `---\n${frontmatterLines}\n---\n${body}`;
  }
}
