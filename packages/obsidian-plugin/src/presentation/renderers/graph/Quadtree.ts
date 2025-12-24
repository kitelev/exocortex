/**
 * Quadtree Data Structure for Barnes-Hut Algorithm
 *
 * Implements a quadtree spatial index for O(n log n) many-body force calculation.
 * Used by the Barnes-Hut algorithm to approximate distant node groups as single bodies.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

/**
 * A point in 2D space with associated data
 */
export interface QuadtreePoint {
  x: number;
  y: number;
}

/**
 * Bounds of a quadtree region
 */
export interface QuadtreeBounds {
  x0: number; // Left
  y0: number; // Top
  x1: number; // Right
  y1: number; // Bottom
}

/**
 * Internal quadtree node (either internal or leaf)
 */
export interface QuadtreeNode<T extends QuadtreePoint> {
  // Bounds
  x0: number;
  y0: number;
  x1: number;
  y1: number;

  // Children (NW, NE, SW, SE) - undefined if leaf
  children?: [
    QuadtreeNode<T> | undefined, // NW (0)
    QuadtreeNode<T> | undefined, // NE (1)
    QuadtreeNode<T> | undefined, // SW (2)
    QuadtreeNode<T> | undefined, // SE (3)
  ];

  // Data (only in leaf nodes)
  data?: T;

  // Linked list for coincident points
  next?: QuadtreeNode<T>;

  // Aggregated values for Barnes-Hut
  value: number; // Total "charge" (mass × strength)
  x: number; // Center of mass X
  y: number; // Center of mass Y
  weight: number; // Total mass (for weighted center calculation)
}

/**
 * Quadtree class for spatial indexing
 *
 * @example
 * ```typescript
 * const nodes = [
 *   { x: 10, y: 20, id: 'a' },
 *   { x: 30, y: 40, id: 'b' },
 * ];
 * const tree = new Quadtree(nodes);
 * tree.visit((node, x0, y0, x1, y1) => {
 *   // Process each quadrant
 *   return false; // Continue visiting children
 * });
 * ```
 */
export class Quadtree<T extends QuadtreePoint> {
  private root: QuadtreeNode<T> | undefined;
  private _x0: number = Infinity;
  private _y0: number = Infinity;
  private _x1: number = -Infinity;
  private _y1: number = -Infinity;

  /**
   * Create a new quadtree
   *
   * @param points - Optional array of points to add
   * @param x - X accessor function (default: d => d.x)
   * @param y - Y accessor function (default: d => d.y)
   */
  constructor(
    points?: T[],
    private readonly xAccessor: (d: T) => number = (d) => d.x,
    private readonly yAccessor: (d: T) => number = (d) => d.y
  ) {
    if (points && points.length > 0) {
      this.addAll(points);
    }
  }

  /**
   * Get the bounds of the quadtree
   */
  extent(): [[number, number], [number, number]] {
    return [
      [this._x0, this._y0],
      [this._x1, this._y1],
    ];
  }

  /**
   * Cover the specified point by expanding bounds as needed
   */
  cover(x: number, y: number): this {
    if (isNaN(x) || isNaN(y)) return this;

    let x0 = this._x0;
    let y0 = this._y0;
    let x1 = this._x1;
    let y1 = this._y1;

    // Initial bounds (first point)
    if (x0 > x1) {
      x0 = Math.floor(x);
      y0 = Math.floor(y);
      x1 = x0 + 1;
      y1 = y0 + 1;
    }
    // Expand bounds as needed
    else {
      // Expand to power of 2 to maintain square quadrants
      let z = x1 - x0;
      let node = this.root;
      let parent: QuadtreeNode<T> | undefined;
      let i: number;

      // Expand left/top
      while (x < x0 || y < y0) {
        i = ((y < y0 ? 1 : 0) << 1) | (x < x0 ? 1 : 0);
        parent = this.createNode(x0, y0, x1, y1);
        parent.children = [undefined, undefined, undefined, undefined];
        parent.children[i ^ 3] = node; // Place existing tree in opposite quadrant
        node = parent;
        z *= 2;
        if (i & 1) x0 = x1 - z;
        else x1 = x0 + z;
        if (i & 2) y0 = y1 - z;
        else y1 = y0 + z;
      }

      // Expand right/bottom
      while (x >= x1 || y >= y1) {
        i = ((y >= y1 ? 1 : 0) << 1) | (x >= x1 ? 1 : 0);
        parent = this.createNode(x0, y0, x1, y1);
        parent.children = [undefined, undefined, undefined, undefined];
        parent.children[i] = node;
        node = parent;
        z *= 2;
        if (i & 1) x1 = x0 + z;
        else x0 = x1 - z;
        if (i & 2) y1 = y0 + z;
        else y0 = y1 - z;
      }

      this.root = node;
    }

    this._x0 = x0;
    this._y0 = y0;
    this._x1 = x1;
    this._y1 = y1;

    return this;
  }

  /**
   * Create a new quadtree node
   */
  private createNode(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    data?: T
  ): QuadtreeNode<T> {
    return {
      x0,
      y0,
      x1,
      y1,
      data,
      value: 0,
      x: 0,
      y: 0,
      weight: 0,
    };
  }

  /**
   * Add a single point to the quadtree
   */
  add(point: T): this {
    const x = this.xAccessor(point);
    const y = this.yAccessor(point);

    if (isNaN(x) || isNaN(y)) return this;

    // Ensure bounds cover this point
    this.cover(x, y);

    // Add to tree
    this.addToTree(point, x, y);

    return this;
  }

  /**
   * Add multiple points to the quadtree
   */
  addAll(points: T[]): this {
    // First pass: calculate bounds
    for (const point of points) {
      const x = this.xAccessor(point);
      const y = this.yAccessor(point);
      if (!isNaN(x) && !isNaN(y)) {
        this.cover(x, y);
      }
    }

    // Second pass: add points
    for (const point of points) {
      const x = this.xAccessor(point);
      const y = this.yAccessor(point);
      if (!isNaN(x) && !isNaN(y)) {
        this.addToTree(point, x, y);
      }
    }

    return this;
  }

  /**
   * Add a point to the tree (internal)
   */
  private addToTree(point: T, x: number, y: number): void {
    const newNode = this.createNode(this._x0, this._y0, this._x1, this._y1, point);

    if (!this.root) {
      this.root = newNode;
      return;
    }

    let node = this.root;
    let x0 = this._x0;
    let y0 = this._y0;
    let x1 = this._x1;
    let y1 = this._y1;

    // Descend until we find a leaf
    while (node.children) {
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      const right = x >= xm;
      const bottom = y >= ym;
      const i = (bottom ? 2 : 0) | (right ? 1 : 0);

      if (right) x0 = xm;
      else x1 = xm;
      if (bottom) y0 = ym;
      else y1 = ym;

      const child = node.children[i];
      if (!child) {
        node.children[i] = this.createNode(x0, y0, x1, y1, point);
        return;
      }
      node = child;
    }

    // We found a leaf node
    if (node.data) {
      const existingX = this.xAccessor(node.data);
      const existingY = this.yAccessor(node.data);

      // Coincident points - add to linked list
      if (existingX === x && existingY === y) {
        newNode.next = node.next;
        node.next = newNode;
        return;
      }

      // Split the leaf node
      const existingData = node.data;
      delete node.data;
      delete node.next;

      // Create children
      node.children = [undefined, undefined, undefined, undefined];

      // Subdivide until points are in different quadrants
      let depth = 0;
      const maxDepth = 100; // Prevent infinite loop

      while (depth < maxDepth) {
        const xm = (x0 + x1) / 2;
        const ym = (y0 + y1) / 2;

        const existingRight = existingX >= xm;
        const existingBottom = existingY >= ym;
        const existingI = (existingBottom ? 2 : 0) | (existingRight ? 1 : 0);

        const newRight = x >= xm;
        const newBottom = y >= ym;
        const newI = (newBottom ? 2 : 0) | (newRight ? 1 : 0);

        if (existingI !== newI) {
          // Points are in different quadrants
          const existingBounds = this.getChildBounds(
            x0,
            y0,
            x1,
            y1,
            existingI
          );
          const newBounds = this.getChildBounds(x0, y0, x1, y1, newI);

          node.children![existingI] = this.createNode(
            existingBounds.x0,
            existingBounds.y0,
            existingBounds.x1,
            existingBounds.y1,
            existingData
          );
          node.children![newI] = this.createNode(
            newBounds.x0,
            newBounds.y0,
            newBounds.x1,
            newBounds.y1,
            point
          );
          return;
        }

        // Points are in the same quadrant - need to subdivide further
        const childBounds = this.getChildBounds(x0, y0, x1, y1, existingI);
        const childNode = this.createNode(
          childBounds.x0,
          childBounds.y0,
          childBounds.x1,
          childBounds.y1
        );
        childNode.children = [undefined, undefined, undefined, undefined];
        node.children![existingI] = childNode;

        node = childNode;
        x0 = childBounds.x0;
        y0 = childBounds.y0;
        x1 = childBounds.x1;
        y1 = childBounds.y1;
        depth++;
      }

      // Max depth reached - add as coincident
      node.data = existingData;
      newNode.next = node.next;
      node.next = newNode;
    } else {
      // Empty leaf - just add data
      node.data = point;
    }
  }

  /**
   * Get child quadrant bounds
   */
  private getChildBounds(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    i: number
  ): QuadtreeBounds {
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    const right = i & 1;
    const bottom = i & 2;

    return {
      x0: right ? xm : x0,
      y0: bottom ? ym : y0,
      x1: right ? x1 : xm,
      y1: bottom ? y1 : ym,
    };
  }

  /**
   * Visit all nodes in the quadtree
   *
   * @param callback - Function called for each node. Return true to skip children.
   */
  visit(
    callback: (
      node: QuadtreeNode<T>,
      x0: number,
      y0: number,
      x1: number,
      y1: number
    ) => boolean | void
  ): this {
    if (!this.root) return this;

    const quads: Array<{
      node: QuadtreeNode<T>;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }> = [];
    quads.push({
      node: this.root,
      x0: this._x0,
      y0: this._y0,
      x1: this._x1,
      y1: this._y1,
    });

    while (quads.length > 0) {
      const q = quads.pop()!;
      const { node, x0, y0, x1, y1 } = q;

      if (!callback(node, x0, y0, x1, y1) && node.children) {
        const xm = (x0 + x1) / 2;
        const ym = (y0 + y1) / 2;

        // Add children in reverse order so they're processed in order
        if (node.children[3])
          quads.push({ node: node.children[3], x0: xm, y0: ym, x1, y1 });
        if (node.children[2])
          quads.push({ node: node.children[2], x0, y0: ym, x1: xm, y1 });
        if (node.children[1])
          quads.push({ node: node.children[1], x0: xm, y0, x1, y1: ym });
        if (node.children[0])
          quads.push({ node: node.children[0], x0, y0, x1: xm, y1: ym });
      }
    }

    return this;
  }

  /**
   * Visit all nodes after their children (post-order)
   *
   * @param callback - Function called for each node after processing children
   */
  visitAfter(
    callback: (
      node: QuadtreeNode<T>,
      x0: number,
      y0: number,
      x1: number,
      y1: number
    ) => void
  ): this {
    if (!this.root) return this;

    // Collect all nodes first
    const nodes: Array<{
      node: QuadtreeNode<T>;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }> = [];

    // Pre-order traversal to collect all nodes
    const quads: Array<{
      node: QuadtreeNode<T>;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }> = [];
    quads.push({
      node: this.root,
      x0: this._x0,
      y0: this._y0,
      x1: this._x1,
      y1: this._y1,
    });

    while (quads.length > 0) {
      const q = quads.pop()!;
      nodes.push(q);

      if (q.node.children) {
        const { x0, y0, x1, y1 } = q;
        const xm = (x0 + x1) / 2;
        const ym = (y0 + y1) / 2;

        if (q.node.children[0])
          quads.push({ node: q.node.children[0], x0, y0, x1: xm, y1: ym });
        if (q.node.children[1])
          quads.push({ node: q.node.children[1], x0: xm, y0, x1, y1: ym });
        if (q.node.children[2])
          quads.push({ node: q.node.children[2], x0, y0: ym, x1: xm, y1 });
        if (q.node.children[3])
          quads.push({ node: q.node.children[3], x0: xm, y0: ym, x1, y1 });
      }
    }

    // Process in reverse order (post-order)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, x0, y0, x1, y1 } = nodes[i];
      callback(node, x0, y0, x1, y1);
    }

    return this;
  }

  /**
   * Find a point in the quadtree
   */
  find(x: number, y: number, radius?: number): T | undefined {
    if (isNaN(x) || isNaN(y)) return undefined;

    let result: T | undefined;
    let minDistance = radius !== undefined ? radius * radius : Infinity;

    this.visit((node, x0, y0, x1, y1) => {
      // Skip if bounding box is too far away
      if (radius !== undefined) {
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
        if (dx * dx + dy * dy > minDistance) {
          return true; // Skip this subtree
        }
      }

      // Check leaf data
      if (node.data) {
        const px = this.xAccessor(node.data);
        const py = this.yAccessor(node.data);
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < minDistance) {
          minDistance = d;
          result = node.data;
        }

        // Check coincident points
        let next = node.next;
        while (next) {
          if (next.data) {
            const npx = this.xAccessor(next.data);
            const npy = this.yAccessor(next.data);
            const nd = (x - npx) * (x - npx) + (y - npy) * (y - npy);
            if (nd < minDistance) {
              minDistance = nd;
              result = next.data;
            }
          }
          next = next.next;
        }
      }

      return false;
    });

    return result;
  }

  /**
   * Get the root node of the quadtree
   */
  getRoot(): QuadtreeNode<T> | undefined {
    return this.root;
  }

  /**
   * Get all data points in the quadtree
   */
  data(): T[] {
    const result: T[] = [];

    this.visit((node) => {
      if (node.data) {
        result.push(node.data);
        let next = node.next;
        while (next) {
          if (next.data) {
            result.push(next.data);
          }
          next = next.next;
        }
      }
      return false;
    });

    return result;
  }

  /**
   * Get the size (number of data points) in the quadtree
   */
  size(): number {
    return this.data().length;
  }
}
