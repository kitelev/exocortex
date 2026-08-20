/**
 * Issue #4011 — a dash-prefixed reified predicate rendered as a raw IRI and
 * broke the inline↔reified dedup.
 *
 * `exo__Statement_predicate` resolves to a PATH-form IRI whenever the predicate
 * definition's `exo__Asset_label` is not itself parseable as `prefix__Local` —
 * which a dash-bearing prefix (`adapter-exo-ims__relatesToConcept`) is not. The
 * pure `predicateIriToKey` canonicalises only ontology-base IRIs and returns
 * anything else verbatim, so the raw `obsidian://…/<uid>.md` reached BOTH
 * consumers:
 *
 *   1. `propertyName` → the Asset Relations group heading showed the raw IRI
 *      (pixel-verified on the live vault, 2026-07-31);
 *   2. the dedup key → it could never equal the inline side's frontmatter key,
 *      so a relation existing in BOTH forms surfaced twice, defeating the
 *      documented "inline-wins" contract.
 *
 * ⛤ `predicateIriToKey` itself is NOT changed: it is a pure function with no
 * vault access, and "pass a non-ontology IRI through" is a correct contract for
 * it — its existing axis stays green for the right reason. The second hop needs
 * the vault, so it lives where the vault already is.
 *
 * ⚠ Grade 2 was derived from the code in the reporting session and NOT
 * reproduced there (the probe asset had no inline twin). It is reproduced here.
 *
 * Revert-verify: dropping the second hop turns both axes RED; the symbolic and
 * unresolvable axes stay GREEN in both states.
 */
import { RelationsRenderer } from "@plugin/presentation/renderers/layout/RelationsRenderer";
import { InMemoryTripleStore } from "@kitelev/exocortex-core";
import { Triple, IRI, Namespace } from "@kitelev/exocortex-core";
import type { TFile } from "obsidian";

const VAULT_IRI_PREFIX = "obsidian://vault/";
const iriOf = (path: string) => new IRI(VAULT_IRI_PREFIX + path);

const A_PATH = "assetspaces/kitelev/exoas-my/my/aaaaaaaa-0001.md";
const B_PATH = "assetspaces/kitelev/exoas-public/concept/bbbbbbbb-0002.md";
const S_PATH = "assetspaces/kitelev/exoas-class-relations/cr/11111111-0011.md";
/** The predicate DEFINITION asset — its label is the frontmatter key. */
const PRED_PATH =
  "assetspaces/kitelev/exoas-public/adapter-exo-ims/0967a771.md";
const PRED_KEY = "adapter-exo-ims__relatesToConcept";

describe("Issue #4011: a dash-prefixed reified predicate resolves to its key", () => {
  /** Frontmatter by vault path — the only thing the renderer reads for the hop. */
  const fmByPath = new Map<string, Record<string, unknown>>([
    [A_PATH, { exo__Asset_uid: "uid-a" }],
    [B_PATH, { exo__Asset_uid: "uid-b" }],
    [PRED_PATH, { exo__Asset_label: PRED_KEY }],
  ]);

  /**
   * Seeds one reified statement. `incoming` puts B on the subject side, which is
   * the shape the inline dedup seed mirrors: it keys inline relations as
   * "sourceFile --propertyName--> A", i.e. edges POINTING AT the open asset.
   */
  async function seed(
    store: InMemoryTripleStore,
    predicate: IRI,
    incoming = false,
  ) {
    const [subj, obj] = incoming
      ? [iriOf(B_PATH), iriOf(A_PATH)]
      : [iriOf(A_PATH), iriOf(B_PATH)];
    const stmt = iriOf(S_PATH);
    await store.add(
      new Triple(
        stmt,
        Namespace.RDF.term("type"),
        Namespace.EXO.term("Statement"),
      ),
    );
    await store.add(
      new Triple(stmt, Namespace.EXO.term("Statement_subject"), subj),
    );
    await store.add(
      new Triple(stmt, Namespace.EXO.term("Statement_predicate"), predicate),
    );
    await store.add(
      new Triple(stmt, Namespace.EXO.term("Statement_object"), obj),
    );
    await store.add(new Triple(subj, predicate, obj));
  }

  function makeRenderer(store: InMemoryTripleStore): RelationsRenderer {
    const vaultAdapter = {
      getAbstractFileByPath: (p: string) =>
        fmByPath.has(p) ? ({ path: p } as never) : null,
      getFrontmatter: (f: { path: string } | null) =>
        (f ? (fmByPath.get(f.path) ?? null) : null) as never,
    };
    const metadataService = { getAssetLabel: () => null };
    return new RelationsRenderer(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      metadataService as never,
      {} as never,
      (() => {}) as never,
      vaultAdapter as never,
      store,
      () => true,
      ((p: string) => iriOf(p)) as never,
    );
  }

  /** Runs the private merge and returns the reified relations it appended. */
  async function merged(
    predicate: IRI,
    seedInline: boolean,
  ): Promise<{ propertyName?: string; provenance?: string }[]> {
    const store = new InMemoryTripleStore();
    await seed(store, predicate, seedInline);
    const renderer = makeRenderer(store);
    const relations: Record<string, unknown>[] = seedInline
      ? [
          {
            provenance: "inline",
            propertyName: PRED_KEY,
            path: B_PATH,
            metadata: { exo__Asset_uid: "uid-b" },
          },
        ]
      : [];
    await (
      renderer as unknown as {
        mergeReifiedRelations: (f: TFile, r: unknown[]) => Promise<void>;
      }
    ).mergeReifiedRelations({ path: A_PATH } as TFile, relations);
    return relations as { propertyName?: string; provenance?: string }[];
  }

  it("names the group by the frontmatter key, not the raw IRI", async () => {
    // Grade 1 — the pixel-verified symptom.
    const out = await merged(iriOf(PRED_PATH), false);
    const reified = out.filter((r) => r.provenance === "reified");
    expect(reified).toHaveLength(1);
    expect(reified[0].propertyName).toBe(PRED_KEY);
  });

  it("dedups against the inline twin (inline wins)", async () => {
    // Grade 2 — derived from code in the reporting session, reproduced here.
    const out = await merged(iriOf(PRED_PATH), true);
    expect(out.filter((r) => r.provenance === "reified")).toHaveLength(0);
    expect(out).toHaveLength(1);
  });

  it("leaves a SYMBOLIC ontology predicate alone", async () => {
    // Canary — green in BOTH states; the pure function already handles this.
    const out = await merged(
      new IRI("https://exocortex.my/ontology/exo-ims#relatesToConcept"),
      false,
    );
    const reified = out.filter((r) => r.provenance === "reified");
    expect(reified[0].propertyName).toBe("exo-ims__relatesToConcept");
  });

  it("falls back to the raw IRI when the definition cannot be resolved", async () => {
    // Canary — green in BOTH states. Fail-open: an unknown predicate must still
    // surface the relation rather than crash or drop it.
    const unknown = iriOf("assetspaces/nowhere/does-not-exist.md");
    const out = await merged(unknown, false);
    const reified = out.filter((r) => r.provenance === "reified");
    expect(reified[0].propertyName).toBe(unknown.value);
  });
});
