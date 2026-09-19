import {
  IRI,
  Literal,
  Namespace,
  iriToVaultPath,
  type ITripleStore,
  type Triple,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "./NodeFsAdapter.js";

/**
 * Frontmatter query keys the index answers, mapped to the predicate the
 * converter emits them under (`aliases:` is a bare key read as
 * `exo:Asset_aliases` — {@link UNPREFIXED_ASSET_FIELDS}).
 */
const INDEXED_KEYS: ReadonlyMap<string, IRI> = new Map([
  ["exo__Asset_uid", Namespace.EXO.term("Asset_uid")],
  ["exo__Asset_label", Namespace.EXO.term("Asset_label")],
  ["aliases", Namespace.EXO.term("Asset_aliases")],
]);

/** Lookup counters — the revert-verify axis reads these, never wall-clock. */
export interface TripleStoreIndexStats {
  /** findFilesByMetadata calls answered from the index (no file read). */
  indexedLookups: number;
  /** findFilesByMetadata calls delegated to the base vault-wide scan. */
  scanFallbacks: number;
  /** Ambiguous lookups (>1 candidate) that paid one directory walk for order. */
  walkOrderings: number;
}

/**
 * #4272 — {@link NodeFsAdapter} whose `findFilesByMetadata` / `findFileByUID`
 * answer the three queries the `apply` create-instance path issues —
 * `exo__Asset_uid`, `exo__Asset_label`, `aliases` — from an index over the
 * loaded triple store instead of the base class's vault-wide scan (glob +
 * read + YAML-parse of EVERY markdown file, per call — 11 scans = 183 317 file
 * reads for one `apply create-task-instance` on a 16 664-file vault).
 *
 * The store the command already holds in memory (cache hit / delta / full
 * parse alike) carries one `exo:Asset_uid` / `exo:Asset_label` /
 * `exo:Asset_aliases` triple per frontmatter value of every converted file, so
 * the index is built once from `store.match(undefined, <predicate>)` on the
 * DEFAULT graph (explicit triples only — the inferred layer lives in the named
 * graph `exo:inferred` and is never consulted, because the scan reads only a
 * file's OWN frontmatter).
 *
 * # Identity with the scan (the requirement, not a nice-to-have)
 *
 * Every consumer takes `[0]` of the returned list, so the contract is: same
 * SET and same ORDER as `NodeFsAdapter.findFilesByMetadata` on the same vault.
 *
 * - **Value form.** `matchesQuery` compares the RAW frontmatter value after
 *   `normalizeValue` (strip `"`, `'`, `[`, `]`, trim; arrays match on any
 *   element; no case folding). The converter, however, rewrites the value on
 *   the way into the store (`NoteToRDFConverter.valueToRDFObject`): a
 *   class-shaped string (`ems__Task`) becomes the class IRI, a `[[uid]]`
 *   wikilink becomes the target's file IRI, a number an `xsd:decimal` literal.
 *   {@link storeValueToFrontmatterForm} inverts that per object kind so the
 *   index key is the value the scan would have normalised: literal → lexical
 *   value; class IRI → `Namespace.fromTermIRI` → `prefix__LocalName`; vault
 *   file IRI → the target file's basename (a bare `[[<uid>]]` wikilink — the
 *   only wikilink-form label/alias shape found in the live corpus).
 * - **Duplicates.** When more than one file carries the value, the scan's
 *   order is `getMarkdownFiles()` (glob) order. The index re-orders such
 *   candidates by the very same walk — a directory listing without file reads,
 *   built lazily and only when a lookup is ambiguous.
 * - **Queries the index cannot answer** — a key outside the three, an empty
 *   query value (the scan matches it against every file LACKING the key), an
 *   empty query — are delegated to the base scan unchanged, and counted in
 *   {@link stats.scanFallbacks} so a test can assert the create path never
 *   pays one.
 *
 * Every other read (`readFile`, `getFileMetadata`, `fileExists`, …) and every
 * write is inherited unchanged: the executor still reads the target, the
 * resolved class / ontology / template files and writes the instance through
 * the filesystem exactly as before.
 */
export class TripleStoreIndexedFsAdapter extends NodeFsAdapter {
  private index: Map<string, Map<string, string[]>> | null = null;
  private walkOrder: Map<string, number> | null = null;
  readonly stats: TripleStoreIndexStats = {
    indexedLookups: 0,
    scanFallbacks: 0,
    walkOrderings: 0,
  };

  constructor(
    rootPath: string,
    private readonly store: ITripleStore,
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
    const result = candidates ?? [];
    return result.length > 1 ? this.orderByWalk(result) : result;
  }

  /**
   * Build the index once: for each indexed predicate, every explicit triple's
   * subject path keyed by the frontmatter-form value. Insertion order follows
   * the store's match order (deterministic per store instance).
   */
  private async ensureIndex(): Promise<Map<string, Map<string, string[]>>> {
    if (this.index) return this.index;
    const index = new Map<string, Map<string, string[]>>();
    for (const [key, predicate] of INDEXED_KEYS) {
      const byValue = new Map<string, string[]>();
      const triples: Triple[] = await this.store.match(undefined, predicate);
      for (const triple of triples) {
        const filePath = TripleStoreIndexedFsAdapter.subjectToPath(triple);
        if (filePath === null) continue;
        const raw = TripleStoreIndexedFsAdapter.storeValueToFrontmatterForm(
          triple.object,
        );
        if (raw === null) continue;
        const norm = this.normalizeValue(raw);
        if (norm.length === 0) continue;
        const list = byValue.get(norm);
        if (list === undefined) {
          byValue.set(norm, [filePath]);
        } else if (!list.includes(filePath)) {
          list.push(filePath);
        }
      }
      index.set(key, byValue);
    }
    this.index = index;
    return index;
  }

  /** Subject IRI → vault-relative path, or null for a non-vault subject. */
  private static subjectToPath(triple: Triple): string | null {
    const subject = triple.subject;
    if (!(subject instanceof IRI)) return null;
    return iriToVaultPath(subject.value);
  }

  /**
   * Invert the converter's value rewriting so the index key is what the scan
   * would normalise from the frontmatter text. Returns null for an object
   * kind that never comes from a scalar frontmatter value (blank node,
   * quoted triple).
   */
  private static storeValueToFrontmatterForm(
    object: Triple["object"],
  ): string | null {
    if (object instanceof Literal) return object.value;
    if (!(object instanceof IRI)) return null;
    const term = Namespace.fromTermIRI(object.value);
    if (term) return `${term.namespace.prefix}__${term.localName}`;
    const targetPath = iriToVaultPath(object.value);
    if (targetPath !== null) {
      const slash = targetPath.lastIndexOf("/");
      const name = slash === -1 ? targetPath : targetPath.slice(slash + 1);
      return name.endsWith(".md") ? name.slice(0, -3) : name;
    }
    return object.value;
  }

  /**
   * Order ambiguous candidates the way the scan returns them — by the same
   * `getMarkdownFiles()` walk (a directory listing, no file reads), built once
   * on first ambiguity. Paths the walk does not list keep their index order
   * after the listed ones.
   */
  private async orderByWalk(candidates: string[]): Promise<string[]> {
    if (this.walkOrder === null) {
      this.stats.walkOrderings++;
      const order = new Map<string, number>();
      const files = await super.getMarkdownFiles();
      files.forEach((p, i) => {
        if (!order.has(p)) order.set(p, i);
      });
      this.walkOrder = order;
    }
    const order = this.walkOrder;
    const afterWalk = order.size;
    return candidates
      .map((p, i) => ({ p, rank: order.get(p) ?? afterWalk + i }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ p }) => p);
  }
}
