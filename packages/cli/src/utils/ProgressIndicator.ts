import ora, { type Ora } from "ora";

export interface ProgressIndicatorOptions {
  /**
   * Delay in milliseconds before showing the spinner.
   * This prevents visual noise for fast operations.
   * @default 2000
   */
  delayMs?: number;
}

/**
 * ProgressIndicator provides visual feedback for long-running CLI operations.
 *
 * Features:
 * - Shows spinner only after delay threshold (default 2s) to avoid visual noise
 * - Displays elapsed time while running
 * - Respects TTY mode - no output when piped
 * - Clean completion/failure messages
 *
 * @example
 * ```typescript
 * const progress = new ProgressIndicator("Loading vault");
 * progress.start();
 * // ... long operation ...
 * progress.succeed("Loaded 1000 triples");
 *
 * // Or use wrap for async operations
 * const result = await progress.wrap(async () => {
 *   return await loadData();
 * });
 * ```
 */
export class ProgressIndicator {
  private readonly spinner: Ora;
  private readonly message: string;
  private readonly delayMs: number;
  private delayTimeout: ReturnType<typeof setTimeout> | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private isSpinnerVisible: boolean = false;
  private readonly isTTY: boolean;

  constructor(message: string, options: ProgressIndicatorOptions = {}) {
    this.message = message;
    this.delayMs = options.delayMs ?? 2000;
    this.isTTY = Boolean(process.stdout.isTTY);
    this.spinner = ora({
      text: message,
      // Disable spinner in non-TTY mode
      isEnabled: this.isTTY,
    });
  }

  /**
   * Start the progress indicator.
   * The spinner will only become visible after the configured delay.
   */
  start(): void {
    if (!this.isTTY) {
      // No visual indicator in non-TTY mode
      return;
    }

    this.startTime = Date.now();

    // Schedule spinner to appear after delay
    this.delayTimeout = setTimeout(() => {
      this.showSpinner();
    }, this.delayMs);
  }

  private showSpinner(): void {
    if (!this.isTTY || this.isSpinnerVisible) {
      return;
    }

    this.isSpinnerVisible = true;
    this.updateSpinnerText();
    this.spinner.start();

    // Start interval to update elapsed time
    this.updateInterval = setInterval(() => {
      this.updateSpinnerText();
    }, 1000);
  }

  private updateSpinnerText(): void {
    const elapsed = Date.now() - this.startTime;
    const formattedTime = this.formatElapsedTime(elapsed);
    this.spinner.text = `${this.message} (${formattedTime})`;
  }

  private formatElapsedTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  private cleanup(): void {
    if (this.delayTimeout) {
      clearTimeout(this.delayTimeout);
      this.delayTimeout = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Stop the progress indicator with a success message.
   * If the operation completed before the delay threshold,
   * no visual output is produced.
   */
  succeed(message?: string): void {
    this.cleanup();

    if (this.isSpinnerVisible) {
      this.spinner.succeed(message);
    }
    this.isSpinnerVisible = false;
  }

  /**
   * Stop the progress indicator with a failure message.
   * If the operation failed before the delay threshold,
   * no visual output is produced.
   */
  fail(message?: string): void {
    this.cleanup();

    if (this.isSpinnerVisible) {
      this.spinner.fail(message);
    }
    this.isSpinnerVisible = false;
  }

  /**
   * Stop the progress indicator without any completion message.
   */
  stop(): void {
    this.cleanup();

    if (this.isSpinnerVisible) {
      this.spinner.stop();
    }
    this.isSpinnerVisible = false;
  }

  /**
   * Wrap an async operation with progress indication.
   * Automatically handles start/succeed/fail lifecycle.
   *
   * @param operation - The async operation to execute
   * @param successMessage - Optional message to show on success
   * @returns The result of the operation
   * @throws Rethrows any error from the operation after showing failure
   */
  async wrap<T>(
    operation: () => Promise<T>,
    successMessage?: string
  ): Promise<T> {
    this.start();

    try {
      const result = await operation();
      this.succeed(successMessage);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Operation failed";
      this.fail(errorMessage);
      throw error;
    }
  }
}
