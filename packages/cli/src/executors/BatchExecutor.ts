import path from "path";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { PathResolver } from "../utils/PathResolver.js";
import { FrontmatterService, DateFormatter } from "exocortex";
import { TransactionManager } from "../utils/TransactionManager.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import {
  FileNotFoundError,
  InvalidArgumentsError,
  OperationFailedError,
} from "../utils/errors/index.js";

/**
 * Represents a single operation in a batch
 */
export interface BatchOperation {
  /** Command to execute (e.g., "start", "complete", "update-label") */
  command: string;
  /** Path to asset file (relative to vault root) */
  filepath: string;
  /** Optional parameters for the command */
  options?: Record<string, unknown>;
}

/**
 * Result of a single operation in a batch
 */
export interface BatchOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Command that was executed */
  command: string;
  /** Path to the affected file */
  filepath: string;
  /** Error message if operation failed */
  error?: string;
  /** Action description if operation succeeded */
  action?: string;
  /** Changes made (if applicable) */
  changes?: Record<string, unknown>;
}

/**
 * Result of the entire batch execution
 */
export interface BatchResult {
  /** Whether all operations succeeded (or all were rolled back in atomic mode) */
  success: boolean;
  /** Total number of operations */
  total: number;
  /** Number of successful operations */
  succeeded: number;
  /** Number of failed operations */
  failed: number;
  /** Individual results for each operation */
  results: BatchOperationResult[];
  /** Execution time in milliseconds */
  durationMs: number;
  /** Whether atomic mode was used */
  atomic: boolean;
  /** Whether rollback was performed (only relevant in atomic mode) */
  rolledBack?: boolean;
}

/**
 * Batch executor for efficient bulk operations
 *
 * Features:
 * - Single CLI invocation for multiple operations
 * - Load vault once, execute multiple operations
 * - Aggregate results with per-file status
 * - Optional atomic mode (all-or-nothing execution)
 */
export class BatchExecutor {
  private pathResolver: PathResolver;
  private fsAdapter: NodeFsAdapter;
  private frontmatterService: FrontmatterService;
  private transactionManager: TransactionManager;
  private dryRun: boolean;

  constructor(vaultRoot: string, dryRun: boolean = false) {
    this.pathResolver = new PathResolver(vaultRoot);
    this.fsAdapter = new NodeFsAdapter(vaultRoot);
    this.frontmatterService = new FrontmatterService();
    this.transactionManager = new TransactionManager();
    this.dryRun = dryRun;
  }

  /**
   * Executes a batch of operations
   *
   * @param operations - Array of operations to execute
   * @param atomic - If true, all operations must succeed or all are rolled back
   * @returns Batch result with per-operation status
   */
  async executeBatch(
    operations: BatchOperation[],
    atomic: boolean = false,
  ): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchOperationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    if (operations.length === 0) {
      return {
        success: true,
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        durationMs: Date.now() - startTime,
        atomic,
      };
    }

    // In atomic mode, backup all files first
    if (atomic && !this.dryRun) {
      try {
        await this.backupAllFiles(operations);
      } catch (error) {
        return {
          success: false,
          total: operations.length,
          succeeded: 0,
          failed: operations.length,
          results: operations.map((op) => ({
            success: false,
            command: op.command,
            filepath: op.filepath,
            error: `Backup failed: ${(error as Error).message}`,
          })),
          durationMs: Date.now() - startTime,
          atomic,
        };
      }
    }

    // Execute each operation
    for (const operation of operations) {
      const result = await this.executeSingleOperation(operation);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else {
        failed++;

        // In atomic mode, rollback on first failure
        if (atomic && !this.dryRun) {
          await this.transactionManager.rollback();
          // Note: We return rolledBack: true explicitly below, no need to set variable

          // Mark remaining operations as not executed
          const remainingIndex = results.length;
          for (let i = remainingIndex; i < operations.length; i++) {
            results.push({
              success: false,
              command: operations[i].command,
              filepath: operations[i].filepath,
              error: "Not executed due to atomic rollback",
            });
            failed++;
          }

          return {
            success: false,
            total: operations.length,
            succeeded: 0, // All rolled back
            failed: operations.length,
            results,
            durationMs: Date.now() - startTime,
            atomic,
            rolledBack: true,
          };
        }
      }
    }

    // Commit transaction if atomic mode and all succeeded
    // Note: If we reach here, no rollback occurred (early return on rollback)
    if (atomic && !this.dryRun) {
      await this.transactionManager.commit();
    }

    const success = failed === 0;

    return {
      success,
      total: operations.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
      atomic,
      ...(atomic && { rolledBack: false }),
    };
  }

  /**
   * Parses batch input from JSON string or file content
   *
   * @param input - JSON string containing array of operations
   * @returns Parsed operations array
   */
  static parseInput(input: string): BatchOperation[] {
    try {
      const parsed = JSON.parse(input);

      if (!Array.isArray(parsed)) {
        throw new InvalidArgumentsError(
          "Batch input must be a JSON array of operations",
          'exo batch --input \'[{"command":"start","filepath":"task.md"}]\'',
        );
      }

      // Validate each operation
      for (const op of parsed) {
        if (!op.command || typeof op.command !== "string") {
          throw new InvalidArgumentsError(
            'Each operation must have a "command" string property',
            '{"command":"start","filepath":"task.md"}',
          );
        }
        if (!op.filepath || typeof op.filepath !== "string") {
          throw new InvalidArgumentsError(
            'Each operation must have a "filepath" string property',
            '{"command":"start","filepath":"task.md"}',
          );
        }
      }

      return parsed as BatchOperation[];
    } catch (error) {
      if (error instanceof InvalidArgumentsError) {
        throw error;
      }
      throw new InvalidArgumentsError(
        `Failed to parse batch input: ${(error as Error).message}`,
        'exo batch --input \'[{"command":"start","filepath":"task.md"}]\'',
      );
    }
  }

  /**
   * Backup all files that will be modified in atomic mode
   */
  private async backupAllFiles(operations: BatchOperation[]): Promise<void> {
    const uniqueFilepaths = new Set<string>();

    for (const op of operations) {
      const resolvedPath = this.pathResolver.resolve(op.filepath);
      uniqueFilepaths.add(resolvedPath);
    }

    for (const filepath of uniqueFilepaths) {
      await this.transactionManager.begin(filepath);
    }
  }

  /**
   * Execute a single operation and return result
   */
  private async executeSingleOperation(
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    try {
      const resolvedPath = this.pathResolver.resolve(operation.filepath);
      this.pathResolver.validate(resolvedPath);
      const relativePath = resolvedPath.replace(
        this.pathResolver.getVaultRoot() + "/",
        "",
      );

      // Read file to verify it exists
      const content = await this.fsAdapter.readFile(relativePath);

      if (this.dryRun) {
        return {
          success: true,
          command: operation.command,
          filepath: operation.filepath,
          action: `Would execute ${operation.command} (dry-run)`,
        };
      }

      // Execute based on command type
      switch (operation.command) {
        case "start":
          return await this.executeStart(relativePath, operation);

        case "complete":
          return await this.executeComplete(relativePath, operation);

        case "trash":
          return await this.executeTrash(relativePath, operation);

        case "archive":
          return await this.executeArchive(relativePath, operation);

        case "move-to-backlog":
          return await this.executeStatusUpdate(
            relativePath,
            operation,
            "ems__EffortStatusBacklog",
            "Moved to backlog",
          );

        case "move-to-analysis":
          return await this.executeStatusUpdate(
            relativePath,
            operation,
            "ems__EffortStatusAnalysis",
            "Moved to analysis",
          );

        case "move-to-todo":
          return await this.executeStatusUpdate(
            relativePath,
            operation,
            "ems__EffortStatusToDo",
            "Moved to todo",
          );

        case "update-label":
          return await this.executeUpdateLabel(relativePath, operation);

        case "schedule":
          return await this.executeSchedule(relativePath, operation);

        case "set-deadline":
          return await this.executeSetDeadline(relativePath, operation);

        case "repair-folder":
          return await this.executeRepairFolder(relativePath, operation);

        default:
          return {
            success: false,
            command: operation.command,
            filepath: operation.filepath,
            error: `Unknown command: ${operation.command}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get current timestamp for property updates in ISO 8601 local time format
   */
  private getCurrentTimestamp(): string {
    return DateFormatter.toLocalTimestamp(new Date());
  }

  /**
   * Execute start command
   */
  private async executeStart(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const content = await this.fsAdapter.readFile(relativePath);
    const timestamp = this.getCurrentTimestamp();

    let updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      '"[[ems__EffortStatusDoing]]"',
    );

    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_startTimestamp",
      timestamp,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: "Started task",
      changes: { status: "Doing", startTimestamp: timestamp },
    };
  }

  /**
   * Execute complete command
   */
  private async executeComplete(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const content = await this.fsAdapter.readFile(relativePath);
    const timestamp = this.getCurrentTimestamp();

    let updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      '"[[ems__EffortStatusDone]]"',
    );

    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_endTimestamp",
      timestamp,
    );

    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_resolutionTimestamp",
      timestamp,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: "Completed task",
      changes: {
        status: "Done",
        endTimestamp: timestamp,
        resolutionTimestamp: timestamp,
      },
    };
  }

  /**
   * Execute trash command
   */
  private async executeTrash(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const content = await this.fsAdapter.readFile(relativePath);
    const timestamp = this.getCurrentTimestamp();

    let updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      '"[[ems__EffortStatusTrashed]]"',
    );

    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_resolutionTimestamp",
      timestamp,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: "Trashed task",
      changes: { status: "Trashed", resolutionTimestamp: timestamp },
    };
  }

  /**
   * Execute archive command
   */
  private async executeArchive(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const content = await this.fsAdapter.readFile(relativePath);

    let updated = this.frontmatterService.updateProperty(
      content,
      "archived",
      "true",
    );
    updated = this.frontmatterService.removeProperty(updated, "aliases");

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: "Archived task",
      changes: { archived: true, aliasesRemoved: true },
    };
  }

  /**
   * Execute status update command
   */
  private async executeStatusUpdate(
    relativePath: string,
    operation: BatchOperation,
    statusValue: string,
    actionDescription: string,
  ): Promise<BatchOperationResult> {
    const content = await this.fsAdapter.readFile(relativePath);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      `"[[${statusValue}]]"`,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: actionDescription,
      changes: { status: statusValue.replace("ems__EffortStatus", "") },
    };
  }

  /**
   * Execute update-label command
   */
  private async executeUpdateLabel(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const label = operation.options?.label as string | undefined;

    if (!label || label.trim() === "") {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: 'Missing required option: "label"',
      };
    }

    const trimmedLabel = label.trim();
    const content = await this.fsAdapter.readFile(relativePath);

    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Asset_label",
      `"${trimmedLabel}"`,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: `Updated label to "${trimmedLabel}"`,
      changes: { label: trimmedLabel },
    };
  }

  /**
   * Execute schedule command
   */
  private async executeSchedule(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const date = operation.options?.date as string | undefined;

    if (!date) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: 'Missing required option: "date"',
      };
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: `Invalid date format: ${date}. Expected YYYY-MM-DD`,
      };
    }

    const content = await this.fsAdapter.readFile(relativePath);
    const timestamp = DateFormatter.toTimestampAtStartOfDay(date);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_scheduledTimestamp",
      timestamp,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: `Scheduled for ${date}`,
      changes: { scheduledTimestamp: timestamp },
    };
  }

  /**
   * Execute set-deadline command
   */
  private async executeSetDeadline(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const date = operation.options?.date as string | undefined;

    if (!date) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: 'Missing required option: "date"',
      };
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: `Invalid date format: ${date}. Expected YYYY-MM-DD`,
      };
    }

    const content = await this.fsAdapter.readFile(relativePath);
    const timestamp = DateFormatter.toTimestampAtStartOfDay(date);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_deadlineTimestamp",
      timestamp,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: `Set deadline to ${date}`,
      changes: { deadlineTimestamp: timestamp },
    };
  }

  /**
   * Execute repair-folder command
   */
  private async executeRepairFolder(
    relativePath: string,
    operation: BatchOperation,
  ): Promise<BatchOperationResult> {
    const metadata = await this.fsAdapter.getFileMetadata(relativePath);

    // Check for required property
    const isDefinedBy = metadata?.exo__Asset_isDefinedBy;
    if (!isDefinedBy) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: "Cannot determine expected folder: missing exo__Asset_isDefinedBy",
      };
    }

    // Extract reference from various formats
    const reference = this.extractReference(isDefinedBy);
    if (!reference) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: "Cannot determine expected folder: invalid exo__Asset_isDefinedBy format",
      };
    }

    // Find the referenced file
    const referencedFilePath = await this.findReferencedFile(reference, relativePath);
    if (!referencedFilePath) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: `Cannot determine expected folder: referenced asset not found: ${reference}`,
      };
    }

    // Get expected folder (folder of referenced file)
    const rawExpectedFolder = path.dirname(referencedFilePath);
    const expectedFolder = rawExpectedFolder === "." ? "" : rawExpectedFolder;
    const rawCurrentFolder = path.dirname(relativePath);
    const currentFolder = rawCurrentFolder === "." ? "" : rawCurrentFolder;

    // Check if already in correct folder
    if (this.normalizePath(currentFolder) === this.normalizePath(expectedFolder)) {
      return {
        success: true,
        command: operation.command,
        filepath: operation.filepath,
        action: "Already in correct folder",
        changes: { moved: false, folder: expectedFolder || "(root)" },
      };
    }

    // Construct new path
    const fileName = path.basename(relativePath);
    const newPath = expectedFolder ? `${expectedFolder}/${fileName}` : fileName;

    // Check if target already exists
    const targetExists = await this.fsAdapter.fileExists(newPath);
    if (targetExists) {
      return {
        success: false,
        command: operation.command,
        filepath: operation.filepath,
        error: `Cannot move file: ${newPath} already exists`,
      };
    }

    // Move the file
    await this.fsAdapter.renameFile(relativePath, newPath);

    return {
      success: true,
      command: operation.command,
      filepath: operation.filepath,
      action: `Moved to ${expectedFolder || "(root)"}`,
      changes: {
        moved: true,
        oldPath: relativePath,
        newPath,
        expectedFolder: expectedFolder || "(root)",
      },
    };
  }

  /**
   * Extract reference from various formats:
   * - [[Reference]] -> Reference
   * - "[[Reference]]" -> Reference
   * - Reference -> Reference
   */
  private extractReference(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    // Remove quotes if present
    let cleaned = value.trim().replace(/^["']|["']$/g, "");

    // Remove wiki-link brackets if present
    cleaned = cleaned.replace(/^\[\[|\]\]$/g, "");

    return cleaned || null;
  }

  /**
   * Find the referenced file by resolving the reference
   */
  private async findReferencedFile(
    reference: string,
    sourceFilePath: string,
  ): Promise<string | null> {
    // Normalize reference (add .md extension if not present)
    const normalizedRef = reference.endsWith(".md")
      ? reference
      : `${reference}.md`;

    // Try 1: Direct path (if reference looks like a path)
    if (reference.includes("/")) {
      const exists = await this.fsAdapter.fileExists(normalizedRef);
      if (exists) {
        return normalizedRef;
      }
    }

    // Try 2: Same folder as source file
    const sourceDir = path.dirname(sourceFilePath);
    const sameFolderPath = sourceDir !== "."
      ? `${sourceDir}/${normalizedRef}`
      : normalizedRef;
    const sameFolderExists = await this.fsAdapter.fileExists(sameFolderPath);
    if (sameFolderExists) {
      return sameFolderPath;
    }

    // Try 3: Search by UID
    const uidPath = await this.fsAdapter.findFileByUID(reference);
    if (uidPath) {
      return uidPath;
    }

    // Try 4: Search by filename across vault
    const allFiles = await this.fsAdapter.getMarkdownFiles();
    const matchingFile = allFiles.find((file) => {
      const baseName = path.basename(file, ".md");
      const refBaseName = path.basename(normalizedRef, ".md");
      return baseName === refBaseName;
    });

    return matchingFile || null;
  }

  /**
   * Normalize path for comparison
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  }
}
