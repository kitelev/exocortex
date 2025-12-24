/**
 * LocalStorageConstraintStore - Browser localStorage persistence for constraints
 *
 * Provides constraint persistence using browser localStorage. Supports
 * serialization/deserialization of all constraint types with versioning
 * for future schema migrations.
 *
 * Note: This is a generic browser-based storage mechanism for use in
 * environments where Obsidian's App storage is not available (e.g., testing,
 * standalone graph view components). For Obsidian-specific storage, use
 * the App.saveLocalStorage/loadLocalStorage methods.
 *
 * @module presentation/renderers/graph/constraints
 * @since 1.0.0
 */

/* eslint-disable no-restricted-globals */

import type {
  LayoutConstraint,
  ConstraintStore,
  SerializedConstraint,
  ConstraintType,
  ConstraintPriority,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
} from "./constraint.types";

// ============================================================
// Constants
// ============================================================

/** Storage key prefix */
const STORAGE_PREFIX = "exocortex-graph-constraints-";

/** Current schema version */
const SCHEMA_VERSION = 1;

// ============================================================
// Serialization Helpers
// ============================================================

/**
 * Serialize a constraint for storage
 */
function serializeConstraint(constraint: LayoutConstraint): SerializedConstraint {
  const base = {
    id: constraint.id,
    type: constraint.type,
    enabled: constraint.enabled,
    priority: constraint.priority,
  };

  switch (constraint.type) {
    case "pin":
      return {
        ...base,
        data: {
          nodeId: constraint.nodeId,
          position: constraint.position,
          strength: constraint.strength,
        },
      };
    case "alignment":
      return {
        ...base,
        data: {
          axis: constraint.axis,
          nodeIds: constraint.nodeIds,
          referencePosition: constraint.referencePosition,
          alignmentMethod: constraint.alignmentMethod,
        },
      };
    case "group":
      return {
        ...base,
        data: {
          nodeIds: constraint.nodeIds,
          boundingBox: constraint.boundingBox,
          padding: constraint.padding,
          minDistance: constraint.minDistance,
          maxDistance: constraint.maxDistance,
          label: constraint.label,
          color: constraint.color,
        },
      };
    case "distance":
      return {
        ...base,
        data: {
          node1: constraint.node1,
          node2: constraint.node2,
          minDistance: constraint.minDistance,
          maxDistance: constraint.maxDistance,
          exactDistance: constraint.exactDistance,
        },
      };
    case "region":
      return {
        ...base,
        data: {
          nodeId: constraint.nodeId,
          region: constraint.region,
        },
      };
    case "order":
      return {
        ...base,
        data: {
          axis: constraint.axis,
          nodeIds: constraint.nodeIds,
          minSpacing: constraint.minSpacing,
        },
      };
    default:
      return { ...base, data: {} };
  }
}

/**
 * Deserialize a constraint from storage
 */
function deserializeConstraint(serialized: SerializedConstraint): LayoutConstraint | null {
  const base = {
    id: serialized.id,
    type: serialized.type as ConstraintType,
    enabled: serialized.enabled,
    priority: serialized.priority as ConstraintPriority,
  };

  try {
    switch (serialized.type) {
      case "pin":
        return {
          ...base,
          type: "pin",
          nodeId: serialized.data.nodeId as string,
          position: serialized.data.position as { x: number; y: number },
          strength: serialized.data.strength as number,
        } as PinConstraint;

      case "alignment":
        return {
          ...base,
          type: "alignment",
          axis: serialized.data.axis as "horizontal" | "vertical",
          nodeIds: serialized.data.nodeIds as string[],
          referencePosition: serialized.data.referencePosition as number | undefined,
          alignmentMethod: serialized.data.alignmentMethod as "average" | "first" | "last" | "min" | "max",
        } as AlignmentConstraint;

      case "group":
        return {
          ...base,
          type: "group",
          nodeIds: serialized.data.nodeIds as string[],
          boundingBox: serialized.data.boundingBox as { x: number; y: number; width: number; height: number } | undefined,
          padding: serialized.data.padding as number,
          minDistance: serialized.data.minDistance as number,
          maxDistance: serialized.data.maxDistance as number | undefined,
          label: serialized.data.label as string | undefined,
          color: serialized.data.color as string | undefined,
        } as GroupConstraint;

      case "distance":
        return {
          ...base,
          type: "distance",
          node1: serialized.data.node1 as string,
          node2: serialized.data.node2 as string,
          minDistance: serialized.data.minDistance as number | undefined,
          maxDistance: serialized.data.maxDistance as number | undefined,
          exactDistance: serialized.data.exactDistance as number | undefined,
        } as DistanceConstraint;

      case "region":
        return {
          ...base,
          type: "region",
          nodeId: serialized.data.nodeId as string,
          region: serialized.data.region as { x: number; y: number; width: number; height: number },
        } as RegionConstraint;

      case "order":
        return {
          ...base,
          type: "order",
          axis: serialized.data.axis as "x" | "y",
          nodeIds: serialized.data.nodeIds as string[],
          minSpacing: serialized.data.minSpacing as number | undefined,
        } as OrderConstraint;

      default:
        console.warn(`Unknown constraint type: ${String(serialized.type)}`);
        return null;
    }
  } catch (error) {
    console.error(`Failed to deserialize constraint:`, error);
    return null;
  }
}

// ============================================================
// Storage Data Structure
// ============================================================

interface StorageData {
  version: number;
  constraints: SerializedConstraint[];
  updatedAt: string;
}

// ============================================================
// LocalStorageConstraintStore Class
// ============================================================

/**
 * LocalStorage-based constraint persistence
 *
 * Stores constraints in browser localStorage with JSON serialization.
 * Includes schema versioning for future migration support.
 *
 * @example
 * ```typescript
 * const store = new LocalStorageConstraintStore();
 *
 * // Save constraints
 * await store.save('graph-123', [
 *   { type: 'pin', nodeId: 'node1', position: { x: 0, y: 0 }, ... },
 * ]);
 *
 * // Load constraints
 * const constraints = await store.load('graph-123');
 * ```
 */
export class LocalStorageConstraintStore implements ConstraintStore {
  private prefix: string;
  private storage: Storage | null;

  constructor(prefix: string = STORAGE_PREFIX, storage?: Storage) {
    this.prefix = prefix;
    // Use provided storage or fallback to global localStorage
    this.storage = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  }

  /**
   * Save constraints for a graph
   */
  async save(graphId: string, constraints: LayoutConstraint[]): Promise<void> {
    const key = this.getKey(graphId);
    const serialized = constraints.map(serializeConstraint);

    const data: StorageData = {
      version: SCHEMA_VERSION,
      constraints: serialized,
      updatedAt: new Date().toISOString(),
    };

    try {
      if (this.storage) {
        this.storage.setItem(key, JSON.stringify(data));
      }
    } catch (error) {
      console.error(`Failed to save constraints for graph ${graphId}:`, error);
      throw error;
    }
  }

  /**
   * Load constraints for a graph
   */
  async load(graphId: string): Promise<LayoutConstraint[]> {
    const key = this.getKey(graphId);

    try {
      if (!this.storage) {
        return [];
      }

      const stored = this.storage.getItem(key);
      if (!stored) {
        return [];
      }

      const data = JSON.parse(stored) as StorageData;

      // Handle schema migration if needed
      if (data.version !== SCHEMA_VERSION) {
        return this.migrateData(data);
      }

      const constraints: LayoutConstraint[] = [];
      for (const serialized of data.constraints) {
        const constraint = deserializeConstraint(serialized);
        if (constraint) {
          constraints.push(constraint);
        }
      }

      return constraints;
    } catch (error) {
      console.error(`Failed to load constraints for graph ${graphId}:`, error);
      return [];
    }
  }

  /**
   * Delete constraints for a graph
   */
  async delete(graphId: string): Promise<void> {
    const key = this.getKey(graphId);

    try {
      if (this.storage) {
        this.storage.removeItem(key);
      }
    } catch (error) {
      console.error(`Failed to delete constraints for graph ${graphId}:`, error);
      throw error;
    }
  }

  /**
   * Check if constraints exist for a graph
   */
  async exists(graphId: string): Promise<boolean> {
    const key = this.getKey(graphId);

    try {
      if (!this.storage) {
        return false;
      }
      return this.storage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get all graph IDs with stored constraints
   */
  async getAllGraphIds(): Promise<string[]> {
    const ids: string[] = [];

    try {
      if (!this.storage) {
        return ids;
      }

      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && key.startsWith(this.prefix)) {
          ids.push(key.substring(this.prefix.length));
        }
      }
    } catch (error) {
      console.error("Failed to get graph IDs:", error);
    }

    return ids;
  }

  /**
   * Clear all stored constraints
   */
  async clearAll(): Promise<void> {
    try {
      if (!this.storage) {
        return;
      }

      const keysToRemove: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        this.storage.removeItem(key);
      }
    } catch (error) {
      console.error("Failed to clear all constraints:", error);
      throw error;
    }
  }

  /**
   * Get storage key for a graph
   */
  private getKey(graphId: string): string {
    return `${this.prefix}${graphId}`;
  }

  /**
   * Migrate data from older schema versions
   */
  private migrateData(data: StorageData): LayoutConstraint[] {
    // Version 1 is current, no migration needed yet
    // Future versions would add migration logic here
    console.warn(
      `Unknown constraint data version ${data.version}, attempting to load as current version`
    );

    const constraints: LayoutConstraint[] = [];
    for (const serialized of data.constraints) {
      const constraint = deserializeConstraint(serialized);
      if (constraint) {
        constraints.push(constraint);
      }
    }

    return constraints;
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a localStorage constraint store instance
 */
export function createLocalStorageConstraintStore(
  prefix?: string,
  storage?: Storage
): LocalStorageConstraintStore {
  return new LocalStorageConstraintStore(prefix, storage);
}
