import {
  IRI,
  Literal,
  Namespace,
  iriToVaultPath,
  type Triple,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "./NodeFsAdapter.js";

/**
 * Frontmatter query keys the index answers, mapped to the predicate the
 * converter emits them under (`aliases:` is a bare key read as
 * `exo:Asset_aliases` — {@link UNPREFIXED_ASSET_FIELDS}).
 */
const INDEXED_KEYS: ReadonlyMap<string, string> = new Map([
  ["exo__Asset_uid", Namespace.EXO.term("Asset_uid").value],
  ["exo__Asset_label", Namespace.EXO.term("Asset_label").value],
  ["aliases", Namespace.EXO.term("Asset_aliases").value],
]);

/**
 * What the index is built from — the loader's EXPLICIT triples (what each
 * file's own frontmatter states) plus the walked files the loader committed
 * no triples for. `loadVaultTriples` produces both (`explicitCount`,
 * `zeroTriplePaths`); the command's triple store is NOT a valid source: the
 * CLI keeps the inferred layer (prototype-chain / RDFS materialisation — 21 181
 * triples on vault-bot-kitelev, 4 534 of them inherited `exo:Asset_aliases`)
 * in the SAME default graph as the explicit triples.
 */
export interface TripleStoreIndexSource {
  explicitTriples: Iterable<Triple>;
  zeroTriplePaths: ReadonlyArray<string>;
}

/** Lookup counters — the revert-verify axes read these, never wall-clock. */
export interface TripleStoreIndexStats {
  /** findFilesByMetadata calls answered from the index. */
  indexedLookups: number;
  /** findFilesByMetadata calls delegated to the base vault-wide scan. */
  scanFallbacks: number;
  /** Index candidates whose frontmatter was read to confirm the match. */
  candidateReads: number;
  /** `zeroTriplePaths` read ONCE while building the index. */
  zeroTripleReads: number;
}

type Index = Map<string, Map<string, string[]>>;

/**
 * #4272 — {@link NodeFsAdapter} whose `findFilesByMetadata` / `findFileByUID`
 * answer the three queries the `apply` create-instance path issues —
 * `exo__Asset_uid`, `exo__Asset_label`, `aliases` — from an index over the
 * loader's explicit triples instead of the base class's vault-wide scan (glob
 * + read + YAML-parse of EVERY markdown file, per call — 11 scans = 183 317
 * file reads for one `apply create-task-instance` on a 16 664-file vault).
 *
 * # Identity with the scan (the requirement, not a nice-to-have)
 *
 * The index is a CANDIDATE generator; the verdict is the scan's own predicate.
 * Every candidate's frontmatter is read and passed through the inherited
 * `matchesQuery` — the very function the scan applies to every file — so a
 * returned path is, by construction, one the scan would have returned. That
 * closes every false-positive source at once: the converter synthesises an
 * `exo:Asset_label` from the basename for an asset that has none (962 of
 * 16 664 files on vault-bot-kitelev), rewrites a `[[uid]]` wikilink into the
 * target's file IRI or class IRI, reads a prefixed `exo__Asset_aliases:` key as
 * the same predicate the scan never looks at, and `normalizeValue` strips
 * `"'[]` anywhere in a value. The reads are bounded by the number of
 * candidates (≈ 1 per lookup), never by the vault size — the axes count them.
 *
 * Two population differences between the loader and the scan are closed
 * explicitly:
 * - files the loader committed no triples for — skipped by an invariant
 *   violation (two-phase commit #2997), excluded under a FileSpace mount, or
 *   simply without frontmatter — are read ONCE while the index is built and
 *   indexed from their own frontmatter ({@link TripleStoreIndexSource.zeroTriplePaths};
 *   2 of 16 664 on the live vault, counted in {@link stats.zeroTripleReads}).
 *   The population rule is the cache entry's (`triples: []` = walked, committed
 *   nothing) and `loadVaultTriples` applies the SAME rule on the full-parse
 *   path (`getAllFiles − committed`), so all three load paths — full parse,
 *   cache hit / delta, cold rebuild — hand the index the same set;
 * - a path with a dot-segment (`.hidden.md`, `.trash/x.md`) is never a
 *   candidate: the scan's glob excludes it (`dot: false`) while the loader's
 *   walk does not.
 *
 * Remaining, documented (all false NEGATIVES on query forms no resolver ever
 * produces; 0 such values on the live corpus): the scan (glob on darwin:
 * `nocase`) sees `*.MD` that the loader's `endsWith(".md")` does not; a label
 * stored as an UNQUOTED date (js-yaml → `Date`) matches only its
 * `String(Date)` rendering in the scan; a `[[uid|alias]]` label / alias
 * matches only the literal text `uid|alias` in the scan (the converter drops
 * the display alias before resolving); a `[[label]]` wikilink whose target is
 * resolved by the converter CASE-INSENSITIVELY through the alias index
 * (`[[ql]]` → the asset aliased `QL`) yields the target's own names as keys
 * (`QL`, basename) while the scan's key is the literal `ql` (no case folding
 * in `normalizeValue`) — a lookup for `ql` finds no candidate.
 *
 * - **Value form.** `matchesQuery` compares the RAW frontmatter value after
 *   `normalizeValue`; the converter rewrites values on the way into the store
 *   (`NoteToRDFConverter.valueToRDFObject`): a class-shaped string (`ems__Task`)
 *   becomes the class IRI, a wikilink the target's file IRI (or the target's
 *   class IRI when the target's own label is class-shaped), a number an
 *   `xsd:decimal` literal. {@link keysForObject} inverts that per object kind
 *   into every frontmatter text the scan could have normalised to the same
 *   thing: literal → its lexical value; class IRI → `prefix__LocalName` PLUS
 *   the uid of each asset whose own label is that class (a `[[<uid>]]` link to
 *   a class file); vault file IRI → the target's basename, own labels and own
 *   aliases (a `[[<uid>]]`, `[[<label>]]` or `[[<alias>]]` link all resolve
 *   there). Extra candidates are harmless — the verdict is the scan's.
 * - **Duplicates.** An ambiguous result is ordered by vault-relative path —
 *   the same order `NodeFsAdapter.getMarkdownFiles()` now returns (sorted;
 *   before #4272 glob's concurrent walk made the scan's `[0]` on a duplicated
 *   value non-deterministic across calls).
 * - **Own writes.** Files this adapter creates / updates / writes / deletes /
 *   renames update the index from the written content (no read), so a
 *   composite grounding that creates an asset and then resolves it by uid in
 *   the same process sees it — as the scan would. Writes that bypass this
 *   adapter (the vault adapter's moves) are not tracked: the index is
 *   otherwise the process-start snapshot, and the create path never resolves
 *   a just-moved asset.
 * - **Queries the index cannot answer** — a key outside the three, an empty
 *   query value (the scan matches it against every file LACKING the key), an
 *   empty query — are delegated to the base scan unchanged, and counted in
 *   {@link stats.scanFallbacks} so a test can assert the create path never
 *   pays one.
 *
 * Every other read (`readFile`, `getFileMetadata`, `fileExists`, …) is
 * inherited unchanged: the executor still reads the target, the resolved
 * class / ontology / template files and writes the instance through the
 * filesystem exactly as before.
 */
export class TripleStoreIndexedFsAdapter extends NodeFsAdapter {
  private indexPromise: Promise<Index> | null = null;
  /** path → the (key, normalised value) pairs it is indexed under (for own writes). */
  private readonly pathKeys = new Map<string, Array<[string, string]>>();
  readonly stats: TripleStoreIndexStats = {
    indexedLookups: 0,
    scanFallbacks: 0,
    candidateReads: 0,
    zeroTripleReads: 0,
  };

  constructor(
    rootPath: string,
    private readonly source: TripleStoreIndexSource,
  ) {
    super(rootPath);
  }

  override async findFilesByMetadata(
    query: Record<string, any>,
  ): Promise<string[]> {
    const entries = Object.entries(query);
    const indexable =
      entries.length > 0 &&
      entries.every(
        ([key, value]) =>
          INDEXED_KEYS.has(key) && this.normalizeValue(value).length > 0,
      );
    if (!indexable) {
      this.stats.scanFallbacks++;
      return super.findFilesByMetadata(query);
    }

    const index = await this.ensureIndex();
    this.stats.indexedLookups++;

    let candidates: string[] | null = null;
    for (const [key, value] of entries) {
      const hits = index.get(key)?.get(this.normalizeValue(value)) ?? [];
      candidates =
        candidates === null
          ? [...hits]
          : candidates.filter((p) => hits.includes(p));
      if (candidates.length === 0) return [];
    }
    const ordered = [...(candidates ?? [])]
      .filter((p) => !TripleStoreIndexedFsAdapter.hasDotSegment(p))
      .sort();

    // Verdict by the scan's own predicate on the candidate's own frontmatter.
    const matches: string[] = [];
    for (const filePath of ordered) {
      this.stats.candidateReads++;
      try {
        const metadata = await this.getFileMetadata(filePath);
        if (this.matchesQuery(metadata, query)) {
          matches.push(filePath);
        }
      } catch {
        // Unreadable / vanished since the source was loaded: not a match — the
        // scan skips such a file the same way.
        continue;
      }
    }
    return matches;
  }

  // --- own writes keep the index current (no reads: the content is in hand) ---

  override async createFile(filePath: string, content: string): Promise<string> {
    const created = await super.createFile(filePath, content);
    await this.reindexOwnWrite(filePath, content);
    return created;
  }

  override async updateFile(filePath: string, content: string): Promise<void> {
    await super.updateFile(filePath, content);
    await this.reindexOwnWrite(filePath, content);
  }

  override async writeFile(filePath: string, content: string): Promise<void> {
    await super.writeFile(filePath, content);
    await this.reindexOwnWrite(filePath, content);
  }

  override async deleteFile(filePath: string): Promise<void> {
    await super.deleteFile(filePath);
    this.forget(await this.ensureIndex(), TripleStoreIndexedFsAdapter.rel(filePath));
  }

  override async renameFile(oldPath: string, newPath: string): Promise<void> {
    await super.renameFile(oldPath, newPath);
    const index = await this.ensureIndex();
    const from = TripleStoreIndexedFsAdapter.rel(oldPath);
    const keys = [...(this.pathKeys.get(from) ?? [])];
    this.forget(index, from);
    const to = TripleStoreIndexedFsAdapter.rel(newPath);
    for (const [key, norm] of keys) this.addKey(index, key, norm, to);
  }

  private async reindexOwnWrite(filePath: string, content: string): Promise<void> {
    const index = await this.ensureIndex();
    const rel = TripleStoreIndexedFsAdapter.rel(filePath);
    this.forget(index, rel);
    let metadata: Record<string, unknown>;
    try {
      metadata = this.extractFrontmatter(content);
    } catch {
      return;
    }
    this.indexFrontmatter(index, rel, metadata);
  }

  /** Vault-relative form of a path this adapter was handed. */
  private static rel(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  private static hasDotSegment(p: string): boolean {
    return p.split("/").some((seg) => seg.startsWith("."));
  }

  private async ensureIndex(): Promise<Index> {
    if (this.indexPromise === null) {
      this.indexPromise = this.buildIndex();
    }
    return this.indexPromise;
  }

  /**
   * Build the index once from the explicit triples, then fold in the files the
   * loader committed nothing for (read once, from their own frontmatter).
   */
  private async buildIndex(): Promise<Index> {
    const index: Index = new Map();
    for (const key of INDEXED_KEYS.keys()) index.set(key, new Map());
    const predicateToKey = new Map<string, string>();
    for (const [key, predicate] of INDEXED_KEYS) predicateToKey.set(predicate, key);

    // Pass 1 — per subject: uid, own label literals / class IRIs, own alias
    // literals (the target-side forms a wikilink to that subject can carry).
    const uidOf = new Map<string, string>();
    const ownNames = new Map<string, string[]>();
    const classIriToPaths = new Map<string, string[]>();
    const relevant: Array<[string, string, Triple["object"]]> = [];
    for (const triple of this.source.explicitTriples) {
      const key = predicateToKey.get(triple.predicate.value);
      if (key === undefined) continue;
      const filePath = TripleStoreIndexedFsAdapter.subjectToPath(triple);
      if (filePath === null) continue;
      relevant.push([key, filePath, triple.object]);
      const object = triple.object;
      if (key === "exo__Asset_uid") {
        if (object instanceof Literal && !uidOf.has(filePath)) uidOf.set(filePath, object.value);
        continue;
      }
      if (object instanceof Literal) {
        TripleStoreIndexedFsAdapter.push(ownNames, filePath, object.value);
      } else if (object instanceof IRI) {
        const term = Namespace.fromTermIRI(object.value);
        if (term) {
          TripleStoreIndexedFsAdapter.push(ownNames, filePath, `${term.namespace.prefix}__${term.localName}`);
          if (key === "exo__Asset_label") {
            TripleStoreIndexedFsAdapter.push(classIriToPaths, object.value, filePath);
          }
        }
      }
    }
    const classIriToUids = new Map<string, string[]>();
    for (const [iri, paths] of classIriToPaths) {
      classIriToUids.set(
        iri,
        paths.map((p) => uidOf.get(p)).filter((u): u is string => u !== undefined),
      );
    }

    // Pass 2 — index every value under every frontmatter text it could have been.
    for (const [key, filePath, object] of relevant) {
      const raws = TripleStoreIndexedFsAdapter.keysForObject(object, classIriToUids, ownNames);
      for (const raw of raws) this.addKey(index, key, this.normalizeValue(raw), filePath);
    }

    // Pass 3 — files with no triples: the scan reads them; so must the index (once).
    for (const filePath of this.source.zeroTriplePaths) {
      this.stats.zeroTripleReads++;
      try {
        this.indexFrontmatter(index, filePath, await this.getFileMetadata(filePath));
      } catch {
        continue;
      }
    }
    return index;
  }

  /** Index a file from its own (raw) frontmatter — exactly what the scan matches on. */
  private indexFrontmatter(index: Index, filePath: string, metadata: Record<string, unknown>): void {
    for (const key of INDEXED_KEYS.keys()) {
      const value = metadata[key];
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) this.addKey(index, key, this.normalizeValue(v), filePath);
    }
  }

  private addKey(index: Index, key: string, norm: string, filePath: string): void {
    if (norm.length === 0) return;
    const byValue = index.get(key);
    if (byValue === undefined) return;
    const list = byValue.get(norm);
    if (list === undefined) byValue.set(norm, [filePath]);
    else if (!list.includes(filePath)) list.push(filePath);
    TripleStoreIndexedFsAdapter.push(this.pathKeys, filePath, [key, norm] as [string, string]);
  }

  private forget(index: Index, filePath: string): void {
    const keys = this.pathKeys.get(filePath);
    if (!keys) return;
    for (const [key, norm] of keys) {
      const list = index.get(key)?.get(norm);
      if (!list) continue;
      const i = list.indexOf(filePath);
      if (i >= 0) list.splice(i, 1);
    }
    this.pathKeys.delete(filePath);
  }

  private static push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  }

  /** Subject IRI → vault-relative path, or null for a non-vault / escaping subject. */
  private static subjectToPath(triple: Triple): string | null {
    const subject = triple.subject;
    if (!(subject instanceof IRI)) return null;
    const p = iriToVaultPath(subject.value);
    if (p === null || p.startsWith("/") || p.startsWith("..") || p.includes("/../")) return null;
    return p;
  }

  /**
   * Invert the converter's value rewriting into every frontmatter text the
   * scan would normalise to the same value. `[]` for an object kind that
   * never comes from a scalar frontmatter value (blank node, quoted triple).
   */
  private static keysForObject(
    object: Triple["object"],
    classIriToUids: ReadonlyMap<string, string[]>,
    ownNames: ReadonlyMap<string, string[]>,
  ): string[] {
    if (object instanceof Literal) return [object.value];
    if (!(object instanceof IRI)) return [];
    const term = Namespace.fromTermIRI(object.value);
    if (term) {
      return [
        `${term.namespace.prefix}__${term.localName}`,
        ...(classIriToUids.get(object.value) ?? []),
      ];
    }
    const targetPath = iriToVaultPath(object.value);
    if (targetPath !== null) {
      const slash = targetPath.lastIndexOf("/");
      const name = slash === -1 ? targetPath : targetPath.slice(slash + 1);
      const basename = name.endsWith(".md") ? name.slice(0, -3) : name;
      return [basename, ...(ownNames.get(targetPath) ?? [])];
    }
    return [object.value];
  }
}
