/**
 * ViewportController - Smooth pan and zoom controls for graph visualization
 *
 * Provides comprehensive interaction support for viewport manipulation:
 * - Mouse wheel zoom (with trackpad pinch-to-zoom support)
 * - Mouse drag panning with momentum
 * - Touch support (single finger pan, pinch-to-zoom)
 * - Keyboard shortcuts for navigation
 * - Double-tap/click zoom
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

/**
 * 2D position
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Viewport state representing pan and zoom
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Configuration options for ViewportController
 */
export interface ViewportControllerConfig {
  /** Minimum zoom level (default: 0.1) */
  minZoom: number;
  /** Maximum zoom level (default: 10) */
  maxZoom: number;
  /** Zoom sensitivity per wheel delta (default: 0.001) */
  zoomSpeed: number;
  /** Pan speed multiplier (default: 1) */
  panSpeed: number;
  /** Momentum decay factor per frame (default: 0.95) */
  momentumDecay: number;
  /** Minimum velocity threshold to stop momentum (default: 0.1) */
  momentumThreshold: number;
  /** Zoom factor on double-tap/click (default: 2) */
  doubleTapZoom: number;
  /** Pixels per arrow key press (default: 50) */
  keyboardPanStep: number;
  /** Zoom change per +/- key press (default: 0.2) */
  keyboardZoomStep: number;
  /** Enable touch support (default: true) */
  enableTouch: boolean;
  /** Enable keyboard shortcuts (default: true) */
  enableKeyboard: boolean;
  /** Enable momentum panning (default: true) */
  enableMomentum: boolean;
  /** Maximum time between taps for double-tap detection in ms (default: 300) */
  doubleTapDelay: number;
}

/**
 * Event types emitted by ViewportController
 */
export type ViewportEventType =
  | "viewport:change"
  | "viewport:zoom"
  | "viewport:pan"
  | "viewport:panstart"
  | "viewport:panend"
  | "viewport:momentum";

/**
 * Event data for viewport events
 */
export interface ViewportEvent {
  type: ViewportEventType;
  viewport: Viewport;
  delta?: { x: number; y: number };
  zoomDelta?: number;
}

/**
 * Event listener callback type
 */
export type ViewportEventListener = (event: ViewportEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ViewportControllerConfig = {
  minZoom: 0.1,
  maxZoom: 10,
  zoomSpeed: 0.001,
  panSpeed: 1,
  momentumDecay: 0.95,
  momentumThreshold: 0.1,
  doubleTapZoom: 2,
  keyboardPanStep: 50,
  keyboardZoomStep: 0.2,
  enableTouch: true,
  enableKeyboard: true,
  enableMomentum: true,
  doubleTapDelay: 300,
};

/**
 * ViewportController class for handling viewport interactions
 *
 * @example
 * ```typescript
 * const controller = new ViewportController(canvasElement);
 *
 * controller.on("viewport:change", (event) => {
 *   console.log("Viewport changed:", event.viewport);
 * });
 *
 * // Manual viewport control
 * controller.zoomAt(1.5, centerX, centerY);
 * controller.panBy(100, 50);
 *
 * // Cleanup
 * controller.destroy();
 * ```
 */
export class ViewportController {
  private element: HTMLElement;
  private viewport: Viewport;
  private config: ViewportControllerConfig;

  // Drag/pan state
  private isDragging = false;
  private lastPointer: Position | null = null;
  private velocity: Position = { x: 0, y: 0 };

  // Touch state
  private activeTouches: Map<number, Position> = new Map();
  private lastPinchDistance: number | null = null;
  private lastPinchCenter: Position | null = null;

  // Double-tap detection
  private lastTapTime = 0;
  private lastTapPosition: Position | null = null;

  // Momentum animation
  private momentumAnimationId: number | null = null;
  private lastMomentumTime = 0;

  // Event listeners
  private listeners: Map<ViewportEventType, Set<ViewportEventListener>> = new Map();

  // Bound event handlers for cleanup
  private boundHandleWheel: (e: WheelEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  private boundHandleTouchStart: (e: TouchEvent) => void;
  private boundHandleTouchMove: (e: TouchEvent) => void;
  private boundHandleTouchEnd: (e: TouchEvent) => void;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleContextMenu: (e: MouseEvent) => void;

  constructor(
    element: HTMLElement,
    initialViewport?: Partial<Viewport>,
    config?: Partial<ViewportControllerConfig>
  ) {
    this.element = element;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.viewport = {
      x: initialViewport?.x ?? 0,
      y: initialViewport?.y ?? 0,
      zoom: initialViewport?.zoom ?? 1,
    };

    // Bind event handlers
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleTouchStart = this.handleTouchStart.bind(this);
    this.boundHandleTouchMove = this.handleTouchMove.bind(this);
    this.boundHandleTouchEnd = this.handleTouchEnd.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleContextMenu = (e: MouseEvent) => e.preventDefault();

    this.setupEventListeners();
  }

  /**
   * Setup all event listeners on the target element
   */
  private setupEventListeners(): void {
    // Make element focusable for keyboard events
    if (!this.element.hasAttribute("tabindex")) {
      this.element.setAttribute("tabindex", "0");
    }

    // Mouse events
    this.element.addEventListener("wheel", this.boundHandleWheel, { passive: false });
    this.element.addEventListener("mousedown", this.boundHandleMouseDown);
    window.addEventListener("mousemove", this.boundHandleMouseMove);
    window.addEventListener("mouseup", this.boundHandleMouseUp);
    this.element.addEventListener("contextmenu", this.boundHandleContextMenu);

    // Touch events
    if (this.config.enableTouch) {
      this.element.addEventListener("touchstart", this.boundHandleTouchStart, { passive: false });
      this.element.addEventListener("touchmove", this.boundHandleTouchMove, { passive: false });
      this.element.addEventListener("touchend", this.boundHandleTouchEnd);
      this.element.addEventListener("touchcancel", this.boundHandleTouchEnd);
    }

    // Keyboard events
    if (this.config.enableKeyboard) {
      this.element.addEventListener("keydown", this.boundHandleKeyDown);
    }
  }

  /**
   * Handle mouse wheel for zooming
   */
  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    const { clientX, clientY, deltaY, ctrlKey } = event;
    const rect = this.element.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    // Pinch zoom on trackpad (ctrlKey is set for pinch gestures)
    const zoomDelta = ctrlKey
      ? -deltaY * 0.01
      : -deltaY * this.config.zoomSpeed;

    this.zoomAt(screenX, screenY, zoomDelta);
  }

  /**
   * Handle mouse down for pan start
   */
  private handleMouseDown(event: MouseEvent): void {
    // Only primary button (left click)
    if (event.button !== 0) return;

    // Check for double-click
    const now = Date.now();
    const rect = this.element.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (
      this.lastTapPosition &&
      now - this.lastTapTime < this.config.doubleTapDelay
    ) {
      const dx = screenX - this.lastTapPosition.x;
      const dy = screenY - this.lastTapPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 20) {
        // Double-click detected - zoom in
        this.handleDoubleTap(screenX, screenY);
        this.lastTapTime = 0;
        this.lastTapPosition = null;
        return;
      }
    }

    this.lastTapTime = now;
    this.lastTapPosition = { x: screenX, y: screenY };

    // Start drag
    this.startDrag(event.clientX, event.clientY);
    event.preventDefault();
  }

  /**
   * Handle mouse move for panning
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.lastPointer) return;

    const dx = (event.clientX - this.lastPointer.x) * this.config.panSpeed;
    const dy = (event.clientY - this.lastPointer.y) * this.config.panSpeed;

    // Track velocity for momentum
    const now = Date.now();
    if (this.config.enableMomentum && this.lastMomentumTime > 0) {
      const dt = Math.max(now - this.lastMomentumTime, 1) / 16; // Normalize to ~60fps
      this.velocity.x = dx / dt;
      this.velocity.y = dy / dt;
    }
    this.lastMomentumTime = now;

    // Update viewport
    this.panBy(dx, dy);

    this.lastPointer = { x: event.clientX, y: event.clientY };
  }

  /**
   * Handle mouse up for pan end
   */
  private handleMouseUp(event: MouseEvent): void {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.lastPointer = null;

    this.emit({
      type: "viewport:panend",
      viewport: { ...this.viewport },
    });

    // Start momentum animation if enabled and velocity is significant
    if (
      this.config.enableMomentum &&
      (Math.abs(this.velocity.x) > this.config.momentumThreshold ||
        Math.abs(this.velocity.y) > this.config.momentumThreshold)
    ) {
      this.startMomentum();
    } else {
      this.velocity = { x: 0, y: 0 };
    }

    // Ignore unused parameter
    void event;
  }

  /**
   * Handle touch start for pan/pinch
   */
  private handleTouchStart(event: TouchEvent): void {
    event.preventDefault();

    // Track all touches
    for (const touch of Array.from(event.changedTouches)) {
      this.activeTouches.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
      });
    }

    const touchCount = this.activeTouches.size;

    if (touchCount === 1) {
      // Single touch - pan
      const touch = event.touches[0];

      // Check for double-tap
      const now = Date.now();
      const rect = this.element.getBoundingClientRect();
      const screenX = touch.clientX - rect.left;
      const screenY = touch.clientY - rect.top;

      if (
        this.lastTapPosition &&
        now - this.lastTapTime < this.config.doubleTapDelay
      ) {
        const dx = screenX - this.lastTapPosition.x;
        const dy = screenY - this.lastTapPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 30) {
          this.handleDoubleTap(screenX, screenY);
          this.lastTapTime = 0;
          this.lastTapPosition = null;
          return;
        }
      }

      this.lastTapTime = now;
      this.lastTapPosition = { x: screenX, y: screenY };

      this.startDrag(touch.clientX, touch.clientY);
    } else if (touchCount === 2) {
      // Two touches - pinch zoom
      this.isDragging = false;
      this.lastPointer = null;
      this.stopMomentum();

      const touches = Array.from(this.activeTouches.values());
      this.lastPinchDistance = this.getTouchDistance(touches[0], touches[1]);
      this.lastPinchCenter = this.getTouchCenter(touches[0], touches[1]);
    }
  }

  /**
   * Handle touch move for pan/pinch
   */
  private handleTouchMove(event: TouchEvent): void {
    event.preventDefault();

    // Update touch positions
    for (const touch of Array.from(event.changedTouches)) {
      this.activeTouches.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
      });
    }

    const touchCount = this.activeTouches.size;

    if (touchCount === 1 && this.isDragging && this.lastPointer) {
      // Single touch pan
      const touch = event.touches[0];
      const dx = (touch.clientX - this.lastPointer.x) * this.config.panSpeed;
      const dy = (touch.clientY - this.lastPointer.y) * this.config.panSpeed;

      // Track velocity
      const now = Date.now();
      if (this.config.enableMomentum && this.lastMomentumTime > 0) {
        const dt = Math.max(now - this.lastMomentumTime, 1) / 16;
        this.velocity.x = dx / dt;
        this.velocity.y = dy / dt;
      }
      this.lastMomentumTime = now;

      this.panBy(dx, dy);
      this.lastPointer = { x: touch.clientX, y: touch.clientY };
    } else if (
      touchCount === 2 &&
      this.lastPinchDistance !== null &&
      this.lastPinchCenter !== null
    ) {
      // Pinch zoom
      const touches = Array.from(this.activeTouches.values());
      const newDistance = this.getTouchDistance(touches[0], touches[1]);
      const newCenter = this.getTouchCenter(touches[0], touches[1]);

      // Calculate zoom delta
      const zoomDelta = newDistance / this.lastPinchDistance - 1;

      // Get screen coordinates relative to element
      const rect = this.element.getBoundingClientRect();
      const screenX = newCenter.x - rect.left;
      const screenY = newCenter.y - rect.top;

      // Apply zoom
      this.zoomAt(screenX, screenY, zoomDelta);

      // Apply pan from center movement
      const panDx = (newCenter.x - this.lastPinchCenter.x) * this.config.panSpeed;
      const panDy = (newCenter.y - this.lastPinchCenter.y) * this.config.panSpeed;
      this.panBy(panDx, panDy);

      this.lastPinchDistance = newDistance;
      this.lastPinchCenter = newCenter;
    }
  }

  /**
   * Handle touch end
   */
  private handleTouchEnd(event: TouchEvent): void {
    // Remove ended touches
    for (const touch of Array.from(event.changedTouches)) {
      this.activeTouches.delete(touch.identifier);
    }

    const touchCount = this.activeTouches.size;

    if (touchCount === 0) {
      // All touches ended
      if (this.isDragging) {
        this.isDragging = false;
        this.lastPointer = null;

        this.emit({
          type: "viewport:panend",
          viewport: { ...this.viewport },
        });

        // Start momentum
        if (
          this.config.enableMomentum &&
          (Math.abs(this.velocity.x) > this.config.momentumThreshold ||
            Math.abs(this.velocity.y) > this.config.momentumThreshold)
        ) {
          this.startMomentum();
        }
      }

      this.lastPinchDistance = null;
      this.lastPinchCenter = null;
    } else if (touchCount === 1) {
      // Transition from pinch to pan
      this.lastPinchDistance = null;
      this.lastPinchCenter = null;

      const remainingTouch = Array.from(this.activeTouches.values())[0];
      this.startDrag(remainingTouch.x, remainingTouch.y);
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Skip if in an input field
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    let handled = false;

    switch (event.key) {
      case "ArrowUp":
        this.panBy(0, this.config.keyboardPanStep);
        handled = true;
        break;
      case "ArrowDown":
        this.panBy(0, -this.config.keyboardPanStep);
        handled = true;
        break;
      case "ArrowLeft":
        this.panBy(this.config.keyboardPanStep, 0);
        handled = true;
        break;
      case "ArrowRight":
        this.panBy(-this.config.keyboardPanStep, 0);
        handled = true;
        break;
      case "+":
      case "=":
        this.zoomByFactor(1 + this.config.keyboardZoomStep);
        handled = true;
        break;
      case "-":
      case "_":
        this.zoomByFactor(1 - this.config.keyboardZoomStep);
        handled = true;
        break;
      case "0":
        this.resetZoom();
        handled = true;
        break;
      case "Home":
        this.resetViewport();
        handled = true;
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  /**
   * Handle double-tap/click zoom
   */
  private handleDoubleTap(screenX: number, screenY: number): void {
    // Toggle between zoomed and default
    const targetZoom =
      this.viewport.zoom < 1.5
        ? this.config.doubleTapZoom
        : 1;

    const zoomFactor = targetZoom / this.viewport.zoom;
    this.zoomAt(screenX, screenY, zoomFactor - 1);
  }

  /**
   * Start dragging
   */
  private startDrag(clientX: number, clientY: number): void {
    this.isDragging = true;
    this.lastPointer = { x: clientX, y: clientY };
    this.velocity = { x: 0, y: 0 };
    this.lastMomentumTime = Date.now();
    this.stopMomentum();

    this.emit({
      type: "viewport:panstart",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Start momentum animation
   */
  private startMomentum(): void {
    this.stopMomentum();

    const animate = () => {
      // Apply velocity with decay
      this.velocity.x *= this.config.momentumDecay;
      this.velocity.y *= this.config.momentumDecay;

      // Stop if velocity is below threshold
      if (
        Math.abs(this.velocity.x) < this.config.momentumThreshold &&
        Math.abs(this.velocity.y) < this.config.momentumThreshold
      ) {
        this.velocity = { x: 0, y: 0 };
        this.momentumAnimationId = null;
        return;
      }

      // Apply movement
      this.viewport.x += this.velocity.x;
      this.viewport.y += this.velocity.y;

      this.emit({
        type: "viewport:momentum",
        viewport: { ...this.viewport },
        delta: { x: this.velocity.x, y: this.velocity.y },
      });

      // Continue animation
      this.momentumAnimationId = requestAnimationFrame(animate);
    };

    this.momentumAnimationId = requestAnimationFrame(animate);
  }

  /**
   * Stop momentum animation
   */
  private stopMomentum(): void {
    if (this.momentumAnimationId !== null) {
      cancelAnimationFrame(this.momentumAnimationId);
      this.momentumAnimationId = null;
    }
  }

  /**
   * Get distance between two touch points
   */
  private getTouchDistance(p1: Position, p2: Position): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Get center point between two touches
   */
  private getTouchCenter(p1: Position, p2: Position): Position {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
  }

  /**
   * Zoom at a specific screen point
   *
   * @param screenX - Screen X coordinate to zoom toward
   * @param screenY - Screen Y coordinate to zoom toward
   * @param delta - Zoom delta (positive = zoom in, negative = zoom out)
   */
  zoomAt(screenX: number, screenY: number, delta: number): void {
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, oldZoom * (1 + delta))
    );

    if (newZoom === oldZoom) return;

    // Zoom toward cursor position (keep world point under cursor stationary)
    const worldX = (screenX - this.viewport.x) / oldZoom;
    const worldY = (screenY - this.viewport.y) / oldZoom;

    this.viewport.zoom = newZoom;
    this.viewport.x = screenX - worldX * newZoom;
    this.viewport.y = screenY - worldY * newZoom;

    this.emit({
      type: "viewport:zoom",
      viewport: { ...this.viewport },
      zoomDelta: newZoom - oldZoom,
    });

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Zoom by a factor around the viewport center
   *
   * @param factor - Zoom factor (> 1 = zoom in, < 1 = zoom out)
   */
  zoomByFactor(factor: number): void {
    const rect = this.element.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    this.zoomAt(centerX, centerY, factor - 1);
  }

  /**
   * Pan the viewport by delta amounts
   *
   * @param dx - Delta X in screen coordinates
   * @param dy - Delta Y in screen coordinates
   */
  panBy(dx: number, dy: number): void {
    this.viewport.x += dx;
    this.viewport.y += dy;

    this.emit({
      type: "viewport:pan",
      viewport: { ...this.viewport },
      delta: { x: dx, y: dy },
    });

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Set the viewport directly
   *
   * @param viewport - New viewport state
   */
  setViewport(viewport: Partial<Viewport>): void {
    if (viewport.x !== undefined) this.viewport.x = viewport.x;
    if (viewport.y !== undefined) this.viewport.y = viewport.y;
    if (viewport.zoom !== undefined) {
      this.viewport.zoom = Math.max(
        this.config.minZoom,
        Math.min(this.config.maxZoom, viewport.zoom)
      );
    }

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Get current viewport state
   */
  getViewport(): Viewport {
    return { ...this.viewport };
  }

  /**
   * Reset zoom to 1
   */
  resetZoom(): void {
    const rect = this.element.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Calculate the world point at center
    const worldX = (centerX - this.viewport.x) / this.viewport.zoom;
    const worldY = (centerY - this.viewport.y) / this.viewport.zoom;

    // Set zoom to 1 keeping center point
    this.viewport.zoom = 1;
    this.viewport.x = centerX - worldX;
    this.viewport.y = centerY - worldY;

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Reset viewport to origin with zoom 1
   */
  resetViewport(): void {
    this.viewport = { x: 0, y: 0, zoom: 1 };
    this.stopMomentum();
    this.velocity = { x: 0, y: 0 };

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Center the viewport on a world coordinate
   *
   * @param worldX - World X coordinate
   * @param worldY - World Y coordinate
   */
  centerOn(worldX: number, worldY: number): void {
    const rect = this.element.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    this.viewport.x = centerX - worldX * this.viewport.zoom;
    this.viewport.y = centerY - worldY * this.viewport.zoom;

    this.emit({
      type: "viewport:change",
      viewport: { ...this.viewport },
    });
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): Position {
    return {
      x: (screenX - this.viewport.x) / this.viewport.zoom,
      y: (screenY - this.viewport.y) / this.viewport.zoom,
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): Position {
    return {
      x: worldX * this.viewport.zoom + this.viewport.x,
      y: worldY * this.viewport.zoom + this.viewport.y,
    };
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: ViewportEventType, listener: ViewportEventListener): void {
    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      this.listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);
  }

  /**
   * Remove event listener
   *
   * @param type - Event type
   * @param listener - Callback function to remove
   */
  off(type: ViewportEventType, listener: ViewportEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: ViewportEvent): void {
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<ViewportControllerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ViewportControllerConfig {
    return { ...this.config };
  }

  /**
   * Check if currently dragging
   */
  isDraggingViewport(): boolean {
    return this.isDragging;
  }

  /**
   * Check if momentum animation is active
   */
  hasMomentum(): boolean {
    return this.momentumAnimationId !== null;
  }

  /**
   * Destroy the controller and remove all event listeners
   */
  destroy(): void {
    this.stopMomentum();

    // Remove mouse events
    this.element.removeEventListener("wheel", this.boundHandleWheel);
    this.element.removeEventListener("mousedown", this.boundHandleMouseDown);
    window.removeEventListener("mousemove", this.boundHandleMouseMove);
    window.removeEventListener("mouseup", this.boundHandleMouseUp);
    this.element.removeEventListener("contextmenu", this.boundHandleContextMenu);

    // Remove touch events
    this.element.removeEventListener("touchstart", this.boundHandleTouchStart);
    this.element.removeEventListener("touchmove", this.boundHandleTouchMove);
    this.element.removeEventListener("touchend", this.boundHandleTouchEnd);
    this.element.removeEventListener("touchcancel", this.boundHandleTouchEnd);

    // Remove keyboard events
    this.element.removeEventListener("keydown", this.boundHandleKeyDown);

    // Clear listeners
    this.listeners.clear();
    this.activeTouches.clear();
  }
}

/**
 * Default ViewportController configuration
 */
export const DEFAULT_VIEWPORT_CONTROLLER_CONFIG = DEFAULT_CONFIG;
