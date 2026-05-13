/**
 * FrontmatterService
 *
 * Centralized service for YAML frontmatter manipulation in Markdown files.
 * Follows DRY principle by eliminating duplication across 15+ locations.
 *
 * @module infrastructure/services
 * @since 1.0.0
 */

/**
 * Result of frontmatter parsing operation
 */
export interface FrontmatterParseResult {
  /** Whether frontmatter block exists */
  exists: boolean;
  /** Parsed frontmatter content (without --- delimiters) */
  content: string;
  /** Original full file content */
  originalContent: string;
}

/**
 * Service for manipulating YAML frontmatter in Markdown files.
 *
 * Handles common operations like:
 * - Adding/updating/removing properties
 * - Creating frontmatter blocks when missing
 * - Preserving existing properties
 * - Maintaining YAML formatting
 *
 * @example
 * ```typescript
 * const service = new FrontmatterService();
 *
 * // Update existing property
 * const updated = service.updateProperty(
 *   content,
 *   'status',
 *   '"[[StatusDone]]"'
 * );
 *
 * // Add new property
 * const withNew = service.addProperty(content, 'priority', 'high');
 *
 * // Remove property
 * const removed = service.removeProperty(content, 'archived');
 * ```
 */
export class FrontmatterService {
  /**
   * Regex pattern for matching YAML frontmatter blocks.
   * Matches: ---\n[content]\n---
   */
  private static readonly FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

  /**
   * Parse frontmatter from markdown content.
   *
   * @param content - Full markdown file content
   * @returns Parse result with existence flag and content
   *
   * @example
   * ```typescript
   * const result = service.parse('---\nfoo: bar\n---\nBody');
   * // result.exists === true
   * // result.content === 'foo: bar'
   * ```
   */
  parse(content: string): FrontmatterParseResult {
    const match = content.match(FrontmatterService.FRONTMATTER_REGEX);

    if (!match) {
      return {
        exists: false,
        content: "",
        originalContent: content,
      };
    }

    return {
      exists: true,
      content: match[1],
      originalContent: content,
    };
  }

  /**
   * Parse frontmatter into a key/value object.
   *
   * Handles `key: value` scalar lines and `key:\n  - item` two-space-indented
   * YAML arrays — the two shapes Exocortex ассеты actually use. Returns null
   * when no frontmatter block is present. Used by callers that need to read
   * another asset's properties (e.g. copy-from-target in create_instance),
   * where `parse()` (which returns the raw YAML string) is insufficient.
   *
   * NOTE: deliberately minimal — does NOT cover inline `[a, b]` arrays, block
   * scalars, nested maps, or quoted-key edge cases. Match the existing
   * lightweight parser in ShapeLoader so behaviour is consistent vault-wide
   * without pulling in a heavyweight YAML dependency.
   */
  parseObject(content: string): Record<string, string | string[]> | null {
    const parsed = this.parse(content);
    if (!parsed.exists) return null;

    const result: Record<string, string | string[]> = {};
    const lines = parsed.content.split(/\r?\n/);
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    const flushArray = (): void => {
      if (currentKey !== null && currentArray !== null) {
        result[currentKey] = currentArray;
      }
      currentKey = null;
      currentArray = null;
    };

    for (const line of lines) {
      const arrayItem = /^ {2}- (.*)$/.exec(line);
      if (arrayItem) {
        if (currentKey !== null && currentArray !== null) {
          currentArray.push(arrayItem[1].trim());
        }
        continue;
      }

      flushArray();

      const kvMatch = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
      if (!kvMatch) continue;
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (value === "") {
        currentKey = key;
        currentArray = [];
      } else {
        result[key] = value;
      }
    }

    flushArray();
    return result;
  }

  /**
   * Update or add a property in frontmatter.
   *
   * - If frontmatter exists and has the property: updates value
   * - If frontmatter exists but lacks property: adds property
   * - If no frontmatter exists: creates frontmatter with property
   *
   * @param content - Full markdown file content
   * @param property - Property name (e.g., 'status', 'ems__Effort_status')
   * @param value - Property value (e.g., '"[[StatusDone]]"', 'true', '42')
   * @returns Updated content with modified frontmatter
   *
   * @example
   * ```typescript
   * // Update existing
   * const result1 = service.updateProperty(
   *   '---\nstatus: draft\n---\nBody',
   *   'status',
   *   'published'
   * );
   * // result1 === '---\nstatus: published\n---\nBody'
   *
   * // Add new property
   * const result2 = service.updateProperty(
   *   '---\nfoo: bar\n---\nBody',
   *   'status',
   *   'draft'
   * );
   * // result2 === '---\nfoo: bar\nstatus: draft\n---\nBody'
   *
   * // Create frontmatter if missing
   * const result3 = service.updateProperty(
   *   'Body content',
   *   'status',
   *   'draft'
   * );
   * // result3 === '---\nstatus: draft\n---\nBody content'
   * ```
   */
  updateProperty(content: string, property: string, value: unknown): string {
    property = FrontmatterService.normalizeIRI(property);
    if (typeof value === "string") {
      value = FrontmatterService.normalizeIRIValue(value);
    }
    const parsed = this.parse(content);
    const serialized = this.serializeValue(property, value);

    // No frontmatter exists - create new block
    if (!parsed.exists) {
      return `---\n${serialized}\n---\n${content}`;
    }

    // Frontmatter exists - update or add property
    let updatedFrontmatter = parsed.content;

    // Property already exists - replace value (including multi-line array items)
    if (this.hasProperty(updatedFrontmatter, property)) {
      const propertyRegex = new RegExp(
        `${this.escapeRegex(property)}:.*(?:\n {2}- .*)*`,
        "m",
      );
      updatedFrontmatter = updatedFrontmatter.replace(
        propertyRegex,
        serialized,
      );
    } else {
      // Property doesn't exist - append to frontmatter
      // Add newline separator only if frontmatter is not empty
      const separator = updatedFrontmatter.length > 0 ? "\n" : "";
      updatedFrontmatter += `${separator}${serialized}`;
    }

    // Replace frontmatter block in original content
    return content.replace(
      FrontmatterService.FRONTMATTER_REGEX,
      `---\n${updatedFrontmatter}\n---`,
    );
  }

  /**
   * Add a new property to frontmatter (alias for updateProperty).
   *
   * Convenience method with clearer semantics for adding new properties.
   *
   * @param content - Full markdown file content
   * @param property - Property name
   * @param value - Property value
   * @returns Updated content
   */
  addProperty(content: string, property: string, value: unknown): string {
    return this.updateProperty(content, property, value);
  }

  /**
   * Remove a property from frontmatter.
   *
   * - If property exists: removes the line
   * - If property doesn't exist: returns content unchanged
   * - If no frontmatter exists: returns content unchanged
   *
   * @param content - Full markdown file content
   * @param property - Property name to remove
   * @returns Updated content with property removed
   *
   * @example
   * ```typescript
   * const result = service.removeProperty(
   *   '---\nfoo: bar\nstatus: draft\n---\nBody',
   *   'status'
   * );
   * // result === '---\nfoo: bar\n---\nBody'
   * ```
   */
  removeProperty(content: string, property: string): string {
    const parsed = this.parse(content);

    // No frontmatter or property doesn't exist - return unchanged
    if (!parsed.exists || !this.hasProperty(parsed.content, property)) {
      return content;
    }

    // Remove property line and any following array items (lines starting with "  - ")
    const propertyLineRegex = new RegExp(
      `\n?${this.escapeRegex(property)}:.*(?:\n {2}- .*)*`,
      "gm",
    );
    const updatedFrontmatter = parsed.content.replace(propertyLineRegex, "");

    // Replace frontmatter block in original content
    return content.replace(
      FrontmatterService.FRONTMATTER_REGEX,
      `---\n${updatedFrontmatter}\n---`,
    );
  }

  /**
   * Check if frontmatter contains a specific property.
   *
   * @param frontmatterContent - Frontmatter content (without --- delimiters)
   * @param property - Property name to check
   * @returns True if property exists
   *
   * @example
   * ```typescript
   * const hasStatus = service.hasProperty('foo: bar\nstatus: draft', 'status');
   * // hasStatus === true
   * ```
   */
  hasProperty(frontmatterContent: string, property: string): boolean {
    return frontmatterContent.includes(`${property}:`);
  }

  /** Namespace IRI → Obsidian property name prefix map */
  private static readonly IRI_PREFIX_MAP: Record<string, string> = {
    "https://exocortex.my/ontology/ems#": "ems__",
    "https://exocortex.my/ontology/exo#": "exo__",
    "https://exocortex.my/ontology/exocmd#": "exocmd__",
    "https://exocortex.my/ontology/ims#": "ims__",
    "https://exocortex.my/ontology/ztlk#": "ztlk__",
    "https://exocortex.my/ontology/ptms#": "ptms__",
    "https://exocortex.my/ontology/lit#": "lit__",
    "https://exocortex.my/ontology/inbox#": "inbox__",
    "https://exocortex.my/ontology/pmbok#": "pmbok__",
  };

  /**
   * Reverse-map a full IRI property name to Obsidian-style name.
   * E.g. "https://exocortex.my/ontology/ems#Effort_status" → "ems__Effort_status"
   * Non-IRI values pass through unchanged.
   */
  static normalizeIRI(property: string): string {
    const hash = property.lastIndexOf("#");
    if (hash < 0) return property;
    const ns = property.substring(0, hash + 1);
    const local = property.substring(hash + 1);
    const prefix = FrontmatterService.IRI_PREFIX_MAP[ns];
    return prefix ? prefix + local : property;
  }

  /**
   * Reverse-map an IRI value to wikilink format.
   * E.g. "obsidian://vault/ems/ems__EffortStatusDoing.md" → "\"[[ems__EffortStatusDoing]]\""
   * Non-IRI and non-obsidian:// values pass through unchanged.
   */
  static normalizeIRIValue(value: string): string {
    // Handle obsidian:// vault URLs
    const obsMatch = value.match(/^obsidian:\/\/vault\/.*\/([^/]+)\.md$/);
    if (obsMatch) {
      return `"[[${obsMatch[1]}]]"`;
    }
    // Handle full ontology IRIs as values
    const normalized = FrontmatterService.normalizeIRI(value);
    if (normalized !== value) {
      return `"[[${normalized}]]"`;
    }
    return value;
  }

  /**
   * Create new frontmatter block with given properties.
   *
   * @param content - Original markdown content (without frontmatter)
   * @param properties - Object with property-value pairs
   * @returns Content with new frontmatter prepended
   *
   * @example
   * ```typescript
   * const result = service.createFrontmatter(
   *   'Body content',
   *   { status: 'draft', priority: 'high' }
   * );
   * // result === '---\nstatus: draft\npriority: high\n---\nBody content'
   * ```
   */
  createFrontmatter(content: string, properties: Record<string, unknown>): string {
    const frontmatterLines = Object.entries(properties).map(
      ([key, value]) => this.serializeValue(key, value),
    );

    const frontmatterBlock = `---\n${frontmatterLines.join("\n")}\n---`;

    // Preserve leading newline if original content starts with one
    const separator = content.startsWith("\n") ? "" : "\n";
    return `${frontmatterBlock}${separator}${content}`;
  }

  /**
   * Get property value from frontmatter content.
   *
   * @param frontmatterContent - Frontmatter content (without --- delimiters)
   * @param property - Property name
   * @returns Property value or null if not found
   *
   * @example
   * ```typescript
   * const value = service.getPropertyValue(
   *   'foo: bar\nstatus: draft',
   *   'status'
   * );
   * // value === 'draft'
   * ```
   */
  getPropertyValue(
    frontmatterContent: string,
    property: string,
  ): string | null {
    const propertyRegex = new RegExp(
      `${this.escapeRegex(property)}:\\s*(.*)$`,
      "m",
    );
    const match = frontmatterContent.match(propertyRegex);
    return match ? match[1].trim() : null;
  }

  /**
   * Escape special regex characters in property names.
   *
   * Handles property names with special characters like dots, underscores, etc.
   *
   * @param str - String to escape
   * @returns Escaped string safe for use in RegExp
   * @private
   */
  /**
   * Serialize a property key-value pair to YAML string.
   * Arrays are serialized as multi-line YAML lists.
   */
  private serializeValue(property: string, value: unknown): string {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return `${property}:`;
      }
      const items = value.map((v) => `  - ${v}`).join("\n");
      return `${property}:\n${items}`;
    }
    return `${property}: ${String(value)}`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
