import { injectable, inject } from "tsyringe";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import { WikiLinkHelpers } from "../utilities/WikiLinkHelpers";
import { Namespace } from "../domain/models/rdf/Namespace";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { PropertyFieldType } from "../domain/types/PropertyFieldType";
import type { ShapeRegistry } from "./ShapeRegistry";
import type { IClock } from "./IClock";
import { liveClock } from "./IClock";
import type { IUidGenerator } from "./IUidGenerator";
import { liveUidGenerator } from "./IUidGenerator";

/**
 * UUID → symbolic class name resolver. After RFC-004 UID-canon
 * (commit `ca2d916`, 2026-05-16) `exo__Instance_class` values are stored
 * as bare `[[<uuid>]]`; symbolic comparisons require resolution via the
 * caller's environment (Obsidian `metadataCache` in the plugin, prebuilt
 * UUID→label map in CLI/tests).
 */
export type ClassRefResolver = (uuid: string) => string | null | undefined;

/**
 * Configuration for creating a generic asset.
 */
export interface GenericAssetCreationConfig {
  /** The class name of the asset (e.g., "ems__Task", "exo__Area") */
  className: string;
  /** Human-readable label for the asset */
  label?: string;
  /** Target folder path where the asset should be created */
  folderPath?: string;
  /** Property values to include in frontmatter */
  propertyValues?: Record<string, unknown>;
  /** Parent file (for context inheritance) */
  parentFile?: IFile;
  /** Parent file metadata (for context inheritance) */
  parentMetadata?: Record<string, unknown>;
  /**
   * Optional UUID → symbolic-class-name resolver for the parent's
   * `exo__Instance_class`. Required when the vault stores class refs
   * in UID-canon form (`[[<uuid>]]`) and parent-class inheritance must
   * branch on `ems__Area` vs other classes. When omitted, parent-class
   * detection still works for symbolic and alias-wikilink forms.
   */
  classResolver?: ClassRefResolver;

  // --- Optional domain fields (H3 PR1 consolidation, #3384). ---
  // Every field below is opt-in: existing callers (plugin
  // ServiceRegistryPopulator, cli apply, grounding factories) omit them and
  // therefore observe byte-identical behaviour. Only `cli create` opts in.

  /**
   * Emission form for `exo__Instance_class`:
   *  - `'label'` (default): `[[<className>]]` — the historical plugin/apply
   *    behaviour. Display label resolves at render time.
   *  - `'uuid'`: `[[<classUid>]]` strip-canon (no alias). Requires
   *    {@link classUid}; falls back to the label form when `classUid` is
   *    absent.
   *
   * `cli create` passes `'uuid'` (UID-canon convention). The plugin flip to
   * `'uuid'` is deferred to PR2 (real-vault UI smoke).
   */
  classRefForm?: "label" | "uuid";

  /**
   * Resolved class UUID, used when {@link classRefForm} is `'uuid'`. The
   * caller (`cli create`) resolves the class short name → UUID before
   * invoking the service.
   */
  classUid?: string;

  /**
   * Creator UUID. When provided (and non-blank) the service emits
   * `exo__Asset_createdBy: "[[<createdBy>]]"`. There is NO default — when
   * omitted the property is not emitted (an empty creator means "the user").
   */
  createdBy?: string;

  /**
   * Extra aliases appended (deduplicated) after the `[label]` entry. Plugin
   * and apply omit this → aliases stay `[label]`.
   */
  aliases?: string[];

  /**
   * IANA timezone for the `exo__Asset_createdAt` timestamp. When provided the
   * timestamp is rendered for that timezone; when omitted the live clock's
   * local timestamp is used (unchanged plugin/apply behaviour).
   */
  timezone?: string;

  /**
   * Markdown body content. When omitted, {@link MetadataHelpers.buildFileContent}
   * applies its default (`# <label>` heading, or empty) — the unchanged
   * plugin/apply behaviour.
   */
  body?: string;

  /**
   * SHACL-lite shape registry. When present, wikilink property values are
   * serialized with cardinality awareness (Issue #3179): scalar by default,
   * YAML array only for properties whose shape declares `Multiple`. When
   * absent, property values use the {@link PropertyFieldType}-driven
   * formatter (unchanged plugin/apply behaviour).
   */
  shapeRegistry?: ShapeRegistry;
}

/**
 * Property definition for frontmatter formatting.
 */
export interface AssetPropertyDefinition {
  /** Property name (e.g., "exo__Asset_label") */
  name: string;
  /** Field type for formatting */
  fieldType: PropertyFieldType;
}

/**
 * Pure (no-write) result of assembling an asset. Returned by
 * {@link GenericAssetCreationService.buildAsset}; used by `cli create`
 * `--dry-run` so the preview matches the exact bytes the real write would
 * produce (canonical property ordering via {@link MetadataHelpers.buildFileContent}).
 */
export interface AssetBuildResult {
  /** Generated asset UUID (filename stem). */
  uid: string;
  /** Resolved target folder (config.folderPath or class-based default). */
  folderPath: string;
  /** Full vault-relative path (`<folderPath>/<uid>.md`). */
  path: string;
  /** Assembled frontmatter (pre-ordering). */
  frontmatter: Record<string, unknown>;
  /** Full file content (ordered frontmatter + body) — identical to the write. */
  content: string;
}

/**
 * Service for creating assets of any class dynamically.
 *
 * Unlike specialized services (TaskCreationService, ProjectCreationService),
 * this service can create assets of any class type based on dynamic
 * property definitions from the ontology.
 *
 * @example
 * ```typescript
 * const service = container.resolve(GenericAssetCreationService);
 *
 * const file = await service.createAsset({
 *   className: "ems__Task",
 *   label: "My Task",
 *   propertyValues: {
 *     ems__Effort_taskSize: '"[[ems__TaskSize_S]]"'
 *   }
 * });
 * ```
 */
@injectable()
export class GenericAssetCreationService {
  // Mutable to support fluent withDeterminism() override after construction.
  // tsyringe container.resolve() (used by CommandManager line 57) cannot
  // resolve a structural `options?: {...}` constructor parameter — TypeInfo
  // unknown for `Object`. Setter pattern preserves DI auto-resolution and
  // keeps test ergonomics: new XYZ(deps).withDeterminism({ clock, uidGen }).
  private clock: IClock = liveClock();
  private uidGen: IUidGenerator = liveUidGenerator();

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  /**
   * Override clock and/or uid generator for deterministic testing.
   * Returns `this` to enable fluent chaining.
   */
  withDeterminism(options: {
    clock?: IClock;
    uidGenerator?: IUidGenerator;
  }): this {
    if (options.clock) this.clock = options.clock;
    if (options.uidGenerator) this.uidGen = options.uidGenerator;
    return this;
  }

  /**
   * Create an asset of any class type.
   *
   * @param config - Configuration for the asset to create
   * @param propertyDefinitions - Optional property type definitions for formatting
   * @returns The created file
   */
  async createAsset(
    config: GenericAssetCreationConfig,
    propertyDefinitions?: AssetPropertyDefinition[],
  ): Promise<IFile> {
    const { folderPath, path, content } = this.buildAsset(
      config,
      propertyDefinitions,
    );

    // Ensure folder exists
    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.vault.createFolder(folderPath);
    }

    const createdFile = await this.vault.create(path, content);

    return createdFile;
  }

  /**
   * Assemble an asset's frontmatter, folder, path and full file content
   * WITHOUT writing anything to the vault.
   *
   * This is the pure core of {@link createAsset}; `cli create --dry-run`
   * calls it so its preview is byte-for-byte what the real write would emit
   * (frontmatter canonicalized via {@link MetadataHelpers.buildFileContent}).
   *
   * @param config - Configuration for the asset to build
   * @param propertyDefinitions - Optional property type definitions
   * @returns The assembled {@link AssetBuildResult} (uid, folderPath, path,
   *          frontmatter, content)
   */
  buildAsset(
    config: GenericAssetCreationConfig,
    propertyDefinitions?: AssetPropertyDefinition[],
  ): AssetBuildResult {
    const uid = this.uidGen.next();
    const frontmatter = this.generateFrontmatter(
      config,
      propertyDefinitions || [],
      uid,
    );
    const content = MetadataHelpers.buildFileContent(frontmatter, config.body);

    const folderPath = config.folderPath || this.getDefaultFolderPath(config);
    const fileName = `${uid}.md`;
    const path = folderPath ? `${folderPath}/${fileName}` : fileName;

    return { uid, folderPath, path, frontmatter, content };
  }

  /**
   * Generate frontmatter for the asset.
   *
   * Public so `cli create` can obtain frontmatter without a write. When
   * `uid` is omitted a fresh one is generated.
   */
  generateFrontmatter(
    config: GenericAssetCreationConfig,
    propertyDefinitions: AssetPropertyDefinition[] = [],
    uid: string = this.uidGen.next(),
  ): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};

    // Build property type map for quick lookup
    const propertyTypeMap = new Map<string, PropertyFieldType>();
    for (const prop of propertyDefinitions) {
      propertyTypeMap.set(prop.name, prop.fieldType);
    }

    // Set required system properties
    frontmatter["exo__Asset_uid"] = uid;

    const createdAt = config.timezone
      ? this.generateTimestampInTimezone(config.timezone)
      : DateFormatter.toLocalTimestamp(this.clock.now());
    frontmatter["exo__Asset_createdAt"] = createdAt;
    // exo__Asset_updatedAt: every created asset satisfies the "updatedAt is an
    // enforced last-modified invariant" from birth (task 1af85afd) — set equal
    // to createdAt at creation. Subsequent mutations bump it separately (via
    // explicit grounding steps / the plugin modify-listener).
    frontmatter["exo__Asset_updatedAt"] = createdAt;

    // exo__Instance_class: opt-in UID-canon strip form (`[[<uuid>]]`) when the
    // caller resolves a class UUID and requests it; otherwise the historical
    // label form (`[[<className>]]`). Default preserves plugin/apply output.
    const classRef =
      config.classRefForm === "uuid" && config.classUid
        ? config.classUid
        : config.className;
    frontmatter["exo__Instance_class"] = [this.formatWikilink(classRef)];

    // Merge any additional `exo__Instance_class` values supplied via
    // propertyValues (e.g. `cli create --class A --property
    // "exo__Instance_class=[[B]]"`, or a repeated `--property` flag) into the
    // array, so a multi-class asset can be created in one command (issue
    // #3852). `--class` sets the primary class; extras accumulate in order,
    // de-duplicated. Formatting goes through `formatWikilink` so bare-UUID,
    // `[[..]]` and `"[[..]]"` inputs all normalise to the same quoted form as
    // the primary. The propertyValues loop below still skips
    // `exo__Instance_class`, so these are not re-emitted there.
    const extraInstanceClasses = config.propertyValues?.["exo__Instance_class"];
    if (extraInstanceClasses !== undefined && extraInstanceClasses !== null) {
      const instanceClasses = frontmatter["exo__Instance_class"] as string[];
      const extras = Array.isArray(extraInstanceClasses)
        ? extraInstanceClasses
        : [extraInstanceClasses];
      for (const extra of extras) {
        // Skip null/undefined and empty/whitespace-only values — the latter
        // would otherwise emit a malformed `"[[]]"` class entry (mirrors the
        // `createdBy` trim guard above).
        if (
          extra === null ||
          extra === undefined ||
          String(extra).trim() === ""
        ) {
          continue;
        }
        const formatted = this.formatWikilink(String(extra));
        if (!instanceClasses.includes(formatted)) {
          instanceClasses.push(formatted);
        }
      }
    }

    // Creator — emitted only when explicitly supplied (no implicit default).
    if (config.createdBy && config.createdBy.trim() !== "") {
      frontmatter["exo__Asset_createdBy"] = this.formatWikilink(
        config.createdBy.trim(),
      );
    }

    // Set label if provided (+ optional extra aliases appended after [label]).
    if (config.label && config.label.trim() !== "") {
      const trimmedLabel = config.label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      const aliases = [trimmedLabel];
      if (config.aliases) {
        for (const alias of config.aliases) {
          if (!aliases.includes(alias)) {
            aliases.push(alias);
          }
        }
      }
      frontmatter["aliases"] = aliases;
    }

    // Inherit parent context if provided
    if (config.parentFile && config.parentMetadata) {
      this.inheritParentContext(frontmatter, config);
    }

    // Process additional property values
    if (config.propertyValues) {
      for (const [propertyName, value] of Object.entries(config.propertyValues)) {
        // Skip system properties already set
        if (
          propertyName === "exo__Asset_uid" ||
          propertyName === "exo__Asset_createdAt" ||
          propertyName === "exo__Asset_updatedAt" ||
          propertyName === "exo__Asset_createdBy" ||
          propertyName === "exo__Instance_class" ||
          propertyName === "exo__Asset_label" ||
          propertyName === "aliases"
        ) {
          continue;
        }

        // Skip null/undefined values
        if (value === null || value === undefined) {
          continue;
        }

        // When a shape registry is supplied (cli create path), wikilink
        // values are serialized with cardinality awareness (Issue #3179):
        // scalar by default, array only for Multiple-cardinality properties.
        // Otherwise the PropertyFieldType formatter applies (plugin/apply).
        if (config.shapeRegistry !== undefined) {
          if (Array.isArray(value)) {
            // Explicit multi-value (e.g. a repeated `cli create --property
            // key=...` flag, issue #3759): emit a flat YAML array, quoting each
            // wikilink element exactly as a scalar would be. The repeated flag
            // is the explicit array signal — independent of the property's
            // declared cardinality. (Scoped to the shape-registry path — the CLI
            // create path — so the no-registry plugin/apply path keeps its
            // existing array-as-inferred-value behavior, covered by tests.)
            frontmatter[propertyName] = value.map((element) =>
              this.quoteWikilinkValue(String(element)),
            );
          } else {
            frontmatter[propertyName] = this.formatPropertyValueWithCardinality(
              propertyName,
              String(value),
              config.shapeRegistry,
            );
          }
        } else {
          const fieldType = propertyTypeMap.get(propertyName);
          frontmatter[propertyName] = this.formatValue(value, fieldType);
        }
      }
    }

    return frontmatter;
  }

  /**
   * Inherit context from parent file (area, project, etc.).
   */
  private inheritParentContext(
    frontmatter: Record<string, unknown>,
    config: GenericAssetCreationConfig,
  ): void {
    const parentMetadata = config.parentMetadata || {};
    const parentName = config.parentFile?.basename;

    // For tasks created from projects/areas, inherit the parent reference.
    // When the parent asset is an ems__Area, the task should link via
    // ems__Effort_area instead of ems__Effort_parent (parent-property semantics).
    if (config.className === "ems__Task" || config.className.startsWith("ems__Task")) {
      const parentClass = parentMetadata.exo__Instance_class;
      const isAreaParent = this.isAreaClass(parentClass, config.classResolver);
      const parentPropertyName = isAreaParent ? "ems__Effort_area" : "ems__Effort_parent";
      frontmatter[parentPropertyName] = parentName
        ? this.formatWikilink(parentName)
        : null;
    }

    // For projects created from areas/projects/tasks, inherit the parent via
    // the unified ems__Effort_* convention (same as Task). When the parent is
    // an Area, write ems__Effort_area; otherwise ems__Effort_parent. This
    // replaces the legacy ems__Project_area emission (issue #2850) — downstream
    // code only consumes the ems__Effort_* properties.
    if (config.className === "ems__Project" || config.className.startsWith("ems__Project")) {
      const parentClass = parentMetadata.exo__Instance_class;
      const isAreaParent = this.isAreaClass(parentClass, config.classResolver);
      const parentPropertyName = isAreaParent ? "ems__Effort_area" : "ems__Effort_parent";
      frontmatter[parentPropertyName] = parentName
        ? this.formatWikilink(parentName)
        : null;
    }

    // Inherit isDefinedBy if available. Re-quote via formatWikilink so that
    // namespace-prefixed wikilinks like `[[!foo]]` — which lose their outer
    // YAML quotes when Obsidian metadataCache parses the parent — are not
    // re-emitted as unquoted YAML tag directives (issue #2850).
    if (parentMetadata.exo__Asset_isDefinedBy) {
      const inherited = parentMetadata.exo__Asset_isDefinedBy;
      frontmatter["exo__Asset_isDefinedBy"] =
        typeof inherited === "string" ? this.formatWikilink(inherited) : inherited;
    }
  }

  /**
   * Check if a class is an Area class.
   *
   * Handles three storage forms for `exo__Instance_class`:
   *  - symbolic literal `"ems__Area"`
   *  - alias wikilink `"[[<uuid>|ems__Area]]"` (pre-UID-canon)
   *  - bare-UUID wikilink `"[[<uuid>]]"` (post-UID-canon, RFC-004)
   *
   * The first two cases work without a resolver. The third requires the
   * caller to supply a `ClassRefResolver` that maps the UUID to the
   * target file's `exo__Asset_label`; otherwise the bare-UUID form
   * remains unresolved and the check returns `false` for it.
   */
  private isAreaClass(
    instanceClass: unknown,
    resolver?: ClassRefResolver,
  ): boolean {
    if (!instanceClass) return false;

    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    const noopResolver: ClassRefResolver = () => null;
    return classes.some((cls) => {
      const symbolic = WikiLinkHelpers.resolveSymbolic(
        String(cls),
        resolver ?? noopResolver,
      );
      return symbolic.includes("Area") || symbolic.includes("ems__Area");
    });
  }

  /**
   * Get default folder path based on class type.
   */
  private getDefaultFolderPath(config: GenericAssetCreationConfig): string {
    // If parent file provided, use its folder
    if (config.parentFile?.parent?.path) {
      return config.parentFile.parent.path;
    }

    // Map class names to default folders
    const classFolderMap: Record<string, string> = {
      ems__Task: "tasks",
      ems__Project: "projects",
      ems__Area: "areas",
      ems__Meeting: "meetings",
      exo__Event: "events",
      ims__Concept: "concepts",
    };

    // Check for exact match
    if (classFolderMap[config.className]) {
      return classFolderMap[config.className];
    }

    // Check for prefix match (e.g., ems__Task_* -> tasks)
    for (const [classPrefix, folder] of Object.entries(classFolderMap)) {
      if (config.className.startsWith(classPrefix)) {
        return folder;
      }
    }

    // Default folder for unrecognized classes
    return "assets";
  }

  /**
   * Format a value based on its field type.
   */
  private formatValue(value: unknown, fieldType?: PropertyFieldType): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    // If no type specified, infer from value
    if (!fieldType) {
      return this.formatInferredValue(value);
    }

    switch (fieldType) {
      case PropertyFieldType.Text:
        return String(value);

      case PropertyFieldType.Wikilink:
      case PropertyFieldType.Reference:
      case PropertyFieldType.StatusSelect:
      case PropertyFieldType.SizeSelect:
        return this.formatWikilink(String(value));

      case PropertyFieldType.Number:
        return typeof value === "number" ? value : Number(value) || 0;

      case PropertyFieldType.Boolean:
        return this.formatBoolean(value);

      case PropertyFieldType.Date:
      case PropertyFieldType.DateTime:
      case PropertyFieldType.Timestamp:
        return this.formatTimestamp(value);

      default:
        return String(value);
    }
  }

  /**
   * Format a value with inferred type.
   */
  private formatInferredValue(value: unknown): unknown {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value;
    }
    if (value instanceof Date) {
       
      return DateFormatter.toLocalTimestamp(value);
    }
    if (typeof value === "string") {
      // Check if it looks like a wikilink
      if (value.startsWith("[[") || value.startsWith('"[[')) {
        return this.formatWikilink(value);
      }
      return value;
    }
    return String(value);
  }

  /**
   * Format a value as a wikilink.
   */
  private formatWikilink(value: string): string {
    // Already in quoted wikilink format
    if (value.startsWith('"[[') && value.endsWith(']]"')) {
      return value;
    }

    // Already in wikilink format, just quote it
    if (value.startsWith("[[") && value.endsWith("]]")) {
      return `"${value}"`;
    }

    // Raw value, wrap in wikilink and quote
    return `"[[${value}]]"`;
  }

  /**
   * Format a value as boolean.
   */
  private formatBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();
      return normalized === "true" || normalized === "yes" || normalized === "1";
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    return Boolean(value);
  }

  /**
   * Format a value as timestamp.
   */
  private formatTimestamp(value: unknown): string {
    if (value instanceof Date) {
       
      return DateFormatter.toLocalTimestamp(value);
    }

    if (typeof value === "string") {
      // If already in local timestamp format, return as-is
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
        return value;
      }
      // If in ISO UTC format, convert to local format
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
        return value.replace("Z", "");
      }
      // Try to parse as date
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
         
        return DateFormatter.toLocalTimestamp(date);
      }
      return value;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {

        return DateFormatter.toLocalTimestamp(date);
      }
    }

    return String(value);
  }

  /**
   * Format a property value with SHACL-lite cardinality awareness (Issue
   * #3179). Plain (non-wikilink) values pass through as scalars. Wikilink
   * values are quoted and emitted as a scalar by default; only properties
   * whose shape declares cardinality `Multiple` are wrapped in a YAML array.
   *
   * Ported from the former CLI `AssetCreationService` so `cli create` keeps
   * its vault-convention emission while the logic lives in core.
   */
  private formatPropertyValueWithCardinality(
    key: string,
    value: string,
    shapeRegistry?: ShapeRegistry,
  ): string | string[] {
    const formatted = this.quoteWikilinkValue(value);

    // A wikilink whose property has Multiple cardinality emits an array-of-1
    // (issue #3179). Non-wikilink values are returned unchanged.
    if (formatted.includes("[[") && this.shouldEmitAsArray(key, shapeRegistry)) {
      return [formatted];
    }

    return formatted;
  }

  /**
   * Quote a wikilink value (`[[...]]`) for YAML emission, leaving non-wikilink
   * values and already-quoted values untouched. Shared by the scalar
   * cardinality formatter and the explicit multi-value array path (#3759).
   */
  private quoteWikilinkValue(value: string): string {
    if (!value.includes("[[")) {
      return value;
    }
    return value.startsWith('"') && value.endsWith('"') ? value : `"${value}"`;
  }

  /**
   * Decide whether a property should be wrapped in a YAML array. Returns
   * `true` only when a shape registry is supplied, the property has a declared
   * shape, and its cardinality is explicitly `Multiple` (Issue #3179).
   */
  private shouldEmitAsArray(
    key: string,
    shapeRegistry?: ShapeRegistry,
  ): boolean {
    if (!shapeRegistry) return false;
    const parsed = Namespace.fromPropertyKey(key);
    if (!parsed) return false;
    const propertyIRI = parsed.namespace.term(parsed.localName).value;
    const shape = shapeRegistry.get(propertyIRI);
    return shape?.cardinality === "Multiple";
  }

  /**
   * Render the live clock's instant as a `YYYY-MM-DDTHH:MM:SS` timestamp for
   * the given IANA timezone. Mirrors the former CLI `AssetCreationService`
   * timestamp generation so `cli create --timezone` output is unchanged.
   */
  private generateTimestampInTimezone(timezone: string): string {
    const now = this.clock.now();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
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
