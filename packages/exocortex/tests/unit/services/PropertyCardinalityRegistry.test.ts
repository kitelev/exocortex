import { PropertyCardinalityRegistry } from "../../../src/services/PropertyCardinalityRegistry";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("PropertyCardinalityRegistry", () => {
  let registry: PropertyCardinalityRegistry;
  let store: InMemoryTripleStore;

  const instanceClass = Namespace.EXO.term("Instance_class");
  const assetLabel = Namespace.EXO.term("Asset_label");
  const propertyCardinality = Namespace.EXO.term("Property_cardinality");

  const multipleCardinalityClassIRI = new IRI(
    "obsidian://vault/exo__PropertyCardinalityMultiple.md",
  );
  const propertyCardinalityClassIRI = new IRI(
    "obsidian://vault/exo__PropertyCardinality.md",
  );

  async function setupStore(multiValuedProps: string[]): Promise<void> {
    // Define PropertyCardinalityMultiple class
    await store.add(
      new Triple(
        multipleCardinalityClassIRI,
        assetLabel,
        new Literal("exo__PropertyCardinalityMultiple"),
      ),
    );
    await store.add(
      new Triple(
        multipleCardinalityClassIRI,
        instanceClass,
        propertyCardinalityClassIRI,
      ),
    );

    // Define each multi-valued property
    for (const propLabel of multiValuedProps) {
      const defIRI = new IRI(`obsidian://vault/${propLabel}.md`);
      await store.add(
        new Triple(defIRI, propertyCardinality, multipleCardinalityClassIRI),
      );
      await store.add(new Triple(defIRI, assetLabel, new Literal(propLabel)));
    }
  }

  beforeEach(() => {
    registry = new PropertyCardinalityRegistry();
    store = new InMemoryTripleStore();
  });

  it("should identify exo__Instance_class as multi-valued", async () => {
    await setupStore(["exo__Instance_class"]);
    await registry.initialize(store);

    const iri = Namespace.EXO.term("Instance_class").value;
    expect(registry.isMultiValued(iri)).toBe(true);
  });

  it("should return false for unlisted property", async () => {
    await setupStore(["exo__Instance_class"]);
    await registry.initialize(store);

    const iri = Namespace.EXO.term("Asset_label").value;
    expect(registry.isMultiValued(iri)).toBe(false);
  });

  it("should handle multiple multi-valued properties", async () => {
    await setupStore(["exo__Instance_class", "ems__Effort_prototype"]);
    await registry.initialize(store);

    expect(registry.isMultiValued(Namespace.EXO.term("Instance_class").value)).toBe(true);
    expect(registry.isMultiValued(Namespace.EMS.term("Effort_prototype").value)).toBe(true);
    expect(registry.size).toBe(2);
  });

  it("should return false when not initialized", () => {
    const iri = Namespace.EXO.term("Instance_class").value;
    expect(registry.isMultiValued(iri)).toBe(false);
  });

  it("should handle empty store", async () => {
    await registry.initialize(store);

    expect(registry.isMultiValued(Namespace.EXO.term("Instance_class").value)).toBe(false);
    expect(registry.isInitialized).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("should handle store without cardinality predicate", async () => {
    // Only add some triples, but no Property_cardinality
    await store.add(
      new Triple(
        new IRI("obsidian://vault/test.md"),
        assetLabel,
        new Literal("test"),
      ),
    );

    await registry.initialize(store);

    expect(registry.isMultiValued(Namespace.EXO.term("Instance_class").value)).toBe(false);
    expect(registry.isInitialized).toBe(true);
  });
});
