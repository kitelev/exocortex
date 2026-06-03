import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  RDFSInferenceEngine,
  NonInheritablePropertyRegistry,
  PropertyCardinalityRegistry,
  PrototypeChainMaterializer,
  NoteToRDFConverter,
  Triple,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { resolveCrossVaultInstanceClassWikilinks } from "../utils/crossVaultInstanceClassResolver.js";
import { deriveSubjectIriPrefix } from "../utils/AlsoVaultMountPrefix.js";

export interface BuildCombinedTriplesOptions {
  /** Disable RDFS subClassOf inference materialization */
  noInference?: boolean;
  /** Suppress console output during build (default: false) */
  silent?: boolean;
  /** Custom logger; defaults to console.log */
  log?: (msg: string) => void;
}

export interface BuildCombinedTriplesResult {
  /** Materialized triple set (cross-vault resolved + RDFS + prototype chain) */
  triples: Triple[];
  /** Raw triples loaded from vaults, before any post-processing */
  rawTripleCount: number;
  /** Triples emitted by cross-vault Instance_class resolution */
  crossVaultAddedTripleCount: number;
  /** Triples emitted by RDFS + prototype chain materialization */
  inferredTripleCount: number;
}

/**
 * Loads triples from a primary vault plus zero or more `--also` vaults,
 * applies cross-vault wikilink resolution, and runs RDFS + prototype-chain
 * materialization on the combined triple store.
 *
 * This is the orchestration shared by `sparql index --also` (Issue #3281)
 * and any future caller that needs a cross-vault materialized triple set.
 *
 * Behaviour:
 *   1. For each vault path (primary + alsos): construct a per-vault adapter,
 *      run NoteToRDFConverter.convertVault, and concat the raw triples.
 *   2. Apply `resolveCrossVaultInstanceClassWikilinks` so an asset in vault A
 *      that declares `exo__Instance_class: [[<class-uid>]]` is properly typed
 *      even when the class file lives in vault B.
 *   3. Add all triples to an InMemoryTripleStore.
 *   4. Run RDFSInferenceEngine.materialize on the combined store, then
 *      PrototypeChainMaterializer (gated on NonInheritablePropertyRegistry +
 *      PropertyCardinalityRegistry, mirroring sparql-index.ts behaviour).
 *   5. Return the materialized triple set together with diagnostic counts.
 *
 * @throws VaultNotFoundError if any vault path does not exist.
 */
export async function buildCombinedTriples(
  primaryVaultPath: string,
  alsoVaultPaths: string[],
  options: BuildCombinedTriplesOptions = {},
): Promise<BuildCombinedTriplesResult> {
  const silent = options.silent ?? false;
  const log = options.log ?? ((msg: string) => console.log(msg));

  const primary = resolve(primaryVaultPath);
  if (!existsSync(primary)) {
    throw new VaultNotFoundError(primary);
  }

  // Resolve, dedupe (against primary), and preserve original order for log clarity.
  const resolvedAlsos: string[] = [];
  for (const a of alsoVaultPaths) {
    const r = resolve(a);
    if (!existsSync(r)) {
      throw new VaultNotFoundError(r);
    }
    if (r === primary || resolvedAlsos.includes(r)) {
      continue;
    }
    resolvedAlsos.push(r);
  }

  // Issue #3352 — pre-build sibling adapters with their derived
  // `subjectIriPrefix` before constructing the primary adapter. The
  // primary adapter is then configured with these siblings so its
  // `getFirstLinkpathDest` (Step 5) resolves label-form wikilinks whose
  // target lives in an `--also` vault. Keeps the combined-cache path
  // symmetric with the non-cached `sparql query --also` path.
  const alsoAdapters: FileSystemVaultAdapter[] = [];
  const alsoPrefixes: string[] = [];
  for (const alsoPath of resolvedAlsos) {
    // Issue #3219 — preserve `assetspaces/<sub>/` prefix on subject IRIs so
    // cached cross-vault triples match the form that non-cached `--also`
    // loads produce, keeping cache-hit and cache-miss queries consistent.
    const subjectIriPrefix = deriveSubjectIriPrefix(alsoPath);
    alsoAdapters.push(
      new FileSystemVaultAdapter(alsoPath, { subjectIriPrefix }),
    );
    alsoPrefixes.push(subjectIriPrefix);
  }

  // Load primary
  if (!silent) {
    log(`📦 Loading primary vault: ${primary}...`);
  }
  let triples: Triple[] = [];
  const primaryAdapter = new FileSystemVaultAdapter(primary, {
    siblingAdapters: alsoAdapters,
  });
  const primaryConverter = new NoteToRDFConverter(primaryAdapter);
  const primaryTriples = await primaryConverter.convertVault();
  triples = triples.concat(primaryTriples);
  if (!silent) {
    log(`   ➕ Added ${primaryTriples.length} triples from primary vault`);
  }

  // Load each --also vault using the pre-built adapter.
  for (let i = 0; i < alsoAdapters.length; i++) {
    const alsoPath = resolvedAlsos[i];
    const alsoAdapter = alsoAdapters[i];
    const subjectIriPrefix = alsoPrefixes[i];
    if (!silent) {
      log(`📦 Loading additional vault: ${alsoPath}...`);
    }
    const alsoConverter = new NoteToRDFConverter(alsoAdapter, undefined, {
      subjectIriPrefix,
    });
    const alsoTriples = await alsoConverter.convertVault();
    triples = triples.concat(alsoTriples);
    if (!silent) {
      log(`   ➕ Added ${alsoTriples.length} triples from ${alsoPath}`);
    }
  }

  const rawTripleCount = triples.length;

  // Cross-vault Instance_class resolution — emits canonical-IRI triples for
  // assets whose class definition lives in another vault.
  let crossVaultAddedTripleCount = 0;
  if (resolvedAlsos.length > 0) {
    const before = triples.length;
    // resolveCrossVaultInstanceClassWikilinks operates on the DomainTriple type
    // which is a re-export of the same Triple class; safe to cast.
    triples = resolveCrossVaultInstanceClassWikilinks(triples as Triple[]) as Triple[];
    crossVaultAddedTripleCount = triples.length - before;
    if (!silent && crossVaultAddedTripleCount > 0) {
      log(
        `   🔗 Cross-vault Instance_class resolution: emitted ${crossVaultAddedTripleCount} canonical-IRI triple(s)`,
      );
    }
  }

  // Materialization (mirrors sparql-index.ts current single-vault behaviour
  // but runs on the combined store so cross-vault subclass / prototype
  // chains are now visible to the reasoner).
  let inferredTripleCount = 0;
  if (options.noInference !== true) {
    const tripleStore = new InMemoryTripleStore();
    await tripleStore.addAll(triples);

    const rdfsEngine = new RDFSInferenceEngine();
    const rdfsCount = await rdfsEngine.materialize(tripleStore);
    inferredTripleCount += rdfsCount;

    const registry = new NonInheritablePropertyRegistry();
    await registry.initialize(tripleStore);
    const cardinalityRegistry = new PropertyCardinalityRegistry();
    await cardinalityRegistry.initialize(tripleStore);
    const protoMaterializer = new PrototypeChainMaterializer(registry, cardinalityRegistry);
    const protoCount = await protoMaterializer.materialize(tripleStore);
    inferredTripleCount += protoCount;

    if (inferredTripleCount > 0) {
      triples = await tripleStore.match();
      if (!silent) {
        log(
          `🧠 Materialized ${inferredTripleCount} inferred triples on combined store (RDFS + prototype chain)`,
        );
      }
    }
  }

  return {
    triples,
    rawTripleCount,
    crossVaultAddedTripleCount,
    inferredTripleCount,
  };
}
