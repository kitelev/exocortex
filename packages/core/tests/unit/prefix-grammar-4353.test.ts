import "reflect-metadata";
import { ClassHierarchyResolver } from "../../src/services/ClassHierarchyResolver";
import { EnumValueResolver } from "../../src/services/EnumValueResolver";
import {
  extractPropertyLabel,
  propertyNameToUri,
  uriToPropertyName,
} from "../../src/domain/types/PropertyDefinition";
import type { ISPARQLQueryable } from "../../src/services/PropertySchemaResolver";

/**
 * Issue #4353 — the narrow `[a-z]+` prefix copies in core move to the shared
 * grammar (`Namespace.PREFIX_PATTERN_SOURCE` via `fromPropertyKey`/`fromTermIRI`).
 *
 * Three prefix shapes the narrow copies refuse, all three MEASURED in the live
 * vaults (2026-09-25, `exo__Asset_label` values emitted as symbolic IRIs):
 *   · camelCase   `aiKnow`          — 14 labels in vault-exodev
 *   · hyphenated  `adapter-exo-ims` — present in ALL three vaults
 *   · digits      `exo003`          —  7 labels in EVERY vault (not in the issue's table)
 *
 * Axis names are `[An]` FIRST in the test title: the revert-verify driver reads
 * them out of jest's `● <suite> › [An]` failure header
 * (integration-test-revert-verify §A47/§A104).
 */

const BASE = "https://exocortex.my/ontology/";

function ancestorRows(...iris: string[]): Map<string, unknown>[] {
  return iris.map((iri) => new Map<string, unknown>([["ancestor", iri]]));
}

/** A store that answers ONLY when the query carries the expected term IRI. */
function storeAnsweringFor(
  expectedTerm: string,
  rows: Map<string, unknown>[],
): jest.Mocked<ISPARQLQueryable> {
  return {
    query: jest.fn(async (q: string) =>
      q.includes(`<${expectedTerm}>`) ? rows : [],
    ),
  } as unknown as jest.Mocked<ISPARQLQueryable>;
}

describe("prefix grammar #4353 — core", () => {
  describe("ClassHierarchyResolver", () => {
    it("[A1] resolves a camelCase-prefixed class (aiKnow__Memory) instead of falling back", async () => {
      const store = storeAnsweringFor(
        `${BASE}aiKnow#Memory`,
        ancestorRows(`${BASE}aiKnow#Thing`),
      );

      const hierarchy = await new ClassHierarchyResolver(store).resolve(
        "aiKnow__Memory",
      );

      // Narrow `^([a-z]+)__` → the class name reaches SPARQL as a bare key,
      // nothing binds, and `loadHierarchy` returns the 2-element fallback.
      expect(hierarchy).toEqual(["aiKnow__Memory", "aiKnow__Thing", "exo__Asset"]);
    });

    it("[A2] resolves a hyphenated-prefixed class (adapter-exo-ims__Rel)", async () => {
      const store = storeAnsweringFor(
        `${BASE}adapter-exo-ims#Rel`,
        ancestorRows(`${BASE}adapter-exo-ims#Base`),
      );

      const hierarchy = await new ClassHierarchyResolver(store).resolve(
        "adapter-exo-ims__Rel",
      );

      expect(hierarchy).toEqual([
        "adapter-exo-ims__Rel",
        "adapter-exo-ims__Base",
        "exo__Asset",
      ]);
    });

    it("[A3] resolves a digit-bearing prefix (exo003__Alias)", async () => {
      const store = storeAnsweringFor(
        `${BASE}exo003#Alias`,
        // ⛔ NOT `exo#Asset`: the fallback this axis must distinguish itself from
        // is `[className, "exo__Asset"]`, so an `exo__Asset`-only ancestor list
        // would make the broken and the fixed result byte-identical.
        ancestorRows(`${BASE}exo003#AliasBase`),
      );

      const hierarchy = await new ClassHierarchyResolver(store).resolve(
        "exo003__Alias",
      );

      expect(hierarchy).toEqual([
        "exo003__Alias",
        "exo003__AliasBase",
        "exo__Asset",
      ]);
    });

    it("[A4] maps a camelCase ancestor IRI back to prefix__Local form", async () => {
      // A full-IRI seed passes `toFullIRI` through untouched, so this axis
      // isolates the INVERSE direction (`fromFullIRI`).
      const store = storeAnsweringFor(
        `${BASE}aiKnow#Memory`,
        ancestorRows(`${BASE}aiKnow#Thing`, `${BASE}exo#Asset`),
      );

      const hierarchy = await new ClassHierarchyResolver(store).resolve(
        `${BASE}aiKnow#Memory`,
      );

      expect(hierarchy).toEqual([
        `${BASE}aiKnow#Memory`,
        "aiKnow__Thing",
        "exo__Asset",
      ]);
    });
  });

  describe("EnumValueResolver", () => {
    it("[A5] queries a camelCase enum class by its term IRI and its _rank property", async () => {
      const rows = [
        new Map<string, unknown>([
          ["instance", `${BASE}aiKnow#MemoryKindEpisodic`],
          ["label", "Episodic"],
        ]),
      ];
      const store = storeAnsweringFor(`${BASE}aiKnow#MemoryKind`, rows);

      const values = await new EnumValueResolver(store).resolve(
        "aiKnow__MemoryKind",
      );

      // Narrow copies: `toFullIRI` emitted the bare key (no binding → empty
      // dropdown) and `buildRankProperty` returned null (no ORDER BY source).
      expect(values).toEqual([
        { value: "[[aiKnow__MemoryKindEpisodic]]", label: "Episodic" },
      ]);
      const query = String(store.query.mock.calls[0][0]);
      expect(query).toContain(`<${BASE}aiKnow#MemoryKind_rank>`);
    });

    it("[A6] queries a hyphenated enum class by its term IRI and its _rank property", async () => {
      const rows = [
        new Map<string, unknown>([
          ["instance", `${BASE}tbank-nessy#LessonLearnedOpen`],
          ["label", "Open"],
        ]),
      ];
      const store = storeAnsweringFor(`${BASE}tbank-nessy#LessonLearned`, rows);

      const values = await new EnumValueResolver(store).resolve(
        "tbank-nessy__LessonLearned",
      );

      expect(values).toEqual([
        { value: "[[tbank-nessy__LessonLearnedOpen]]", label: "Open" },
      ]);
      const query = String(store.query.mock.calls[0][0]);
      expect(query).toContain(`<${BASE}tbank-nessy#LessonLearned_rank>`);
    });

    it("[A7] offers a hyphenated enum INSTANCE as a resolvable wikilink", async () => {
      // The enum CLASS is plain, so `toFullIRI`/`buildRankProperty` succeed even
      // with the narrow copies — this axis isolates `fromFullIRI`.
      const rows = [
        new Map<string, unknown>([
          ["instance", `${BASE}adapter-exo-ims#RelWide`],
          ["label", "Wide"],
        ]),
      ];
      const store = storeAnsweringFor(`${BASE}ems#RelKind`, rows);

      const values = await new EnumValueResolver(store).resolve("ems__RelKind");

      expect(values).toEqual([
        { value: "[[adapter-exo-ims__RelWide]]", label: "Wide" },
      ]);
    });
  });

  describe("PropertyDefinition helpers", () => {
    it("[A8] propertyNameToUri compacts camelCase, hyphenated and digit prefixes", () => {
      expect(propertyNameToUri("aiKnow__Memory_title")).toBe(
        "aiKnow:Memory_title",
      );
      expect(propertyNameToUri("tbank-nessy__LessonLearned_note")).toBe(
        "tbank-nessy:LessonLearned_note",
      );
      expect(propertyNameToUri("exo003__Alias_alias")).toBe(
        "exo003:Alias_alias",
      );
      // Unchanged for a key with no prefix at all.
      expect(propertyNameToUri("aliases")).toBe("aliases");
    });

    it("[A9] the compact round trip goes through the REAL compact form, both ways", () => {
      // ⛔ The intermediate is pinned on purpose. `expect(uriToPropertyName(
      // propertyNameToUri(name))).toBe(name)` alone is satisfied by a SYMMETRIC
      // NO-OP pair: with the narrow forward copy the key comes back unchanged,
      // the narrow inverse then leaves it alone, and the identity passes — the
      // axis was green under the mutant that breaks the forward half
      // (integration-test-revert-verify §A33, measured on this very axis).
      const cases: Array<[string, string]> = [
        ["aiKnow__Memory_title", "aiKnow:Memory_title"],
        ["tbank-nessy__LessonLearned_note", "tbank-nessy:LessonLearned_note"],
        ["exo003__Alias_alias", "exo003:Alias_alias"],
      ];
      for (const [name, compact] of cases) {
        expect(propertyNameToUri(name)).toBe(compact);
        expect(uriToPropertyName(compact)).toBe(name);
      }
    });

    it("[A11] uriToPropertyName recovers the KEY from a full term IRI, not just its last segment", () => {
      expect(uriToPropertyName(`${BASE}aiKnow#Memory_title`)).toBe(
        "aiKnow__Memory_title",
      );
      expect(uriToPropertyName(`${BASE}adapter-exo-ims#relatesToConcept`)).toBe(
        "adapter-exo-ims__relatesToConcept",
      );
      expect(uriToPropertyName(`${BASE}exo003#Alias_alias`)).toBe(
        "exo003__Alias_alias",
      );
    });

    it("[A10] extractPropertyLabel strips a camelCase/hyphenated/digit prefix", () => {
      expect(extractPropertyLabel("aiKnow__Memory_title")).toBe("Title");
      expect(extractPropertyLabel("tbank-nessy__LessonLearned_rootCause")).toBe(
        "Root Cause",
      );
      expect(extractPropertyLabel("exo003__Alias_alias")).toBe("Alias");
    });
  });
});
