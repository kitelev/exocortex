import type { TFile } from "obsidian";
import { ObsidianApp } from '@plugin/types';

/**
 * Utility class for common file operations in commands
 */
export class CommandHelpers {
  // Maximum attempts to wait for file activation (20 × 100ms = 2 seconds total timeout)
  private static readonly MAX_FILE_ACTIVATION_ATTEMPTS = 20;
  private static readonly FILE_ACTIVATION_CHECK_INTERVAL_MS = 100;

  /**
   * Opens a file in a new tab and waits for it to become active.
   * Supports cancellation via AbortSignal for lifecycle management.
   *
   * @param app - Obsidian app instance
   * @param file - File to open
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise that resolves when file is active (with 2 second timeout)
   */
  static async openFileInNewTab(app: ObsidianApp, file: TFile, signal?: AbortSignal): Promise<void> {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });

    // Wait for the file to become active (with timeout and cancellation support)
    await this.waitForFileActivation(app, file.path, signal);
  }

  /**
   * Waits for a file to become the active file in the workspace.
   * Supports cancellation via AbortSignal for plugin lifecycle management.
   *
   * @param app - Obsidian app instance
   * @param targetPath - Path of the file to wait for
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise that resolves when file is active or times out
   */
  static async waitForFileActivation(
    app: ObsidianApp,
    targetPath: string,
    signal?: AbortSignal
  ): Promise<void> {
    for (let i = 0; i < this.MAX_FILE_ACTIVATION_ATTEMPTS; i++) {
      // Check for cancellation
      if (signal?.aborted) {
        return;
      }

      if (app.workspace.getActiveFile()?.path === targetPath) {
        return;
      }

      // Use a cancellable delay
      await this.cancellableDelay(this.FILE_ACTIVATION_CHECK_INTERVAL_MS, signal);
    }
  }

  /**
   * Creates a cancellable delay that respects AbortSignal.
   * If aborted, the delay completes silently (no error thrown).
   *
   * @param ms - Delay in milliseconds
   * @param signal - Optional AbortSignal for cancellation
   */
  private static cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      const timerId = setTimeout(() => {
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timerId);
          resolve();
        }, { once: true });
      }
    });
  }
}
