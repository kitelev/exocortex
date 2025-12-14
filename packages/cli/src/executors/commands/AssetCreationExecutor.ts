import { v4 as uuidv4 } from "uuid";
import { BaseCommandExecutor, CommandContext } from "./BaseCommandExecutor.js";
import { ErrorHandler } from "../../utils/ErrorHandler.js";
import { ExitCodes } from "../../utils/ExitCodes.js";
import { DateFormatter, MetadataHelpers, FileAlreadyExistsError } from "exocortex";

/**
 * Executes asset creation commands (create-task, create-project, etc.)
 */
export class AssetCreationExecutor extends BaseCommandExecutor {
  constructor(context: CommandContext) {
    super(context);
  }

  /**
   * Creates new task file with complete frontmatter initialization.
   */
  async executeCreateTask(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.createAsset(filepath, label, "ems__Task", options);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Creates new meeting file with complete frontmatter initialization.
   */
  async executeCreateMeeting(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.createAsset(filepath, label, "ems__Meeting", options);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Creates new project file with complete frontmatter initialization.
   */
  async executeCreateProject(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.createAsset(filepath, label, "ems__Project", options);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Creates new area file with complete frontmatter initialization.
   */
  async executeCreateArea(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.createAsset(filepath, label, "ems__Area", options);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Helper method to create asset with frontmatter
   */
  private async createAsset(
    filepath: string,
    label: string,
    assetClass: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    if (!label || label.trim().length === 0) {
      throw new Error("Label cannot be empty");
    }

    const trimmedLabel = label.trim();
    const { relativePath } = this.resolveAndValidate(filepath);

    const exists = await this.fsAdapter.fileExists(relativePath);
    if (exists) {
      throw new FileAlreadyExistsError(filepath);
    }

    const uid = uuidv4();
    const frontmatter = this.buildAssetFrontmatter(assetClass, uid, trimmedLabel, options);
    const content = MetadataHelpers.buildFileContent(frontmatter);

    await this.fsAdapter.createFile(relativePath, content);

    console.log(`✅ Created ${this.getAssetTypeName(assetClass)}: ${filepath}`);
    console.log(`   UID: ${uid}`);
    console.log(`   Label: ${trimmedLabel}`);
    console.log(`   Class: ${assetClass}`);
  }

  /**
   * Build frontmatter for asset creation
   */
  private buildAssetFrontmatter(
    assetClass: string,
    uid: string,
    label: string,
    options: Record<string, any> = {},
  ): Record<string, any> {
    const timestamp = DateFormatter.toLocalTimestamp(new Date());

    const frontmatter: Record<string, any> = {
      exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      exo__Asset_uid: uid,
      exo__Asset_label: label,
      exo__Asset_createdAt: timestamp,
      exo__Instance_class: [`"[[${assetClass}]]"`],
      aliases: [label],
    };

    // Add status for efforts (tasks, projects, meetings)
    if (
      assetClass === "ems__Task" ||
      assetClass === "ems__Project" ||
      assetClass === "ems__Meeting"
    ) {
      frontmatter["ems__Effort_status"] = '"[[ems__EffortStatusDraft]]"';
    }

    // Add optional prototype reference
    if (options.prototype) {
      frontmatter["ems__Effort_prototype"] = `"[[${options.prototype}]]"`;
    }

    // Add optional area reference
    if (options.area) {
      frontmatter["ems__Effort_area"] = `"[[${options.area}]]"`;
    }

    // Add optional parent reference
    if (options.parent) {
      frontmatter["ems__Effort_parent"] = `"[[${options.parent}]]"`;
    }

    return frontmatter;
  }

  /**
   * Get human-readable asset type name
   */
  private getAssetTypeName(assetClass: string): string {
    const classMap: Record<string, string> = {
      ems__Task: "task",
      ems__Meeting: "meeting",
      ems__Project: "project",
      ems__Area: "area",
    };
    return classMap[assetClass] || "asset";
  }
}
