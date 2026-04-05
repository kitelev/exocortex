import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("NonInheritablePropertyRegistry", () => {
  let registry: NonInheritablePropertyRegistry;
  let store: InMemoryTripleStore;

  // Predicates
  const instanceClass = new IRI(
    "https://exocortex.my/ontology/exo#Instance_class",
  );
  const assetLabel = new IRI(
    "https://exocortex.my/ontology/exo#Asset_label",
  );

  // NonInheritableProperty class (as it appears in vault — obsidian IRI)
  const nonInheritableClassIRI = new IRI(
    "obsidian://vault/03%20Knowledge/exo/exo__NonInheritableProperty.md",
  );

  // Property definition subjects (vault file IRIs)
  const startTimestampDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_startTimestamp.md",
  );
  const endTimestampDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_endTimestamp.md",
  );
  const plannedStartDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_plannedStartTimestamp.md",
  );
  const plannedEndDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_plannedEndTimestamp.md",
  );
  const prototypeDef = new IRI(
    "obsidian://vault/03%20Knowledge/exo/exo__Asset_prototype.md",
  );
  const uidDef = new IRI(
    "obsidian://vault/03%20Knowledge/exo/exo__Asset_uid.md",
  );
  const labelDef = new IRI(
    "obsidian://vault/03%20Knowledge/exo/exo__Asset_label.md",
  );
  const statusDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_status.md",
  );
  const resultDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_result.md",
  );
  const blockedByDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_blockedBy.md",
  );
  const scheduledDateDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_scheduledDate.md",
  );
  const dueDateDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_dueDate.md",
  );

  // Inheritable property (not marked)
  const areaDef = new IRI(
    "obsidian://vault/03%20Knowledge/ems/ems__Effort_area.md",
  );

  const ALL_NONINHERITABLE_DEFS = [
    { def: startTimestampDef, label: "ems__Effort_startTimestamp" },
    { def: endTimestampDef, label: "ems__Effort_endTimestamp" },
    { def: plannedStartDef, label: "ems__Effort_plannedStartTimestamp" },
    { def: plannedEndDef, label: "ems__Effort_plannedEndTimestamp" },
    { def: prototypeDef, label: "exo__Asset_prototype" },
    { def: uidDef, label: "exo__Asset_uid" },
    { def: labelDef, label: "exo__Asset_label" },
    { def: statusDef, label: "ems__Effort_status" },
    { def: resultDef, label: "ems__Effort_result" },
    { def: blockedByDef, label: "ems__Effort_blockedBy" },
    { def: scheduledDateDef, label: "ems__Effort_scheduledDate" },
    { def: dueDateDef, label: "ems__Effort_dueDate" },
  ];

  async function populateStoreWith12Properties(): Promise<void> {
    // Add NonInheritableProperty class label
    await store.add(
      new Triple(
        nonInheritableClassIRI,
        assetLabel,
        new Literal("exo__NonInheritableProperty"),
      ),
    );

    // Mark all 12 properties
    for (const { def, label } of ALL_NONINHERITABLE_DEFS) {
      await store.add(
        new Triple(def, instanceClass, nonInheritableClassIRI),
      );
      await store.add(
        new Triple(def, assetLabel, new Literal(label)),
      );
    }

    // Add an inheritable property (not marked as NonInheritableProperty)
    await store.add(
      new Triple(areaDef, assetLabel, new Literal("ems__Effort_area")),
    );
  }

  beforeEach(() => {
    registry = new NonInheritablePropertyRegistry();
    store = new InMemoryTripleStore();
  });

  describe("initialize", () => {
    it("should handle empty store gracefully", async () => {
      await registry.initialize(store);

      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBe(0);
    });

    it("should load all 12 non-inheritable properties", async () => {
      await populateStoreWith12Properties();

      await registry.initialize(store);

      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBe(12);
    });

    it("should handle store without Instance_class predicate", async () => {
      await store.add(
        new Triple(
          new IRI("http://example.com/something"),
          assetLabel,
          new Literal("test"),
        ),
      );

      await registry.initialize(store);

      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBe(0);
    });

    it("should handle store without NonInheritableProperty class", async () => {
      // Add Instance_class triples but without NonInheritableProperty
      await store.add(
        new Triple(
          startTimestampDef,
          instanceClass,
          new IRI("https://exocortex.my/ontology/exo#TimestampProperty"),
        ),
      );

      await registry.initialize(store);

      expect(registry.isInitialized).toBe(true);
      expect(registry.size).toBe(0);
    });

    it("should clear previous state on re-initialize", async () => {
      await populateStoreWith12Properties();
      await registry.initialize(store);
      expect(registry.size).toBe(12);

      // Re-initialize with empty store
      const emptyStore = new InMemoryTripleStore();
      await registry.initialize(emptyStore);

      expect(registry.size).toBe(0);
    });
  });

  describe("isNonInheritable", () => {
    beforeEach(async () => {
      await populateStoreWith12Properties();
      await registry.initialize(store);
    });

    it("should return true for all 12 marked properties", () => {
      // EMS properties
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_startTimestamp").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_endTimestamp").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_plannedStartTimestamp").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_plannedEndTimestamp").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_status").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_result").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_blockedBy").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_scheduledDate").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_dueDate").value,
        ),
      ).toBe(true);

      // EXO properties
      expect(
        registry.isNonInheritable(
          Namespace.EXO.term("Asset_prototype").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EXO.term("Asset_uid").value,
        ),
      ).toBe(true);
      expect(
        registry.isNonInheritable(
          Namespace.EXO.term("Asset_label").value,
        ),
      ).toBe(true);
    });

    it("should return false for unmarked properties", () => {
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_area").value,
        ),
      ).toBe(false);

      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_timeEstimateMinutes").value,
        ),
      ).toBe(false);

      expect(
        registry.isNonInheritable(
          Namespace.EXO.term("Asset_description").value,
        ),
      ).toBe(false);
    });

    it("should return false before initialization", () => {
      const uninitializedRegistry = new NonInheritablePropertyRegistry();

      expect(
        uninitializedRegistry.isNonInheritable(
          Namespace.EMS.term("Effort_startTimestamp").value,
        ),
      ).toBe(false);
    });

    it("should return false for unknown IRI strings", () => {
      expect(
        registry.isNonInheritable("http://completely/unknown/property"),
      ).toBe(false);

      expect(registry.isNonInheritable("")).toBe(false);
    });
  });

  describe("fallback IRI detection", () => {
    it("should find NonInheritableProperty by IRI pattern when label not found", async () => {
      // Setup: NonInheritableProperty class referenced by IRI containing the name
      // (no Asset_label triple for the class itself)
      const niClassByIRI = new IRI(
        "https://exocortex.my/ontology/exo#NonInheritableProperty",
      );

      await store.add(
        new Triple(startTimestampDef, instanceClass, niClassByIRI),
      );
      await store.add(
        new Triple(
          startTimestampDef,
          assetLabel,
          new Literal("ems__Effort_startTimestamp"),
        ),
      );

      await registry.initialize(store);

      expect(registry.size).toBe(1);
      expect(
        registry.isNonInheritable(
          Namespace.EMS.term("Effort_startTimestamp").value,
        ),
      ).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should skip properties with non-Exocortex labels", async () => {
      await store.add(
        new Triple(
          nonInheritableClassIRI,
          assetLabel,
          new Literal("exo__NonInheritableProperty"),
        ),
      );

      const unknownDef = new IRI("obsidian://vault/unknown.md");
      await store.add(
        new Triple(unknownDef, instanceClass, nonInheritableClassIRI),
      );
      await store.add(
        new Triple(unknownDef, assetLabel, new Literal("someUnknownPrefix__Prop")),
      );

      await registry.initialize(store);

      expect(registry.size).toBe(0);
    });

    it("should handle exocmd__ namespace properties", async () => {
      await store.add(
        new Triple(
          nonInheritableClassIRI,
          assetLabel,
          new Literal("exo__NonInheritableProperty"),
        ),
      );

      const exocmdDef = new IRI("obsidian://vault/exocmd_prop.md");
      await store.add(
        new Triple(exocmdDef, instanceClass, nonInheritableClassIRI),
      );
      await store.add(
        new Triple(exocmdDef, assetLabel, new Literal("exocmd__Grounding_type")),
      );

      await registry.initialize(store);

      expect(registry.size).toBe(1);
      expect(
        registry.isNonInheritable(
          Namespace.EXOCMD.term("Grounding_type").value,
        ),
      ).toBe(true);
    });
  });
});
