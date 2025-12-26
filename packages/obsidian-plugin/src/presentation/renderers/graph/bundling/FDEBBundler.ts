/**
 * FDEBBundler - Force-Directed Edge Bundling
 *
 * Implements the Force-Directed Edge Bundling algorithm by Holten & van Wijk (2009).
 * This algorithm reduces visual clutter in dense graphs by attracting compatible
 * edges toward each other, creating bundled paths.
 *
 * Key features:
 * - Edge compatibility computation (angle, scale, position, visibility)
 * - Iterative subdivision and force simulation
 * - Adaptive step size for convergence
 * - Configurable bundling strength and parameters
 *
 * Reference:
 * Holten, D. and Van Wijk, J.J., 2009. Force-Directed Edge Bundling for Graph Visualization.
 * Computer Graphics Forum, 28(3), pp.983-990.
 *
 * @module presentation/renderers/graph/bundling
 * @since 1.0.0
 */

import type { GraphEdge, GraphNode } from "../types";
import type {
  BundledEdge,
  BundlingConfig,
  BundlingResult,
  CompatibilityMeasures,
  EdgeBundler,
  EdgeSegment,
  Vector2,
} from "./BundlingTypes";
import {
  add,
  DEFAULT_BUNDLING_CONFIG,
  distance,
  dot,
  normalize,
  scale,
  subtract,
} from "./BundlingTypes";

/**
 * FDEBBundler - Force-Directed Edge Bundling implementation
 *
 * Bundles edges by computing compatibility between edge pairs and
 * iteratively applying attractive forces between compatible edges.
 */
export class FDEBBundler implements EdgeBundler {
  private config: BundlingConfig;
  private segments: Map<string, EdgeSegment> = new Map();
  private compatibilityCache: Map<string, number> = new Map();

  /**
   * Create a new FDEBBundler
   *
   * @param config - Optional partial configuration
   */
  constructor(config?: Partial<BundlingConfig>) {
    this.config = {
      ...DEFAULT_BUNDLING_CONFIG,
      algorithm: "fdeb",
      ...config,
    };
  }

  /**
   * Bundle edges using force-directed edge bundling
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Array of bundled edges with control points
   */
  bundle(edges: GraphEdge[], nodes: Map<string, GraphNode>): BundledEdge[] {
    return this.bundleWithStats(edges, nodes).edges;
  }

  /**
   * Bundle edges with detailed statistics
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Bundling result with edges and statistics
   */
  bundleWithStats(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): BundlingResult {
    const startTime = performance.now();

    // Clear caches
    this.segments.clear();
    this.compatibilityCache.clear();

    // Filter edges with valid nodes
    const validEdges = edges.filter((edge) => {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;
      return nodes.has(sourceId) && nodes.has(targetId);
    });

    if (validEdges.length === 0) {
      return {
        edges: [],
        duration: performance.now() - startTime,
        bundledCount: 0,
        unbundledCount: 0,
        averageCompatibility: 0,
      };
    }

    // Initialize segments with source/target points
    this.initializeSegments(validEdges, nodes);

    // Compute pairwise edge compatibility
    this.computeCompatibility();

    // Iterative subdivision and force simulation
    this.runSimulation();

    // Create bundled edges from segments
    const bundledEdges = this.createBundledEdges(validEdges);

    // Calculate statistics
    let totalCompatibility = 0;
    let compatibilityCount = 0;

    for (const compat of this.compatibilityCache.values()) {
      totalCompatibility += compat;
      compatibilityCount++;
    }

    const bundledCount = bundledEdges.filter(
      (e) => e.controlPoints.length > 2
    ).length;

    return {
      edges: bundledEdges,
      duration: performance.now() - startTime,
      bundledCount,
      unbundledCount: bundledEdges.length - bundledCount,
      averageCompatibility:
        compatibilityCount > 0 ? totalCompatibility / compatibilityCount : 0,
    };
  }

  /**
   * Update bundling configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<BundlingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      algorithm: "fdeb",
    };
  }

  /**
   * Get current bundling configuration
   */
  getConfig(): BundlingConfig {
    return { ...this.config };
  }

  /**
   * Get the name of the bundling algorithm
   */
  getName(): string {
    return "fdeb";
  }

  /**
   * Initialize edge segments with source and target points
   */
  private initializeSegments(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): void {
    for (const edge of edges) {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceNode = nodes.get(sourceId)!;
      const targetNode = nodes.get(targetId)!;

      const sourcePos: Vector2 = {
        x: sourceNode.x ?? 0,
        y: sourceNode.y ?? 0,
      };
      const targetPos: Vector2 = {
        x: targetNode.x ?? 0,
        y: targetNode.y ?? 0,
      };

      this.segments.set(edge.id, {
        edgeId: edge.id,
        points: [sourcePos, targetPos],
        compatibility: new Map(),
        sourceId,
        targetId,
      });
    }
  }

  /**
   * Compute pairwise edge compatibility scores
   */
  private computeCompatibility(): void {
    const segmentList = Array.from(this.segments.values());
    const n = segmentList.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const seg1 = segmentList[i];
        const seg2 = segmentList[j];

        // Skip if edges share a node (connected edges)
        if (
          seg1.sourceId === seg2.sourceId ||
          seg1.sourceId === seg2.targetId ||
          seg1.targetId === seg2.sourceId ||
          seg1.targetId === seg2.targetId
        ) {
          continue;
        }

        const compat = this.computeEdgeCompatibility(seg1, seg2);

        if (compat >= this.config.compatibility) {
          const key = this.getCompatibilityKey(seg1.edgeId, seg2.edgeId);
          this.compatibilityCache.set(key, compat);
          seg1.compatibility.set(seg2.edgeId, compat);
          seg2.compatibility.set(seg1.edgeId, compat);
        }
      }
    }
  }

  /**
   * Compute compatibility between two edges
   */
  private computeEdgeCompatibility(
    seg1: EdgeSegment,
    seg2: EdgeSegment
  ): number {
    const p1 = seg1.points[0];
    const p2 = seg1.points[seg1.points.length - 1];
    const q1 = seg2.points[0];
    const q2 = seg2.points[seg2.points.length - 1];

    const measures = this.computeCompatibilityMeasures(p1, p2, q1, q2);

    // Combined compatibility is the product of all measures
    return (
      measures.angleCompatibility *
      measures.scaleCompatibility *
      measures.positionCompatibility *
      measures.visibilityCompatibility
    );
  }

  /**
   * Compute individual compatibility measures between two edges
   */
  private computeCompatibilityMeasures(
    p1: Vector2,
    p2: Vector2,
    q1: Vector2,
    q2: Vector2
  ): CompatibilityMeasures {
    // Edge vectors
    const pVec = subtract(p2, p1);
    const qVec = subtract(q2, q1);

    const pLen = distance(p1, p2);
    const qLen = distance(q1, q2);

    // Angle compatibility: edges with similar angles bundle better
    let angleCompatibility = 0;
    if (pLen > 0 && qLen > 0) {
      const pNorm = normalize(pVec);
      const qNorm = normalize(qVec);
      const cosAngle = Math.abs(dot(pNorm, qNorm));
      angleCompatibility = cosAngle;
    }

    // Scale compatibility: edges of similar length bundle better
    const avgLen = (pLen + qLen) / 2;
    const scaleCompatibility =
      avgLen > 0
        ? (2 / (avgLen / Math.min(pLen, qLen) + Math.max(pLen, qLen) / avgLen))
        : 0;

    // Position compatibility: edges close together bundle better
    const pMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const qMid = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
    const midDist = distance(pMid, qMid);
    const positionCompatibility =
      avgLen > 0 ? avgLen / (avgLen + midDist) : 0;

    // Visibility compatibility: check if edges "see" each other
    const visibilityCompatibility = this.computeVisibilityCompatibility(
      p1,
      p2,
      q1,
      q2
    );

    return {
      angleCompatibility,
      scaleCompatibility,
      positionCompatibility,
      visibilityCompatibility,
    };
  }

  /**
   * Compute visibility compatibility (whether edges can "see" each other)
   */
  private computeVisibilityCompatibility(
    p1: Vector2,
    p2: Vector2,
    q1: Vector2,
    q2: Vector2
  ): number {
    // Project q endpoints onto p edge
    const pVec = subtract(p2, p1);
    const pLenSq = dot(pVec, pVec);

    if (pLenSq === 0) return 0;

    // Project q1 onto p
    const q1Proj = dot(subtract(q1, p1), pVec) / pLenSq;
    // Project q2 onto p
    const q2Proj = dot(subtract(q2, p1), pVec) / pLenSq;

    // Check if projections overlap with the edge
    const minProj = Math.min(q1Proj, q2Proj);
    const maxProj = Math.max(q1Proj, q2Proj);

    if (maxProj < 0 || minProj > 1) {
      // No overlap
      return 0;
    }

    // Calculate visibility based on overlap
    const overlapStart = Math.max(0, minProj);
    const overlapEnd = Math.min(1, maxProj);
    const overlap = overlapEnd - overlapStart;

    return Math.max(0, Math.min(1, overlap * 2));
  }

  /**
   * Run the force simulation to bundle edges
   */
  private runSimulation(): void {
    const { iterations, subdivisionRate, adaptiveStepSize } = this.config;
    let stepSize = this.config.stepSize;

    // Number of subdivision cycles (each cycle doubles the points)
    const maxCycles = Math.ceil(Math.log2(this.config.maxSubdivisions));
    let iterationsPerCycle = Math.ceil(iterations / maxCycles);

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      // Subdivide edges (except first cycle)
      if (cycle > 0) {
        this.subdivideEdges();

        // Reduce iterations as subdivisions increase
        iterationsPerCycle = Math.max(
          10,
          Math.ceil(iterationsPerCycle / subdivisionRate)
        );
      }

      // Run force simulation for this cycle
      for (let iter = 0; iter < iterationsPerCycle; iter++) {
        const displacement = this.applyForces(stepSize);

        // Adaptive step size: reduce if displacement is small
        if (adaptiveStepSize && displacement < 0.1) {
          stepSize *= 0.9;
        }
      }

      // Reduce step size for next cycle
      stepSize *= 0.5;
    }
  }

  /**
   * Subdivide all edge segments by adding midpoints
   */
  private subdivideEdges(): void {
    for (const segment of this.segments.values()) {
      const newPoints: Vector2[] = [];
      const points = segment.points;

      for (let i = 0; i < points.length; i++) {
        newPoints.push(points[i]);

        // Add midpoint between this point and next (except for last point)
        if (i < points.length - 1) {
          const mid: Vector2 = {
            x: (points[i].x + points[i + 1].x) / 2,
            y: (points[i].y + points[i + 1].y) / 2,
          };
          newPoints.push(mid);
        }
      }

      segment.points = newPoints;
    }
  }

  /**
   * Apply forces to all edge points
   *
   * @param stepSize - Current step size
   * @returns Total displacement for convergence check
   */
  private applyForces(stepSize: number): number {
    const { springConstant, bundleStrength } = this.config;
    const forces = new Map<string, Vector2[]>();

    // Initialize force arrays
    for (const segment of this.segments.values()) {
      forces.set(
        segment.edgeId,
        segment.points.map(() => ({ x: 0, y: 0 }))
      );
    }

    // Calculate edge-to-edge attraction forces
    for (const segment of this.segments.values()) {
      const edgeForces = forces.get(segment.edgeId)!;

      for (const [otherEdgeId, compat] of segment.compatibility) {
        const otherSegment = this.segments.get(otherEdgeId);
        if (!otherSegment) continue;

        // Calculate attraction force for each point
        this.calculateAttractionForces(
          segment,
          otherSegment,
          compat,
          edgeForces,
          bundleStrength
        );
      }

      // Calculate spring forces (keep edge from becoming too curved)
      this.calculateSpringForces(segment, edgeForces, springConstant);
    }

    // Apply forces
    let totalDisplacement = 0;

    for (const segment of this.segments.values()) {
      const edgeForces = forces.get(segment.edgeId)!;
      const points = segment.points;

      // Don't move endpoints
      for (let i = 1; i < points.length - 1; i++) {
        const force = edgeForces[i];
        const displacement = scale(force, stepSize);

        points[i] = add(points[i], displacement);
        totalDisplacement += Math.sqrt(
          displacement.x * displacement.x + displacement.y * displacement.y
        );
      }
    }

    return totalDisplacement;
  }

  /**
   * Calculate attraction forces between two edge segments
   */
  private calculateAttractionForces(
    seg1: EdgeSegment,
    seg2: EdgeSegment,
    compatibility: number,
    forces: Vector2[],
    bundleStrength: number
  ): void {
    const points1 = seg1.points;
    const points2 = seg2.points;

    // Find corresponding points on the other edge
    // Use normalized positions along edge
    for (let i = 1; i < points1.length - 1; i++) {
      const t = i / (points1.length - 1);

      // Find corresponding point on other edge
      const otherIdx = Math.floor(t * (points2.length - 1));
      const otherT = t * (points2.length - 1) - otherIdx;

      let otherPoint: Vector2;
      if (otherIdx >= points2.length - 1) {
        otherPoint = points2[points2.length - 1];
      } else {
        otherPoint = {
          x:
            points2[otherIdx].x +
            (points2[otherIdx + 1].x - points2[otherIdx].x) * otherT,
          y:
            points2[otherIdx].y +
            (points2[otherIdx + 1].y - points2[otherIdx].y) * otherT,
        };
      }

      // Calculate attraction force
      const diff = subtract(otherPoint, points1[i]);
      const dist = Math.sqrt(diff.x * diff.x + diff.y * diff.y);

      if (dist > 0) {
        const forceMag = compatibility * bundleStrength;
        const force = scale(normalize(diff), forceMag);

        forces[i] = add(forces[i], force);
      }
    }
  }

  /**
   * Calculate spring forces to maintain edge smoothness
   */
  private calculateSpringForces(
    segment: EdgeSegment,
    forces: Vector2[],
    springConstant: number
  ): void {
    const points = segment.points;

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      // Spring force from previous point
      const prevDiff = subtract(prev, curr);
      // Spring force from next point
      const nextDiff = subtract(next, curr);

      // Combined spring force pulls point toward neighbors
      const springForce = add(
        scale(prevDiff, springConstant),
        scale(nextDiff, springConstant)
      );

      forces[i] = add(forces[i], springForce);
    }
  }

  /**
   * Create bundled edges from segments
   */
  private createBundledEdges(edges: GraphEdge[]): BundledEdge[] {
    return edges.map((edge) => {
      const segment = this.segments.get(edge.id);

      if (!segment) {
        // Edge not in segments (shouldn't happen)
        return {
          id: edge.id,
          sourceId:
            typeof edge.source === "string" ? edge.source : edge.source.id,
          targetId:
            typeof edge.target === "string" ? edge.target : edge.target.id,
          controlPoints: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          originalEdge: edge,
        };
      }

      // Calculate average compatibility score for this edge
      let totalCompat = 0;
      let compatCount = 0;
      for (const compat of segment.compatibility.values()) {
        totalCompat += compat;
        compatCount++;
      }

      return {
        id: edge.id,
        sourceId: segment.sourceId,
        targetId: segment.targetId,
        controlPoints: [...segment.points],
        originalEdge: edge,
        compatibilityScore: compatCount > 0 ? totalCompat / compatCount : 0,
      };
    });
  }

  /**
   * Generate a unique key for edge pair compatibility
   */
  private getCompatibilityKey(edgeId1: string, edgeId2: string): string {
    return edgeId1 < edgeId2
      ? `${edgeId1}|${edgeId2}`
      : `${edgeId2}|${edgeId1}`;
  }
}

/**
 * Factory function to create an FDEBBundler
 *
 * @param config - Optional partial configuration
 * @returns New FDEBBundler instance
 */
export function createFDEBBundler(
  config?: Partial<BundlingConfig>
): FDEBBundler {
  return new FDEBBundler(config);
}
