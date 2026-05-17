import type {
  CommandResolver,
  PreconditionEvaluator,
  ResolvedCommand,
  ILogger,
  EvalContext,
} from "exocortex";
import type {
  ExocmdBindingsCache,
  ExocmdBindingsCacheEntry,
} from "./ExocmdBindingsCache";
import { fnv1aHex } from "./ExocmdBindingsCache";

/**
 * Minimal frontmatter snapshot the indexer needs to (a) discover
 * representative assets per class and (b) reconstruct the symbolic
 * `exo__Asset_label` of UUID-named class assets so symbolic-form lookups
 * can resolve through the cache too.
 *
 * Mirrors Obsidian's `metadataCache.getFileCache(file)?.frontmatter` shape
 * but stays decoupled so the indexer is unit-testable without Obsidian.
 */
export interface FrontmatterRecord {
  readonly path: string;
  readonly frontmatter: Record<string, unknown> | null;
}

/**
 * Vault-access surface the indexer needs. Production wiring funnels
 * `App.metadataCache.getFileCache(file).frontmatter` for every markdown
 * file through this iterator; the unit test substitutes an inline array.
 */
export interface IndexerVaultSource {
  listAllAssets(): Iterable<FrontmatterRecord>;
}

export interface ExocmdBindingsIndexerConfig {
  readonly cache: ExocmdBindingsCache;
  readonly vaultSource: IndexerVaultSource;
  readonly commandResolver: CommandResolver;
  readonly preconditionEvaluator: PreconditionEvaluator;
  readonly logger: ILogger;
}

/**
 * Result summary returned by `runFullScan()` so the caller can emit a
 * structured log line / `performance.measure` without touching the cache
 * file directly. Numbers are kept narrow on purpose — anything richer
 * (per-class durations etc.) is not needed for the AC.
 */
export interface IndexerRunSummary {
  readonly classesScanned: number;
  readonly classesWritten: number;
  readonly assetsConsidered: number;
  readonly errors: number;
}

/**
 * Background indexer that populates {@link ExocmdBindingsCache} after the
 * full vault triple store finishes building (Issue #3183).
 *
 * # Algorithm
 *
 * 1. Walk every markdown asset's frontmatter (cached by Obsidian — no disk
 *    I/O on this scan).
 * 2. Group assets by their primary class signature — the first
 *    `exo__Instance_class` value that is not `exo__Asset`. Post-UUID-canon
 *    (2026-05-16) this is the class UUID; pre-migration assets surface as
 *    symbolic strings. The grouping key is what the reader uses for
 *    lookup, so writer/reader agree without translation.
 * 3. For each class group, pick the first asset as the representative,
 *    construct its full class vector (the rep's actual
 *    `exo__Instance_class` array + `exo__Asset` appended), and resolve
 *    visible commands via the full `CommandResolver` +
 *    `PreconditionEvaluator` — byte-identical to the production path so
 *    cached output renders DOM-identical buttons (Issue #3183 AC #3).
 * 4. Build an {@link ExocmdBindingsCacheEntry} per class with the resolved
 *    commands and a `preconditions_signature` (FNV-1a 32-bit) computed
 *    over the precondition IDs / SPARQL bodies — used downstream to detect
 *    `exocmd__` asset edits that change the set without recomputing
 *    everything.
 * 5. Atomic write through `cache.save()`.
 *
 * # Failure mode
 *
 * One bad class never poisons the cache: errors are caught per-class,
 * counted in the summary, and the remaining classes still write. If the
 * final `save()` itself throws, the previous cache file (if any) survives
 * because of atomic-rename semantics in `ExocmdBindingsCache.save()`.
 *
 * # Cost
 *
 * O(N classes) calls to `resolveForAssetMulti` + ASK evaluations against
 * the warm full triple store. Each call is the same work the production
 * path does on every render — but it runs once, off the UX critical path,
 * after `convertVault()` already finished.
 */
export class ExocmdBindingsIndexer {
  constructor(private readonly config: ExocmdBindingsIndexerConfig) {}

  async runFullScan(): Promise<IndexerRunSummary> {
    const { vaultSource, commandResolver, preconditionEvaluator, logger } =
      this.config;

    const repsByClass = new Map<string, FrontmatterRecord>();
    let assetsConsidered = 0;
    for (const record of vaultSource.listAllAssets()) {
      assetsConsidered++;
      const primary = this.extractPrimaryClass(record.frontmatter);
      if (primary === null) continue;
      if (!repsByClass.has(primary)) {
        repsByClass.set(primary, record);
      }
    }

    const bindings: Record<string, ExocmdBindingsCacheEntry> = {};
    let classesWritten = 0;
    let errors = 0;

    for (const [classKey, rep] of repsByClass) {
      try {
        const entry = await this.resolveForRepresentative(
          classKey,
          rep,
          commandResolver,
          preconditionEvaluator,
        );
        if (entry !== null) {
          bindings[classKey] = entry;
          classesWritten++;
        }
      } catch (err) {
        errors++;
        logger.warn(
          `[ExocmdBindingsIndexer] failed to resolve commands for class ${classKey}: ${String(err)}`,
        );
      }
    }

    try {
      await this.config.cache.save(bindings);
    } catch (err) {
      logger.warn(
        `[ExocmdBindingsIndexer] failed to persist cache: ${String(err)}`,
      );
      errors++;
    }

    return {
      classesScanned: repsByClass.size,
      classesWritten,
      assetsConsidered,
      errors,
    };
  }

  /**
   * Run the full resolver against a single representative asset for the
   * class and return the cache entry shape. Returns `null` when no
   * commands are visible (no need to persist an empty bucket).
   */
  private async resolveForRepresentative(
    classKey: string,
    rep: FrontmatterRecord,
    commandResolver: CommandResolver,
    preconditionEvaluator: PreconditionEvaluator,
  ): Promise<ExocmdBindingsCacheEntry | null> {
    const fm = rep.frontmatter ?? {};
    const assetClasses = this.extractAssetClasses(fm);
    if (assetClasses.length === 0) return null;
    const prototypeIRI = this.extractPrototypeIRI(fm);
    const subjectIRI = `obsidian://vault/${encodeURI(rep.path)}`;

    const resolved = await commandResolver.resolveForAssetMulti(
      subjectIRI,
      assetClasses,
      prototypeIRI,
    );
    if (resolved.length === 0) return null;

    const evalContext: EvalContext = {
      targetIRI: subjectIRI,
      fileBasename: this.basenameOf(rep.path),
      currentFolder: this.parentOf(rep.path),
    };

    const checks = await Promise.all(
      resolved.map(async (rc) => {
        try {
          const available = await preconditionEvaluator.evaluate(
            rc.command.precondition,
            subjectIRI,
            evalContext,
          );
          return { rc, available };
        } catch {
          return { rc, available: false };
        }
      }),
    );

    const visible: ResolvedCommand[] = checks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);

    if (visible.length === 0) return null;

    const signature = this.computePreconditionsSignature(visible);
    void classKey; // key is the caller-provided grouping; nothing to do with it here

    return {
      commands: visible,
      preconditions_signature: signature,
    };
  }

  /**
   * Primary class for grouping = first non-`exo__Asset` value in
   * `exo__Instance_class`. Matches the priority logic of the production
   * reader so writer/reader keys align without translation.
   */
  private extractPrimaryClass(
    frontmatter: Record<string, unknown> | null,
  ): string | null {
    if (frontmatter === null) return null;
    const raw = frontmatter["exo__Instance_class"];
    if (raw === undefined || raw === null) return null;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== "string") continue;
      const cleaned = v.replace(/["'[\]]/g, "").trim().split("|")[0].trim();
      if (cleaned.length === 0) continue;
      if (cleaned === "exo__Asset") continue;
      return cleaned;
    }
    return null;
  }

  /**
   * Mirror `DynamicCommandButtonGroupBuilder.extractAssetClasses` minus the
   * UUID→symbolic expansion: the indexer is decoupled from
   * `App.metadataCache.getFirstLinkpathDest`, so it stores the cache under
   * the raw primary-class key and the lookup tries each of the reader's
   * candidate keys in turn (UUID first, then symbolic via the reader's
   * own expansion). This keeps the indexer Obsidian-independent.
   */
  private extractAssetClasses(
    frontmatter: Record<string, unknown>,
  ): string[] {
    const raw = frontmatter["exo__Instance_class"];
    const classes: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value !== "string") return;
      const cleaned = value.replace(/["'[\]]/g, "").trim().split("|")[0].trim();
      if (cleaned.length > 0 && !classes.includes(cleaned)) {
        classes.push(cleaned);
      }
    };
    if (typeof raw === "string") {
      collect(raw);
    } else if (Array.isArray(raw)) {
      for (const item of raw) collect(item);
    }
    if (classes.length === 0) return [];
    if (!classes.includes("exo__Asset")) classes.push("exo__Asset");
    return classes;
  }

  private extractPrototypeIRI(
    frontmatter: Record<string, unknown>,
  ): string | undefined {
    const raw = frontmatter["exo__Asset_prototype"];
    if (typeof raw !== "string") return undefined;
    const cleaned = raw.replace(/["'[\]]/g, "").trim();
    return cleaned.length > 0 ? cleaned : undefined;
  }

  /**
   * Stable hash of every precondition definition referenced by the
   * resolved commands. Used downstream so an `exocmd__Precondition`
   * edit invalidates just the affected class without comparing the full
   * command list pair-wise.
   */
  private computePreconditionsSignature(
    commands: ReadonlyArray<ResolvedCommand>,
  ): string {
    const parts: string[] = [];
    for (const rc of commands) {
      const p = rc.command.precondition;
      if (!p) {
        parts.push(`${rc.command.id}:no-precondition`);
        continue;
      }
      parts.push(
        `${rc.command.id}:${p.id}:${p.sparqlAsk ?? ""}:${p.query ?? ""}:${p.hostFunction ?? ""}`,
      );
    }
    return `fnv1a:${fnv1aHex(parts.join(""))}`;
  }

  private basenameOf(path: string): string {
    const idx = path.lastIndexOf("/");
    const tail = idx >= 0 ? path.slice(idx + 1) : path;
    const dot = tail.lastIndexOf(".");
    return dot > 0 ? tail.slice(0, dot) : tail;
  }

  private parentOf(path: string): string | undefined {
    const idx = path.lastIndexOf("/");
    return idx >= 0 ? path.slice(0, idx) : undefined;
  }
}
