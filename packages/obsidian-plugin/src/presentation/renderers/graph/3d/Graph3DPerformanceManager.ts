/**
 * Graph3DPerformanceManager - Performance optimization for 3D graph rendering
 *
 * Provides:
 * - LOD (Level of Detail): Distance-based label opacity fading
 * - Frustum Culling: Skip rendering off-screen nodes
 * - WebGL Context Recovery: Automatic recovery on context loss
 *
 * Performance targets:
 * - 30+ FPS with 500 nodes (LOD + culling enabled)
 * - Zero crashes on WebGL context loss
 * - Smooth LOD transitions (no popping)
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

import * as THREE from "three";

/**
 * LOD (Level of Detail) configuration
 */
export interface LODConfig {
  /** Enable LOD system */
  enabled: boolean;

  /** Distance at which labels start fading (world units) */
  labelFadeStart: number;

  /** Distance at which labels are fully hidden (world units) */
  labelFadeEnd: number;

  /** Minimum opacity for labels during fade (0-1) */
  labelMinOpacity: number;

  /** Distance at which node detail reduces (world units) */
  nodeDetailFadeStart: number;

  /** Distance at which nodes use minimum detail (world units) */
  nodeDetailFadeEnd: number;
}

/**
 * Frustum culling configuration
 */
export interface FrustumCullingConfig {
  /** Enable frustum culling */
  enabled: boolean;

  /** Padding around frustum for culling (world units) - prevents popping */
  padding: number;

  /** Update culling every N frames (reduces CPU overhead) */
  updateInterval: number;
}

/**
 * WebGL context recovery configuration
 */
export interface WebGLRecoveryConfig {
  /** Enable automatic context recovery */
  enabled: boolean;

  /** Maximum recovery attempts before giving up */
  maxAttempts: number;

  /** Delay between recovery attempts (ms) */
  retryDelay: number;

  /** Show recovery UI message */
  showRecoveryMessage: boolean;
}

/**
 * Full performance configuration
 */
export interface PerformanceConfig {
  lod: LODConfig;
  frustumCulling: FrustumCullingConfig;
  webglRecovery: WebGLRecoveryConfig;
}

/**
 * Default LOD configuration optimized for 500 nodes
 */
export const DEFAULT_LOD_CONFIG: LODConfig = {
  enabled: true,
  labelFadeStart: 150,
  labelFadeEnd: 250,
  labelMinOpacity: 0,
  nodeDetailFadeStart: 200,
  nodeDetailFadeEnd: 400,
};

/**
 * Default frustum culling configuration
 */
export const DEFAULT_FRUSTUM_CULLING_CONFIG: FrustumCullingConfig = {
  enabled: true,
  padding: 50,
  updateInterval: 2,
};

/**
 * Default WebGL recovery configuration
 */
export const DEFAULT_WEBGL_RECOVERY_CONFIG: WebGLRecoveryConfig = {
  enabled: true,
  maxAttempts: 3,
  retryDelay: 1000,
  showRecoveryMessage: true,
};

/**
 * Default performance configuration
 */
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  lod: DEFAULT_LOD_CONFIG,
  frustumCulling: DEFAULT_FRUSTUM_CULLING_CONFIG,
  webglRecovery: DEFAULT_WEBGL_RECOVERY_CONFIG,
};

/**
 * Visibility state for a node
 */
export interface NodeVisibility {
  /** Whether node is in frustum */
  inFrustum: boolean;

  /** Distance from camera */
  distanceToCamera: number;

  /** Computed label opacity based on LOD */
  labelOpacity: number;

  /** Whether label should be visible */
  labelVisible: boolean;

  /** Node detail level (0-1, 1 = full detail) */
  detailLevel: number;
}

/**
 * Performance event types
 */
export type PerformanceEventType =
  | "webglContextLost"
  | "webglContextRestored"
  | "recoveryStarted"
  | "recoveryComplete"
  | "recoveryFailed"
  | "performanceUpdate";

/**
 * Performance event data
 */
export interface PerformanceEvent {
  type: PerformanceEventType;
  message?: string;
  stats?: PerformanceStats;
  attempt?: number;
  maxAttempts?: number;
}

/**
 * Performance event listener
 */
export type PerformanceEventListener = (event: PerformanceEvent) => void;

/**
 * Performance statistics
 */
export interface PerformanceStats {
  /** Current FPS */
  fps: number;

  /** Total nodes */
  totalNodes: number;

  /** Visible nodes (after culling) */
  visibleNodes: number;

  /** Hidden nodes (culled) */
  culledNodes: number;

  /** Nodes with visible labels */
  labelsVisible: number;

  /** Average distance to camera */
  averageDistance: number;

  /** Culling efficiency (% nodes culled) */
  cullingEfficiency: number;
}

/**
 * Graph3DPerformanceManager - Manages rendering performance optimizations
 *
 * @example
 * ```typescript
 * const perfManager = new Graph3DPerformanceManager(renderer, camera);
 * perfManager.initialize();
 *
 * // In render loop
 * const visibility = perfManager.calculateNodeVisibility(nodePosition);
 * if (visibility.inFrustum) {
 *   // Render node with visibility.labelOpacity
 * }
 *
 * // Listen for WebGL recovery events
 * perfManager.on('recoveryComplete', () => {
 *   // Re-render scene
 * });
 * ```
 */
export class Graph3DPerformanceManager {
  private config: PerformanceConfig;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private container: HTMLElement | null = null;

  // Frustum culling
  private frustum: THREE.Frustum = new THREE.Frustum();
  private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private frameCount = 0;

  // WebGL recovery
  private recoveryAttempts = 0;
  private isRecovering = false;
  private contextLostHandler: ((event: Event) => void) | null = null;
  private contextRestoredHandler: ((event: Event) => void) | null = null;
  private onRecoveryComplete: (() => void) | null = null;

  // Event system
  private eventListeners: Map<PerformanceEventType, Set<PerformanceEventListener>> =
    new Map();

  // Performance tracking
  private lastFrameTime = 0;
  private frameTimeAccumulator = 0;
  private frameCountForFps = 0;
  private currentFps = 60;
  private visibilityCache: Map<string, NodeVisibility> = new Map();

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      lod: { ...DEFAULT_LOD_CONFIG, ...config.lod },
      frustumCulling: { ...DEFAULT_FRUSTUM_CULLING_CONFIG, ...config.frustumCulling },
      webglRecovery: { ...DEFAULT_WEBGL_RECOVERY_CONFIG, ...config.webglRecovery },
    };

    // Initialize event listener maps
    const eventTypes: PerformanceEventType[] = [
      "webglContextLost",
      "webglContextRestored",
      "recoveryStarted",
      "recoveryComplete",
      "recoveryFailed",
      "performanceUpdate",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  /**
   * Initialize the performance manager
   *
   * @param renderer - Three.js WebGL renderer
   * @param camera - Three.js perspective camera
   * @param container - Container element for recovery UI
   * @param onRecoveryComplete - Callback when context is restored
   */
  initialize(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    container: HTMLElement,
    onRecoveryComplete?: () => void
  ): void {
    this.renderer = renderer;
    this.camera = camera;
    this.container = container;
    this.onRecoveryComplete = onRecoveryComplete ?? null;

    // Setup WebGL context loss/restore handlers
    if (this.config.webglRecovery.enabled) {
      this.setupWebGLRecovery();
    }

    this.lastFrameTime = performance.now();
  }

  /**
   * Setup WebGL context loss and restore handlers
   */
  private setupWebGLRecovery(): void {
    if (!this.renderer) return;

    const canvas = this.renderer.domElement;

    this.contextLostHandler = (event: Event) => {
      event.preventDefault();
      this.handleContextLost();
    };

    this.contextRestoredHandler = () => {
      this.handleContextRestored();
    };

    canvas.addEventListener("webglcontextlost", this.contextLostHandler);
    canvas.addEventListener("webglcontextrestored", this.contextRestoredHandler);
  }

  /**
   * Handle WebGL context lost event
   */
  private handleContextLost(): void {
    this.emit("webglContextLost", {
      type: "webglContextLost",
      message: "WebGL context lost. Attempting recovery...",
    });

    this.isRecovering = true;
    this.recoveryAttempts = 0;

    // Show recovery message if configured
    if (this.config.webglRecovery.showRecoveryMessage && this.container) {
      this.showRecoveryUI("Recovering...");
    }

    this.emit("recoveryStarted", {
      type: "recoveryStarted",
      message: "Starting WebGL context recovery",
      attempt: 1,
      maxAttempts: this.config.webglRecovery.maxAttempts,
    });
  }

  /**
   * Handle WebGL context restored event
   */
  private handleContextRestored(): void {
    this.recoveryAttempts++;

    if (this.recoveryAttempts <= this.config.webglRecovery.maxAttempts) {
      this.emit("webglContextRestored", {
        type: "webglContextRestored",
        message: `WebGL context restored (attempt ${this.recoveryAttempts})`,
        attempt: this.recoveryAttempts,
      });

      // Hide recovery UI
      this.hideRecoveryUI();

      // Notify that recovery is complete
      this.isRecovering = false;

      this.emit("recoveryComplete", {
        type: "recoveryComplete",
        message: "WebGL context recovery successful",
        attempt: this.recoveryAttempts,
      });

      // Call recovery callback
      if (this.onRecoveryComplete) {
        this.onRecoveryComplete();
      }
    } else {
      this.emit("recoveryFailed", {
        type: "recoveryFailed",
        message: `WebGL context recovery failed after ${this.config.webglRecovery.maxAttempts} attempts`,
        attempt: this.recoveryAttempts,
        maxAttempts: this.config.webglRecovery.maxAttempts,
      });

      // Show permanent error message
      if (this.config.webglRecovery.showRecoveryMessage && this.container) {
        this.showRecoveryUI("WebGL Error - Please refresh the page");
      }
    }
  }

  /**
   * Show recovery UI overlay
   *
   * CSS classes used:
   * - .graph3d-recovery-overlay: Base overlay styling
   * - .graph3d-recovery-overlay--visible: Shows the overlay
   * - .graph3d-recovery-overlay--hidden: Hides the overlay
   */
  private showRecoveryUI(message: string): void {
    if (!this.container) return;

    // Check if recovery overlay already exists
    let overlay = this.container.querySelector(
      ".graph3d-recovery-overlay"
    ) as HTMLElement;

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "graph3d-recovery-overlay graph3d-recovery-overlay--visible";
      // Add relative positioning class to container
      this.container.classList.add("graph3d-container--relative");
      this.container.appendChild(overlay);
    }

    overlay.textContent = message;
    overlay.classList.remove("graph3d-recovery-overlay--hidden");
    overlay.classList.add("graph3d-recovery-overlay--visible");
  }

  /**
   * Hide recovery UI overlay
   */
  private hideRecoveryUI(): void {
    if (!this.container) return;

    const overlay = this.container.querySelector(
      ".graph3d-recovery-overlay"
    ) as HTMLElement;

    if (overlay) {
      overlay.classList.remove("graph3d-recovery-overlay--visible");
      overlay.classList.add("graph3d-recovery-overlay--hidden");
    }
  }

  /**
   * Update frustum for culling calculations
   *
   * Call this once per frame before calculating visibility
   */
  updateFrustum(): void {
    if (!this.camera || !this.config.frustumCulling.enabled) return;

    // Only update frustum on configured interval
    this.frameCount++;
    if (this.frameCount % this.config.frustumCulling.updateInterval !== 0) {
      return;
    }

    // Update projection screen matrix
    this.camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );

    // Update frustum from matrix
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    // Clear visibility cache when frustum updates
    this.visibilityCache.clear();
  }

  /**
   * Calculate visibility state for a node
   *
   * @param nodeId - Unique node identifier for caching
   * @param position - Node position in world space
   * @param radius - Node radius for frustum intersection
   * @returns Visibility state including LOD calculations
   */
  calculateNodeVisibility(
    nodeId: string,
    position: THREE.Vector3,
    radius: number = 10
  ): NodeVisibility {
    // Check cache first
    const cached = this.visibilityCache.get(nodeId);
    if (cached) {
      return cached;
    }

    const result: NodeVisibility = {
      inFrustum: true,
      distanceToCamera: 0,
      labelOpacity: 1,
      labelVisible: true,
      detailLevel: 1,
    };

    if (!this.camera) {
      return result;
    }

    // Calculate distance to camera
    result.distanceToCamera = position.distanceTo(this.camera.position);

    // Frustum culling check
    if (this.config.frustumCulling.enabled) {
      // Create sphere for intersection test with padding
      const testRadius = radius + this.config.frustumCulling.padding;
      const sphere = new THREE.Sphere(position, testRadius);
      result.inFrustum = this.frustum.intersectsSphere(sphere);
    }

    // LOD calculations (only if LOD enabled and in frustum)
    if (this.config.lod.enabled && result.inFrustum) {
      // Label opacity based on distance
      result.labelOpacity = this.calculateLabelOpacity(result.distanceToCamera);
      result.labelVisible = result.labelOpacity > 0.01;

      // Detail level based on distance
      result.detailLevel = this.calculateDetailLevel(result.distanceToCamera);
    } else if (!result.inFrustum) {
      result.labelVisible = false;
      result.labelOpacity = 0;
      result.detailLevel = 0;
    }

    // Cache result
    this.visibilityCache.set(nodeId, result);

    return result;
  }

  /**
   * Calculate label opacity based on distance (smooth fade)
   */
  private calculateLabelOpacity(distance: number): number {
    const { labelFadeStart, labelFadeEnd, labelMinOpacity } = this.config.lod;

    if (distance <= labelFadeStart) {
      return 1;
    }

    if (distance >= labelFadeEnd) {
      return labelMinOpacity;
    }

    // Smooth interpolation using ease-out
    const t = (distance - labelFadeStart) / (labelFadeEnd - labelFadeStart);
    const eased = 1 - Math.pow(t, 2); // Quadratic ease-out

    return labelMinOpacity + (1 - labelMinOpacity) * eased;
  }

  /**
   * Calculate detail level based on distance
   */
  private calculateDetailLevel(distance: number): number {
    const { nodeDetailFadeStart, nodeDetailFadeEnd } = this.config.lod;

    if (distance <= nodeDetailFadeStart) {
      return 1;
    }

    if (distance >= nodeDetailFadeEnd) {
      return 0.2; // Minimum detail level
    }

    // Linear interpolation
    const t = (distance - nodeDetailFadeStart) / (nodeDetailFadeEnd - nodeDetailFadeStart);
    return 1 - t * 0.8; // Maps to 1.0 -> 0.2
  }

  /**
   * Batch calculate visibility for multiple nodes
   *
   * @param nodes - Array of nodes with id and position
   * @param getPosition - Function to get position for a node
   * @param getRadius - Optional function to get radius for a node
   * @returns Map of node ID to visibility state
   */
  calculateBatchVisibility<T extends { id: string }>(
    nodes: T[],
    getPosition: (node: T) => THREE.Vector3,
    getRadius?: (node: T) => number
  ): Map<string, NodeVisibility> {
    const results = new Map<string, NodeVisibility>();

    for (const node of nodes) {
      const position = getPosition(node);
      const radius = getRadius ? getRadius(node) : 10;
      results.set(node.id, this.calculateNodeVisibility(node.id, position, radius));
    }

    return results;
  }

  /**
   * Update FPS counter
   *
   * Call this once per frame
   */
  updateFPS(): void {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.frameTimeAccumulator += delta;
    this.frameCountForFps++;

    // Update FPS every second
    if (this.frameTimeAccumulator >= 1000) {
      this.currentFps = Math.round(
        (this.frameCountForFps * 1000) / this.frameTimeAccumulator
      );
      this.frameTimeAccumulator = 0;
      this.frameCountForFps = 0;
    }
  }

  /**
   * Get current performance statistics
   */
  getStats(): PerformanceStats {
    let totalNodes = 0;
    let visibleNodes = 0;
    let labelsVisible = 0;
    let totalDistance = 0;

    for (const visibility of this.visibilityCache.values()) {
      totalNodes++;
      if (visibility.inFrustum) {
        visibleNodes++;
        totalDistance += visibility.distanceToCamera;
      }
      if (visibility.labelVisible) {
        labelsVisible++;
      }
    }

    const averageDistance = visibleNodes > 0 ? totalDistance / visibleNodes : 0;
    const culledNodes = totalNodes - visibleNodes;
    const cullingEfficiency = totalNodes > 0 ? (culledNodes / totalNodes) * 100 : 0;

    return {
      fps: this.currentFps,
      totalNodes,
      visibleNodes,
      culledNodes,
      labelsVisible,
      averageDistance,
      cullingEfficiency,
    };
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.currentFps;
  }

  /**
   * Check if currently recovering from context loss
   */
  isInRecovery(): boolean {
    return this.isRecovering;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<PerformanceConfig>): void {
    if (config.lod) {
      this.config.lod = { ...this.config.lod, ...config.lod };
    }
    if (config.frustumCulling) {
      this.config.frustumCulling = { ...this.config.frustumCulling, ...config.frustumCulling };
    }
    if (config.webglRecovery) {
      this.config.webglRecovery = { ...this.config.webglRecovery, ...config.webglRecovery };
    }

    // Clear cache when config changes
    this.visibilityCache.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * Enable/disable LOD
   */
  setLODEnabled(enabled: boolean): void {
    this.config.lod.enabled = enabled;
    this.visibilityCache.clear();
  }

  /**
   * Enable/disable frustum culling
   */
  setFrustumCullingEnabled(enabled: boolean): void {
    this.config.frustumCulling.enabled = enabled;
    this.visibilityCache.clear();
  }

  /**
   * Clear visibility cache (call when camera or nodes change significantly)
   */
  clearCache(): void {
    this.visibilityCache.clear();
  }

  /**
   * Add event listener
   */
  on(eventType: PerformanceEventType, listener: PerformanceEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: PerformanceEventType, listener: PerformanceEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: PerformanceEventType, event: PerformanceEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in Graph3DPerformanceManager event listener:`, error);
        }
      }
    }
  }

  /**
   * Destroy the performance manager and cleanup
   */
  destroy(): void {
    // Remove WebGL context handlers
    if (this.renderer && this.contextLostHandler && this.contextRestoredHandler) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener("webglcontextlost", this.contextLostHandler);
      canvas.removeEventListener("webglcontextrestored", this.contextRestoredHandler);
    }

    // Hide recovery UI if visible
    this.hideRecoveryUI();

    // Clear all caches and references
    this.visibilityCache.clear();
    this.eventListeners.clear();
    this.camera = null;
    this.renderer = null;
    this.container = null;
    this.onRecoveryComplete = null;
    this.contextLostHandler = null;
    this.contextRestoredHandler = null;
  }
}

/**
 * Factory function to create Graph3DPerformanceManager
 */
export function createGraph3DPerformanceManager(
  config?: Partial<PerformanceConfig>
): Graph3DPerformanceManager {
  return new Graph3DPerformanceManager(config);
}
