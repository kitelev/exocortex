/**
 * GPUMemoryManager - GPU memory management for graph rendering
 *
 * Manages GPU memory allocation, tracking, and cleanup for textures, buffers,
 * and other WebGL resources used in graph rendering.
 *
 * Features:
 * - Memory budget management
 * - LRU eviction for texture cache
 * - Memory pressure detection
 * - Resource lifecycle tracking
 * - Memory usage statistics
 * - Automatic garbage collection triggers
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Texture, RenderTexture } from "pixi.js";

/**
 * Resource types tracked by the memory manager
 */
export type ResourceType = "texture" | "renderTexture" | "buffer" | "geometry";

/**
 * Resource entry in the memory manager
 */
export interface ManagedResource {
  /** Unique identifier for the resource */
  id: string;
  /** Type of resource */
  type: ResourceType;
  /** Size in bytes (estimated) */
  size: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  lastAccessedAt: number;
  /** Reference count */
  refCount: number;
  /** Whether resource is pinned (cannot be evicted) */
  pinned: boolean;
  /** Priority level (higher = less likely to be evicted) */
  priority: number;
  /** The actual resource reference */
  resource: Texture | RenderTexture | WebGLBuffer | unknown;
  /** Cleanup callback */
  cleanup?: () => void;
}

/**
 * Memory usage snapshot
 */
export interface MemoryUsage {
  /** Total allocated memory in bytes */
  totalAllocated: number;
  /** Memory used by textures */
  textureMemory: number;
  /** Memory used by render textures */
  renderTextureMemory: number;
  /** Memory used by buffers */
  bufferMemory: number;
  /** Memory used by geometry */
  geometryMemory: number;
  /** Number of resources */
  resourceCount: number;
  /** Memory budget in bytes */
  budget: number;
  /** Usage percentage */
  usagePercent: number;
}

/**
 * Memory pressure levels
 */
export enum MemoryPressure {
  /** Normal operation */
  NORMAL = "normal",
  /** Approaching budget limit */
  LOW = "low",
  /** At or near budget limit */
  HIGH = "high",
  /** Over budget, emergency cleanup needed */
  CRITICAL = "critical",
}

/**
 * Memory event types
 */
export type MemoryEventType =
  | "resourceAllocated"
  | "resourceReleased"
  | "pressureChange"
  | "eviction"
  | "budgetExceeded";

/**
 * Memory event
 */
export interface MemoryEvent {
  /** Event type */
  type: MemoryEventType;
  /** Resource ID (for resource events) */
  resourceId?: string;
  /** Resource type (for resource events) */
  resourceType?: ResourceType;
  /** Size in bytes */
  size?: number;
  /** Previous pressure level */
  previousPressure?: MemoryPressure;
  /** New pressure level */
  newPressure?: MemoryPressure;
  /** Current memory usage */
  usage: MemoryUsage;
}

/**
 * Memory event listener
 */
export type MemoryEventListener = (event: MemoryEvent) => void;

/**
 * GPU Memory Manager configuration
 */
export interface GPUMemoryManagerConfig {
  /** Memory budget in bytes (default: 256MB) */
  budget?: number;
  /** Low pressure threshold (default: 0.6 = 60%) */
  lowPressureThreshold?: number;
  /** High pressure threshold (default: 0.8 = 80%) */
  highPressureThreshold?: number;
  /** Critical pressure threshold (default: 0.95 = 95%) */
  criticalPressureThreshold?: number;
  /** Enable automatic eviction when over budget (default: true) */
  autoEviction?: boolean;
  /** Eviction batch size (default: 10) */
  evictionBatchSize?: number;
  /** LRU eviction time threshold in ms (default: 30000 = 30 seconds) */
  lruTimeThreshold?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_GPU_MEMORY_MANAGER_CONFIG: Required<GPUMemoryManagerConfig> = {
  budget: 256 * 1024 * 1024, // 256MB
  lowPressureThreshold: 0.6,
  highPressureThreshold: 0.8,
  criticalPressureThreshold: 0.95,
  autoEviction: true,
  evictionBatchSize: 10,
  lruTimeThreshold: 30000,
};

/**
 * GPU Memory Manager statistics
 */
export interface GPUMemoryStats {
  /** Total allocations since creation */
  totalAllocations: number;
  /** Total deallocations since creation */
  totalDeallocations: number;
  /** Total bytes allocated since creation */
  totalBytesAllocated: number;
  /** Total bytes freed since creation */
  totalBytesFreed: number;
  /** Number of evictions triggered */
  evictionCount: number;
  /** Bytes evicted */
  bytesEvicted: number;
  /** Peak memory usage */
  peakMemoryUsage: number;
  /** Current pressure level */
  pressureLevel: MemoryPressure;
}

/**
 * GPUMemoryManager - Manages GPU memory for graph rendering
 *
 * @example
 * ```typescript
 * const memoryManager = new GPUMemoryManager({
 *   budget: 128 * 1024 * 1024, // 128MB
 * });
 *
 * // Register a texture
 * const textureId = memoryManager.register({
 *   id: 'node-texture-1',
 *   type: 'texture',
 *   size: 64 * 64 * 4, // 64x64 RGBA
 *   resource: myTexture,
 * });
 *
 * // Access resource (updates LRU timestamp)
 * memoryManager.access(textureId);
 *
 * // Check memory pressure
 * if (memoryManager.getPressure() === MemoryPressure.HIGH) {
 *   console.log('Memory pressure high, reducing quality');
 * }
 *
 * // Get memory usage
 * const usage = memoryManager.getUsage();
 * console.log(`Using ${usage.usagePercent}% of budget`);
 *
 * // Release resource
 * memoryManager.release(textureId);
 * ```
 */
export class GPUMemoryManager {
  /** Configuration */
  private config: Required<GPUMemoryManagerConfig>;

  /** Managed resources */
  private resources: Map<string, ManagedResource> = new Map();

  /** Event listeners */
  private listeners: Set<MemoryEventListener> = new Set();

  /** Current memory usage by type */
  private memoryByType: Map<ResourceType, number> = new Map([
    ["texture", 0],
    ["renderTexture", 0],
    ["buffer", 0],
    ["geometry", 0],
  ]);

  /** Total allocated memory */
  private totalAllocated: number = 0;

  /** Current pressure level */
  private pressureLevel: MemoryPressure = MemoryPressure.NORMAL;

  /** Statistics */
  private stats: GPUMemoryStats = {
    totalAllocations: 0,
    totalDeallocations: 0,
    totalBytesAllocated: 0,
    totalBytesFreed: 0,
    evictionCount: 0,
    bytesEvicted: 0,
    peakMemoryUsage: 0,
    pressureLevel: MemoryPressure.NORMAL,
  };

  constructor(config: GPUMemoryManagerConfig = {}) {
    this.config = { ...DEFAULT_GPU_MEMORY_MANAGER_CONFIG, ...config };
  }

  /**
   * Register a resource with the memory manager
   *
   * @param params - Resource registration parameters
   * @returns Resource ID
   */
  register(params: {
    id: string;
    type: ResourceType;
    size: number;
    resource: Texture | RenderTexture | WebGLBuffer | unknown;
    priority?: number;
    pinned?: boolean;
    cleanup?: () => void;
  }): string {
    const now = Date.now();

    const managedResource: ManagedResource = {
      id: params.id,
      type: params.type,
      size: params.size,
      createdAt: now,
      lastAccessedAt: now,
      refCount: 1,
      pinned: params.pinned ?? false,
      priority: params.priority ?? 0,
      resource: params.resource,
      cleanup: params.cleanup,
    };

    this.resources.set(params.id, managedResource);

    // Update memory tracking
    this.totalAllocated += params.size;
    const currentTypeMemory = this.memoryByType.get(params.type) ?? 0;
    this.memoryByType.set(params.type, currentTypeMemory + params.size);

    // Update stats
    this.stats.totalAllocations++;
    this.stats.totalBytesAllocated += params.size;
    if (this.totalAllocated > this.stats.peakMemoryUsage) {
      this.stats.peakMemoryUsage = this.totalAllocated;
    }

    // Check and update pressure
    this.updatePressure();

    // Emit event
    this.emitEvent({
      type: "resourceAllocated",
      resourceId: params.id,
      resourceType: params.type,
      size: params.size,
      usage: this.getUsage(),
    });

    // Auto-evict if over budget
    if (this.config.autoEviction && this.pressureLevel === MemoryPressure.CRITICAL) {
      this.evictLRU(this.config.evictionBatchSize);
    }

    return params.id;
  }

  /**
   * Access a resource (updates LRU timestamp)
   *
   * @param id - Resource ID
   * @returns True if resource exists
   */
  access(id: string): boolean {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    resource.lastAccessedAt = Date.now();
    return true;
  }

  /**
   * Increment reference count for a resource
   *
   * @param id - Resource ID
   * @returns New reference count or -1 if not found
   */
  addRef(id: string): number {
    const resource = this.resources.get(id);
    if (!resource) {
      return -1;
    }

    resource.refCount++;
    resource.lastAccessedAt = Date.now();
    return resource.refCount;
  }

  /**
   * Decrement reference count for a resource
   *
   * @param id - Resource ID
   * @returns New reference count or -1 if not found
   */
  removeRef(id: string): number {
    const resource = this.resources.get(id);
    if (!resource) {
      return -1;
    }

    resource.refCount = Math.max(0, resource.refCount - 1);
    return resource.refCount;
  }

  /**
   * Release a resource
   *
   * @param id - Resource ID
   * @param force - Force release even if refCount > 0
   * @returns True if released
   */
  release(id: string, force: boolean = false): boolean {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    // Check reference count
    if (resource.refCount > 1 && !force) {
      resource.refCount--;
      return false;
    }

    // Cleanup resource
    if (resource.cleanup) {
      try {
        resource.cleanup();
      } catch (error) {
        console.error(`Error cleaning up resource ${id}:`, error);
      }
    }

    // Update memory tracking
    this.totalAllocated -= resource.size;
    const currentTypeMemory = this.memoryByType.get(resource.type) ?? 0;
    this.memoryByType.set(resource.type, Math.max(0, currentTypeMemory - resource.size));

    // Update stats
    this.stats.totalDeallocations++;
    this.stats.totalBytesFreed += resource.size;

    // Remove from map
    this.resources.delete(id);

    // Update pressure
    this.updatePressure();

    // Emit event
    this.emitEvent({
      type: "resourceReleased",
      resourceId: id,
      resourceType: resource.type,
      size: resource.size,
      usage: this.getUsage(),
    });

    return true;
  }

  /**
   * Pin a resource to prevent eviction
   *
   * @param id - Resource ID
   * @returns True if pinned successfully
   */
  pin(id: string): boolean {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    resource.pinned = true;
    return true;
  }

  /**
   * Unpin a resource
   *
   * @param id - Resource ID
   * @returns True if unpinned successfully
   */
  unpin(id: string): boolean {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    resource.pinned = false;
    return true;
  }

  /**
   * Get a resource by ID
   *
   * @param id - Resource ID
   * @returns Resource or undefined
   */
  get(id: string): ManagedResource | undefined {
    return this.resources.get(id);
  }

  /**
   * Check if a resource exists
   *
   * @param id - Resource ID
   * @returns True if exists
   */
  has(id: string): boolean {
    return this.resources.has(id);
  }

  /**
   * Get current memory usage
   *
   * @returns Memory usage snapshot
   */
  getUsage(): MemoryUsage {
    return {
      totalAllocated: this.totalAllocated,
      textureMemory: this.memoryByType.get("texture") ?? 0,
      renderTextureMemory: this.memoryByType.get("renderTexture") ?? 0,
      bufferMemory: this.memoryByType.get("buffer") ?? 0,
      geometryMemory: this.memoryByType.get("geometry") ?? 0,
      resourceCount: this.resources.size,
      budget: this.config.budget,
      usagePercent: (this.totalAllocated / this.config.budget) * 100,
    };
  }

  /**
   * Get current memory pressure level
   *
   * @returns Memory pressure level
   */
  getPressure(): MemoryPressure {
    return this.pressureLevel;
  }

  /**
   * Update memory pressure level
   */
  private updatePressure(): void {
    const usageRatio = this.totalAllocated / this.config.budget;
    let newPressure: MemoryPressure;

    if (usageRatio >= this.config.criticalPressureThreshold) {
      newPressure = MemoryPressure.CRITICAL;
    } else if (usageRatio >= this.config.highPressureThreshold) {
      newPressure = MemoryPressure.HIGH;
    } else if (usageRatio >= this.config.lowPressureThreshold) {
      newPressure = MemoryPressure.LOW;
    } else {
      newPressure = MemoryPressure.NORMAL;
    }

    if (newPressure !== this.pressureLevel) {
      const previousPressure = this.pressureLevel;
      this.pressureLevel = newPressure;
      this.stats.pressureLevel = newPressure;

      this.emitEvent({
        type: "pressureChange",
        previousPressure,
        newPressure,
        usage: this.getUsage(),
      });
    }
  }

  /**
   * Evict resources using LRU strategy
   *
   * @param count - Maximum number of resources to evict
   * @returns Number of resources evicted
   */
  evictLRU(count: number = this.config.evictionBatchSize): number {
    const now = Date.now();
    const candidates: ManagedResource[] = [];

    // Collect eviction candidates
    for (const resource of this.resources.values()) {
      // Skip pinned resources
      if (resource.pinned) continue;

      // Skip resources with active references
      if (resource.refCount > 0) continue;

      // Skip recently accessed resources
      if (now - resource.lastAccessedAt < this.config.lruTimeThreshold) continue;

      candidates.push(resource);
    }

    // Sort by priority (ascending) then by last access time (ascending)
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.lastAccessedAt - b.lastAccessedAt;
    });

    // Evict up to count resources
    let evicted = 0;
    let bytesEvicted = 0;

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const resource = candidates[i];
      if (this.release(resource.id, true)) {
        evicted++;
        bytesEvicted += resource.size;
      }
    }

    if (evicted > 0) {
      this.stats.evictionCount++;
      this.stats.bytesEvicted += bytesEvicted;

      this.emitEvent({
        type: "eviction",
        size: bytesEvicted,
        usage: this.getUsage(),
      });
    }

    return evicted;
  }

  /**
   * Evict all evictable resources
   *
   * @returns Number of resources evicted
   */
  evictAll(): number {
    return this.evictLRU(this.resources.size);
  }

  /**
   * Force garbage collection of unreferenced resources
   *
   * @returns Number of resources collected
   */
  collectGarbage(): number {
    let collected = 0;

    for (const resource of this.resources.values()) {
      if (resource.refCount === 0 && !resource.pinned) {
        if (this.release(resource.id, true)) {
          collected++;
        }
      }
    }

    return collected;
  }

  /**
   * Set memory budget
   *
   * @param budget - New budget in bytes
   */
  setBudget(budget: number): void {
    this.config.budget = budget;
    this.updatePressure();

    // Auto-evict if now over budget
    if (this.config.autoEviction && this.pressureLevel === MemoryPressure.CRITICAL) {
      this.evictLRU(this.config.evictionBatchSize);
    }
  }

  /**
   * Add an event listener
   *
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  addEventListener(listener: MemoryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove an event listener
   *
   * @param listener - Callback function
   */
  removeEventListener(listener: MemoryEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit a memory event
   */
  private emitEvent(event: MemoryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Memory event listener error:", error);
      }
    }
  }

  /**
   * Get memory manager statistics
   *
   * @returns Current statistics
   */
  getStats(): GPUMemoryStats {
    return { ...this.stats };
  }

  /**
   * Get all resources of a specific type
   *
   * @param type - Resource type
   * @returns Array of resources
   */
  getResourcesByType(type: ResourceType): ManagedResource[] {
    return Array.from(this.resources.values()).filter((r) => r.type === type);
  }

  /**
   * Get resource count by type
   *
   * @returns Map of type to count
   */
  getResourceCounts(): Map<ResourceType, number> {
    const counts = new Map<ResourceType, number>();

    for (const resource of this.resources.values()) {
      const current = counts.get(resource.type) ?? 0;
      counts.set(resource.type, current + 1);
    }

    return counts;
  }

  /**
   * Clear all resources
   *
   * @param force - Force clear even pinned resources
   */
  clear(force: boolean = false): void {
    const toRelease = Array.from(this.resources.keys());

    for (const id of toRelease) {
      const resource = this.resources.get(id);
      if (resource && (!resource.pinned || force)) {
        this.release(id, true);
      }
    }
  }

  /**
   * Destroy the memory manager
   */
  destroy(): void {
    this.clear(true);
    this.listeners.clear();
  }

  /**
   * Get estimated texture size
   *
   * @param width - Texture width
   * @param height - Texture height
   * @param format - Pixel format (default: RGBA = 4 bytes)
   * @returns Estimated size in bytes
   */
  static estimateTextureSize(
    width: number,
    height: number,
    format: number = 4
  ): number {
    return width * height * format;
  }

  /**
   * Get estimated buffer size
   *
   * @param vertexCount - Number of vertices
   * @param attributeSize - Bytes per vertex
   * @returns Estimated size in bytes
   */
  static estimateBufferSize(vertexCount: number, attributeSize: number): number {
    return vertexCount * attributeSize;
  }

  /**
   * Format bytes as human-readable string
   *
   * @param bytes - Number of bytes
   * @returns Human-readable string
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * Create a GPUMemoryManager instance
 *
 * @param config - Configuration options
 * @returns GPUMemoryManager instance
 */
export function createGPUMemoryManager(
  config?: GPUMemoryManagerConfig
): GPUMemoryManager {
  return new GPUMemoryManager(config);
}

/**
 * Singleton instance for global memory management
 */
let globalMemoryManager: GPUMemoryManager | null = null;

/**
 * Get or create the global memory manager
 *
 * @param config - Configuration options (only used on first call)
 * @returns Global GPUMemoryManager instance
 */
export function getGlobalMemoryManager(
  config?: GPUMemoryManagerConfig
): GPUMemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new GPUMemoryManager(config);
  }
  return globalMemoryManager;
}

/**
 * Reset the global memory manager (for testing)
 */
export function resetGlobalMemoryManager(): void {
  if (globalMemoryManager) {
    globalMemoryManager.destroy();
    globalMemoryManager = null;
  }
}
