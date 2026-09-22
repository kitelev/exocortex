import {
  InMemoryTripleStore,
  createTripleStoreClassPropertyResolver,
  IRI,
  Literal,
  type ClassPropertyField,
  type Triple,
} from "@kitelev/exocortex-core";
import { loadVaultTriples } from "../../src/cache/loadVaultTriples.js";
import {
  withClassPropertyVault,
  CLS_BASE,
  CLS_LEAF,
  CLS_LONE,
  CLS_MID,
  CLS_PLAIN,
  PROP_OPTIONAL,
} from "./helpers/class-property-fixture.js";

/**
 * Req `07509cf9` — the resolver of the properties a class DECLARES, anchored on
 * `exo__Property_domain`. One axis per Gherkin scenario, all of them driven
 * through the PRODUCTION loader (`loadVaultTriples` — the same call
 * `validate-schema` makes) over a file fixture of our own, because the guards
 * under test only engage on what `NoteToRDFConverter` actually emits.
 *
 * Scenario 8 ("the existing required-property resolver does not change") is NOT
 * here: an axis in this file would compare the new resolver against itself. It
 * lives in `class-property-existing-unchanged.integration.test.ts`, which pins
 * the OLD resolver's output composition on this SAME fixture and is green under
 * both revisions of `RequiredPropertyResolver.ts` — see that file's header.
 */

const REQ = "@req:07509cf9-6a4e-45ef-a420-03f5fb9baef9";

/** One printable line per field — every axis asserts on lists of these. */
function printable(fields: readonly ClassPropertyField[]): string[] {
  return fields.map(
    (f) =>
      `${f.propertyKey}|${f.fieldType}|${f.targetClassUid ?? "-"}|${
        f.required ? "required" : "optional"
      }`,
  );
}

function keysOf(fields: readonly ClassPropertyField[]): string[] {
  return fields.map((f) => f.propertyKey);
}

async function resolveOn(
  dir: string,
  hostUid: string,
): Promise<ClassPropertyField[]> {
  const loaded = await loadVaultTriples(dir, { useCache: false });
  const store = new InMemoryTripleStore();
  await store.addAll(loaded.triples as Triple[]);
  return createTripleStoreClassPropertyResolver(store)(hostUid);
}

/**
 * `Subject` / `RDFObject` are unions and a BlankNode carries no `.value`, so
 * every read narrows first — the `check-test-types` ratchet is a stricter
 * superset of what ts-jest asks, and it is right here.
 */
function nodeValue(node: unknown): string | null {
  return node instanceof IRI || node instanceof Literal ? node.value : null;
}

describe("declared-class-property resolution through the production loader (req 07509cf9)", () => {
  it(`D1 ${REQ} a property whose exo__Property_domain names the class ITSELF comes back keyed by its label — the frontmatter key a form would write`, async () => {
    await withClassPropertyVault(async (dir) => {
      expect(printable(await resolveOn(dir, CLS_LEAF))).toContain(
        "tst__Leaf_optional|text|-|optional",
      );
    });
  }, 120000);

  it(`D2 ${REQ} a property declared two superClass hops up reaches the leaf, and one hop up reaches the middle class — the transitive closure, not just the direct parent`, async () => {
    await withClassPropertyVault(async (dir) => {
      expect(keysOf(await resolveOn(dir, CLS_LEAF))).toContain(
        "tst__Base_required",
      );
      expect(keysOf(await resolveOn(dir, CLS_MID))).toContain(
        "tst__Base_required",
      );
    });
  }, 120000);

  it(`D3 ${REQ} a property that declares NO exo__Property_minCount is still returned, and its required flag is false — this is the whole difference from the minCount-anchored resolver`, async () => {
    await withClassPropertyVault(async (dir) => {
      const loaded = await loadVaultTriples(dir, { useCache: false });
      const triples = loaded.triples as Triple[];
      // Canary: the fixture genuinely declares no minCount for this property,
      // so "required === false" is a fact about the resolver, not about a
      // property that happens to be absent from the graph.
      const minCountSubjects = triples
        .filter((t) => t.predicate.value.endsWith("Property_minCount"))
        .map((t) => nodeValue(t.subject) ?? "")
        .filter((v) => v.includes(PROP_OPTIONAL));
      expect(minCountSubjects).toEqual([]);

      const optional = (await resolveOn(dir, CLS_LEAF)).filter(
        (f) => f.propertyKey === "tst__Leaf_optional",
      );
      expect(printable(optional)).toEqual(["tst__Leaf_optional|text|-|optional"]);
    });
  }, 120000);

  it(`D4 ${REQ} a property declaring exo__Property_minCount = 1 comes back with required = true — the mandatory/optional split a consumer would otherwise need a second pass for`, async () => {
    await withClassPropertyVault(async (dir) => {
      const required = (await resolveOn(dir, CLS_LEAF)).filter(
        (f) => f.propertyKey === "tst__Base_required",
      );
      expect(printable(required)).toEqual(["tst__Base_required|text|-|required"]);
    });
  }, 120000);

  it(`D5 ${REQ} a class no exo__Property_domain points at resolves to an EMPTY list, and a class outside the chain never leaks into another class's answer`, async () => {
    await withClassPropertyVault(async (dir) => {
      expect(printable(await resolveOn(dir, CLS_LONE))).toEqual([]);
      // Canary: an empty answer in the same run is a fact about the host, not a
      // dead query — a host that DOES declare a property is non-empty here.
      expect(keysOf(await resolveOn(dir, CLS_PLAIN))).toEqual([
        "tst__Plain_prop",
      ]);
      // tst__Other declares a property too; it is not an ancestor of the leaf,
      // so "every declared property" must not degrade into "every property".
      expect(keysOf(await resolveOn(dir, CLS_LEAF))).not.toContain(
        "tst__Other_noise",
      );
    });
  }, 120000);

  it(`D6 ${REQ} the class reference arrives in EITHER live IRI form — symbolic for a prefix__Name-labelled class, a file IRI for a plain-labelled one — and a bare-UID host resolves through both`, async () => {
    await withClassPropertyVault(async (dir) => {
      const loaded = await loadVaultTriples(dir, { useCache: false });
      const triples = loaded.triples as Triple[];
      const domainObjects = triples
        .filter((t) => t.predicate.value.endsWith("Property_domain"))
        .map((t) => nodeValue(t.object) ?? "")
        .map((v) =>
          v.startsWith("https://exocortex.my/ontology/")
            ? `symbolic:${v.split("#").pop() ?? ""}`
            : `file:${v.split("/").pop() ?? ""}`,
        )
        .sort();
      // Both emission forms are present in ONE fixture — that is what makes the
      // dual-form guard observable rather than assumed.
      expect(domainObjects).toEqual([
        `file:${CLS_PLAIN}.md`,
        "symbolic:Base",
        "symbolic:Base",
        "symbolic:Leaf",
        "symbolic:Mid",
        "symbolic:Mid",
        "symbolic:Other",
      ]);
      // …and the full composition a bare-UID host resolves to, across both forms.
      // `tst__Dual_scoped` declares BOTH Base and Mid — two domains on the same
      // ancestor chain — so it appears here exactly ONCE, in label order rather
      // than in the file order the store yields.
      expect(printable(await resolveOn(dir, CLS_LEAF))).toEqual([
        "tst__Base_required|text|-|required",
        "tst__Dual_scoped|text|-|optional",
        "tst__Leaf_optional|text|-|optional",
        "tst__Mid_ref|assetRef|tst__Pick|optional",
      ]);
      expect(printable(await resolveOn(dir, CLS_PLAIN))).toEqual([
        "tst__Plain_prop|number|-|optional",
      ]);
    });
  }, 120000);

  it(`D7 ${REQ} the field type is derived from exo__Property_range, and an OBJECT range carries the picker key of the range class`, async () => {
    await withClassPropertyVault(async (dir) => {
      const byKey = new Map(
        (await resolveOn(dir, CLS_LEAF)).map((f) => [f.propertyKey, f]),
      );
      expect(printable([...byKey.values()].filter((f) => f.fieldType === "assetRef"))).toEqual([
        "tst__Mid_ref|assetRef|tst__Pick|optional",
      ]);
      expect(byKey.get("tst__Base_required")?.fieldType).toBe("text");
      expect(byKey.get("tst__Base_required")?.targetClassUid).toBeUndefined();
      // xsd:integer on the plain-labelled host's property → a numeric field.
      const plain = await resolveOn(dir, CLS_PLAIN);
      expect(plain.map((f) => f.fieldType)).toEqual(["number"]);
      // The base class itself resolves too — its own declarations, no chain.
      expect(keysOf(await resolveOn(dir, CLS_BASE))).toEqual([
        "tst__Base_required",
        "tst__Dual_scoped",
      ]);
    });
  }, 120000);
});
