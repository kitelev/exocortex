import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * The fixture vault both halves of req `07509cf9` run on — the axes of the new
 * DECLARED-property resolver and the axis that pins the EXISTING required-property
 * resolver's output as unchanged.
 *
 * It is deliberately ONE shared vault: "the existing resolver is unchanged" is a
 * statement about the SAME graph, so the two files must not each build their own.
 * And it is a real file tree read through the production loader
 * (`loadVaultTriples`), not a hand-assembled triple list — the guards under test
 * are exactly the ones that only engage on what `NoteToRDFConverter` actually
 * emits (a class reference whose target carries a `prefix__Name` label comes out
 * SYMBOLICALLY, and `exo__Asset_label` on such an asset comes out as an IRI, not
 * a Literal — see `sparql-iri-form-pre-verify` §A29).
 *
 * Shape:
 *
 *   tst__Base ←superClass— tst__Mid ←superClass— tst__Leaf        tst__Lone   tst__Other
 *      ↑domain                ↑domain               ↑domain                      ↑domain
 *   tst__Base_required     tst__Mid_ref        tst__Leaf_optional            tst__Other_noise
 *   (minCount 1)           (range → tst__Pick)  (no minCount)                (minCount 1)
 *
 * `tst__Lone` exists to pin the empty case; `tst__Other` exists so that "every
 * declared property" cannot be satisfied by returning EVERYTHING — its property
 * must stay out of `tst__Leaf`'s answer.
 */

/** `exo__Class` — the metaclass every class asset below instantiates. */
const EXO_CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
/** `exo__Property` — the metaclass every property definition instantiates. */
const EXO_PROPERTY = "38277bfa-d7f9-4a75-b856-b23276ab0db3";

export const CLS_BASE = "aaaaaaaa-0000-4000-8000-000000000001";
export const CLS_MID = "aaaaaaaa-0000-4000-8000-000000000002";
export const CLS_LEAF = "aaaaaaaa-0000-4000-8000-000000000003";
export const CLS_LONE = "aaaaaaaa-0000-4000-8000-000000000004";
export const CLS_PICK = "aaaaaaaa-0000-4000-8000-000000000005";
export const CLS_OTHER = "aaaaaaaa-0000-4000-8000-000000000006";
/**
 * The one class whose label does NOT parse as `prefix__Name`. That single fact
 * flips the converter to the OTHER IRI form: references to it come out as file
 * IRIs (`obsidian://vault/…/<uid>.md`) instead of symbolic ontology terms. It
 * exists so "a class reference arrives in EITHER form" is exercised by data
 * rather than asserted — without it the whole fixture would be symbolic and the
 * dual-form guard would be untested in one of its two directions.
 */
export const CLS_PLAIN = "aaaaaaaa-0000-4000-8000-000000000007";

export const PROP_REQUIRED = "bbbbbbbb-0000-4000-8000-000000000001";
export const PROP_OPTIONAL = "bbbbbbbb-0000-4000-8000-000000000002";
export const PROP_REF = "bbbbbbbb-0000-4000-8000-000000000003";
export const PROP_NOISE = "bbbbbbbb-0000-4000-8000-000000000004";
export const PROP_PLAIN = "bbbbbbbb-0000-4000-8000-000000000005";
/**
 * Declares TWO domains, BOTH of them on the leaf's ancestor chain. Without the
 * dedupe by frontmatter key the same key would come back twice; and its label
 * sorts SECOND while its uid makes it arrive LAST, so it is also the only input
 * on which the deterministic ordering is observable.
 */
export const PROP_DUAL = "bbbbbbbb-0000-4000-8000-000000000006";

/**
 * Labels. Every one is `prefix__Name` — so the converter emits that class ref
 * symbolically — EXCEPT `CLS_PLAIN`, which is deliberately not.
 */
export const LABELS: Readonly<Record<string, string>> = {
  [CLS_BASE]: "tst__Base",
  [CLS_MID]: "tst__Mid",
  [CLS_LEAF]: "tst__Leaf",
  [CLS_LONE]: "tst__Lone",
  [CLS_PICK]: "tst__Pick",
  [CLS_OTHER]: "tst__Other",
  [CLS_PLAIN]: "PlainHost",
};

function classMd(uid: string, label: string, superUid?: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    "exo__Instance_class:",
    `  - "[[${EXO_CLASS}]]"`,
    `exo__Asset_label: ${label}`,
    ...(superUid ? ["exo__Class_superClass:", `  - "[[${superUid}]]"`] : []),
    "---",
    "",
  ].join("\n");
}

/**
 * A property definition. `domainUid` and `rangeUid` are written as bare
 * `[[<uid>]]` — the strip-canon form the CLI itself writes — so the SYMBOLIC
 * emission under test is produced by the converter, never staged by the fixture.
 */
function propertyMd(opts: {
  uid: string;
  label: string;
  domainUid: string;
  /** A SECOND domain — a property may legitimately declare more than one. */
  alsoDomainUid?: string;
  rangeLiteral?: string;
  rangeUid?: string;
  minCount?: number;
}): string {
  return [
    "---",
    `exo__Asset_uid: ${opts.uid}`,
    "exo__Instance_class:",
    `  - "[[${EXO_PROPERTY}]]"`,
    `exo__Asset_label: ${opts.label}`,
    "exo__Property_domain:",
    `  - "[[${opts.domainUid}]]"`,
    ...(opts.alsoDomainUid ? [`  - "[[${opts.alsoDomainUid}]]"`] : []),
    ...(opts.rangeLiteral
      ? [`exo__Property_range: "${opts.rangeLiteral}"`]
      : []),
    ...(opts.rangeUid
      ? ["exo__Property_range:", `  - "[[${opts.rangeUid}]]"`]
      : []),
    ...(opts.minCount === undefined
      ? []
      : [`exo__Property_minCount: ${opts.minCount}`]),
    "---",
    "",
  ].join("\n");
}

/** Materialise the fixture vault, run `body` against it, then remove it. */
export async function withClassPropertyVault(
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "classprop-loader-"));
  try {
    const tbox = path.join(dir, "tbox");
    await fs.mkdir(tbox, { recursive: true });

    const write = async (uid: string, content: string): Promise<void> => {
      await fs.writeFile(path.join(tbox, `${uid}.md`), content, "utf-8");
    };

    await write(CLS_BASE, classMd(CLS_BASE, LABELS[CLS_BASE] ?? ""));
    await write(CLS_MID, classMd(CLS_MID, LABELS[CLS_MID] ?? "", CLS_BASE));
    await write(CLS_LEAF, classMd(CLS_LEAF, LABELS[CLS_LEAF] ?? "", CLS_MID));
    await write(CLS_LONE, classMd(CLS_LONE, LABELS[CLS_LONE] ?? ""));
    await write(CLS_PICK, classMd(CLS_PICK, LABELS[CLS_PICK] ?? ""));
    await write(CLS_OTHER, classMd(CLS_OTHER, LABELS[CLS_OTHER] ?? ""));
    await write(CLS_PLAIN, classMd(CLS_PLAIN, LABELS[CLS_PLAIN] ?? ""));

    await write(
      PROP_REQUIRED,
      propertyMd({
        uid: PROP_REQUIRED,
        label: "tst__Base_required",
        domainUid: CLS_BASE,
        rangeLiteral: "xsd:string",
        minCount: 1,
      }),
    );
    await write(
      PROP_OPTIONAL,
      propertyMd({
        uid: PROP_OPTIONAL,
        label: "tst__Leaf_optional",
        domainUid: CLS_LEAF,
        rangeLiteral: "xsd:string",
      }),
    );
    await write(
      PROP_REF,
      propertyMd({
        uid: PROP_REF,
        label: "tst__Mid_ref",
        domainUid: CLS_MID,
        rangeUid: CLS_PICK,
      }),
    );
    await write(
      PROP_NOISE,
      propertyMd({
        uid: PROP_NOISE,
        label: "tst__Other_noise",
        domainUid: CLS_OTHER,
        rangeLiteral: "xsd:string",
        minCount: 1,
      }),
    );
    await write(
      PROP_PLAIN,
      propertyMd({
        uid: PROP_PLAIN,
        label: "tst__Plain_prop",
        domainUid: CLS_PLAIN,
        rangeLiteral: "xsd:integer",
      }),
    );
    await write(
      PROP_DUAL,
      propertyMd({
        uid: PROP_DUAL,
        label: "tst__Dual_scoped",
        domainUid: CLS_BASE,
        alsoDomainUid: CLS_MID,
        rangeLiteral: "xsd:string",
      }),
    );

    await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
