/**
 * Notification service interface for dependency injection
 * Provides user notifications and confirmations
 */
export interface INotificationService {
  /**
   * Show informational notification to user
   */
  info(message: string, duration?: number): void;

  /**
   * Show success notification to user
   */
  success(message: string, duration?: number): void;

  /**
   * Show error notification to user
   */
  error(message: string, duration?: number): void;

  /**
   * Show warning notification to user
   */
  warn(message: string, duration?: number): void;

  /**
   * Show confirmation dialog
   * @returns Promise that resolves to true if user confirms, false otherwise
   */
  confirm(title: string, message: string): Promise<boolean>;
}
