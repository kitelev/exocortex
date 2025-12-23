/**
 * Zustand store for graph event management.
 * Provides a robust event emitter for real-time graph updates.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { randomUUID } from "../../utils/uuid";

enableMapSet();

import type {
  GraphEvent,
  GraphEventType,
  GraphEventHandler,
  GraphEventWildcardHandler,
  GraphEventStore,
  GraphEventState,
  EventSubscription,
  SubscriptionOptions,
  EmitEventInput,
} from "./types";

/**
 * Default event state
 */
const DEFAULT_STATE: GraphEventState = {
  eventHistory: [],
  maxHistorySize: 100,
  historyEnabled: false,
  debugMode: false,
  pendingBatch: [],
  isBatching: false,
};

/**
 * Internal handler wrapper for options support
 */
interface HandlerEntry {
  id: string;
  handler: GraphEventHandler<GraphEvent>;
  options: SubscriptionOptions;
  lastCallTime?: number;
  debounceTimeout?: ReturnType<typeof setTimeout>;
}

/**
 * Map of event type to handlers
 */
const handlers = new Map<GraphEventType | "*", HandlerEntry[]>();

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return randomUUID();
}

/**
 * Check if handler should be called based on options
 */
function shouldCallHandler(
  entry: HandlerEntry,
  event: GraphEvent
): { call: boolean; delay?: number } {
  const { options } = entry;

  // Source filter
  if (options.sources && options.sources.length > 0) {
    if (!options.sources.includes(event.source)) {
      return { call: false };
    }
  }

  // Custom filter
  if (options.filter && !options.filter(event)) {
    return { call: false };
  }

  // Throttle check
  if (options.throttle && entry.lastCallTime) {
    const elapsed = Date.now() - entry.lastCallTime;
    if (elapsed < options.throttle) {
      return { call: false };
    }
  }

  // Debounce returns delay
  if (options.debounce) {
    return { call: true, delay: options.debounce };
  }

  return { call: true };
}

/**
 * Call handler with debounce/throttle support
 */
function callHandler(entry: HandlerEntry, event: GraphEvent): void {
  const result = shouldCallHandler(entry, event);

  if (!result.call) {
    return;
  }

  // Handle debounce
  if (result.delay) {
    if (entry.debounceTimeout) {
      clearTimeout(entry.debounceTimeout);
    }
    entry.debounceTimeout = setTimeout(() => {
      entry.lastCallTime = Date.now();
      entry.handler(event);
    }, result.delay);
    return;
  }

  // Direct call (with throttle tracking)
  entry.lastCallTime = Date.now();
  entry.handler(event);
}

/**
 * Sort handlers by priority (higher first)
 */
function sortHandlersByPriority(entries: HandlerEntry[]): HandlerEntry[] {
  return [...entries].sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));
}

/**
 * Create the graph event store
 */
export const useGraphEventStore = create<GraphEventStore>()(
  subscribeWithSelector(
    immer<GraphEventStore>((set, get) => ({
      // Initial state
      ...DEFAULT_STATE,

      // ============================================================
      // Event Emission
      // ============================================================

      emit: (eventData: EmitEventInput) => {
        const state = get();

        const event = {
          ...eventData,
          id: generateEventId(),
          timestamp: Date.now(),
          source: eventData.source ?? "store",
        } as GraphEvent;

        // If batching, collect event
        if (state.isBatching) {
          set((s) => {
            s.pendingBatch.push(event);
          });
          return;
        }

        // Debug logging
        if (state.debugMode) {
          console.debug("[GraphEvent]", event.type, event);
        }

        // Add to history if enabled
        if (state.historyEnabled) {
          set((s) => {
            s.eventHistory.push(event);
            // Trim history if needed
            if (s.eventHistory.length > s.maxHistorySize) {
              s.eventHistory = s.eventHistory.slice(-s.maxHistorySize);
            }
          });
        }

        // Get handlers for specific type
        const typeHandlers = handlers.get(event.type) ?? [];
        const wildcardHandlers = handlers.get("*") ?? [];

        // Combine and sort by priority
        const allHandlers = sortHandlersByPriority([...typeHandlers, ...wildcardHandlers]);

        // Call handlers
        for (const entry of allHandlers) {
          try {
            callHandler(entry, event);
          } catch (error) {
            console.error(`[GraphEvent] Error in handler for ${event.type}:`, error);
          }
        }
      },

      emitAsync: async (eventData: EmitEventInput): Promise<void> => {
        const state = get();

        const event = {
          ...eventData,
          id: generateEventId(),
          timestamp: Date.now(),
          source: eventData.source ?? "store",
        } as GraphEvent;

        // If batching, collect event
        if (state.isBatching) {
          set((s) => {
            s.pendingBatch.push(event);
          });
          return;
        }

        // Debug logging
        if (state.debugMode) {
          console.debug("[GraphEvent] async", event.type, event);
        }

        // Add to history if enabled
        if (state.historyEnabled) {
          set((s) => {
            s.eventHistory.push(event);
            if (s.eventHistory.length > s.maxHistorySize) {
              s.eventHistory = s.eventHistory.slice(-s.maxHistorySize);
            }
          });
        }

        // Get handlers
        const typeHandlers = handlers.get(event.type) ?? [];
        const wildcardHandlers = handlers.get("*") ?? [];
        const allHandlers = sortHandlersByPriority([...typeHandlers, ...wildcardHandlers]);

        // Call handlers sequentially (await each)
        for (const entry of allHandlers) {
          try {
            const result = shouldCallHandler(entry, event);
            if (result.call && !result.delay) {
              entry.lastCallTime = Date.now();
              await Promise.resolve(entry.handler(event));
            }
          } catch (error) {
            console.error(`[GraphEvent] Error in async handler for ${event.type}:`, error);
          }
        }
      },

      // ============================================================
      // Subscriptions
      // ============================================================

      on: <T extends GraphEventType>(
        type: T,
        handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>,
        options: SubscriptionOptions = {}
      ): EventSubscription => {
        const entry: HandlerEntry = {
          id: generateEventId(),
          handler: handler as GraphEventHandler,
          options,
        };

        if (!handlers.has(type)) {
          handlers.set(type, []);
        }
        handlers.get(type)!.push(entry);

        let active = true;

        return {
          unsubscribe: () => {
            if (!active) return;
            active = false;
            const typeHandlers = handlers.get(type);
            if (typeHandlers) {
              const index = typeHandlers.findIndex((e) => e.id === entry.id);
              if (index !== -1) {
                // Clear any pending debounce
                if (typeHandlers[index].debounceTimeout) {
                  clearTimeout(typeHandlers[index].debounceTimeout);
                }
                typeHandlers.splice(index, 1);
              }
            }
          },
          isActive: () => active,
        };
      },

      onAny: (
        handler: GraphEventWildcardHandler,
        options: SubscriptionOptions = {}
      ): EventSubscription => {
        const entry: HandlerEntry = {
          id: generateEventId(),
          handler,
          options,
        };

        if (!handlers.has("*")) {
          handlers.set("*", []);
        }
        handlers.get("*")!.push(entry);

        let active = true;

        return {
          unsubscribe: () => {
            if (!active) return;
            active = false;
            const wildcardHandlers = handlers.get("*");
            if (wildcardHandlers) {
              const index = wildcardHandlers.findIndex((e) => e.id === entry.id);
              if (index !== -1) {
                if (wildcardHandlers[index].debounceTimeout) {
                  clearTimeout(wildcardHandlers[index].debounceTimeout);
                }
                wildcardHandlers.splice(index, 1);
              }
            }
          },
          isActive: () => active,
        };
      },

      off: <T extends GraphEventType>(
        type: T,
        handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>
      ) => {
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          const index = typeHandlers.findIndex((e) => e.handler === handler);
          if (index !== -1) {
            if (typeHandlers[index].debounceTimeout) {
              clearTimeout(typeHandlers[index].debounceTimeout);
            }
            typeHandlers.splice(index, 1);
          }
        }
      },

      // ============================================================
      // Batching
      // ============================================================

      startBatch: () => {
        set((state) => {
          state.isBatching = true;
          state.pendingBatch = [];
        });
      },

      endBatch: () => {
        const state = get();
        const batch = [...state.pendingBatch];

        set((s) => {
          s.isBatching = false;
          s.pendingBatch = [];
        });

        // Emit all collected events
        if (batch.length > 0) {
          const emit = get().emit;

          // Emit batch event
          emit({
            type: "data:batch",
            operations: batch.map((e) => {
              if (e.type === "node:add") {
                return { type: "add" as const, entity: "node" as const, data: e.node };
              }
              if (e.type === "edge:add") {
                return { type: "add" as const, entity: "edge" as const, data: e.edge };
              }
              if (e.type === "node:update") {
                return { type: "update" as const, entity: "node" as const, id: e.nodeId, changes: e.changes };
              }
              if (e.type === "edge:update") {
                return { type: "update" as const, entity: "edge" as const, id: e.edgeId, changes: e.changes };
              }
              if (e.type === "node:remove") {
                return { type: "remove" as const, entity: "node" as const, id: e.nodeId };
              }
              if (e.type === "edge:remove") {
                return { type: "remove" as const, entity: "edge" as const, id: e.edgeId };
              }
              // For other event types, skip in batch operations
              return null;
            }).filter((op): op is NonNullable<typeof op> => op !== null),
            source: "store",
          });

          // Also emit individual events
          for (const event of batch) {
            // Re-emit without batching
            if (state.debugMode) {
              console.debug("[GraphEvent] batched", event.type, event);
            }

            if (state.historyEnabled) {
              set((s) => {
                s.eventHistory.push(event);
                if (s.eventHistory.length > s.maxHistorySize) {
                  s.eventHistory = s.eventHistory.slice(-s.maxHistorySize);
                }
              });
            }

            const typeHandlers = handlers.get(event.type) ?? [];
            const wildcardHandlers = handlers.get("*") ?? [];
            const allHandlers = sortHandlersByPriority([...typeHandlers, ...wildcardHandlers]);

            for (const entry of allHandlers) {
              try {
                callHandler(entry, event);
              } catch (error) {
                console.error(`[GraphEvent] Error in batched handler for ${event.type}:`, error);
              }
            }
          }
        }
      },

      // ============================================================
      // History & Debug
      // ============================================================

      clearHistory: () => {
        set((state) => {
          state.eventHistory = [];
        });
      },

      setDebugMode: (enabled: boolean) => {
        set((state) => {
          state.debugMode = enabled;
        });
      },

      setHistoryEnabled: (enabled: boolean) => {
        set((state) => {
          state.historyEnabled = enabled;
        });
      },

      getRecentEvents: <T extends GraphEventType>(
        type: T,
        count = 10
      ): Array<Extract<GraphEvent, { type: T }>> => {
        const state = get();
        return state.eventHistory
          .filter((e): e is Extract<GraphEvent, { type: T }> => e.type === type)
          .slice(-count);
      },

      // ============================================================
      // Reset
      // ============================================================

      reset: () => {
        // Clear all handlers
        handlers.clear();

        // Reset state
        set(() => ({
          ...DEFAULT_STATE,
          eventHistory: [],
          pendingBatch: [],
        }));
      },
    }))
  )
);

/**
 * Get default state for testing
 */
export const getDefaultState = (): GraphEventState => ({
  ...DEFAULT_STATE,
  eventHistory: [],
  pendingBatch: [],
});

/**
 * Clear all handlers (for testing)
 */
export const clearAllHandlers = (): void => {
  handlers.clear();
};

/**
 * Get handler count for a specific event type (for testing)
 */
export const getHandlerCount = (type: GraphEventType | "*"): number => {
  return handlers.get(type)?.length ?? 0;
};
