/**
 * req e750782f-907b-4573-99ce-f9a5e3150418 — once `skos` is registered in
 * `Namespace.KNOWN_NAMESPACES`, the plugin's IRI readers must read the W3C SKOS
 * terms back (RFC 14217015 §5, decision №6). Review round 1 found three readers
 * that still assumed "registered W3C ⇒ schema term, never a key or a class":
 *
 *   L1  `predicateIriToKey` reads a REGISTERED W3C predicate back to its
 *       frontmatter key (`skos__exactMatch`, `owl__sameAs`, `rdf__type`); its
 *       hand-rolled exocortex-only anchor returned the raw IRI.
 *   L2  a reified desk mapping (`exo__Statement` with predicate
 *       `skos:exactMatch`) is grouped under `skos__exactMatch`, not under the
 *       raw W3C IRI (the user-visible heading).
 *   L3  …and it dedups against its inline twin (inline wins) — with the raw IRI
 *       as the dedup key the mapping rendered twice.
 *   L4  `OntologySchemaService.getPropertyRangeClasses` keeps a W3C
 *       `skos:Concept` range as the class `skos__Concept` (and still drops
 *       `xsd:string` — the #4353 A35 guard).
 *   L5  `OntologySchemaService.getClassHierarchy` keeps `skos__Concept` as an
 *       ancestor (and still drops `owl:Thing`).
 *   L6  `ReferencePropertyField` derives the class filter `["skos__Concept"]`
 *       from a W3C range (and still none for `rdfs:Class` — the #4353 A44 guard).
 *   L7  (review round 2) `OntologySchemaService` gives a property whose range is
 *       W3C `skos:Concept` the field type `wikilink`, not `text` — the creation
 *       modal writes its value as a link (`xsd:string` stays `text`).
 *
 * Axis names are `[Ln]` FIRST in the title — the revert-verify driver reads them
 * from jest's `● <suite> › [Ln]` header (integration-test-revert-verify §A104).
 */
import { InMemoryTripleStore, Triple, IRI, Namespace } from "@kitelev/exocortex-core";
import type { TFile } from "obsidian";
import {
  RelationsRenderer,
  predicateIriToKey,
} from "../../src/presentation/renderers/layout/RelationsRenderer";
import { SPARQLQueryService } from "../../src/application/services/SPARQLQueryService";
import { OntologySchemaService } from "../../src/application/services/OntologySchemaService";
import { ReferencePropertyField } from "../../src/presentation/components/property-fields/ReferencePropertyField";
import type { ReferencePropertyFieldProps } from "../../src/presentation/components/property-fields/types";

jest.mock("../../src/application/services/SPARQLQueryService");

const REQ = "@req:e750782f-907b-4573-99ce-f9a5e3150418";
const W3C_SKOS = "http://www.w3.org/2004/02/skos/core#";
const BASE = "https://exocortex.my/ontology/";

const VAULT_IRI_PREFIX = "obsidian://vault/";
const iriOf = (path: string) => new IRI(VAULT_IRI_PREFIX + path);
const A_PATH = "assetspaces/kitelev/exoas-empty-mind/empty-mind/aaaaaaaa-0001.md";
const B_PATH = "assetspaces/kitelev/exoas-desk/desk/bbbbbbbb-0002.md";
const S_PATH = "assetspaces/kitelev/exoas-desk/desk-mappings/11111111-0011.md";
const EXACT_KEY = "skos__exactMatch";

function mockStore(): jest.Mocked<SPARQLQueryService> {
  return {
    query: jest.fn(),
    initialize: jest.fn(),
    refresh: jest.fn(),
    updateFile: jest.fn(),
    dispose: jest.fn(),
  } as unknown as jest.Mocked<SPARQLQueryService>;
}

describe("req e750782f — W3C SKOS in the plugin's IRI readers", () => {
  it(`[L1] ${REQ} predicateIriToKey reads a registered W3C predicate back to its frontmatter key`, () => {
    expect(predicateIriToKey(`${W3C_SKOS}exactMatch`)).toBe(EXACT_KEY);
    expect(predicateIriToKey("http://www.w3.org/2002/07/owl#sameAs")).toBe(
      "owl__sameAs",
    );
    expect(
      predicateIriToKey("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
    ).toBe("rdf__type");
    // Canaries — the ad-hoc base (incl. a dash prefix) still reads back, and an
    // UNREGISTERED vocabulary or a path-form IRI still passes through.
    expect(predicateIriToKey(`${BASE}ems#Effort_area`)).toBe("ems__Effort_area");
    expect(predicateIriToKey(`${BASE}exo-ims#relatesToConcept`)).toBe(
      "exo-ims__relatesToConcept",
    );
    expect(predicateIriToKey("http://www.w3.org/2003/01/geo/wgs84_pos#lat")).toBe(
      "http://www.w3.org/2003/01/geo/wgs84_pos#lat",
    );
    expect(predicateIriToKey("obsidian://vault/foo.md")).toBe(
      "obsidian://vault/foo.md",
    );
  });

  describe("RelationsRenderer.mergeReifiedRelations — a desk mapping", () => {
    const fmByPath = new Map<string, Record<string, unknown>>([
      [A_PATH, { exo__Asset_uid: "uid-a" }],
      [B_PATH, { exo__Asset_uid: "uid-b" }],
    ]);

    /** B --skos:exactMatch--> A, reified (the inline seed keys edges INTO A). */
    async function seed(store: InMemoryTripleStore): Promise<void> {
      const predicate = new IRI(`${W3C_SKOS}exactMatch`);
      const stmt = iriOf(S_PATH);
      const subj = iriOf(B_PATH);
      const obj = iriOf(A_PATH);
      await store.add(
        new Triple(stmt, Namespace.RDF.term("type"), Namespace.EXO.term("Statement")),
      );
      await store.add(new Triple(stmt, Namespace.EXO.term("Statement_subject"), subj));
      await store.add(
        new Triple(stmt, Namespace.EXO.term("Statement_predicate"), predicate),
      );
      await store.add(new Triple(stmt, Namespace.EXO.term("Statement_object"), obj));
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

    async function merged(
      seedInline: boolean,
    ): Promise<{ propertyName?: string; provenance?: string }[]> {
      const store = new InMemoryTripleStore();
      await seed(store);
      const relations: Record<string, unknown>[] = seedInline
        ? [
            {
              provenance: "inline",
              propertyName: EXACT_KEY,
              path: B_PATH,
              metadata: { exo__Asset_uid: "uid-b" },
            },
          ]
        : [];
      await (
        makeRenderer(store) as unknown as {
          mergeReifiedRelations: (f: TFile, r: unknown[]) => Promise<void>;
        }
      ).mergeReifiedRelations({ path: A_PATH } as TFile, relations);
      return relations as { propertyName?: string; provenance?: string }[];
    }

    it(`[L2] ${REQ} groups a reified skos:exactMatch mapping under skos__exactMatch, not the raw W3C IRI`, async () => {
      const reified = (await merged(false)).filter((r) => r.provenance === "reified");
      // Non-vacuity: the reified path surfaced the mapping at all.
      expect(reified).toHaveLength(1);
      expect(reified[0].propertyName).toBe(EXACT_KEY);
    });

    it(`[L3] ${REQ} dedups a reified skos:exactMatch mapping against its inline twin (inline wins)`, async () => {
      const out = await merged(true);
      expect(out.filter((r) => r.provenance === "reified")).toHaveLength(0);
      expect(out).toHaveLength(1);
    });
  });

  describe("OntologySchemaService", () => {
    it(`[L4] ${REQ} keeps a W3C skos:Concept range as the class skos__Concept (xsd:string still dropped)`, async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${W3C_SKOS}exactMatch>`)
          ? [
              new Map([["range", `${W3C_SKOS}Concept`]]),
              new Map([["range", "http://www.w3.org/2001/XMLSchema#string"]]),
            ]
          : [],
      );

      const ranges = await new OntologySchemaService(
        store,
      ).getPropertyRangeClasses(EXACT_KEY);

      expect(ranges).toEqual(["skos__Concept"]);
    });

    it(`[L5] ${REQ} keeps skos__Concept as an ancestor in the class hierarchy (owl:Thing still dropped)`, async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}concept#Concept>`)
          ? [
              new Map([["superClass", `${W3C_SKOS}Concept`]]),
              new Map([["superClass", "http://www.w3.org/2002/07/owl#Thing"]]),
            ]
          : [],
      );

      const hierarchy = await new OntologySchemaService(store).getClassHierarchy(
        "concept__Concept",
      );

      expect(hierarchy).toEqual(["skos__Concept"]);
    });

    it(`[L7] ${REQ} gives a property with a W3C skos:Concept range the field type wikilink (xsd:string stays text)`, async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`rdfs:domain <${BASE}desk#Mapping>`)
          ? [
              new Map([
                ["property", `${W3C_SKOS}exactMatch`],
                ["range", `${W3C_SKOS}Concept`],
              ]),
              new Map([
                ["property", `${BASE}desk#Mapping_note`],
                ["range", "http://www.w3.org/2001/XMLSchema#string"],
              ]),
            ]
          : [],
      );

      const props = await new OntologySchemaService(store).getClassProperties(
        "desk__Mapping",
      );
      const byUri = new Map(props.map((p) => [p.uri, p.fieldType]));

      expect(byUri.get(EXACT_KEY)).toBe("wikilink");
      expect(byUri.get("desk__Mapping_note")).toBe("text");
    });
  });

  describe("ReferencePropertyField", () => {
    function fieldWithRange(rangeType: string): string[] | undefined {
      const props = {
        app: { vault: { getMarkdownFiles: () => [] } },
        property: { name: "skos__exactMatch", label: "Exact match" },
        rangeType,
      } as unknown as ReferencePropertyFieldProps;
      const field = new ReferencePropertyField(document.createElement("div"), props);
      return (
        field as unknown as {
          getEffectiveClassFilter(
            classFilter?: string[],
            rangeType?: string,
          ): string[] | undefined;
        }
      ).getEffectiveClassFilter(undefined, rangeType);
    }

    it(`[L6] ${REQ} derives the class filter skos__Concept from a W3C skos:Concept range (rdfs:Class still none)`, () => {
      expect(fieldWithRange(`${W3C_SKOS}Concept`)).toEqual(["skos__Concept"]);
      expect(fieldWithRange("http://www.w3.org/2000/01/rdf-schema#Class")).toBeUndefined();
    });
  });
});
