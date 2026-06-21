/**
 * Event bus interface for dependency injection
 * Enables loosely-coupled communication between services
 */
export interface IEventBus {
  /**
   * Publish an event to all subscribers
   */
  publish<T = unknown>(eventName: string, data: T): void;

  /**
   * Subscribe to an event
   * @returns Unsubscribe function
   */
  subscribe<T = unknown>(eventName: string, handler: (data: T) => void): () => void;

  /**
   * Unsubscribe from an event
   */
  unsubscribe(eventName: string, handler: (data: unknown) => void): void;
}
