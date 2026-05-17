import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  CommandResolver,
  PreconditionEvaluator,
  type IVaultAdapter,
  type IFile,
  type ILogger,
  type ResolvedCommand,
  type EvalContext,
  type DomainTriple,
} from "exocortex";

/**
 * Cold-start fast-path resolver for `exocmd__Command` button visibility
 * (Issue #3171).
 *
 * # Problem
 *
 * `VaultRDFIndexer.initialize()` synchronously scans the entire vault and
 * builds the full triple store before any SPARQL query (including the
 * precondition ASKs that gate button visibility) can run. On a 12k+ file
 * vault this takes ~40 s on iPhone Obsidian and ~10 s on desktop — the user
 * sees zero exocmd buttons during that window, breaking the GTD flow of
 * "open note → tap button".
 *
 * # Approach
 *
 * Build a *mini* in-memory triple store that contains only the two pieces
 * actually needed to evaluate button visibility for ONE open asset:
 *
 *   1. The target file's frontmatter triples (subject = the open note).
 *   2. Triples from the ~41 `assetspaces/exocmd/*.md` files
 *      (`exocmd__Command`, `exocmd__CommandBinding`, `exocmd__Precondition`,
 *      `exocmd__Grounding` definitions).
 *
 * That is ~42 file lookups via Obsidian's *already-warm* metadata cache
 * (through `IVaultAdapter.getFrontmatter`), versus 12k+ file reads on the
 * full path.
 *
 * The same `CommandResolver` and `PreconditionEvaluator` classes are
 * instantiated against this mini-store, so binding-matching, deduplication,
 * priority sorting, and SPARQL ASK evaluation are byte-identical to the
 * full path. The only semantic difference is that preconditions which
 * traverse the broader graph (e.g. `?cls Class_superClass+ exo:Prototype`)
 * may return `false` because the class-hierarchy assets are not in the
 * mini-store — the caller upgrades to the full resolver once
 * `SPARQLApi.isReady()` flips to true (background `convertVault()`
 * completion), and the open file re-renders automatically.
 *
 * # Caching
 *
 * The exocmd file list and their parsed triples are cached after the first
 * `resolveVisibleCommands` call. Cache invalidation is triggered explicitly
 * via {@link ExocmdFastResolver.invalidateCommandCache} — wired in
 * `ExocortexPlugin` to `metadataCache.on('changed')` for files inside the
 * exocmd directory root.
 */
export class ExocmdFastResolver {
  private cachedExocmdTriples: DomainTriple[] | null = null;
  private readonly converter: NoteToRDFConverter;

  /**
   * @param vault Adapter over Obsidian's `vault` + `metadataCache`. The fast
   *   path uses `getAllFiles()` + `getFrontmatter(file)` to read frontmatter
   *   from the *already-warm* metadata cache — no extra disk I/O on the
   *   startup path.
   * @param exocmdAssetspaceRoot The vault-relative directory that holds
   *   exocmd assets (typically `assetspaces/exocmd`). Files outside this
   *   root are not included in the mini-store.
   * @param logger Structured logger; defaults to a no-op via the underlying
   *   converter / resolver.
   */
  constructor(
    private readonly vault: IVaultAdapter,
    private readonly exocmdAssetspaceRoot: string,
    private readonly logger: ILogger,
  ) {
    this.converter = new NoteToRDFConverter(this.vault, this.logger);
  }

  /**
   * Resolve all visible `exocmd__Command` instances for the given open file.
   *
   * Returns an array shaped exactly like
   * `DynamicCommandButtonGroupBuilder.resolveVisibleCommands`'s
   * `visibleCommands` slice, so the consumer (the builder) can drop in the
   * fast-path result without further normalization.
   *
   * - Empty array when the target file has no `exo__Instance_class`, no
   *   frontmatter at all, or no bindings match (after precondition filter).
   * - Class-hierarchy-traversing preconditions degrade gracefully to `false`
   *   (the underlying `PreconditionEvaluator.evaluateSparqlAsk` returns
   *   `false` on missing triples — never throws).
   */
  async resolveVisibleCommands(
    currentFile: IFile,
  ): Promise<ResolvedCommand[]> {
    const targetFrontmatter = this.vault.getFrontmatter(currentFile);
    if (!targetFrontmatter) return [];

    const assetClasses = this.extractAssetClasses(targetFrontmatter);
    if (assetClasses.length === 0) return [];

    // Build the mini-store: target triples + cached exocmd triples.
    const miniStore = new InMemoryTripleStore();

    let targetTriples: DomainTriple[];
    try {
      targetTriples = await this.converter.convertNote(currentFile);
    } catch (err) {
      this.logger.warn(
        `[ExocmdFastResolver] failed to convert target file ${currentFile.path}: ${String(err)}`,
      );
      return [];
    }

    const exocmdTriples = await this.getExocmdTriples();
    await miniStore.addAll([...targetTriples, ...exocmdTriples]);

    // Stand up resolver + evaluator against the mini-store. They are cheap
    // to construct — both just hold a reference to the store and lazily
    // build their internal caches per query.
    const commandResolver = new CommandResolver(miniStore, this.logger);
    // No queryBodyResolver: fast-path does not support `exocmd__Command_query`
    // references (Phase 1a) — those degrade to false until full path catches
    // up, identical to the class-hierarchy degradation above.
    const preconditionEvaluator = new PreconditionEvaluator(miniStore);

    // CRITICAL: subjectIRI MUST match the IRI emitted by NoteToRDFConverter
    // for `currentFile`. The converter uses
    // `obsidian://vault/${encodeURI(file.path)}` (see
    // `vaultPathToIRI` in `packages/exocortex/src/infrastructure/vault/iri.ts`),
    // matching DynamicCommandButtonGroupBuilder.resolveVisibleCommands.
    const subjectIRI = `obsidian://vault/${encodeURI(currentFile.path)}`;
    const prototypeIRI = this.extractPrototypeIRI(targetFrontmatter);

    let resolved: ResolvedCommand[];
    try {
      resolved = await commandResolver.resolveForAssetMulti(
        subjectIRI,
        assetClasses,
        prototypeIRI,
      );
    } catch (err) {
      this.logger.info(
        `[ExocmdFastResolver] command resolve failed: ${String(err)}`,
      );
      return [];
    }
    if (resolved.length === 0) return [];

    const evalContext: EvalContext = {
      targetIRI: subjectIRI,
      fileBasename: currentFile.basename,
      currentFolder: currentFile.parent?.path,
    };

    // Evaluate preconditions in PARALLEL — mirrors the full path
    // (DynamicCommandButtonGroupBuilder lines 281-294).
    const availabilityChecks = await Promise.all(
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

    return availabilityChecks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);
  }

  /**
   * Invalidate the cached exocmd triples. Call this when any file inside
   * `exocmdAssetspaceRoot` changes — the next `resolveVisibleCommands` call
   * rebuilds the mini-store from a fresh scan.
   */
  invalidateCommandCache(): void {
    this.cachedExocmdTriples = null;
  }

  // -- Private --

  /**
   * Read frontmatter of every file under `exocmdAssetspaceRoot` and convert
   * to triples via the shared `NoteToRDFConverter`. Cached on first call.
   *
   * Implementation note: this does NOT use `vault.read()` — only
   * `getFrontmatter()` (metadata cache lookup). The metadata cache is
   * already warm by the time Obsidian fires `layout-ready`, so this is an
   * in-memory traversal of ~41 files.
   */
  private async getExocmdTriples(): Promise<DomainTriple[]> {
    if (this.cachedExocmdTriples) return this.cachedExocmdTriples;

    const allFiles = this.vault.getAllFiles();
    const rootPrefix = this.exocmdAssetspaceRoot.endsWith("/")
      ? this.exocmdAssetspaceRoot
      : this.exocmdAssetspaceRoot + "/";

    // Include files inside `assetspaces/exocmd/...` AND any direct child of
    // `assetspaces/exocmd` (no leading slash difference).
    const exocmdFiles = allFiles.filter(
      (f) =>
        f.path.startsWith(rootPrefix) ||
        f.path === this.exocmdAssetspaceRoot,
    );

    const triples: DomainTriple[] = [];
    for (const file of exocmdFiles) {
      try {
        const fileTriples = await this.converter.convertNote(file);
        triples.push(...fileTriples);
      } catch (err) {
        // Single bad asset must not poison the cache — log and skip.
        this.logger.warn(
          `[ExocmdFastResolver] failed to convert exocmd file ${file.path}: ${String(err)}`,
        );
      }
    }

    this.cachedExocmdTriples = triples;
    return triples;
  }

  /**
   * Extract `exo__Instance_class` values from frontmatter and append the
   * universal `exo__Asset` superclass — mirrors
   * `DynamicCommandButtonGroupBuilder.extractAssetClasses` (minus the
   * UUID→symbolic expansion which requires `App` access; the fast path
   * accepts a small precision loss here — bindings with UUID-only
   * `targetClass` references are rare in starter-kit and the background
   * full-resolver re-render covers them).
   */
  private extractAssetClasses(metadata: Record<string, unknown>): string[] {
    const raw = metadata["exo__Instance_class"];
    const classes: string[] = [];

    const collect = (value: unknown): void => {
      if (typeof value !== "string") return;
      const cleaned = value.replace(/["'[\]]/g, "").trim();
      if (cleaned && !classes.includes(cleaned)) classes.push(cleaned);
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
    metadata: Record<string, unknown>,
  ): string | undefined {
    const raw = metadata["exo__Asset_prototype"];
    if (typeof raw === "string") {
      return raw.replace(/["'[\]]/g, "").trim();
    }
    return undefined;
  }
}
