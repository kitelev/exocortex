import { App, MetadataCache, TFile, Vault, Platform } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import {
  ApplicationErrorHandler,
  NetworkError,
  ServiceError,
  type INotificationService,
} from "exocortex";

/**
 * Task data for iOS Live Activities integration
 */
export interface TaskData {
  taskId: string;
  title: string;
  startTime: string; // ISO8601
  filePath: string;
  callbackURL: string;
}

/**
 * Service for detecting task status changes and launching iOS app
 * 
 * This service listens for metadata changes in Obsidian notes and detects
 * when a task's status changes to "DOING". When detected, it:
 * 1. Generates or retrieves a unique TaskId
 * 2. Builds an exocortex:// URL with task details
 * 3. Launches the iOS companion app via URL scheme
 * 4. The iOS app then displays a Live Activity on the lock screen
 * 
 * Architecture:
 * - Domain Layer: TaskData interface (pure data)
 * - Application Layer: TaskTrackingService (business logic)
 * - Infrastructure Layer: Obsidian API integration (vault, metadata cache)
 */
export class TaskTrackingService {
  private logger: ILogger;
  private errorHandler: ApplicationErrorHandler;
  private currentTask: TaskData | null = null;

  constructor(
    private app: App,
    private vault: Vault,
    private metadataCache: MetadataCache,
    notifier?: INotificationService,
  ) {
    this.logger = LoggerFactory.create("TaskTrackingService");
    this.errorHandler = new ApplicationErrorHandler({}, this.logger, notifier);
  }

  /**
   * Register event listener for metadata changes
   * Call this during plugin initialization
   */
  public registerListener(): void {
    this.logger.debug("Registering status change listener");
    // Listener is registered in ExocortexPlugin.ts via metadataCache.on('changed')
    // This method documents the integration point
  }

  /**
   * Handle file metadata change event
   * Called by ExocortexPlugin when metadataCache emits 'changed' event
   */
  public async handleFileChange(file: TFile): Promise<void> {
    try {
      const cache = this.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) {
        return; // No frontmatter, nothing to track
      }

      const status = cache.frontmatter.Status;

      // Check if status changed to DOING
      if (this.isDoingStatus(status)) {
        this.logger.info(`Detected DOING status for: ${file.basename}`);
        await this.startTracking(file, cache.frontmatter);
      }
    } catch (error) {
      const serviceError = new ServiceError("Error handling file change", {
        file: file.path,
        originalError: error instanceof Error ? error.message : String(error),
      });

      this.errorHandler.handle(serviceError);
    }
  }

  /**
   * Check if status is "DOING"
   * Handles both formats: [[ems__EffortStatusDoing]] and ems__EffortStatusDoing
   */
  private isDoingStatus(status: unknown): boolean {
    if (!status || typeof status !== "string") {
      return false;
    }

    // Remove wiki link brackets if present
    const normalized = status.replace(/\[\[|\]\]/g, "").trim();
    return normalized === "ems__EffortStatusDoing";
  }

  /**
   * Start tracking a task - launch iOS app with task details
   */
  private async startTracking(
    file: TFile,
    frontmatter: Record<string, unknown>,
  ): Promise<void> {
    let taskId: string | undefined;

    try {
      // Extract or generate task ID
      taskId = frontmatter.TaskId as string | undefined;
      if (!taskId) {
        taskId = uuidv4();
        this.logger.info(`Generated new TaskId: ${taskId}`);
        await this.addTaskIdToFrontmatter(file, taskId);
      }

      // Extract task title
      const title = (frontmatter.Title as string) || file.basename;

      // Current time as ISO8601
      const startTime = new Date().toISOString();

      // Build callback URL for task completion
      const callbackURL = this.buildCallbackURL(file.path);

      // Create task data
      const taskData: TaskData = {
        taskId,
        title,
        startTime,
        filePath: file.path,
        callbackURL,
      };

      // Save current task
      this.currentTask = taskData;

      // Launch iOS app
      await this.launchIOSApp(taskData);
    } catch (error) {
      const serviceError = new ServiceError("Error starting task tracking", {
        file: file.path,
        taskId,
        originalError: error instanceof Error ? error.message : String(error),
      });

      this.errorHandler.handle(serviceError);
    }
  }

  /**
   * Add TaskId to frontmatter if not present
   */
  private async addTaskIdToFrontmatter(
    file: TFile,
    taskId: string,
  ): Promise<void> {
    try {
      await this.errorHandler.executeWithRetry(
        async () => {
          try {
            const content = await this.vault.read(file);

            // Check if frontmatter exists
            if (!content.startsWith("---")) {
              this.logger.warn(
                `Cannot add TaskId: no frontmatter in ${file.basename}`,
              );
              return;
            }

            // Find end of frontmatter
            const lines = content.split("\n");
            let endIndex = -1;
            for (let i = 1; i < lines.length; i++) {
              if (lines[i].trim() === "---") {
                endIndex = i;
                break;
              }
            }

            if (endIndex === -1) {
              this.logger.warn(
                `Cannot add TaskId: malformed frontmatter in ${file.basename}`,
              );
              return;
            }

            // Insert TaskId before closing ---
            lines.splice(endIndex, 0, `TaskId: ${taskId}`);
            const updatedContent = lines.join("\n");

            await this.vault.modify(file, updatedContent);
            this.logger.info(`Added TaskId to ${file.basename}`);
          } catch (error) {
            throw new NetworkError("Failed to add TaskId to frontmatter", {
              file: file.path,
              taskId,
              originalError:
                error instanceof Error ? error.message : String(error),
            });
          }
        },
        {
          file: file.path,
          taskId,
        },
      );
    } catch (error) {
      const serviceError =
        error instanceof NetworkError
          ? error
          : new ServiceError("Error adding TaskId to frontmatter", {
              file: file.path,
              taskId,
              originalError:
                error instanceof Error ? error.message : String(error),
            });

      this.errorHandler.handle(serviceError);
    }
  }

  /**
   * Build callback URL for Advanced URI plugin
   * This URL will be called by iOS app when user completes the task
   */
  private buildCallbackURL(filePath: string): string {
    const vaultName = this.app.vault.getName();
    const encodedPath = encodeURIComponent(filePath);
    const encodedVault = encodeURIComponent(vaultName);

    // Advanced URI format for updating frontmatter
    // Requires "Advanced URI" community plugin to be installed
    const callbackURL =
      `obsidian://advanced-uri?` +
      `vault=${encodedVault}&` +
      `filepath=${encodedPath}&` +
      `updatefrontmatter=true&` +
      `frontmatterkey=Status&` +
      `frontmattervalue=[[ems__EffortStatusDone]]`;

    return callbackURL;
  }

  /**
   * Launch iOS app with task data
   * Uses exocortex:// URL scheme to communicate with iOS companion app
   */
  private async launchIOSApp(taskData: TaskData): Promise<void> {
    // Check if running on iOS
    // @ts-ignore - Platform is available in Obsidian mobile
    if (typeof Platform !== "undefined" && !Platform.isIOS) {
      this.logger.warn(
        "iOS Live Activities only available on iOS. " +
          "This feature will not work on desktop or Android."
      );
      return;
    }

    // Build URL parameters
    const params = new URLSearchParams({
      taskId: taskData.taskId,
      title: taskData.title,
      startTime: taskData.startTime,
      "x-success": taskData.callbackURL,
    });

    const url = `exocortex://task/start?${params.toString()}`;

    this.logger.info("Launching iOS app with URL:", url);
    this.logger.debug("Task data:", taskData);

    try {
      // Open URL - this will launch the iOS app
      // On iOS, this triggers the registered URL scheme handler
      // On desktop, this will do nothing (already warned above)
      window.open(url, "_blank");

      this.logger.info("iOS app launch initiated successfully");
    } catch (error) {
      const serviceError = new ServiceError("Failed to launch iOS app", {
        taskData,
        originalError: error instanceof Error ? error.message : String(error),
      });

      this.errorHandler.handle(serviceError);
    }
  }

  /**
   * Get current tracked task
   */
  public getCurrentTask(): TaskData | null {
    return this.currentTask;
  }

  /**
   * Clear current task
   * Call this when task is completed or cancelled
   */
  public clearCurrentTask(): void {
    this.currentTask = null;
    this.logger.debug("Cleared current task");
  }
}
