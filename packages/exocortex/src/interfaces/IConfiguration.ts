/**
 * Configuration interface for dependency injection
 * Provides access to application settings
 */
export interface IConfiguration {
  /**
   * Get configuration value by key
   */
  get<T = any>(key: string): T | undefined;

  /**
   * Set configuration value
   */
  set<T = any>(key: string, value: T): Promise<void>;

  /**
   * Get all configuration as object
   */
  getAll(): Record<string, any>;
}
