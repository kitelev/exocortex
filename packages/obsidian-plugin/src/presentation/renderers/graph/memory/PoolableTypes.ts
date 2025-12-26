/**
 * PoolableTypes - Specialized poolable object implementations
 *
 * Provides concrete implementations of frequently-created objects optimized
 * for graph rendering: render batches, event objects, and computation buffers.
 *
 * @module presentation/renderers/graph/memory
 * @since 1.0.0
 */

import type { Poolable } from "./ObjectPool";

/**
 * Base class for poolable objects with common functionality
 */
export abstract class BasePoolable implements Poolable {
  protected _inUse: boolean = false;
  protected _createdAt: number = Date.now();
  protected _lastUsedAt: number = 0;
  protected _useCount: number = 0;

  abstract reset(): void;

  isInUse(): boolean {
    return this._inUse;
  }

  setInUse(inUse: boolean): void {
    this._inUse = inUse;
    if (inUse) {
      this._lastUsedAt = Date.now();
      this._useCount++;
    }
  }

  /** Get creation timestamp */
  getCreatedAt(): number {
    return this._createdAt;
  }

  /** Get last usage timestamp */
  getLastUsedAt(): number {
    return this._lastUsedAt;
  }

  /** Get total use count */
  getUseCount(): number {
    return this._useCount;
  }
}

/**
 * Node position data for render batches
 */
export interface NodePosition {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
  zIndex: number;
}

/**
 * Edge position data for render batches
 */
export interface EdgePosition {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color: number;
  alpha: number;
  width: number;
}

/**
 * RenderBatch - Poolable container for batched rendering data
 *
 * Holds arrays of node and edge positions for efficient batch rendering.
 * Reused across frames to minimize allocation overhead.
 *
 * @example
 * ```typescript
 * const batch = renderBatchPool.acquire();
 *
 * batch.addNode({
 *   id: 'node-1',
 *   x: 100, y: 100,
 *   radius: 8,
 *   color: 0x6366f1,
 *   alpha: 1,
 *   zIndex: 0
 * });
 *
 * // Process batch...
 *
 * renderBatchPool.release(batch);
 * ```
 */
export class RenderBatch extends BasePoolable {
  /** Node positions in this batch */
  private nodes: NodePosition[] = [];

  /** Edge positions in this batch */
  private edges: EdgePosition[] = [];

  /** Batch capacity for nodes */
  private nodeCapacity: number;

  /** Batch capacity for edges */
  private edgeCapacity: number;

  /** Batch ID for tracking */
  private batchId: string;

  /** Frame number this batch was created for */
  private frameNumber: number = 0;

  /** Whether batch has been modified */
  private dirty: boolean = false;

  constructor(nodeCapacity: number = 1000, edgeCapacity: number = 2000) {
    super();
    this.nodeCapacity = nodeCapacity;
    this.edgeCapacity = edgeCapacity;
    this.batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  reset(): void {
    this.nodes.length = 0;
    this.edges.length = 0;
    this.frameNumber = 0;
    this.dirty = false;
  }

  /** Add a node to the batch */
  addNode(node: NodePosition): boolean {
    if (this.nodes.length >= this.nodeCapacity) {
      return false;
    }
    this.nodes.push(node);
    this.dirty = true;
    return true;
  }

  /** Add multiple nodes to the batch */
  addNodes(nodes: NodePosition[]): number {
    let added = 0;
    for (const node of nodes) {
      if (this.addNode(node)) {
        added++;
      } else {
        break;
      }
    }
    return added;
  }

  /** Add an edge to the batch */
  addEdge(edge: EdgePosition): boolean {
    if (this.edges.length >= this.edgeCapacity) {
      return false;
    }
    this.edges.push(edge);
    this.dirty = true;
    return true;
  }

  /** Add multiple edges to the batch */
  addEdges(edges: EdgePosition[]): number {
    let added = 0;
    for (const edge of edges) {
      if (this.addEdge(edge)) {
        added++;
      } else {
        break;
      }
    }
    return added;
  }

  /** Get all nodes in batch */
  getNodes(): readonly NodePosition[] {
    return this.nodes;
  }

  /** Get all edges in batch */
  getEdges(): readonly EdgePosition[] {
    return this.edges;
  }

  /** Get node count */
  getNodeCount(): number {
    return this.nodes.length;
  }

  /** Get edge count */
  getEdgeCount(): number {
    return this.edges.length;
  }

  /** Check if batch has capacity for more nodes */
  hasNodeCapacity(): boolean {
    return this.nodes.length < this.nodeCapacity;
  }

  /** Check if batch has capacity for more edges */
  hasEdgeCapacity(): boolean {
    return this.edges.length < this.edgeCapacity;
  }

  /** Get remaining node capacity */
  getRemainingNodeCapacity(): number {
    return this.nodeCapacity - this.nodes.length;
  }

  /** Get remaining edge capacity */
  getRemainingEdgeCapacity(): number {
    return this.edgeCapacity - this.edges.length;
  }

  /** Set frame number */
  setFrameNumber(frame: number): void {
    this.frameNumber = frame;
  }

  /** Get frame number */
  getFrameNumber(): number {
    return this.frameNumber;
  }

  /** Get batch ID */
  getBatchId(): string {
    return this.batchId;
  }

  /** Check if batch is dirty (modified since last clean) */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Mark batch as clean */
  markClean(): void {
    this.dirty = false;
  }

  /** Check if batch is empty */
  isEmpty(): boolean {
    return this.nodes.length === 0 && this.edges.length === 0;
  }
}

/**
 * Event types for poolable event objects
 */
export type PoolableEventType =
  | "nodeClick"
  | "nodeHover"
  | "nodeDoubleClick"
  | "edgeClick"
  | "edgeHover"
  | "canvasClick"
  | "canvasDrag"
  | "canvasZoom"
  | "selectionChange"
  | "custom";

/**
 * EventObject - Poolable event container for graph interactions
 *
 * Encapsulates event data for node, edge, and canvas interactions.
 * Pooled to avoid creating new objects for high-frequency events.
 *
 * @example
 * ```typescript
 * const event = eventPool.acquire();
 *
 * event.setType('nodeClick');
 * event.setTargetId('node-1');
 * event.setPosition(100, 100);
 * event.setTimestamp(performance.now());
 *
 * // Handle event...
 *
 * eventPool.release(event);
 * ```
 */
export class EventObject extends BasePoolable {
  /** Event type */
  private type: PoolableEventType = "custom";

  /** Target element ID (node or edge) */
  private targetId: string = "";

  /** Event position X */
  private x: number = 0;

  /** Event position Y */
  private y: number = 0;

  /** World-space position X */
  private worldX: number = 0;

  /** World-space position Y */
  private worldY: number = 0;

  /** Event timestamp */
  private timestamp: number = 0;

  /** Whether shift key was pressed */
  private shiftKey: boolean = false;

  /** Whether ctrl/cmd key was pressed */
  private ctrlKey: boolean = false;

  /** Whether alt key was pressed */
  private altKey: boolean = false;

  /** Mouse button (0=left, 1=middle, 2=right) */
  private button: number = 0;

  /** Delta X for drag/zoom events */
  private deltaX: number = 0;

  /** Delta Y for drag/zoom events */
  private deltaY: number = 0;

  /** Zoom scale for zoom events */
  private scale: number = 1;

  /** Custom data */
  private data: Record<string, unknown> = {};

  /** Whether event was consumed/handled */
  private consumed: boolean = false;

  reset(): void {
    this.type = "custom";
    this.targetId = "";
    this.x = 0;
    this.y = 0;
    this.worldX = 0;
    this.worldY = 0;
    this.timestamp = 0;
    this.shiftKey = false;
    this.ctrlKey = false;
    this.altKey = false;
    this.button = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.scale = 1;
    this.data = {};
    this.consumed = false;
  }

  // Setters with chaining
  setType(type: PoolableEventType): this {
    this.type = type;
    return this;
  }

  setTargetId(id: string): this {
    this.targetId = id;
    return this;
  }

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setWorldPosition(x: number, y: number): this {
    this.worldX = x;
    this.worldY = y;
    return this;
  }

  setTimestamp(timestamp: number): this {
    this.timestamp = timestamp;
    return this;
  }

  setModifiers(shift: boolean, ctrl: boolean, alt: boolean): this {
    this.shiftKey = shift;
    this.ctrlKey = ctrl;
    this.altKey = alt;
    return this;
  }

  setButton(button: number): this {
    this.button = button;
    return this;
  }

  setDelta(deltaX: number, deltaY: number): this {
    this.deltaX = deltaX;
    this.deltaY = deltaY;
    return this;
  }

  setScale(scale: number): this {
    this.scale = scale;
    return this;
  }

  setData(key: string, value: unknown): this {
    this.data[key] = value;
    return this;
  }

  consume(): void {
    this.consumed = true;
  }

  // Getters
  getType(): PoolableEventType {
    return this.type;
  }

  getTargetId(): string {
    return this.targetId;
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  getWorldX(): number {
    return this.worldX;
  }

  getWorldY(): number {
    return this.worldY;
  }

  getTimestamp(): number {
    return this.timestamp;
  }

  isShiftKey(): boolean {
    return this.shiftKey;
  }

  isCtrlKey(): boolean {
    return this.ctrlKey;
  }

  isAltKey(): boolean {
    return this.altKey;
  }

  getButton(): number {
    return this.button;
  }

  getDeltaX(): number {
    return this.deltaX;
  }

  getDeltaY(): number {
    return this.deltaY;
  }

  getScale(): number {
    return this.scale;
  }

  getData<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  isConsumed(): boolean {
    return this.consumed;
  }

  /** Initialize from a DOM event */
  initFromMouseEvent(event: MouseEvent, type: PoolableEventType): this {
    this.type = type;
    this.x = event.clientX;
    this.y = event.clientY;
    this.timestamp = event.timeStamp;
    this.shiftKey = event.shiftKey;
    this.ctrlKey = event.ctrlKey || event.metaKey;
    this.altKey = event.altKey;
    this.button = event.button;
    return this;
  }

  /** Initialize from a wheel event */
  initFromWheelEvent(event: WheelEvent): this {
    this.type = "canvasZoom";
    this.x = event.clientX;
    this.y = event.clientY;
    this.timestamp = event.timeStamp;
    this.deltaX = event.deltaX;
    this.deltaY = event.deltaY;
    this.shiftKey = event.shiftKey;
    this.ctrlKey = event.ctrlKey || event.metaKey;
    this.altKey = event.altKey;
    return this;
  }
}

/**
 * Buffer types for computation buffers
 */
export type BufferType = "float32" | "float64" | "int32" | "uint32" | "uint8";

/**
 * ComputationBuffer - Poolable typed array buffer for numerical computations
 *
 * Provides reusable typed array buffers for force calculations, position updates,
 * and other numerical operations during graph simulation.
 *
 * @example
 * ```typescript
 * const buffer = computationBufferPool.acquire();
 *
 * buffer.resize(nodeCount * 2); // x,y pairs
 * const positions = buffer.getFloat32Array();
 *
 * // Compute positions...
 *
 * computationBufferPool.release(buffer);
 * ```
 */
export class ComputationBuffer extends BasePoolable {
  /** Internal buffer */
  private buffer: ArrayBuffer;

  /** Current buffer type */
  private bufferType: BufferType = "float32";

  /** Float32 view */
  private float32View: Float32Array | null = null;

  /** Float64 view */
  private float64View: Float64Array | null = null;

  /** Int32 view */
  private int32View: Int32Array | null = null;

  /** Uint32 view */
  private uint32View: Uint32Array | null = null;

  /** Uint8 view */
  private uint8View: Uint8Array | null = null;

  /** Current logical size (number of elements) */
  private size: number = 0;

  /** Maximum capacity in bytes */
  private maxCapacity: number;

  constructor(initialCapacity: number = 4096, maxCapacity: number = 4 * 1024 * 1024) {
    super();
    this.maxCapacity = maxCapacity;
    this.buffer = new ArrayBuffer(initialCapacity);
    this.createViews();
  }

  reset(): void {
    this.size = 0;
    this.bufferType = "float32";
    // Zero out the buffer for security
    new Uint8Array(this.buffer).fill(0);
  }

  /** Create typed array views for the buffer */
  private createViews(): void {
    this.float32View = new Float32Array(this.buffer);
    this.float64View = new Float64Array(this.buffer);
    this.int32View = new Int32Array(this.buffer);
    this.uint32View = new Uint32Array(this.buffer);
    this.uint8View = new Uint8Array(this.buffer);
  }

  /**
   * Resize buffer to accommodate at least 'count' elements of current type
   *
   * @param count - Number of elements needed
   * @returns True if resize was successful
   */
  resize(count: number): boolean {
    const bytesPerElement = this.getBytesPerElement();
    const requiredBytes = count * bytesPerElement;

    if (requiredBytes > this.maxCapacity) {
      return false;
    }

    if (requiredBytes > this.buffer.byteLength) {
      // Grow buffer (double until large enough)
      let newSize = this.buffer.byteLength;
      while (newSize < requiredBytes) {
        newSize *= 2;
      }
      newSize = Math.min(newSize, this.maxCapacity);

      this.buffer = new ArrayBuffer(newSize);
      this.createViews();
    }

    this.size = count;
    return true;
  }

  /** Get bytes per element for current buffer type */
  private getBytesPerElement(): number {
    switch (this.bufferType) {
      case "float32":
      case "int32":
      case "uint32":
        return 4;
      case "float64":
        return 8;
      case "uint8":
        return 1;
      default:
        return 4;
    }
  }

  /** Set buffer type */
  setBufferType(type: BufferType): void {
    this.bufferType = type;
  }

  /** Get buffer type */
  getBufferType(): BufferType {
    return this.bufferType;
  }

  /** Get current size in elements */
  getSize(): number {
    return this.size;
  }

  /** Get capacity in elements for current type */
  getCapacity(): number {
    return Math.floor(this.buffer.byteLength / this.getBytesPerElement());
  }

  /** Get buffer byte length */
  getByteLength(): number {
    return this.buffer.byteLength;
  }

  /** Get Float32Array view */
  getFloat32Array(): Float32Array {
    this.bufferType = "float32";
    return this.float32View!;
  }

  /** Get Float64Array view */
  getFloat64Array(): Float64Array {
    this.bufferType = "float64";
    return this.float64View!;
  }

  /** Get Int32Array view */
  getInt32Array(): Int32Array {
    this.bufferType = "int32";
    return this.int32View!;
  }

  /** Get Uint32Array view */
  getUint32Array(): Uint32Array {
    this.bufferType = "uint32";
    return this.uint32View!;
  }

  /** Get Uint8Array view */
  getUint8Array(): Uint8Array {
    this.bufferType = "uint8";
    return this.uint8View!;
  }

  /** Get raw ArrayBuffer */
  getRawBuffer(): ArrayBuffer {
    return this.buffer;
  }

  /** Copy data from another buffer */
  copyFrom(source: ComputationBuffer): void {
    const sourceView = new Uint8Array(source.buffer);

    if (sourceView.byteLength > this.buffer.byteLength) {
      this.resize(Math.ceil(sourceView.byteLength / this.getBytesPerElement()));
    }

    // Create new view after potential resize (buffer may have changed)
    const targetView = new Uint8Array(this.buffer);
    targetView.set(sourceView);
    this.size = source.size;
    this.bufferType = source.bufferType;
  }

  /** Fill buffer with a value */
  fill(value: number, start: number = 0, end?: number): void {
    switch (this.bufferType) {
      case "float32":
        this.float32View!.fill(value, start, end ?? this.size);
        break;
      case "float64":
        this.float64View!.fill(value, start, end ?? this.size);
        break;
      case "int32":
        this.int32View!.fill(value, start, end ?? this.size);
        break;
      case "uint32":
        this.uint32View!.fill(value, start, end ?? this.size);
        break;
      case "uint8":
        this.uint8View!.fill(value, start, end ?? this.size);
        break;
    }
  }
}

/**
 * PoolableVector2D - Poolable 2D vector for position/velocity calculations
 */
export class PoolableVector2D extends BasePoolable {
  x: number = 0;
  y: number = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  add(other: PoolableVector2D): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  subtract(other: PoolableVector2D): this {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }

  multiply(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  divide(scalar: number): this {
    if (scalar !== 0) {
      this.x /= scalar;
      this.y /= scalar;
    }
    return this;
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): this {
    const mag = this.magnitude();
    if (mag > 0) {
      this.divide(mag);
    }
    return this;
  }

  distance(other: PoolableVector2D): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceSquared(other: PoolableVector2D): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return dx * dx + dy * dy;
  }

  dot(other: PoolableVector2D): number {
    return this.x * other.x + this.y * other.y;
  }

  clone(): PoolableVector2D {
    const clone = new PoolableVector2D();
    clone.x = this.x;
    clone.y = this.y;
    return clone;
  }

  copyFrom(other: PoolableVector2D): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }
}

/**
 * PoolableRect - Poolable rectangle for bounds calculations
 */
export class PoolableRect extends BasePoolable {
  x: number = 0;
  y: number = 0;
  width: number = 0;
  height: number = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
  }

  set(x: number, y: number, width: number, height: number): this {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    return this;
  }

  setFromBounds(minX: number, minY: number, maxX: number, maxY: number): this {
    this.x = minX;
    this.y = minY;
    this.width = maxX - minX;
    this.height = maxY - minY;
    return this;
  }

  get left(): number {
    return this.x;
  }

  get right(): number {
    return this.x + this.width;
  }

  get top(): number {
    return this.y;
  }

  get bottom(): number {
    return this.y + this.height;
  }

  get centerX(): number {
    return this.x + this.width / 2;
  }

  get centerY(): number {
    return this.y + this.height / 2;
  }

  containsPoint(px: number, py: number): boolean {
    return px >= this.x && px <= this.right && py >= this.y && py <= this.bottom;
  }

  intersects(other: PoolableRect): boolean {
    return !(
      other.x > this.right ||
      other.right < this.x ||
      other.y > this.bottom ||
      other.bottom < this.y
    );
  }

  expand(padding: number): this {
    this.x -= padding;
    this.y -= padding;
    this.width += padding * 2;
    this.height += padding * 2;
    return this;
  }

  union(other: PoolableRect): this {
    const minX = Math.min(this.x, other.x);
    const minY = Math.min(this.y, other.y);
    const maxX = Math.max(this.right, other.right);
    const maxY = Math.max(this.bottom, other.bottom);

    this.x = minX;
    this.y = minY;
    this.width = maxX - minX;
    this.height = maxY - minY;
    return this;
  }

  copyFrom(other: PoolableRect): this {
    this.x = other.x;
    this.y = other.y;
    this.width = other.width;
    this.height = other.height;
    return this;
  }
}
