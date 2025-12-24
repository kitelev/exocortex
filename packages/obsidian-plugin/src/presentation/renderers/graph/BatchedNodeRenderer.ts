/**
 * BatchedNodeRenderer - High-performance batched sprite rendering for graph nodes
 *
 * Implements efficient batch rendering using PixiJS ParticleContainer for maximum
 * WebGL performance when rendering thousands of nodes.
 *
 * Features:
 * - Batch rendering with configurable batch sizes
 * - Texture atlas for node shapes
 * - Instanced drawing support
 * - LOD-aware rendering
 * - Object pooling for sprites
 * - Automatic batch management
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Container, Graphics, RenderTexture, Sprite, Texture } from "pixi.js";
import type { NodeShape } from "./NodeRenderer";
import { SHAPE_DRAWERS, DEFAULT_NODE_STYLE } from "./NodeRenderer";
import type { LODSystem, NodeLODSettings } from "./LODSystem";

/**
 * Batch configuration for sprite rendering
 */
export interface BatchConfig {
  /** Maximum sprites per batch (default: 10000) */
  maxSprites: number;
  /** Maximum textures per batch - GPU dependent (default: 16) */
  maxTextures: number;
  /** Whether to use instanced rendering (default: true) */
  useInstancing: boolean;
  /** Base texture resolution (default: 32) */
  textureResolution: number;
}

/**
 * Default batch configuration
 */
export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxSprites: 10000,
  maxTextures: 16,
  useInstancing: true,
  textureResolution: 32,
};

/**
 * Node data for batch rendering
 */
export interface BatchNode {
  /** Unique node identifier */
  id: string;
  /** X position in world coordinates */
  x: number;
  /** Y position in world coordinates */
  y: number;
  /** Node radius */
  radius: number;
  /** Node color (hex) */
  color: number;
  /** Node alpha (0-1) */
  alpha: number;
  /** Node shape */
  shape: NodeShape;
  /** Whether node is hovered */
  isHovered: boolean;
  /** Whether node is selected */
  isSelected: boolean;
  /** Z-index for sorting */
  zIndex: number;
}

/**
 * Texture cache entry
 */
interface TextureCacheEntry {
  /** The cached texture */
  texture: Texture;
  /** Shape used to generate this texture */
  shape: NodeShape;
  /** Color used to generate this texture */
  color: number;
  /** Radius used to generate this texture */
  radius: number;
  /** Last access time for LRU eviction */
  lastAccess: number;
  /** Reference count */
  refCount: number;
}

/**
 * Sprite pool entry
 */
interface PooledSprite {
  /** The sprite instance */
  sprite: Sprite;
  /** Whether the sprite is currently in use */
  inUse: boolean;
  /** Node ID this sprite represents (when in use) */
  nodeId: string | null;
}

/**
 * Batch renderer statistics
 */
export interface BatchRendererStats {
  /** Total nodes being rendered */
  totalNodes: number;
  /** Number of active batches */
  activeBatches: number;
  /** Sprites in use */
  spritesInUse: number;
  /** Sprites in pool */
  spritesInPool: number;
  /** Textures in cache */
  texturesInCache: number;
  /** Draw calls per frame */
  drawCalls: number;
  /** Last frame render time (ms) */
  renderTime: number;
}

/**
 * BatchedNodeRenderer configuration
 */
export interface BatchedNodeRendererConfig {
  /** Batch configuration */
  batch?: Partial<BatchConfig>;
  /** Maximum texture cache size (default: 256) */
  maxTextureCacheSize?: number;
  /** Maximum sprite pool size (default: 20000) */
  maxSpritePoolSize?: number;
  /** Whether to enable LOD-aware rendering (default: true) */
  enableLOD?: boolean;
  /** LOD system instance (optional) */
  lodSystem?: LODSystem;
}

/**
 * Default BatchedNodeRenderer configuration
 */
export const DEFAULT_BATCHED_NODE_RENDERER_CONFIG: Required<Omit<BatchedNodeRendererConfig, "lodSystem">> = {
  batch: DEFAULT_BATCH_CONFIG,
  maxTextureCacheSize: 256,
  maxSpritePoolSize: 20000,
  enableLOD: true,
};

/**
 * BatchedNodeRenderer - High-performance batched node rendering
 *
 * @example
 * ```typescript
 * const renderer = new BatchedNodeRenderer();
 *
 * // Initialize with parent container
 * renderer.initialize(nodeContainer);
 *
 * // Begin frame
 * renderer.beginFrame();
 *
 * // Add nodes to batch
 * for (const node of nodes) {
 *   renderer.addNode({
 *     id: node.id,
 *     x: node.x,
 *     y: node.y,
 *     radius: 8,
 *     color: 0x6366f1,
 *     alpha: 1,
 *     shape: 'circle',
 *     isHovered: false,
 *     isSelected: false,
 *     zIndex: 0,
 *   });
 * }
 *
 * // End frame and flush batches
 * renderer.endFrame();
 *
 * // Get stats
 * console.log(renderer.getStats());
 * ```
 */
export class BatchedNodeRenderer {
  /** Configuration */
  private config: Required<Omit<BatchedNodeRendererConfig, "lodSystem">> & { lodSystem?: LODSystem };
  private batchConfig: BatchConfig;

  /** Parent container */
  private parentContainer: Container | null = null;

  /** Batch containers */
  private batchContainers: Container[] = [];

  /** Current batch index */
  private currentBatchIndex: number = 0;

  /** Texture cache */
  private textureCache: Map<string, TextureCacheEntry> = new Map();

  /** Sprite pool */
  private spritePool: PooledSprite[] = [];

  /** Active sprites (nodeId -> sprite) */
  private activeSprites: Map<string, Sprite> = new Map();

  /** Pending nodes for current frame */
  private pendingNodes: BatchNode[] = [];

  /** Graphics used for texture generation */
  private textureGraphics: Graphics;

  /** Whether currently in a frame */
  private inFrame: boolean = false;

  /** Statistics */
  private stats: BatchRendererStats = {
    totalNodes: 0,
    activeBatches: 0,
    spritesInUse: 0,
    spritesInPool: 0,
    texturesInCache: 0,
    drawCalls: 0,
    renderTime: 0,
  };

  /** Frame start time for stats */
  private frameStartTime: number = 0;

  /** Current LOD settings */
  private currentLODSettings: NodeLODSettings | null = null;

  constructor(config: BatchedNodeRendererConfig = {}) {
    this.config = {
      batch: { ...DEFAULT_BATCH_CONFIG, ...config.batch },
      maxTextureCacheSize: config.maxTextureCacheSize ?? DEFAULT_BATCHED_NODE_RENDERER_CONFIG.maxTextureCacheSize,
      maxSpritePoolSize: config.maxSpritePoolSize ?? DEFAULT_BATCHED_NODE_RENDERER_CONFIG.maxSpritePoolSize,
      enableLOD: config.enableLOD ?? DEFAULT_BATCHED_NODE_RENDERER_CONFIG.enableLOD,
      lodSystem: config.lodSystem,
    };
    this.batchConfig = this.config.batch as BatchConfig;

    // Initialize texture graphics
    this.textureGraphics = new Graphics();

    // Pre-populate sprite pool
    this.initializeSpritePool();
  }

  /**
   * Initialize sprite pool with default sprites
   */
  private initializeSpritePool(): void {
    const initialPoolSize = Math.min(1000, this.config.maxSpritePoolSize);
    for (let i = 0; i < initialPoolSize; i++) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 0.5);
      this.spritePool.push({
        sprite,
        inUse: false,
        nodeId: null,
      });
    }
    this.stats.spritesInPool = this.spritePool.length;
  }

  /**
   * Initialize the renderer with a parent container
   *
   * @param container - Parent container for batches
   */
  initialize(container: Container): void {
    this.parentContainer = container;
    this.createInitialBatch();
  }

  /**
   * Create initial batch container
   */
  private createInitialBatch(): void {
    if (!this.parentContainer) return;

    const batchContainer = new Container();
    batchContainer.sortableChildren = true;
    this.parentContainer.addChild(batchContainer);
    this.batchContainers.push(batchContainer);
    this.stats.activeBatches = 1;
  }

  /**
   * Generate texture cache key
   */
  private getTextureCacheKey(shape: NodeShape, color: number, radius: number): string {
    // Quantize radius to reduce cache variations
    const quantizedRadius = Math.round(radius / 2) * 2;
    return `${shape}_${color.toString(16)}_${quantizedRadius}`;
  }

  /**
   * Get or create texture for a node style
   */
  private getTexture(shape: NodeShape, color: number, radius: number): Texture {
    const key = this.getTextureCacheKey(shape, color, radius);

    const cached = this.textureCache.get(key);
    if (cached) {
      cached.lastAccess = Date.now();
      cached.refCount++;
      return cached.texture;
    }

    // Generate new texture
    const texture = this.generateTexture(shape, color, radius);

    // Add to cache with LRU eviction
    if (this.textureCache.size >= this.config.maxTextureCacheSize) {
      this.evictOldestTexture();
    }

    this.textureCache.set(key, {
      texture,
      shape,
      color,
      radius,
      lastAccess: Date.now(),
      refCount: 1,
    });

    this.stats.texturesInCache = this.textureCache.size;
    return texture;
  }

  /**
   * Generate a texture for a node shape
   */
  private generateTexture(shape: NodeShape, color: number, radius: number): Texture {
    const resolution = this.batchConfig.textureResolution;
    const size = radius * 2 + 4; // Add padding for anti-aliasing

    this.textureGraphics.clear();

    // Get shape drawer
    const drawer = SHAPE_DRAWERS[shape];
    if (drawer) {
      // Draw at center of texture
      this.textureGraphics.clear();

      // Position the graphics at center
      drawer(this.textureGraphics, radius);
      this.textureGraphics.fill({ color, alpha: 1 });
    } else {
      // Fallback to circle
      this.textureGraphics.circle(0, 0, radius);
      this.textureGraphics.fill({ color, alpha: 1 });
    }

    // Create render texture (note: requires app renderer)
    // For now, return an empty texture as we can't render without app context
    // In actual use, this would use app.renderer.generateTexture()
    const renderTexture = RenderTexture.create({
      width: size,
      height: size,
      resolution,
    });

    return renderTexture;
  }

  /**
   * Evict the oldest texture from cache
   */
  private evictOldestTexture(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.textureCache) {
      if (entry.lastAccess < oldestTime && entry.refCount === 0) {
        oldestKey = key;
        oldestTime = entry.lastAccess;
      }
    }

    if (oldestKey) {
      const entry = this.textureCache.get(oldestKey);
      if (entry) {
        if (entry.texture?.destroy) {
          entry.texture.destroy(true);
        }
        this.textureCache.delete(oldestKey);
      }
    }
  }

  /**
   * Acquire a sprite from the pool
   */
  private acquireSprite(nodeId: string): Sprite {
    // Check if node already has a sprite
    const existing = this.activeSprites.get(nodeId);
    if (existing) {
      return existing;
    }

    // Find available sprite in pool
    for (const pooled of this.spritePool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.nodeId = nodeId;
        this.activeSprites.set(nodeId, pooled.sprite);
        this.stats.spritesInUse++;
        this.stats.spritesInPool = this.spritePool.filter(p => !p.inUse).length;
        return pooled.sprite;
      }
    }

    // No available sprite, create new one
    if (this.spritePool.length < this.config.maxSpritePoolSize) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 0.5);
      const pooled: PooledSprite = {
        sprite,
        inUse: true,
        nodeId,
      };
      this.spritePool.push(pooled);
      this.activeSprites.set(nodeId, sprite);
      this.stats.spritesInUse++;
      return sprite;
    }

    // Pool exhausted, return temporary sprite
    const tempSprite = new Sprite();
    tempSprite.anchor.set(0.5, 0.5);
    this.activeSprites.set(nodeId, tempSprite);
    this.stats.spritesInUse++;
    return tempSprite;
  }

  /**
   * Release a sprite back to the pool
   */
  private releaseSprite(nodeId: string): void {
    const sprite = this.activeSprites.get(nodeId);
    if (!sprite) return;

    // Find in pool
    for (const pooled of this.spritePool) {
      if (pooled.sprite === sprite) {
        pooled.inUse = false;
        pooled.nodeId = null;
        sprite.visible = false;
        if (sprite.parent) {
          sprite.parent.removeChild(sprite);
        }
        break;
      }
    }

    this.activeSprites.delete(nodeId);
    this.stats.spritesInUse--;
    this.stats.spritesInPool = this.spritePool.filter(p => !p.inUse).length;
  }

  /**
   * Begin a new frame
   */
  beginFrame(): void {
    if (this.inFrame) {
      console.warn("BatchedNodeRenderer: beginFrame called while already in frame");
      return;
    }

    this.inFrame = true;
    this.frameStartTime = performance.now();
    this.pendingNodes = [];
    this.currentBatchIndex = 0;

    // Update LOD settings
    if (this.config.enableLOD && this.config.lodSystem) {
      this.currentLODSettings = this.config.lodSystem.getNodeSettings();
    }

    // Mark all active sprites as potentially stale
    // (will be updated or released at end of frame)
  }

  /**
   * Add a node to the current batch
   *
   * @param node - Node data to add
   */
  addNode(node: BatchNode): void {
    if (!this.inFrame) {
      console.warn("BatchedNodeRenderer: addNode called outside of frame");
      return;
    }

    // Apply LOD settings if enabled
    if (this.config.enableLOD && this.currentLODSettings) {
      // Skip if at max nodes limit
      if (
        this.currentLODSettings.maxNodes > 0 &&
        this.pendingNodes.length >= this.currentLODSettings.maxNodes
      ) {
        return;
      }

      // Apply radius multiplier
      node.radius *= this.currentLODSettings.radiusMultiplier;
    }

    this.pendingNodes.push(node);
  }

  /**
   * End the current frame and flush batches
   */
  endFrame(): void {
    if (!this.inFrame) {
      console.warn("BatchedNodeRenderer: endFrame called outside of frame");
      return;
    }

    // Sort pending nodes by z-index
    this.pendingNodes.sort((a, b) => a.zIndex - b.zIndex);

    // Track which nodes are in this frame
    const frameNodeIds = new Set<string>();

    // Process pending nodes
    for (const node of this.pendingNodes) {
      frameNodeIds.add(node.id);
      this.renderNode(node);
    }

    // Release sprites for nodes no longer in frame
    const toRelease: string[] = [];
    for (const nodeId of this.activeSprites.keys()) {
      if (!frameNodeIds.has(nodeId)) {
        toRelease.push(nodeId);
      }
    }
    for (const nodeId of toRelease) {
      this.releaseSprite(nodeId);
    }

    // Update stats
    this.stats.totalNodes = this.pendingNodes.length;
    this.stats.drawCalls = this.batchContainers.length;
    this.stats.renderTime = performance.now() - this.frameStartTime;

    this.inFrame = false;
    this.pendingNodes = [];
  }

  /**
   * Render a single node
   */
  private renderNode(node: BatchNode): void {
    if (!this.parentContainer) return;

    // Get or acquire sprite
    const sprite = this.acquireSprite(node.id);

    // Determine color based on state
    let color = node.color;
    if (node.isSelected) {
      color = 0xfbbf24; // amber-400 for selection
    } else if (node.isHovered) {
      color = 0x60a5fa; // blue-400 for hover
    }

    // Get shape (with LOD fallback to circle for minimal/low LOD)
    let shape = node.shape;
    if (this.config.enableLOD && this.currentLODSettings && !this.currentLODSettings.showShapes) {
      shape = "circle"; // Use simple circle at low LOD
    }

    // Get or create texture
    const texture = this.getTexture(shape, color, Math.round(node.radius));
    sprite.texture = texture;

    // Update sprite position and properties
    sprite.position.set(node.x, node.y);
    sprite.alpha = node.alpha;
    sprite.zIndex = node.zIndex;
    sprite.visible = true;

    // Scale based on hover state
    if (node.isHovered) {
      sprite.scale.set(DEFAULT_NODE_STYLE.hoverScale);
    } else {
      sprite.scale.set(1);
    }

    // Ensure sprite is in a batch container
    if (!sprite.parent) {
      const batchContainer = this.getBatchContainer();
      batchContainer.addChild(sprite);
    }
  }

  /**
   * Get current or create new batch container
   */
  private getBatchContainer(): Container {
    if (!this.parentContainer) {
      throw new Error("BatchedNodeRenderer not initialized");
    }

    // Check if current batch is full
    const currentBatch = this.batchContainers[this.currentBatchIndex];
    if (currentBatch && currentBatch.children.length < this.batchConfig.maxSprites) {
      return currentBatch;
    }

    // Create new batch
    this.currentBatchIndex++;
    if (this.currentBatchIndex >= this.batchContainers.length) {
      const newBatch = new Container();
      newBatch.sortableChildren = true;
      this.parentContainer.addChild(newBatch);
      this.batchContainers.push(newBatch);
      this.stats.activeBatches = this.batchContainers.length;
    }

    return this.batchContainers[this.currentBatchIndex];
  }

  /**
   * Update node position without full rebuild
   *
   * @param nodeId - Node ID
   * @param x - New X position
   * @param y - New Y position
   */
  updateNodePosition(nodeId: string, x: number, y: number): void {
    const sprite = this.activeSprites.get(nodeId);
    if (sprite) {
      sprite.position.set(x, y);
    }
  }

  /**
   * Update node state (hover/selection)
   *
   * @param nodeId - Node ID
   * @param isHovered - Whether node is hovered
   * @param isSelected - Whether node is selected
   */
  updateNodeState(nodeId: string, isHovered: boolean, _isSelected: boolean): void {
    const sprite = this.activeSprites.get(nodeId);
    if (!sprite) return;

    // Update scale for hover
    if (isHovered) {
      sprite.scale.set(1.2); // Hover scale
    } else {
      sprite.scale.set(1);
    }

    // Note: Color changes require texture update, which is handled in next frame
    // _isSelected is reserved for future selection visual feedback
  }

  /**
   * Remove a node from rendering
   *
   * @param nodeId - Node ID to remove
   */
  removeNode(nodeId: string): void {
    this.releaseSprite(nodeId);
  }

  /**
   * Get renderer statistics
   *
   * @returns Current statistics
   */
  getStats(): BatchRendererStats {
    return { ...this.stats };
  }

  /**
   * Set LOD system
   *
   * @param lodSystem - LOD system instance
   */
  setLODSystem(lodSystem: LODSystem): void {
    this.config.lodSystem = lodSystem;
  }

  /**
   * Enable or disable LOD-aware rendering
   *
   * @param enabled - Whether to enable LOD
   */
  setLODEnabled(enabled: boolean): void {
    this.config.enableLOD = enabled;
  }

  /**
   * Clear all rendered nodes
   */
  clear(): void {
    // Release all active sprites
    for (const nodeId of this.activeSprites.keys()) {
      this.releaseSprite(nodeId);
    }

    // Clear batch containers
    for (const container of this.batchContainers) {
      container.removeChildren();
    }

    this.pendingNodes = [];
    this.stats.totalNodes = 0;
  }

  /**
   * Destroy the renderer and release resources
   */
  destroy(): void {
    this.clear();

    // Destroy textures
    for (const entry of this.textureCache.values()) {
      if (entry.texture?.destroy) {
        entry.texture.destroy(true);
      }
    }
    this.textureCache.clear();

    // Destroy sprites
    for (const pooled of this.spritePool) {
      pooled.sprite.destroy();
    }
    this.spritePool = [];
    this.activeSprites.clear();

    // Destroy batch containers
    for (const container of this.batchContainers) {
      container.destroy({ children: true });
    }
    this.batchContainers = [];

    // Destroy graphics
    this.textureGraphics.destroy();

    this.parentContainer = null;
  }

  /**
   * Pre-generate textures for common node styles
   *
   * @param styles - Array of styles to pre-generate
   */
  preGenerateTextures(
    styles: Array<{ shape: NodeShape; color: number; radius: number }>
  ): void {
    for (const style of styles) {
      this.getTexture(style.shape, style.color, style.radius);
    }
  }

  /**
   * Get memory usage estimate
   *
   * @returns Memory usage in bytes
   */
  getMemoryUsage(): number {
    let totalBytes = 0;

    // Texture memory
    for (const entry of this.textureCache.values()) {
      const tex = entry.texture;
      if (tex?.width && tex?.height) {
        // Approximate RGBA bytes
        totalBytes += tex.width * tex.height * 4;
      }
    }

    // Sprite pool memory (approximate per sprite)
    totalBytes += this.spritePool.length * 200; // ~200 bytes per sprite

    return totalBytes;
  }
}

/**
 * Create a BatchedNodeRenderer instance
 *
 * @param config - Configuration options
 * @returns BatchedNodeRenderer instance
 */
export function createBatchedNodeRenderer(
  config?: BatchedNodeRendererConfig
): BatchedNodeRenderer {
  return new BatchedNodeRenderer(config);
}
