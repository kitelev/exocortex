import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { PropertyFieldType } from "../domain/types/PropertyFieldType";

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
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

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
    const uid = uuidv4();
    const fileName = `${uid}.md`;

    const frontmatter = this.generateFrontmatter(
      config,
      propertyDefinitions || [],
      uid,
    );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    // Determine folder path
    const folderPath = config.folderPath || this.getDefaultFolderPath(config);

    // Ensure folder exists
    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.vault.createFolder(folderPath);
    }

    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  /**
   * Generate frontmatter for the asset.
   */
  private generateFrontmatter(
    config: GenericAssetCreationConfig,
    propertyDefinitions: AssetPropertyDefinition[],
    uid: string,
  ): Record<string, unknown> {
    const now = new Date();
    const frontmatter: Record<string, unknown> = {};

    // Build property type map for quick lookup
    const propertyTypeMap = new Map<string, PropertyFieldType>();
    for (const prop of propertyDefinitions) {
      propertyTypeMap.set(prop.name, prop.fieldType);
    }

    // Set required system properties
    frontmatter["exo__Asset_uid"] = uid;
    frontmatter["exo__Asset_createdAt"] = DateFormatter.toLocalTimestamp(now);
    frontmatter["exo__Instance_class"] = [this.formatWikilink(config.className)];

    // Set label if provided
    if (config.label && config.label.trim() !== "") {
      const trimmedLabel = config.label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
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

        const fieldType = propertyTypeMap.get(propertyName);
        frontmatter[propertyName] = this.formatValue(value, fieldType);
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

    // For tasks created from projects/areas, inherit the parent reference
    if (config.className === "ems__Task" || config.className.startsWith("ems__Task")) {
      frontmatter["ems__Effort_parent"] = parentName
        ? this.formatWikilink(parentName)
        : null;
    }

    // For projects created from areas, inherit the area
    if (config.className === "ems__Project" || config.className.startsWith("ems__Project")) {
      // If parent is an area, set it as area reference
      const parentClass = parentMetadata.exo__Instance_class;
      if (this.isAreaClass(parentClass)) {
        frontmatter["ems__Project_area"] = parentName
          ? this.formatWikilink(parentName)
          : null;
      }
    }

    // Inherit isDefinedBy if available
    if (parentMetadata.exo__Asset_isDefinedBy) {
      frontmatter["exo__Asset_isDefinedBy"] = parentMetadata.exo__Asset_isDefinedBy;
    }
  }

  /**
   * Check if a class is an Area class.
   */
  private isAreaClass(instanceClass: unknown): boolean {
    if (!instanceClass) return false;

    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    return classes.some(
      (cls) => String(cls).includes("Area") || String(cls).includes("ems__Area"),
    );
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
}
