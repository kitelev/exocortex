import { loadDefaultSpec, orderProperties } from "../services/OrderSpecResolver";
import { canonicalYamlKey } from "../services/NoteToRDFConverter";
import {
  serializeYamlScalar,
  STRING_SCALAR_PROPERTIES,
} from "./yamlScalar";

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

  /**
   * Whether an asset is archived, reading the three carrier spellings in
   * priority order (req 960d7a3f, ticket da0f73a3):
   *
   *   1. `exo__Asset_archived` — the CANONICAL key (declared in the exoas-exo
   *      TBox, the only spelling writers emit since 2026-09-15);
   *   2. `exo__Asset_isArchived` — read-only compatibility alias (never
   *      written; 0 carriers measured across the three canonical vaults);
   *   3. `archived` — the legacy bare Obsidian-style key, still carried by
   *      not-yet-migrated assets.
   *
   * The FIRST spelling present decides (a `false` under a higher-priority key
   * is not overridden by a `true` under a lower one). Accepted truthy forms:
   * `true`, `1`, `"true"`, `"yes"`, `"1"` (case-insensitive, trimmed); a
   * SINGLE-element YAML list is unwrapped (`archived:\n  - true` — the shape
   * Obsidian's list-typed property editor produces; AreaHierarchyBuilder /
   * AreaSelectionModal precedent); any other shape (multi-element list,
   * object) is NOT archived.
   */
  static isAssetArchived(metadata: Record<string, unknown>): boolean {
    for (const key of MetadataHelpers.ARCHIVED_FLAG_KEYS) {
      const raw = metadata?.[key];
      if (raw === undefined || raw === null) continue;
      return MetadataHelpers.isTruthyFlag(raw);
    }
    return false;
  }

  /**
   * Archive-flag carrier keys in priority order — canonical, compatibility
   * alias, legacy bare. Exported so readers that key off the property NAME
   * (plugin layout-section dependencies, relation-column filters) list the
   * same spellings instead of re-deriving them.
   */
  static readonly ARCHIVED_FLAG_KEYS: readonly string[] = [
    "exo__Asset_archived",
    "exo__Asset_isArchived",
    "archived",
  ];

  private static isTruthyFlag(raw: unknown): boolean {
    const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();
      return normalized === "true" || normalized === "yes" || normalized === "1";
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

  /**
   * @param declaredRangeOf — the property's declared `exo__Property_range`
   *   values (ticket 2227d660), when the caller has a TBox to read them from
   *   (`cli create` → `PropertyNameValidator`). Each scalar is then typed by
   *   its range (`serializeYamlScalar`'s third argument); a key the lookup does
   *   not know — or no lookup at all — keeps the shape-based behaviour, so the
   *   plugin / apply callers are unaffected.
   *
   *   The lookup is called with the key AS THE CALLER SUPPLIED IT (before
   *   `canonicalYamlKey`), the same key `set-property` resolves its range by
   *   (ticket 8185c9dd, review #4282 LOW-1). `cli create` keys its map by
   *   the def's `prefix__Name` label, so `exo__Asset_pinned` resolves a
   *   declared range in BOTH writers even though it is EMITTED as the bare
   *   `pinned:` key (`UNPREFIXED_ASSET_FIELDS`); a caller passing the bare
   *   `aliases` resolves nothing in both (no def carries that label) — the
   *   two writers agree by construction. The `STRING_SCALAR_PROPERTIES` rule
   *   stays keyed by the emitted name, as before.
   */
  static buildFileContent(
    frontmatter: Record<string, unknown>,
    bodyContent?: string,
    declaredRangeOf?: (suppliedKey: string) => readonly string[] | undefined,
  ): string {
    // req 869561bf — the asset-creation twin of
    // `FrontmatterService.createFrontmatter`; canonicalise on the same terms so
    // a caller passing `exo__Asset_aliases` gets the live `aliases:` key AND the
    // `STRING_SCALAR_PROPERTIES` lookup below (which keys off the emitted name)
    // keeps a scalar-looking alias a string instead of letting YAML coerce it
    // to a Date — the #3750 MEDIUM-3 guarantee.
    const canonical: Record<string, unknown> = {};
    // The key each canonical key was SUPPLIED as — the range lookup below is
    // made with it (ticket 8185c9dd). When two supplied keys collapse onto one
    // canonical key (`aliases` + `exo__Asset_aliases`) the later entry wins the
    // value, so it also wins the lookup key.
    const suppliedKeyOf: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      const canonicalKey = canonicalYamlKey(key);
      canonical[canonicalKey] = value;
      suppliedKeyOf[canonicalKey] = key;
    }
    const ordered = orderProperties(canonical, loadDefaultSpec());
    const frontmatterLines = Object.entries(ordered)
      .map(([key, value]) => {
        // #3750 MEDIUM-1: route through serializeYamlScalar so scalars with
        // YAML-breaking chars (colon-space, leading indicators, control chars)
        // are quoted — mirrors the #3748 fix on the create_instance serializer
        // (FrontmatterService.serializeValue). Scalar-looking coercion (#3750
        // MEDIUM-3) is gated to string-semantic properties (label/aliases).
        const quoteAmbiguous = STRING_SCALAR_PROPERTIES.has(key);
        // Ticket 2227d660: the declared range (when the caller can read the
        // TBox) types a canonical scalar — `-1001234567890` under
        // `xsd:integer` stays bare, `42` under `xsd:string` is quoted. Looked
        // up by the SUPPLIED key (ticket 8185c9dd): the map is keyed by the
        // def's `prefix__Name` label, and a whitelisted bare key (`pinned`) is
        // emitted unprefixed.
        const declaredRange = declaredRangeOf?.(suppliedKeyOf[key] ?? key);
        if (Array.isArray(value)) {
          const arrayItems = value
            .map(
              (item) =>
                `  - ${serializeYamlScalar(item, quoteAmbiguous, declaredRange)}`,
            )
            .join("\n");
          return `${key}:\n${arrayItems}`;
        }
        return `${key}: ${serializeYamlScalar(value, quoteAmbiguous, declaredRange)}`;
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
