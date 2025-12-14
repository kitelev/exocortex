import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { PathResolver } from "../utils/PathResolver.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FrontmatterService } from "exocortex";
import type { CommandContext, FolderRepairResult } from "./commands/index.js";
import {
  StatusCommandExecutor,
  AssetCreationExecutor,
  PropertyCommandExecutor,
  FolderRepairExecutor,
} from "./commands/index.js";

/**
 * Facade for CLI command execution.
 *
 * Delegates to specialized executors:
 * - StatusCommandExecutor: start, complete, trash, archive, moveToBacklog, etc.
 * - AssetCreationExecutor: createTask, createMeeting, createProject, createArea
 * - PropertyCommandExecutor: renameToUid, updateLabel, schedule, setDeadline
 * - FolderRepairExecutor: repairFolder
 */
export class CommandExecutor {
  private context: CommandContext;
  private statusExecutor: StatusCommandExecutor;
  private creationExecutor: AssetCreationExecutor;
  private propertyExecutor: PropertyCommandExecutor;
  private folderRepairExecutor: FolderRepairExecutor;

  constructor(vaultRoot: string, dryRun: boolean = false) {
    this.context = {
      pathResolver: new PathResolver(vaultRoot),
      fsAdapter: new NodeFsAdapter(vaultRoot),
      frontmatterService: new FrontmatterService(),
      dryRun,
    };

    this.statusExecutor = new StatusCommandExecutor(this.context);
    this.creationExecutor = new AssetCreationExecutor(this.context);
    this.propertyExecutor = new PropertyCommandExecutor(this.context);
    this.folderRepairExecutor = new FolderRepairExecutor(this.context);
  }

  /**
   * Executes a command on a single asset (infrastructure verification)
   */
  async execute(
    commandName: string,
    filepath: string,
    options: Record<string, any>,
  ): Promise<void> {
    try {
      const resolvedPath = this.context.pathResolver.resolve(filepath);
      this.context.pathResolver.validate(resolvedPath);

      await this.context.fsAdapter.readFile(
        resolvedPath.replace(this.context.pathResolver.getVaultRoot() + "/", ""),
      );

      console.log(`✅ Command infrastructure verified`);
      console.log(`   Command: ${commandName}`);
      console.log(`   File: ${resolvedPath}`);
      console.log(`   Vault: ${this.context.pathResolver.getVaultRoot()}`);

      if (Object.keys(options).length > 0) {
        console.log(`   Options: ${JSON.stringify(options, null, 2)}`);
      }

      console.log(`\n📝 Note: Actual command execution will be implemented in follow-up issues.`);
      console.log(`    This PR establishes the infrastructure foundation.`);

      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  getVaultRoot(): string {
    return this.context.pathResolver.getVaultRoot();
  }

  // Status commands
  async executeStart(filepath: string): Promise<void> {
    return this.statusExecutor.executeStart(filepath);
  }

  async executeComplete(filepath: string): Promise<void> {
    return this.statusExecutor.executeComplete(filepath);
  }

  async executeTrash(filepath: string): Promise<void> {
    return this.statusExecutor.executeTrash(filepath);
  }

  async executeArchive(filepath: string): Promise<void> {
    return this.statusExecutor.executeArchive(filepath);
  }

  async executeMoveToBacklog(filepath: string): Promise<void> {
    return this.statusExecutor.executeMoveToBacklog(filepath);
  }

  async executeMoveToAnalysis(filepath: string): Promise<void> {
    return this.statusExecutor.executeMoveToAnalysis(filepath);
  }

  async executeMoveToToDo(filepath: string): Promise<void> {
    return this.statusExecutor.executeMoveToToDo(filepath);
  }

  // Asset creation commands
  async executeCreateTask(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    return this.creationExecutor.executeCreateTask(filepath, label, options);
  }

  async executeCreateMeeting(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    return this.creationExecutor.executeCreateMeeting(filepath, label, options);
  }

  async executeCreateProject(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    return this.creationExecutor.executeCreateProject(filepath, label, options);
  }

  async executeCreateArea(
    filepath: string,
    label: string,
    options: Record<string, any> = {},
  ): Promise<void> {
    return this.creationExecutor.executeCreateArea(filepath, label, options);
  }

  // Property commands
  async executeRenameToUid(filepath: string): Promise<void> {
    return this.propertyExecutor.executeRenameToUid(filepath);
  }

  async executeUpdateLabel(filepath: string, newLabel: string): Promise<void> {
    return this.propertyExecutor.executeUpdateLabel(filepath, newLabel);
  }

  async executeSchedule(filepath: string, date: string): Promise<void> {
    return this.propertyExecutor.executeSchedule(filepath, date);
  }

  async executeSetDeadline(filepath: string, date: string): Promise<void> {
    return this.propertyExecutor.executeSetDeadline(filepath, date);
  }

  // Folder repair command
  async executeRepairFolder(filepath: string): Promise<FolderRepairResult> {
    return this.folderRepairExecutor.executeRepairFolder(filepath);
  }
}
