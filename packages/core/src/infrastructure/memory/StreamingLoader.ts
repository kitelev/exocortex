/**
 * StreamingLoader - Incremental Graph Data Loading
 *
 * Provides streaming/chunked loading of large graph datasets
 * to prevent UI blocking and enable progressive rendering.
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

import { CompactGraphStore } from "./CompactGraphStore";
import type {
  GraphChunk,
  ChunkNode,
  ChunkEdge,
  StreamingProgressEvent,
  StreamingProgressCallback,
} from "./types";

/**
 * Configuration for streaming loader
 */
export interface StreamingLoaderConfig {
  /** Chunk size (number of nodes per chunk) */
  chunkSize?: number;
  /** Delay between chunks for UI responsiveness (ms) */
  chunkDelay?: number;
  /** Enable automatic edge resolution after all nodes are loaded */
  autoResolveEdges?: boolean;
  /** Maximum concurrent chunk processing */
  maxConcurrency?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<StreamingLoaderConfig> = {
  chunkSize: 1000,
  chunkDelay: 0,
  autoResolveEdges: true,
  maxConcurrency: 1,
};

/**
 * Streaming loader state
 */
export type LoaderState =
  | "idle"
  | "loading"
  | "paused"
  | "completed"
  | "error";

/**
 * StreamingLoader class for incremental graph data loading.
 */
export class StreamingLoader {
  private config: Required<StreamingLoaderConfig>;
  private store: CompactGraphStore;
  private state: LoaderState = "idle";

  /** Pending edges that couldn't be added (nodes not yet loaded) */
  private pendingEdges: ChunkEdge[] = [];

  /** Progress tracking */
  private nodesLoaded = 0;
  private edgesLoaded = 0;
  private chunksProcessed = 0;
  private totalChunks: number | undefined;

  /** Callbacks */
  private progressCallbacks: StreamingProgressCallback[] = [];

  /** Abort controller for cancellation */
  private abortController: AbortController | null = null;

  constructor(store: CompactGraphStore, config?: StreamingLoaderConfig) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current loader state.
   */
  public getState(): LoaderState {
    return this.state;
  }

  /**
   * Get current progress.
   */
  public getProgress(): StreamingProgressEvent {
    const progress =
      this.totalChunks !== undefined && this.totalChunks > 0
        ? this.chunksProcessed / this.totalChunks
        : 0;

    return {
      currentChunk: this.chunksProcessed,
      totalChunks: this.totalChunks,
      nodesLoaded: this.nodesLoaded,
      edgesLoaded: this.edgesLoaded,
      progress,
      isComplete: this.state === "completed",
    };
  }

  /**
   * Subscribe to progress updates.
   *
   * @param callback - Progress callback
   * @returns Unsubscribe function
   */
  public onProgress(callback: StreamingProgressCallback): () => void {
    this.progressCallbacks.push(callback);
    return () => {
      const index = this.progressCallbacks.indexOf(callback);
      if (index >= 0) {
        this.progressCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify progress callbacks.
   */
  private notifyProgress(): void {
    const event = this.getProgress();
    for (const callback of this.progressCallbacks) {
      callback(event);
    }
  }

  /**
   * Load a single chunk.
   *
   * @param chunk - The chunk to load
   */
  public loadChunk(chunk: GraphChunk): void {
    if (this.state === "error") {
      throw new Error("Loader is in error state");
    }

    this.state = "loading";

    if (chunk.totalChunks !== undefined) {
      this.totalChunks = chunk.totalChunks;
    }

    // Add nodes
    for (const node of chunk.nodes) {
      this.store.addNode(node);
      this.nodesLoaded++;
    }

    // Try to add edges (some may be pending if target nodes aren't loaded yet)
    for (const edge of chunk.edges) {
      const index = this.store.addEdge(edge);
      if (index >= 0) {
        this.edgesLoaded++;
      } else {
        this.pendingEdges.push(edge);
      }
    }

    this.chunksProcessed++;

    // Check if this is the last chunk
    if (chunk.isLast) {
      this.finishLoading();
    }

    this.notifyProgress();
  }

  /**
   * Finish loading - resolve pending edges.
   */
  private finishLoading(): void {
    if (this.config.autoResolveEdges && this.pendingEdges.length > 0) {
      // Retry adding pending edges
      for (const edge of this.pendingEdges) {
        const index = this.store.addEdge(edge);
        if (index >= 0) {
          this.edgesLoaded++;
        }
      }
      this.pendingEdges = [];
    }

    this.state = "completed";
    this.notifyProgress();
  }

  /**
   * Load from an async iterator (for streaming from server).
   *
   * @param chunks - Async iterator of chunks
   * @returns Promise that resolves when loading is complete
   */
  public async loadFromIterator(
    chunks: AsyncIterable<GraphChunk>
  ): Promise<void> {
    this.reset();
    this.state = "loading";
    this.abortController = new AbortController();

    try {
      for await (const chunk of chunks) {
        if (this.abortController.signal.aborted) {
          this.state = "paused";
          return;
        }

        this.loadChunk(chunk);

        // Yield to UI if delay is configured
        if (this.config.chunkDelay > 0) {
          await this.delay(this.config.chunkDelay);
        }
      }

      // Ensure loading is finished if not already completed by last chunk
      const currentState = this.state as LoaderState;
      if (currentState !== "completed") {
        this.finishLoading();
      }
    } catch (error) {
      this.state = "error";
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Load from an array of nodes and edges.
   * Automatically chunks the data.
   *
   * @param nodes - All nodes to load
   * @param edges - All edges to load
   * @returns Promise that resolves when loading is complete
   */
  public async loadFromArrays(
    nodes: ChunkNode[],
    edges: ChunkEdge[]
  ): Promise<void> {
    const chunks = this.createChunks(nodes, edges);
    await this.loadFromIterator(this.arrayToAsyncIterator(chunks));
  }

  /**
   * Create chunks from nodes and edges.
   */
  private createChunks(nodes: ChunkNode[], edges: ChunkEdge[]): GraphChunk[] {
    const chunks: GraphChunk[] = [];
    const { chunkSize } = this.config;
    const totalChunks = Math.ceil(nodes.length / chunkSize);

    // Distribute edges to chunks based on their source node
    const edgesBySourceChunk: ChunkEdge[][] = Array(totalChunks)
      .fill(null)
      .map(() => []);

    for (const edge of edges) {
      // Find which chunk the source node is in
      const sourceIndex = nodes.findIndex((n) => n.id === edge.sourceId);
      if (sourceIndex >= 0) {
        const chunkIndex = Math.floor(sourceIndex / chunkSize);
        edgesBySourceChunk[chunkIndex].push(edge);
      }
    }

    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, nodes.length);

      chunks.push({
        chunkIndex: i,
        totalChunks,
        nodes: nodes.slice(startIndex, endIndex),
        edges: edgesBySourceChunk[i],
        isLast: i === totalChunks - 1,
      });
    }

    return chunks;
  }

  /**
   * Convert array to async iterator.
   */
  private async *arrayToAsyncIterator<T>(array: T[]): AsyncIterable<T> {
    for (const item of array) {
      yield item;
    }
  }

  /**
   * Delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel loading.
   */
  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state = "paused";
  }

  /**
   * Reset loader state.
   */
  public reset(): void {
    this.state = "idle";
    this.pendingEdges = [];
    this.nodesLoaded = 0;
    this.edgesLoaded = 0;
    this.chunksProcessed = 0;
    this.totalChunks = undefined;
    this.abortController = null;
  }

  /**
   * Get the number of pending edges.
   */
  public getPendingEdgeCount(): number {
    return this.pendingEdges.length;
  }

  /**
   * Get statistics about the loading process.
   */
  public getStats(): {
    state: LoaderState;
    nodesLoaded: number;
    edgesLoaded: number;
    chunksProcessed: number;
    totalChunks: number | undefined;
    pendingEdges: number;
    storeStats: ReturnType<CompactGraphStore["getMemoryStats"]>;
  } {
    return {
      state: this.state,
      nodesLoaded: this.nodesLoaded,
      edgesLoaded: this.edgesLoaded,
      chunksProcessed: this.chunksProcessed,
      totalChunks: this.totalChunks,
      pendingEdges: this.pendingEdges.length,
      storeStats: this.store.getMemoryStats(),
    };
  }
}

/**
 * Create a streaming loader generator from a source.
 *
 * @param source - Data source (can be a URL, file, etc.)
 * @param fetchFn - Function to fetch chunk data
 * @yields GraphChunk objects
 */
export async function* createStreamingSource(
  source: string,
  fetchFn: (
    source: string,
    offset: number,
    limit: number
  ) => Promise<{
    nodes: ChunkNode[];
    edges: ChunkEdge[];
    hasMore: boolean;
    totalCount?: number;
  }>,
  chunkSize = 1000
): AsyncGenerator<GraphChunk> {
  let offset = 0;
  let chunkIndex = 0;
  let totalChunks: number | undefined;

  while (true) {
    const result = await fetchFn(source, offset, chunkSize);

    if (result.totalCount !== undefined && totalChunks === undefined) {
      totalChunks = Math.ceil(result.totalCount / chunkSize);
    }

    yield {
      chunkIndex,
      totalChunks,
      nodes: result.nodes,
      edges: result.edges,
      isLast: !result.hasMore,
    };

    if (!result.hasMore) {
      break;
    }

    offset += chunkSize;
    chunkIndex++;
  }
}
