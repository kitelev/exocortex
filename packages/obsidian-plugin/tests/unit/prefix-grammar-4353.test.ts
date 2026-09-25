import { SPARQLQueryService } from "../../src/application/services/SPARQLQueryService";
import { ClassDiscoveryService } from "../../src/application/services/ClassDiscoveryService";
import { OntologySchemaService } from "../../src/application/services/OntologySchemaService";
import { ReferencePropertyField } from "../../src/presentation/components/property-fields/ReferencePropertyField";
import type { ReferencePropertyFieldProps } from "../../src/presentation/components/property-fields/types";

jest.mock("../../src/application/services/SPARQLQueryService");

/**
 * Issue #4353 — the narrow `[a-z]+` prefix copies in the plugin move to the
 * shared core grammar (`Namespace.fromPropertyKey` / `Namespace.fromTermIRI`).
 *
 * The three refused prefix shapes, MEASURED in the live vaults (2026-09-25):
 * camelCase `aiKnow` (14 labels in vault-exodev), hyphenated `adapter-exo-ims`
 * (all three vaults), digit-bearing `exo003` (7 labels in every vault).
 *
 * Axis names are `[An]` FIRST in the title — the revert-verify driver reads them
 * from jest's `● <suite> › [An]` header (integration-test-revert-verify §A104).
 */

const BASE = "https://exocortex.my/ontology/";

function mockStore(): jest.Mocked<SPARQLQueryService> {
  return {
    query: jest.fn(),
    initialize: jest.fn(),
    refresh: jest.fn(),
    updateFile: jest.fn(),
    dispose: jest.fn(),
  } as unknown as jest.Mocked<SPARQLQueryService>;
}

describe("prefix grammar #4353 — obsidian-plugin", () => {
  describe("ClassDiscoveryService", () => {
    /** classQuery, labelQuery, uidQuery — the three calls discoverClasses fires. */
    function mockDiscovery(
      store: jest.Mocked<SPARQLQueryService>,
      classIRI: string,
      labelValue: string,
    ): void {
      (store.query as jest.Mock)
        .mockResolvedValueOnce([new Map([["class", classIRI]])])
        .mockResolvedValueOnce([
          new Map([
            ["class", classIRI],
            ["label", labelValue],
          ]),
        ])
        .mockResolvedValueOnce([]);
    }

    it("[A20] keeps the namespace of a camelCase class whose label is a symbolic IRI", async () => {
      const store = mockStore();
      // NoteToRDFConverter expands a `prefix__Local` label to its term IRI, so
      // this is the shape the label query really returns for a class-def.
      mockDiscovery(
        store,
        "obsidian://vault/aiknow/2f3a1c40-0000-4000-8000-000000000001.md",
        `${BASE}aiKnow#Memory`,
      );

      const classes = await new ClassDiscoveryService(store).discoverClasses();

      // Narrow `…/ontology/([a-z]+)#` → fell through to the last-segment
      // fallback, which DROPS the namespace: className came out as "Memory".
      expect(classes).toEqual([
        expect.objectContaining({
          className: "aiKnow__Memory",
          label: "Memory",
          canCreateInstance: true,
        }),
      ]);
    });

    it("[A21] accepts a hyphenated class name given in prefix__Local label form", async () => {
      const store = mockStore();
      mockDiscovery(
        store,
        "obsidian://vault/adapters/2f3a1c40-0000-4000-8000-000000000002.md",
        "adapter-exo-ims__RelatesToConcept",
      );

      const classes = await new ClassDiscoveryService(store).discoverClasses();

      // Narrow `^[a-z]+__…` in isPrefixedClassName → the label was not
      // recognised, toClassName could not parse it either, and the class was
      // reduced to its UUID filename (then dropped from the dropdown).
      expect(classes).toEqual([
        expect.objectContaining({
          className: "adapter-exo-ims__RelatesToConcept",
          label: "Relates To Concept",
          canCreateInstance: true,
        }),
      ]);
    });

    it("[A22] accepts a digit-bearing class name (exo003__Alias)", async () => {
      const store = mockStore();
      mockDiscovery(
        store,
        "obsidian://vault/exo003/2f3a1c40-0000-4000-8000-000000000003.md",
        "exo003__Alias",
      );

      const classes = await new ClassDiscoveryService(store).discoverClasses();

      expect(classes).toEqual([
        expect.objectContaining({
          className: "exo003__Alias",
          label: "Alias",
          canCreateInstance: true,
        }),
      ]);
    });
  });

  describe("OntologySchemaService", () => {
    it("[A30] queries a camelCase class by its term IRI and maps ancestors back", async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}aiKnow#Memory>`)
          ? [new Map([["superClass", `${BASE}aiKnow#Thing`]])]
          : [],
      );

      const hierarchy = await new OntologySchemaService(store).getClassHierarchy(
        "aiKnow__Memory",
      );

      // Narrow copies: toClassIri emitted the bare key (no binding → []) and
      // toClassName returned null for the ancestor (silently dropped).
      expect(hierarchy).toEqual(["aiKnow__Thing"]);
    });

    it("[A31] queries a hyphenated class by its term IRI and maps ancestors back", async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}adapter-exo-ims#Rel>`)
          ? [new Map([["superClass", `${BASE}adapter-exo-ims#Base`]])]
          : [],
      );

      const hierarchy = await new OntologySchemaService(store).getClassHierarchy(
        "adapter-exo-ims__Rel",
      );

      expect(hierarchy).toEqual(["adapter-exo-ims__Base"]);
    });

    it("[A32] resolves a camelCase property's declared range class", async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}aiKnow#Memory_source>`)
          ? [new Map([["range", `${BASE}aiKnow#Source`]])]
          : [],
      );

      const ranges = await new OntologySchemaService(
        store,
      ).getPropertyRangeClasses("aiKnow__Memory_source");

      // Narrow toPropertyIri → the bare key reached SPARQL, nothing bound, and
      // the service silently fell back to name-based inference.
      expect(ranges).toEqual(["aiKnow__Source"]);
    });

    it("[A33] reads owl:deprecated for a digit-bearing property", async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}exo003#Alias_alias>`)
          ? [new Map([["deprecated", "true"]])]
          : [],
      );

      const deprecated = await new OntologySchemaService(
        store,
      ).isDeprecatedProperty("exo003__Alias_alias");

      // Narrow toPropertyIri → the query matched nothing, so a DEPRECATED
      // property read as live and kept being offered in the creation form.
      expect(deprecated).toBe(true);
    });

    it("[A35] widening the prefix grammar does NOT turn a W3C datatype into a class", async () => {
      // The narrow regex filtered non-exocortex IRIs by ACCIDENT; `toClassName`
      // needs that filter on PURPOSE, because its callers treat the result as a
      // CLASS. Without it `rdfs:range xsd:string` arrives as the "class"
      // `xsd__string` and the reference picker filters down to zero notes.
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`<${BASE}aiKnow#Memory_source>`)
          ? [
              new Map([["range", "http://www.w3.org/2001/XMLSchema#string"]]),
              new Map([["range", `${BASE}aiKnow#Source`]]),
            ]
          : [],
      );

      const ranges = await new OntologySchemaService(
        store,
      ).getPropertyRangeClasses("aiKnow__Memory_source");

      expect(ranges).toEqual(["aiKnow__Source"]);
    });

    it("[A34] labels a hyphenated property from its local name, not its whole key", async () => {
      const store = mockStore();
      (store.query as jest.Mock).mockImplementation(async (q: string) =>
        q.includes(`rdfs:domain <${BASE}tbank-nessy#LessonLearned>`)
          ? [new Map([["property", `${BASE}tbank-nessy#LessonLearned_rootCause`]])]
          : [],
      );

      const props = await new OntologySchemaService(store).getClassProperties(
        "tbank-nessy__LessonLearned",
      );

      // Narrow toPropertyName dropped the namespace (`LessonLearned_rootCause`)
      // and narrow extractLabel left the prefix in, yielding " Lesson Learned…".
      expect(props).toEqual([
        expect.objectContaining({
          uri: "tbank-nessy__LessonLearned_rootCause",
          label: "Root Cause",
        }),
      ]);
    });
  });

  describe("ReferencePropertyField", () => {
    function fieldWithRange(rangeType: string): string[] | undefined {
      const props = {
        app: { vault: { getMarkdownFiles: () => [] } },
        property: { name: "test__Probe_ref", label: "Ref" },
        rangeType,
      } as unknown as ReferencePropertyFieldProps;
      // The constructor renders immediately, so it needs a real container.
      const field = new ReferencePropertyField(
        document.createElement("div"),
        props,
      );
      return (
        field as unknown as {
          getEffectiveClassFilter(
            classFilter?: string[],
            rangeType?: string,
          ): string[] | undefined;
        }
      ).getEffectiveClassFilter(undefined, rangeType);
    }

    it("[A40] derives the class filter from a camelCase range IRI", () => {
      // Narrow `…/ontology/([a-z]+)#` → null → NO class filter at all, so the
      // autocomplete offered every note in the vault instead of the range's.
      expect(fieldWithRange(`${BASE}aiKnow#Memory`)).toEqual(["aiKnow__Memory"]);
    });

    it("[A41] derives the class filter from a hyphenated range IRI", () => {
      expect(fieldWithRange(`${BASE}adapter-exo-ims#Rel`)).toEqual([
        "adapter-exo-ims__Rel",
      ]);
    });

    it("[A42] accepts a digit-bearing range already in prefix__Local form", () => {
      expect(fieldWithRange("exo003__Alias")).toEqual(["exo003__Alias"]);
    });

    it("[A43] strips the prefix from the class badge shown on a suggestion", () => {
      // `formatClassLabel` is a pure display formatter with no cheaper production
      // entry point (the only caller builds a suggestion row inside the DOM), so
      // the axis calls it directly rather than driving the whole render.
      const props = {
        app: { vault: { getMarkdownFiles: () => [] } },
        property: { name: "test__Probe_ref", label: "Ref" },
      } as unknown as ReferencePropertyFieldProps;
      const field = new ReferencePropertyField(
        document.createElement("div"),
        props,
      ) as unknown as { formatClassLabel(className: string): string };

      expect(field.formatClassLabel("aiKnow__Memory")).toBe("Memory");
      expect(field.formatClassLabel("adapter-exo-ims__Rel")).toBe("Rel");
      expect(field.formatClassLabel("exo003__Alias")).toBe("Alias");
    });
  });
});
