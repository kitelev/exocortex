/**
 * CommunityDetection - Louvain algorithm for detecting communities in graphs
 *
 * Implements the Louvain method for community detection, which optimizes
 * modularity through a greedy local search followed by aggregation.
 *
 * Features:
 * - O(n log n) time complexity for most real-world graphs
 * - Hierarchical community structure discovery
 * - Configurable resolution parameter
 * - Weighted edge support
 * - Plugin integration with LayoutPlugin architecture
 *
 * References:
 * - Blondel et al. (2008) "Fast unfolding of communities in large networks"
 * - https://en.wikipedia.org/wiki/Louvain_method
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData } from "./types";
import type {
  LayoutPluginMetadata,
  LayoutOptionDefinition,
  LayoutPlugin,
  ExtendedLayoutResult,
} from "./LayoutPlugin";
import { BaseLayoutAlgorithm, createLayoutFactory } from "./LayoutPlugin";
import type { Point } from "./LayoutManager";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Community assignment for a node
 */
export interface CommunityAssignment {
  /** Node ID */
  nodeId: string;

  /** Community ID (0-indexed) */
  communityId: number;

  /** Confidence score (0-1) */
  confidence?: number;

  /** Hierarchy level where this assignment was made */
  level?: number;
}

/**
 * Community metadata
 */
export interface Community {
  /** Community ID (0-indexed) */
  id: number;

  /** Number of nodes in community */
  size: number;

  /** Node IDs in this community */
  members: string[];

  /** Internal edges (weight sum) */
  internalWeight: number;

  /** Total degree (weight sum of all incident edges) */
  totalDegree: number;

  /** Color for visualization */
  color?: string;

  /** Label for the community */
  label?: string;
}

/**
 * Result of community detection
 */
export interface CommunityDetectionResult {
  /** Community assignments for each node */
  assignments: Map<string, CommunityAssignment>;

  /** Community metadata */
  communities: Community[];

  /** Modularity score (-0.5 to 1.0, higher is better) */
  modularity: number;

  /** Number of iterations performed */
  iterations: number;

  /** Time taken in milliseconds */
  computeTime: number;

  /** Hierarchy levels discovered */
  levels: number;
}

/**
 * Options for community detection
 */
export interface CommunityDetectionOptions {
  /** Resolution parameter (higher = smaller communities) @default 1.0 */
  resolution?: number;

  /** Maximum iterations per level @default 10 */
  maxIterations?: number;

  /** Minimum modularity improvement to continue @default 0.0001 */
  minModularityGain?: number;

  /** Whether to use weighted edges @default true */
  useWeights?: boolean;

  /** Default weight for unweighted edges @default 1.0 */
  defaultWeight?: number;

  /** Random seed for reproducibility @default undefined */
  randomSeed?: number;

  /** Whether to randomize node order @default true */
  randomizeOrder?: boolean;
}

/**
 * Default community detection options
 */
export const DEFAULT_COMMUNITY_OPTIONS: Required<CommunityDetectionOptions> = {
  resolution: 1.0,
  maxIterations: 10,
  minModularityGain: 0.0001,
  useWeights: true,
  defaultWeight: 1.0,
  randomSeed: 42,
  randomizeOrder: true,
};

/**
 * Predefined color palettes for community visualization
 */
export const COMMUNITY_COLOR_PALETTES = {
  /** Categorical palette (up to 10 distinct colors) */
  categorical: [
    "#1f77b4", // blue
    "#ff7f0e", // orange
    "#2ca02c", // green
    "#d62728", // red
    "#9467bd", // purple
    "#8c564b", // brown
    "#e377c2", // pink
    "#7f7f7f", // gray
    "#bcbd22", // olive
    "#17becf", // cyan
  ],

  /** Pastel palette (softer colors) */
  pastel: [
    "#aec7e8",
    "#ffbb78",
    "#98df8a",
    "#ff9896",
    "#c5b0d5",
    "#c49c94",
    "#f7b6d2",
    "#c7c7c7",
    "#dbdb8d",
    "#9edae5",
  ],

  /** Vibrant palette (high contrast) */
  vibrant: [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#984ea3",
    "#ff7f00",
    "#ffff33",
    "#a65628",
    "#f781bf",
    "#999999",
    "#66c2a5",
  ],

  /** Nature-inspired palette */
  nature: [
    "#4e79a7",
    "#59a14f",
    "#9c755f",
    "#f28e2b",
    "#edc948",
    "#e15759",
    "#b07aa1",
    "#76b7b2",
    "#ff9da7",
    "#bab0ac",
  ],
};

// ============================================================
// Louvain Algorithm Implementation
// ============================================================

/**
 * Internal graph representation optimized for Louvain algorithm
 */
interface LouvainGraph {
  /** Node IDs */
  nodes: string[];

  /** Node index lookup */
  nodeIndex: Map<string, number>;

  /** Adjacency matrix (sparse representation) */
  adjacency: Map<number, Map<number, number>>;

  /** Total weight of all edges (sum of 2*w for undirected) */
  totalWeight: number;

  /** Node degrees (weighted) */
  degrees: number[];

  /** Community assignments (node index -> community index) */
  communities: number[];

  /** Community total degrees */
  communityDegrees: Map<number, number>;

  /** Community internal weights */
  communityInternalWeights: Map<number, number>;
}

/**
 * Seeded random number generator for reproducibility
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number = Date.now()) {
    this.seed = seed;
  }

  /** Get next random number in [0, 1) */
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x80000000;
  }

  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

/**
 * Build internal graph representation from GraphData
 */
function buildLouvainGraph(
  graph: GraphData,
  options: Required<CommunityDetectionOptions>
): LouvainGraph {
  const nodes = graph.nodes.map((n) => n.id);
  const nodeIndex = new Map<string, number>();
  nodes.forEach((id, idx) => nodeIndex.set(id, idx));

  const adjacency = new Map<number, Map<number, number>>();
  const degrees: number[] = new Array(nodes.length).fill(0);

  // Initialize adjacency lists
  for (let i = 0; i < nodes.length; i++) {
    adjacency.set(i, new Map());
  }

  // Build undirected weighted graph
  let totalWeight = 0;
  for (const edge of graph.edges) {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourceIdx = nodeIndex.get(sourceId);
    const targetIdx = nodeIndex.get(targetId);

    if (sourceIdx === undefined || targetIdx === undefined) continue;

    const weight = options.useWeights
      ? (edge.weight ?? options.defaultWeight)
      : options.defaultWeight;

    // Add edge in both directions (undirected)
    const sourceAdj = adjacency.get(sourceIdx)!;
    const targetAdj = adjacency.get(targetIdx)!;

    sourceAdj.set(targetIdx, (sourceAdj.get(targetIdx) ?? 0) + weight);
    targetAdj.set(sourceIdx, (targetAdj.get(sourceIdx) ?? 0) + weight);

    degrees[sourceIdx] += weight;
    degrees[targetIdx] += weight;
    totalWeight += 2 * weight; // Each edge counted twice in undirected graph
  }

  // Initialize: each node in its own community
  const communities = nodes.map((_, i) => i);
  const communityDegrees = new Map<number, number>();
  const communityInternalWeights = new Map<number, number>();

  degrees.forEach((d, i) => {
    communityDegrees.set(i, d);
    communityInternalWeights.set(i, 0);
  });

  return {
    nodes,
    nodeIndex,
    adjacency,
    totalWeight,
    degrees,
    communities,
    communityDegrees,
    communityInternalWeights,
  };
}

/**
 * Calculate modularity of current partition
 */
function calculateModularity(
  graph: LouvainGraph,
  resolution: number
): number {
  if (graph.totalWeight === 0) return 0;

  let q = 0;
  const m2 = graph.totalWeight; // 2m

  for (let i = 0; i < graph.nodes.length; i++) {
    const neighbors = graph.adjacency.get(i)!;
    const comm_i = graph.communities[i];
    const k_i = graph.degrees[i];

    for (const [j, w_ij] of neighbors) {
      if (j >= i) continue; // Only count each edge once

      const comm_j = graph.communities[j];
      if (comm_i !== comm_j) continue;

      const k_j = graph.degrees[j];
      q += 2 * (w_ij - (resolution * k_i * k_j) / m2);
    }
  }

  return q / m2;
}

/**
 * Calculate modularity gain for moving node to a community
 */
function modularityGain(
  graph: LouvainGraph,
  nodeIdx: number,
  newCommunity: number,
  resolution: number
): number {
  const m2 = graph.totalWeight;
  if (m2 === 0) return 0;

  const k_i = graph.degrees[nodeIdx];
  const currentCommunity = graph.communities[nodeIdx];

  if (currentCommunity === newCommunity) return 0;

  // Calculate sum of weights to new community
  let k_i_in = 0;
  const neighbors = graph.adjacency.get(nodeIdx)!;
  for (const [neighbor, weight] of neighbors) {
    if (graph.communities[neighbor] === newCommunity) {
      k_i_in += weight;
    }
  }

  const sigma_tot = graph.communityDegrees.get(newCommunity) ?? 0;

  // Modularity gain formula
  return k_i_in - (resolution * sigma_tot * k_i) / m2;
}

/**
 * Move node to best community
 * @returns true if node was moved
 */
function moveNodeToBestCommunity(
  graph: LouvainGraph,
  nodeIdx: number,
  resolution: number
): boolean {
  const currentCommunity = graph.communities[nodeIdx];
  let bestCommunity = currentCommunity;
  let bestGain = 0;

  // First, remove node from current community
  const k_i = graph.degrees[nodeIdx];
  const neighbors = graph.adjacency.get(nodeIdx)!;

  // Calculate weight to current community
  let k_i_currentComm = 0;
  for (const [neighbor, weight] of neighbors) {
    if (graph.communities[neighbor] === currentCommunity && neighbor !== nodeIdx) {
      k_i_currentComm += weight;
    }
  }

  // Temporarily remove node from community
  graph.communityDegrees.set(
    currentCommunity,
    (graph.communityDegrees.get(currentCommunity) ?? 0) - k_i
  );
  graph.communityInternalWeights.set(
    currentCommunity,
    (graph.communityInternalWeights.get(currentCommunity) ?? 0) - k_i_currentComm
  );

  // Consider all neighboring communities
  const neighboringCommunities = new Set<number>();
  for (const [neighbor] of neighbors) {
    neighboringCommunities.add(graph.communities[neighbor]);
  }
  neighboringCommunities.add(currentCommunity); // Can stay in current

  for (const community of neighboringCommunities) {
    const gain = modularityGain(graph, nodeIdx, community, resolution);
    if (gain > bestGain) {
      bestGain = gain;
      bestCommunity = community;
    }
  }

  // Move to best community
  graph.communities[nodeIdx] = bestCommunity;

  // Calculate weight to new community
  let k_i_newComm = 0;
  for (const [neighbor, weight] of neighbors) {
    if (graph.communities[neighbor] === bestCommunity && neighbor !== nodeIdx) {
      k_i_newComm += weight;
    }
  }

  // Update community totals
  graph.communityDegrees.set(
    bestCommunity,
    (graph.communityDegrees.get(bestCommunity) ?? 0) + k_i
  );
  graph.communityInternalWeights.set(
    bestCommunity,
    (graph.communityInternalWeights.get(bestCommunity) ?? 0) + k_i_newComm
  );

  return bestCommunity !== currentCommunity;
}

/**
 * First phase of Louvain: local moving
 */
function louvainFirstPhase(
  graph: LouvainGraph,
  options: Required<CommunityDetectionOptions>,
  rng: SeededRandom
): number {
  let improvement = true;
  let iterCount = 0;
  let totalMoves = 0;

  while (improvement && iterCount < options.maxIterations) {
    improvement = false;
    iterCount++;

    // Get node order (randomized for better convergence)
    const nodeOrder = [...Array(graph.nodes.length).keys()];
    if (options.randomizeOrder) {
      rng.shuffle(nodeOrder);
    }

    for (const nodeIdx of nodeOrder) {
      if (moveNodeToBestCommunity(graph, nodeIdx, options.resolution)) {
        improvement = true;
        totalMoves++;
      }
    }
  }

  return totalMoves;
}

/**
 * Second phase of Louvain: aggregate communities into super-nodes
 */
function louvainSecondPhase(
  graph: LouvainGraph
): LouvainGraph | null {
  // Build community-to-nodes mapping
  const communityNodes = new Map<number, number[]>();
  for (let i = 0; i < graph.communities.length; i++) {
    const comm = graph.communities[i];
    if (!communityNodes.has(comm)) {
      communityNodes.set(comm, []);
    }
    communityNodes.get(comm)!.push(i);
  }

  // If only one community or each node in its own community, done
  const numCommunities = communityNodes.size;
  if (numCommunities === 1 || numCommunities === graph.nodes.length) {
    return null;
  }

  // Create mapping from old community ID to new node index
  const communities = [...communityNodes.keys()];
  const communityToNewIdx = new Map<number, number>();
  communities.forEach((comm, idx) => communityToNewIdx.set(comm, idx));

  // Build aggregated graph
  const newNodes = communities.map((comm) => `community_${comm}`);
  const newAdjacency = new Map<number, Map<number, number>>();
  const newDegrees = new Array(numCommunities).fill(0);

  for (let i = 0; i < numCommunities; i++) {
    newAdjacency.set(i, new Map());
  }

  // Aggregate edges
  for (let i = 0; i < graph.nodes.length; i++) {
    const comm_i = graph.communities[i];
    const newIdx_i = communityToNewIdx.get(comm_i)!;
    const neighbors = graph.adjacency.get(i)!;

    for (const [j, weight] of neighbors) {
      if (j < i) continue; // Only process each edge once

      const comm_j = graph.communities[j];
      const newIdx_j = communityToNewIdx.get(comm_j)!;

      if (newIdx_i === newIdx_j) {
        // Internal edge (becomes self-loop weight)
        const adj = newAdjacency.get(newIdx_i)!;
        adj.set(newIdx_i, (adj.get(newIdx_i) ?? 0) + 2 * weight);
        newDegrees[newIdx_i] += 2 * weight;
      } else {
        // External edge
        const adj_i = newAdjacency.get(newIdx_i)!;
        const adj_j = newAdjacency.get(newIdx_j)!;
        adj_i.set(newIdx_j, (adj_i.get(newIdx_j) ?? 0) + weight);
        adj_j.set(newIdx_i, (adj_j.get(newIdx_i) ?? 0) + weight);
        newDegrees[newIdx_i] += weight;
        newDegrees[newIdx_j] += weight;
      }
    }
  }

  // New graph starts with each super-node in its own community
  const newCommunities = newNodes.map((_, i) => i);
  const newCommunityDegrees = new Map<number, number>();
  const newCommunityInternalWeights = new Map<number, number>();

  for (let i = 0; i < numCommunities; i++) {
    newCommunityDegrees.set(i, newDegrees[i]);
    // Self-loop weight is internal weight
    const selfLoop = newAdjacency.get(i)?.get(i) ?? 0;
    newCommunityInternalWeights.set(i, selfLoop);
  }

  return {
    nodes: newNodes,
    nodeIndex: new Map(newNodes.map((n, i) => [n, i])),
    adjacency: newAdjacency,
    totalWeight: graph.totalWeight,
    degrees: newDegrees,
    communities: newCommunities,
    communityDegrees: newCommunityDegrees,
    communityInternalWeights: newCommunityInternalWeights,
  };
}

/**
 * Run the Louvain algorithm
 */
export function detectCommunities(
  graph: GraphData,
  options: Partial<CommunityDetectionOptions> = {}
): CommunityDetectionResult {
  const startTime = performance.now();
  const opts: Required<CommunityDetectionOptions> = {
    ...DEFAULT_COMMUNITY_OPTIONS,
    ...options,
  };

  // Handle empty graph
  if (graph.nodes.length === 0) {
    return {
      assignments: new Map(),
      communities: [],
      modularity: 0,
      iterations: 0,
      computeTime: performance.now() - startTime,
      levels: 0,
    };
  }

  // Handle single-node graph
  if (graph.nodes.length === 1) {
    const nodeId = graph.nodes[0].id;
    return {
      assignments: new Map([[nodeId, { nodeId, communityId: 0, confidence: 1, level: 0 }]]),
      communities: [{
        id: 0,
        size: 1,
        members: [nodeId],
        internalWeight: 0,
        totalDegree: 0,
      }],
      modularity: 0,
      iterations: 1,
      computeTime: performance.now() - startTime,
      levels: 1,
    };
  }

  const rng = new SeededRandom(opts.randomSeed);

  // Build initial graph
  let louvainGraph = buildLouvainGraph(graph, opts);

  // Track community assignments at each level
  const levelAssignments: Map<string, number>[] = [];
  let totalIterations = 0;
  let level = 0;
  let improved = true;

  // Keep reference to original node indices
  let nodeMapping: number[][] = louvainGraph.nodes.map((_, i) => [i]);

  while (improved) {
    // Phase 1: Local moving
    const moves = louvainFirstPhase(louvainGraph, opts, rng);
    totalIterations++;

    // Algorithm continues if there were moves
    improved = moves > 0;

    // Save assignments at this level
    const assignments = new Map<string, number>();
    for (let i = 0; i < louvainGraph.communities.length; i++) {
      // Map back to original nodes
      for (const origIdx of nodeMapping[i]) {
        assignments.set(graph.nodes[origIdx].id, louvainGraph.communities[i]);
      }
    }
    levelAssignments.push(assignments);

    // Phase 2: Aggregate
    const aggregatedGraph = louvainSecondPhase(louvainGraph);
    if (!aggregatedGraph) {
      break;
    }

    // Update node mapping for next level
    const communityNodes = new Map<number, number[]>();
    for (let i = 0; i < louvainGraph.communities.length; i++) {
      const comm = louvainGraph.communities[i];
      if (!communityNodes.has(comm)) {
        communityNodes.set(comm, []);
      }
      // Add all original nodes that were in this super-node
      communityNodes.get(comm)!.push(...nodeMapping[i]);
    }

    // Create new mapping
    const communities = [...communityNodes.keys()];
    nodeMapping = communities.map((comm) => communityNodes.get(comm)!);

    louvainGraph = aggregatedGraph;
    level++;
  }

  // Use final level assignments
  const finalAssignments = levelAssignments[levelAssignments.length - 1] || new Map();

  // Renumber communities to be contiguous 0..n-1
  const communityRenumber = new Map<number, number>();
  let nextCommunityId = 0;
  for (const comm of finalAssignments.values()) {
    if (!communityRenumber.has(comm)) {
      communityRenumber.set(comm, nextCommunityId++);
    }
  }

  // Build final assignments with renumbered communities
  const assignments = new Map<string, CommunityAssignment>();
  for (const [nodeId, comm] of finalAssignments) {
    assignments.set(nodeId, {
      nodeId,
      communityId: communityRenumber.get(comm)!,
      confidence: 1,
      level,
    });
  }

  // Build community metadata
  const communityMembers = new Map<number, string[]>();
  for (const [nodeId, assignment] of assignments) {
    const comm = assignment.communityId;
    if (!communityMembers.has(comm)) {
      communityMembers.set(comm, []);
    }
    communityMembers.get(comm)!.push(nodeId);
  }

  // Calculate community stats
  const communities: Community[] = [];
  for (const [commId, members] of communityMembers) {
    let internalWeight = 0;
    let totalDegree = 0;

    for (const nodeId of members) {
      const nodeIdx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (nodeIdx === -1) continue;

      // Find edges
      for (const edge of graph.edges) {
        const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

        if (sourceId === nodeId || targetId === nodeId) {
          const weight = opts.useWeights ? (edge.weight ?? opts.defaultWeight) : opts.defaultWeight;
          totalDegree += weight;

          // Check if internal edge
          const otherId = sourceId === nodeId ? targetId : sourceId;
          const otherAssignment = assignments.get(otherId);
          if (otherAssignment && otherAssignment.communityId === commId) {
            internalWeight += weight / 2; // Count each internal edge once
          }
        }
      }
    }

    communities.push({
      id: commId,
      size: members.length,
      members,
      internalWeight,
      totalDegree,
      color: COMMUNITY_COLOR_PALETTES.categorical[commId % COMMUNITY_COLOR_PALETTES.categorical.length],
    });
  }

  // Sort communities by size (descending)
  communities.sort((a, b) => b.size - a.size);

  // Calculate final modularity
  const originalGraph = buildLouvainGraph(graph, opts);
  for (const [nodeId, assignment] of assignments) {
    const idx = originalGraph.nodeIndex.get(nodeId);
    if (idx !== undefined) {
      originalGraph.communities[idx] = assignment.communityId;
    }
  }
  const modularity = calculateModularity(originalGraph, opts.resolution);

  return {
    assignments,
    communities,
    modularity,
    iterations: totalIterations,
    computeTime: performance.now() - startTime,
    levels: level + 1,
  };
}

/**
 * Assign colors to nodes based on community membership
 */
export function assignCommunityColors(
  graph: GraphData,
  result: CommunityDetectionResult,
  palette: keyof typeof COMMUNITY_COLOR_PALETTES = "categorical"
): GraphData {
  const colors = COMMUNITY_COLOR_PALETTES[palette];

  return {
    nodes: graph.nodes.map((node) => {
      const assignment = result.assignments.get(node.id);
      const color = assignment
        ? colors[assignment.communityId % colors.length]
        : "#888888";

      return {
        ...node,
        color,
        group: assignment ? `community_${assignment.communityId}` : undefined,
      };
    }),
    edges: graph.edges,
  };
}

// ============================================================
// Layout Algorithm Integration
// ============================================================

/**
 * Option definitions for community detection
 */
export const COMMUNITY_DETECTION_OPTIONS: LayoutOptionDefinition[] = [
  {
    name: "resolution",
    type: "number",
    label: "Resolution",
    description: "Higher values produce smaller communities. Default: 1.0",
    default: 1.0,
    min: 0.1,
    max: 10.0,
    step: 0.1,
  },
  {
    name: "maxIterations",
    type: "number",
    label: "Max Iterations",
    description: "Maximum iterations per level",
    default: 10,
    min: 1,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    name: "minModularityGain",
    type: "number",
    label: "Min Modularity Gain",
    description: "Minimum improvement to continue iterating",
    default: 0.0001,
    min: 0.00001,
    max: 0.01,
    step: 0.00001,
    advanced: true,
  },
  {
    name: "useWeights",
    type: "boolean",
    label: "Use Edge Weights",
    description: "Consider edge weights in calculations",
    default: true,
  },
  {
    name: "randomizeOrder",
    type: "boolean",
    label: "Randomize Order",
    description: "Randomize node processing order (improves convergence)",
    default: true,
    advanced: true,
  },
  {
    name: "colorPalette",
    type: "select",
    label: "Color Palette",
    description: "Color palette for communities",
    default: "categorical",
    options: [
      { value: "categorical", label: "Categorical (Default)" },
      { value: "pastel", label: "Pastel" },
      { value: "vibrant", label: "Vibrant" },
      { value: "nature", label: "Nature" },
    ],
  },
  {
    name: "showCommunityLabels",
    type: "boolean",
    label: "Show Community Labels",
    description: "Display community ID labels on nodes",
    default: false,
  },
];

/**
 * Community-aware layout algorithm
 *
 * Uses Louvain community detection to group nodes and applies
 * force-directed layout with community-aware forces.
 */
export class CommunityLayout extends BaseLayoutAlgorithm {
  private lastResult: CommunityDetectionResult | null = null;

  constructor(options: Record<string, unknown> = {}) {
    super("community", options);
  }

  getDefaults(): Record<string, unknown> {
    return {
      resolution: 1.0,
      maxIterations: 10,
      minModularityGain: 0.0001,
      useWeights: true,
      randomizeOrder: true,
      colorPalette: "categorical",
      showCommunityLabels: false,
      // Layout parameters
      nodeSpacing: 50,
      communitySpacing: 200,
      centerX: 0,
      centerY: 0,
    };
  }

  /**
   * Get the last community detection result
   */
  getLastResult(): CommunityDetectionResult | null {
    return this.lastResult;
  }

  layout(graph: GraphData): ExtendedLayoutResult {
    if (this.cancelled) {
      return this.createEmptyResult("Layout cancelled");
    }

    const startTime = performance.now();

    // Detect communities
    this.lastResult = detectCommunities(graph, {
      resolution: this.options.resolution as number,
      maxIterations: this.options.maxIterations as number,
      minModularityGain: this.options.minModularityGain as number,
      useWeights: this.options.useWeights as boolean,
      randomizeOrder: this.options.randomizeOrder as boolean,
    });

    // Calculate positions using community-aware layout
    const positions = this.calculateCommunityLayout(graph, this.lastResult);

    const computeTime = performance.now() - startTime;

    return {
      positions,
      bounds: this.calculateBounds(positions),
      computeTime,
      stats: {
        communities: this.lastResult.communities.length,
        modularity: this.lastResult.modularity,
        levels: this.lastResult.levels,
        iterations: this.lastResult.iterations,
      },
      qualityScore: Math.max(0, Math.min(1, (this.lastResult.modularity + 0.5) / 1.5)),
    };
  }

  /**
   * Calculate node positions with community clustering
   */
  private calculateCommunityLayout(
    graph: GraphData,
    result: CommunityDetectionResult
  ): Map<string, Point> {
    const positions = new Map<string, Point>();
    const nodeSpacing = this.options.nodeSpacing as number;
    const communitySpacing = this.options.communitySpacing as number;
    const centerX = this.options.centerX as number;
    const centerY = this.options.centerY as number;

    if (result.communities.length === 0) {
      return positions;
    }

    // Calculate community positions in a circle
    const numCommunities = result.communities.length;
    const communityRadius = Math.max(communitySpacing, numCommunities * 30);

    const communityPositions = new Map<number, Point>();
    for (let i = 0; i < numCommunities; i++) {
      const angle = (2 * Math.PI * i) / numCommunities - Math.PI / 2;
      communityPositions.set(result.communities[i].id, {
        x: centerX + communityRadius * Math.cos(angle),
        y: centerY + communityRadius * Math.sin(angle),
      });
    }

    // Position nodes within each community using spiral layout
    for (const community of result.communities) {
      const communityCenter = communityPositions.get(community.id)!;
      const members = community.members;

      if (members.length === 1) {
        positions.set(members[0], { ...communityCenter });
        continue;
      }

      // Spiral layout for community members
      const spiralSpacing = nodeSpacing / 2;
      const angleStep = 2.39996; // Golden angle ≈ 137.5°

      for (let i = 0; i < members.length; i++) {
        const r = spiralSpacing * Math.sqrt(i);
        const theta = i * angleStep;

        positions.set(members[i], {
          x: communityCenter.x + r * Math.cos(theta),
          y: communityCenter.y + r * Math.sin(theta),
        });
      }
    }

    // Handle nodes without community assignment
    for (const node of graph.nodes) {
      if (!positions.has(node.id)) {
        positions.set(node.id, {
          x: centerX + (Math.random() - 0.5) * 200,
          y: centerY + (Math.random() - 0.5) * 200,
        });
      }
    }

    return positions;
  }

  private createEmptyResult(message: string): ExtendedLayoutResult {
    return {
      positions: new Map(),
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      cancelled: true,
      stats: { message },
    };
  }
}

// ============================================================
// Plugin Registration
// ============================================================

/**
 * Plugin metadata for community detection
 */
export const COMMUNITY_DETECTION_METADATA: LayoutPluginMetadata = {
  id: "community-detection",
  name: "Community Detection (Louvain)",
  description:
    "Detects communities in graphs using the Louvain algorithm. " +
    "Groups tightly connected nodes together and positions them visually. " +
    "Optimizes modularity to find the best partition.",
  version: "1.0.0",
  author: "Exocortex",
  icon: "groups",
  category: "domain-specific",
  tags: ["community", "clustering", "louvain", "modularity", "grouping"],
  supportedGraphTypes: ["general", "dag", "tree"],
  minNodes: 1,
  maxNodes: 10000,
  documentationUrl: "https://en.wikipedia.org/wiki/Louvain_method",
};

/**
 * Create the community detection layout plugin
 */
export function createCommunityDetectionPlugin(): LayoutPlugin {
  return {
    metadata: COMMUNITY_DETECTION_METADATA,
    factory: createLayoutFactory(CommunityLayout, COMMUNITY_DETECTION_OPTIONS),
  };
}

/**
 * Pre-created plugin instance for convenience
 */
export const communityDetectionPlugin = createCommunityDetectionPlugin();
