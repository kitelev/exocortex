/**
 * TouchGestureManager - Mobile touch gesture support for 3D graph
 *
 * Provides touch gesture handling for:
 * - Tap to select nodes
 * - Long-press for context actions
 * - Pinch-to-zoom (handled by OrbitControls)
 * - Two-finger rotation (handled by OrbitControls)
 * - Single-finger pan (handled by OrbitControls)
 *
 * OrbitControls from Three.js already handles the multi-touch gestures,
 * this manager focuses on tap/touch-to-select functionality.
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

/**
 * Configuration for touch gesture handling
 */
export interface TouchGestureConfig {
  /** Maximum movement (in pixels) before tap becomes a drag */
  tapThreshold: number;

  /** Maximum time (in ms) for a touch to count as a tap */
  tapTimeout: number;

  /** Time (in ms) to trigger long press */
  longPressTimeout: number;

  /** Enable haptic feedback on supported devices */
  enableHapticFeedback: boolean;

  /** Enable double-tap to zoom to fit */
  enableDoubleTap: boolean;

  /** Double-tap maximum interval (in ms) */
  doubleTapTimeout: number;
}

/**
 * Default touch gesture configuration
 */
export const DEFAULT_TOUCH_GESTURE_CONFIG: TouchGestureConfig = {
  tapThreshold: 10,
  tapTimeout: 300,
  longPressTimeout: 500,
  enableHapticFeedback: true,
  enableDoubleTap: true,
  doubleTapTimeout: 300,
};

/**
 * Touch gesture event types
 */
export type TouchGestureEventType =
  | "tap"
  | "doubleTap"
  | "longPress"
  | "touchStart"
  | "touchMove"
  | "touchEnd";

/**
 * Touch gesture event data
 */
export interface TouchGestureEvent {
  type: TouchGestureEventType;
  /** X position relative to element */
  x: number;
  /** Y position relative to element */
  y: number;
  /** Original touch event */
  originalEvent?: TouchEvent;
  /** Number of active touches */
  touchCount?: number;
}

/**
 * Event listener callback for touch gesture events
 */
export type TouchGestureEventListener = (event: TouchGestureEvent) => void;

/**
 * Touch state tracking
 */
interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  identifier: number;
}

/**
 * TouchGestureManager - Handles touch gestures for 3D graph
 *
 * @example
 * ```typescript
 * const manager = new TouchGestureManager(canvas);
 *
 * manager.on('tap', (event) => {
 *   console.log('Tap at:', event.x, event.y);
 * });
 *
 * manager.on('doubleTap', (event) => {
 *   console.log('Double tap at:', event.x, event.y);
 * });
 *
 * manager.destroy();
 * ```
 */
export class TouchGestureManager {
  private element: HTMLElement;
  private config: TouchGestureConfig;
  private eventListeners: Map<TouchGestureEventType, Set<TouchGestureEventListener>> =
    new Map();

  private touchStates: Map<number, TouchState> = new Map();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private destroyed = false;

  // Bound event handlers for proper removal
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundTouchCancel: (e: TouchEvent) => void;

  constructor(
    element: HTMLElement,
    config: Partial<TouchGestureConfig> = {}
  ) {
    this.element = element;
    this.config = { ...DEFAULT_TOUCH_GESTURE_CONFIG, ...config };

    // Initialize event listener maps
    const eventTypes: TouchGestureEventType[] = [
      "tap",
      "doubleTap",
      "longPress",
      "touchStart",
      "touchMove",
      "touchEnd",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }

    // Bind handlers
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);
    this.boundTouchCancel = this.handleTouchCancel.bind(this);

    // Add event listeners
    this.element.addEventListener("touchstart", this.boundTouchStart, {
      passive: false,
    });
    this.element.addEventListener("touchmove", this.boundTouchMove, {
      passive: false,
    });
    this.element.addEventListener("touchend", this.boundTouchEnd, {
      passive: false,
    });
    this.element.addEventListener("touchcancel", this.boundTouchCancel, {
      passive: false,
    });
  }

  /**
   * Handle touch start event
   */
  private handleTouchStart(event: TouchEvent): void {
    if (this.destroyed) return;

    const rect = this.element.getBoundingClientRect();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      this.touchStates.set(touch.identifier, {
        startX: x,
        startY: y,
        startTime: Date.now(),
        identifier: touch.identifier,
      });

      this.emit("touchStart", {
        type: "touchStart",
        x,
        y,
        originalEvent: event,
        touchCount: event.touches.length,
      });
    }

    // Start long press timer only for single touch
    if (event.touches.length === 1) {
      this.startLongPressTimer(event);
    } else {
      this.cancelLongPressTimer();
    }
  }

  /**
   * Handle touch move event
   */
  private handleTouchMove(event: TouchEvent): void {
    if (this.destroyed) return;

    const rect = this.element.getBoundingClientRect();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const state = this.touchStates.get(touch.identifier);

      if (state) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        const dx = x - state.startX;
        const dy = y - state.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If moved beyond threshold, cancel long press
        if (distance > this.config.tapThreshold) {
          this.cancelLongPressTimer();
        }

        this.emit("touchMove", {
          type: "touchMove",
          x,
          y,
          originalEvent: event,
          touchCount: event.touches.length,
        });
      }
    }
  }

  /**
   * Handle touch end event
   */
  private handleTouchEnd(event: TouchEvent): void {
    if (this.destroyed) return;

    this.cancelLongPressTimer();

    const rect = this.element.getBoundingClientRect();
    const now = Date.now();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const state = this.touchStates.get(touch.identifier);

      if (state) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        const dx = x - state.startX;
        const dy = y - state.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const duration = now - state.startTime;

        this.emit("touchEnd", {
          type: "touchEnd",
          x,
          y,
          originalEvent: event,
          touchCount: event.touches.length,
        });

        // Check if this is a tap (small movement, short duration, single touch)
        if (
          distance < this.config.tapThreshold &&
          duration < this.config.tapTimeout &&
          event.touches.length === 0 // No remaining touches
        ) {
          // Check for double tap
          if (this.config.enableDoubleTap) {
            const timeSinceLastTap = now - this.lastTapTime;
            const distFromLastTap = Math.sqrt(
              Math.pow(x - this.lastTapX, 2) + Math.pow(y - this.lastTapY, 2)
            );

            if (
              timeSinceLastTap < this.config.doubleTapTimeout &&
              distFromLastTap < this.config.tapThreshold * 2
            ) {
              // Double tap detected
              this.emit("doubleTap", {
                type: "doubleTap",
                x,
                y,
                originalEvent: event,
              });
              this.triggerHapticFeedback();
              this.lastTapTime = 0; // Reset to prevent triple-tap detection
            } else {
              // Single tap - wait for potential double tap
              this.lastTapTime = now;
              this.lastTapX = x;
              this.lastTapY = y;

              // Emit tap immediately (don't wait for double tap timeout)
              this.emit("tap", {
                type: "tap",
                x,
                y,
                originalEvent: event,
              });
              this.triggerHapticFeedback();
            }
          } else {
            // Double tap disabled, emit tap immediately
            this.emit("tap", {
              type: "tap",
              x,
              y,
              originalEvent: event,
            });
            this.triggerHapticFeedback();
          }
        }

        this.touchStates.delete(touch.identifier);
      }
    }
  }

  /**
   * Handle touch cancel event
   */
  private handleTouchCancel(event: TouchEvent): void {
    if (this.destroyed) return;

    this.cancelLongPressTimer();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touchStates.delete(touch.identifier);
    }
  }

  /**
   * Start long press timer
   */
  private startLongPressTimer(event: TouchEvent): void {
    this.cancelLongPressTimer();

    const touch = event.touches[0];
    const rect = this.element.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    this.longPressTimer = setTimeout(() => {
      this.emit("longPress", {
        type: "longPress",
        x,
        y,
        originalEvent: event,
      });
      this.triggerHapticFeedback();
    }, this.config.longPressTimeout);
  }

  /**
   * Cancel long press timer
   */
  private cancelLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Trigger haptic feedback if available
   */
  private triggerHapticFeedback(): void {
    if (!this.config.enableHapticFeedback) return;

    // Use Vibration API if available
    if (
      "vibrate" in navigator &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(10);
    }
  }

  /**
   * Add event listener
   */
  on(eventType: TouchGestureEventType, listener: TouchGestureEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: TouchGestureEventType, listener: TouchGestureEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: TouchGestureEventType, event: TouchGestureEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in TouchGestureManager event listener:", error);
        }
      }
    }
  }

  /**
   * Check if device supports touch
   */
  static isTouchDevice(): boolean {
    return (
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0
    );
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TouchGestureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TouchGestureConfig {
    return { ...this.config };
  }

  /**
   * Destroy the manager and remove event listeners
   */
  destroy(): void {
    this.destroyed = true;
    this.cancelLongPressTimer();

    this.element.removeEventListener("touchstart", this.boundTouchStart);
    this.element.removeEventListener("touchmove", this.boundTouchMove);
    this.element.removeEventListener("touchend", this.boundTouchEnd);
    this.element.removeEventListener("touchcancel", this.boundTouchCancel);

    this.touchStates.clear();
    this.eventListeners.clear();
  }
}

/**
 * Factory function to create TouchGestureManager
 */
export function createTouchGestureManager(
  element: HTMLElement,
  config?: Partial<TouchGestureConfig>
): TouchGestureManager {
  return new TouchGestureManager(element, config);
}
