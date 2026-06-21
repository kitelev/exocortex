/**
 * Configuration interface for dependency injection
 * Provides access to application settings
 */
export interface IConfiguration {
  /**
   * Get configuration value by key
   */
  get<T = unknown>(key: string): T | undefined;

  /**
   * Set configuration value
   */
  set<T = unknown>(key: string, value: T): Promise<void>;

  /**
   * Get all configuration as object
   */
  getAll(): Record<string, unknown>;
}
