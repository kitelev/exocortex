import { v4 as uuidv4 } from "uuid";
import { DateFormatter, MetadataHelpers } from "exocortex";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "./ClassResolverService.js";
import { WikilinkValidator } from "./WikilinkValidator.js";

/** Default ExoAssistant UUID */
const EXO_ASSISTANT_UUID = "de20a3f1-7483-4714-ab28-b45f5cf02c76";

/** Default timezone */
const DEFAULT_TIMEZONE = "Asia/Almaty";

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
    fm["exo__Instance_class"] = [`"[[${params.classShortName}]]"`];

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
        fm[key] = value;
      }
    }

    return fm;
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
