import {
  InMemoryTripleStore,
  RDFSInferenceEngine,
  NonInheritablePropertyRegistry,
  PropertyCardinalityRegistry,
  PrototypeChainMaterializer,
  type Triple,
} from "@kitelev/exocortex-core";
import { serializeNode } from "./tripleSerialization.js";

/**
 * Result of {@link materializeInferredTriples}.
 */
export interface MaterializeInferredResult {
  /**
   * Triples the inference engines ADDED on top of the explicit set — the
   * store's default-graph content minus every explicit triple (keyed by the
   * serialized `subject|predicate|object` form, i.e. the same identity the
   * persisted cache uses). This is the inferred LAYER the cache stores
   * separately from the per-file explicit triples (#4263).
   */
  inferred: Triple[];
  /**
   * `RDFSInferenceEngine.materialize` + `PrototypeChainMaterializer.materialize`
   * counts, summed — what `index` has always reported as "Materialized N
   * inferred triples".
   */
  inferredCount: number;
}

/**
 * Serialized identity of a triple — the same form the JSON cache persists, so
 * the explicit/inferred split survives a save → load round-trip unchanged.
 */
export function tripleKey(triple: Triple): string {
  const s = serializeNode(triple.subject);
  const p = serializeNode(triple.predicate);
  const o = serializeNode(triple.object);
  return `${s.type}:${s.value}|${p.type}:${p.value}|${o.type}:${o.value}|${o.datatype ?? ""}|${o.language ?? ""}`;
}

/**
 * Run the SAME inference pipeline `exocortex index` runs (RDFS `Instance_class`
 * ancestor closure, then prototype-chain inheritance) over an explicit triple
 * set and return only what the engines added.
 *
 * #4263: the persistent triple cache keeps the inferred layer in its own
 * bucket (it is derived from the WHOLE explicit set and belongs to no single
 * file), and a delta refresh re-runs this function over the merged explicit
 * triples so the layer is neither left stale nor silently dropped. `index`
 * and `CacheManager` share this one implementation so the two paths cannot
 * drift (see `tripleSerialization.ts` for the same argument applied to the
 * serializers).
 */
export async function materializeInferredTriples(
  explicit: Triple[],
): Promise<MaterializeInferredResult> {
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(explicit);

  const engine = new RDFSInferenceEngine();
  let inferredCount = await engine.materialize(tripleStore);

  // Prototype chain materialization (after RDFS inference)
  const registry = new NonInheritablePropertyRegistry();
  await registry.initialize(tripleStore);
  const cardinalityRegistry = new PropertyCardinalityRegistry();
  await cardinalityRegistry.initialize(tripleStore);
  const protoMaterializer = new PrototypeChainMaterializer(
    registry,
    cardinalityRegistry,
  );
  inferredCount += await protoMaterializer.materialize(tripleStore);

  if (inferredCount <= 0) {
    return { inferred: [], inferredCount: 0 };
  }

  const explicitKeys = new Set<string>();
  for (const t of explicit) {
    explicitKeys.add(tripleKey(t));
  }
  const all = await tripleStore.match();
  const inferred: Triple[] = [];
  for (const t of all) {
    if (!explicitKeys.has(tripleKey(t))) {
      inferred.push(t);
    }
  }
  return { inferred, inferredCount };
}
