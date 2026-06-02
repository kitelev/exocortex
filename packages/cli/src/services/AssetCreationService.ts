import { v4 as uuidv4 } from "uuid";
import { DateFormatter, MetadataHelpers, Namespace } from "exocortex";
import type { ShapeRegistry } from "exocortex";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "./ClassResolverService.js";
import { WikilinkValidator } from "./WikilinkValidator.js";

/** Default ExoAssistant UUID */
const EXO_ASSISTANT_UUID = "de20a3f1-7483-4714-ab28-b45f5cf02c76";

/** Default timezone */
const DEFAULT_TIMEZONE = "Asia/Almaty";

/**
 * Build a class wikilink for `exo__Instance_class` frontmatter.
 *
 * Per UID-canon rule (CLAUDE.md 2026-05-17): wikilinks where alias equals
 * the target are degenerate — alias provides no display value. When a user
 * passes `--class <UUID>` directly, `classShortName === classUuid` and the
 * naive `[[uid|uid]]` form duplicates the UID as both target and alias.
 * Emit bare `[[uid]]` form instead (Issue #3180).
 */
function buildClassWikilink(
  classUuid: string,
  classShortName: string,
): string {
  if (!classShortName || classShortName === classUuid) {
    return `"[[${classUuid}]]"`;
  }
  return `"[[${classUuid}|${classShortName}]]"`;
}

/**
 * Options for creating a new asset.
 */
export interface CreateAssetOptions {
  /** Class short name (e.g. "ztlk__PermanentNote") */
  classShortName: string;
  /** Human-readable label for the asset */
  label: string;
  /** Optional aliases (in addition to label) */
  aliases?: string[];
  /** Optional property key-value pairs */
  properties?: Record<string, string>;
  /** Markdown body content */
  body?: string;
  /** Vault root path */
  vault: string;
  /** If true, do not write file */
  dryRun?: boolean;
  /** UUID of the creator (defaults to ExoAssistant) */
  createdBy?: string;
  /** Timezone for timestamps (defaults to Asia/Almaty) */
  timezone?: string;
  /** Skip wikilink validation */
  skipWikilinkValidation?: boolean;
}

/**
 * Result of a successful asset creation.
 */
export interface CreateAssetResult {
  /** Generated UUID for the asset */
  uuid: string;
  /** Path where the file was created (relative to vault) */
  path: string;
  /** Label of the asset */
  label: string;
  /** The assembled frontmatter */
  frontmatter: Record<string, unknown>;
}

/**
 * Orchestrates the creation of vault assets:
 * - Resolves class short name to UUID
 * - Generates UUID v4 for the asset
 * - Generates timestamp in the correct timezone
 * - Validates wikilinks in properties
 * - Assembles frontmatter and writes file
 *
 * @example
 * ```typescript
 * const service = new AssetCreationService(fsAdapter, classResolver, wikilinkValidator);
 * const result = await service.create({
 *   classShortName: "ztlk__PermanentNote",
 *   label: "My Note",
 *   vault: "/path/to/vault",
 * });
 * console.log(result.uuid, result.path);
 * ```
 */
export class AssetCreationService {
  constructor(
    private readonly fsAdapter: NodeFsAdapter,
    private readonly classResolver: ClassResolverService,
    private readonly wikilinkValidator: WikilinkValidator,
    /**
     * Optional SHACL-lite shape registry loaded from vault property assets.
     * When provided, properties declared with
     * `exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"`
     * are serialized as scalar YAML values instead of single-entry arrays.
     * When omitted, all wikilink values are wrapped in arrays (legacy default).
     */
    private readonly shapeRegistry?: ShapeRegistry,
  ) {}

  /**
   * Create a new asset in the vault.
   *
   * @param opts - Creation options
   * @returns Result with uuid, path, label, and frontmatter
   * @throws ClassNotFoundError if class short name cannot be resolved
   * @throws WikilinkNotFoundError if property wikilinks reference non-existent files
   */
  async create(opts: CreateAssetOptions): Promise<CreateAssetResult> {
    // 1. Validate label
    if (!opts.label || opts.label.trim().length === 0) {
      throw new Error("Label cannot be empty");
    }

    const trimmedLabel = opts.label.trim();

    // 2. Resolve class UUID
    const classUuid = await this.classResolver.resolve(
      opts.vault,
      opts.classShortName,
    );

    // 3. Validate wikilinks in properties (unless skipped)
    if (opts.properties && !opts.skipWikilinkValidation) {
      await this.wikilinkValidator.validatePropertyValues(opts.properties);
    }

    // 4. Generate UUID for the new asset
    const assetUuid = uuidv4();

    // 5. Generate timestamp
    const timestamp = this.generateTimestamp(opts.timezone);

    // 6. Build frontmatter
    const frontmatter = this.buildFrontmatter({
      assetUuid,
      classShortName: opts.classShortName,
      classUuid,
      label: trimmedLabel,
      aliases: opts.aliases,
      properties: opts.properties,
      createdBy: opts.createdBy || EXO_ASSISTANT_UUID,
      timestamp,
    });

    // 7. Build file content
    const content = MetadataHelpers.buildFileContent(frontmatter, opts.body);

    // 8. Determine file path
    const relativePath = `01 Inbox/${assetUuid}.md`;

    // 9. Write file (unless dry-run)
    if (!opts.dryRun) {
      await this.fsAdapter.createFile(relativePath, content);
    }

    return {
      uuid: assetUuid,
      path: relativePath,
      label: trimmedLabel,
      frontmatter,
    };
  }

  /**
   * Build frontmatter for the new asset.
   */
  private buildFrontmatter(params: {
    assetUuid: string;
    classShortName: string;
    classUuid: string;
    label: string;
    aliases?: string[];
    properties?: Record<string, string>;
    createdBy: string;
    timestamp: string;
  }): Record<string, unknown> {
    const fm: Record<string, unknown> = {};

    // System properties
    fm["exo__Asset_uid"] = params.assetUuid;
    fm["exo__Asset_label"] = params.label;
    fm["exo__Asset_createdAt"] = params.timestamp;
    fm["exo__Asset_createdBy"] = `"[[${params.createdBy}]]"`;
    fm["exo__Instance_class"] = [buildClassWikilink(params.classUuid, params.classShortName)];

    // Aliases
    const allAliases = [params.label];
    if (params.aliases && params.aliases.length > 0) {
      for (const alias of params.aliases) {
        if (!allAliases.includes(alias)) {
          allAliases.push(alias);
        }
      }
    }
    fm["aliases"] = allAliases;

    // Additional properties
    if (params.properties) {
      for (const [key, value] of Object.entries(params.properties)) {
        // Skip system properties that are already set
        if (
          key === "exo__Asset_uid" ||
          key === "exo__Asset_label" ||
          key === "exo__Asset_createdAt" ||
          key === "exo__Asset_createdBy" ||
          key === "exo__Instance_class" ||
          key === "aliases"
        ) {
          continue;
        }
        fm[key] = this.formatPropertyValue(key, value);
      }
    }

    return fm;
  }

  /**
   * Format a property value for frontmatter.
   *
   * Wikilink values (containing `[[`) are quoted. By default they are wrapped
   * in a single-entry YAML array so Obsidian can parse them as a list. If the
   * shape registry declares the property's cardinality as `"Single"`, the
   * quoted value is emitted as a scalar instead (issue #3099).
   *
   * Plain (non-wikilink) values are always left as scalars.
   *
   * @param key - The property key (e.g. `ems__Effort_status`)
   * @param value - The raw property value string
   * @returns Formatted value: `string` for plain or single-cardinality wikilinks, `string[]` for arrays
   */
  private formatPropertyValue(key: string, value: string): string | string[] {
    if (!value.includes("[[")) {
      return value;
    }

    // Quote the wikilink if not already quoted
    const quoted =
      value.startsWith('"') && value.endsWith('"') ? value : `"${value}"`;

    if (this.isSingleValued(key)) {
      return quoted;
    }

    // Default: wrap in array for YAML list format
    return [quoted];
  }

  /**
   * Check whether a property is declared single-valued in the shape registry.
   *
   * Safe default: `false` (treat as multi-valued / wrap in array) when no
   * registry is provided, when the property has no shape, or when its
   * cardinality is not explicitly `"Single"`.
   */
  private isSingleValued(key: string): boolean {
    if (!this.shapeRegistry) return false;
    const parsed = Namespace.fromPropertyKey(key);
    if (!parsed) return false;
    const propertyIRI = parsed.namespace.term(parsed.localName).value;
    const shape = this.shapeRegistry.get(propertyIRI);
    return shape?.cardinality === "Single";
  }

  /**
   * Generate a timestamp string.
   *
   * Uses DateFormatter.toLocalTimestamp for consistency with the rest of the codebase.
   * The timezone parameter controls which timezone is used for display.
   */
  private generateTimestamp(timezone?: string): string {
    const tz = timezone || DEFAULT_TIMEZONE;

    // Use Intl.DateTimeFormat to get the time in the specified timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value || "00";

    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  }
}
