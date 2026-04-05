import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { InstantiationRuleResolver } from "../../../src/services/InstantiationRuleResolver";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// ─── Test helpers ─────────────────────────────────────────────

async function addInstantiationRule(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    targetClass: string; // IRI local name, e.g. "Task"
    targetClassNamespace?: typeof Namespace.EMS | typeof Namespace.EXO;
    prototypeUID?: string;
    defaultFolder?: string;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const ns = opts.targetClassNamespace ?? Namespace.EMS;

  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXO.term("InstantiationRule"),
    ),
    new Triple(
      subject,
      Namespace.EXO.term("rule_targetClass"),
      ns.term(opts.targetClass),
    ),
  ];

  if (opts.prototypeUID) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXO.term("rule_prototypeUID"),
        new Literal(opts.prototypeUID),
      ),
    );
  }

  if (opts.defaultFolder) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXO.term("rule_defaultFolder"),
        new Literal(opts.defaultFolder),
      ),
    );
  }

  await store.addAll(triples);
  return subject;
}

async function addPropertySetRule(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    parentRuleSubject: IRI;
    property: string; // IRI local name within EMS namespace, e.g. "Effort_status"
    propertyNamespace?: typeof Namespace.EMS | typeof Namespace.EXO;
    value: string;
    valueType?: string;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const propNs = opts.propertyNamespace ?? Namespace.EMS;

  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXO.term("PropertySetRule"),
    ),
    new Triple(
      opts.parentRuleSubject,
      Namespace.EXO.term("rule_propertySetRules"),
      subject,
    ),
    new Triple(
      subject,
      Namespace.EXO.term("rule_property"),
      propNs.term(opts.property),
    ),
    new Triple(
      subject,
      Namespace.EXO.term("rule_value"),
      new Literal(opts.value),
    ),
  ];

  if (opts.valueType) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXO.term("rule_valueType"),
        new Literal(opts.valueType),
      ),
    );
  }

  await store.addAll(triples);
  return subject;
}

// ─── Tests ────────────────────────────────────────────────────

describe("InstantiationRuleResolver", () => {
  let store: InMemoryTripleStore;
  let resolver: InstantiationRuleResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new InstantiationRuleResolver(store);
  });

  describe("getRule", () => {
    it("should return null for an unknown class", async () => {
      const result = await resolver.getRule("ems__UnknownClass");
      expect(result).toBeNull();
    });

    it("should resolve a Task rule with prototype and folder", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-task-001",
        targetClass: "Task",
        prototypeUID: "proto-task-uid",
        defaultFolder: "01 Efforts/Tasks",
      });

      await addPropertySetRule(store, {
        uid: "psr-task-status",
        parentRuleSubject: ruleSubject,
        property: "Effort_status",
        value: "[[ems__EffortStatusBacklog]]",
        valueType: "wikilink",
      });

      const result = await resolver.getRule("ems__Task");

      expect(result).not.toBeNull();
      expect(result!.prototypeUID).toBe("proto-task-uid");
      expect(result!.defaultFolder).toBe("01 Efforts/Tasks");
      expect(result!.propertySetRules).toHaveLength(1);
      expect(result!.propertySetRules[0]).toEqual({
        property: "ems__Effort_status",
        value: "[[ems__EffortStatusBacklog]]",
        valueType: "wikilink",
      });
    });

    it("should resolve a Project rule with multiple property set rules", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-project-001",
        targetClass: "Project",
        prototypeUID: "proto-project-uid",
        defaultFolder: "01 Efforts/Projects",
      });

      await addPropertySetRule(store, {
        uid: "psr-proj-status",
        parentRuleSubject: ruleSubject,
        property: "Effort_status",
        value: "[[ems__EffortStatusBacklog]]",
        valueType: "wikilink",
      });

      await addPropertySetRule(store, {
        uid: "psr-proj-priority",
        parentRuleSubject: ruleSubject,
        property: "Effort_priority",
        value: "3",
        valueType: "literal",
      });

      const result = await resolver.getRule("ems__Project");

      expect(result).not.toBeNull();
      expect(result!.prototypeUID).toBe("proto-project-uid");
      expect(result!.defaultFolder).toBe("01 Efforts/Projects");
      expect(result!.propertySetRules).toHaveLength(2);

      const statusRule = result!.propertySetRules.find(
        (r) => r.property === "ems__Effort_status",
      );
      expect(statusRule).toBeDefined();
      expect(statusRule!.valueType).toBe("wikilink");

      const priorityRule = result!.propertySetRules.find(
        (r) => r.property === "ems__Effort_priority",
      );
      expect(priorityRule).toBeDefined();
      expect(priorityRule!.value).toBe("3");
      expect(priorityRule!.valueType).toBe("literal");
    });

    it("should resolve a Knowledge rule (ims namespace)", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-concept-001",
        targetClass: "Concept",
        targetClassNamespace: Namespace.EXO,
        defaultFolder: "03 Knowledge/concepts",
      });

      // No prototype, no property set rules — just folder
      const result = await resolver.getRule("exo__Concept");

      expect(result).not.toBeNull();
      expect(result!.prototypeUID).toBeNull();
      expect(result!.defaultFolder).toBe("03 Knowledge/concepts");
      expect(result!.propertySetRules).toHaveLength(0);
    });

    it("should return null when no matching rule exists among multiple rules", async () => {
      await addInstantiationRule(store, {
        uid: "rule-task-001",
        targetClass: "Task",
        defaultFolder: "01 Efforts/Tasks",
      });

      await addInstantiationRule(store, {
        uid: "rule-project-001",
        targetClass: "Project",
        defaultFolder: "01 Efforts/Projects",
      });

      const result = await resolver.getRule("ems__Area");
      expect(result).toBeNull();
    });

    it("should handle rule without optional fields", async () => {
      await addInstantiationRule(store, {
        uid: "rule-minimal-001",
        targetClass: "Task",
        // no prototypeUID, no defaultFolder
      });

      const result = await resolver.getRule("ems__Task");

      expect(result).not.toBeNull();
      expect(result!.prototypeUID).toBeNull();
      expect(result!.defaultFolder).toBeNull();
      expect(result!.propertySetRules).toHaveLength(0);
    });

    it("should default valueType to 'literal' when not specified", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-default-vt",
        targetClass: "Task",
      });

      await addPropertySetRule(store, {
        uid: "psr-no-vt",
        parentRuleSubject: ruleSubject,
        property: "Effort_summary",
        value: "Default summary",
        // no valueType specified
      });

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.propertySetRules[0].valueType).toBe("literal");
    });
  });

  describe("caching", () => {
    it("should cache results and return same value on second call", async () => {
      await addInstantiationRule(store, {
        uid: "rule-cache-001",
        targetClass: "Task",
        defaultFolder: "01 Efforts/Tasks",
      });

      const first = await resolver.getRule("ems__Task");
      const second = await resolver.getRule("ems__Task");

      expect(first).toBe(second); // Same reference
    });

    it("should cache null results for unknown classes", async () => {
      const first = await resolver.getRule("ems__Unknown");
      const second = await resolver.getRule("ems__Unknown");

      expect(first).toBeNull();
      expect(second).toBeNull();
    });

    it("should return fresh data after invalidateCache", async () => {
      await addInstantiationRule(store, {
        uid: "rule-inv-001",
        targetClass: "Task",
        defaultFolder: "old/folder",
      });

      const before = await resolver.getRule("ems__Task");
      expect(before!.defaultFolder).toBe("old/folder");

      // Clear and re-populate store with different data
      await store.clear();
      await addInstantiationRule(store, {
        uid: "rule-inv-002",
        targetClass: "Task",
        defaultFolder: "new/folder",
      });

      // Still cached
      const cached = await resolver.getRule("ems__Task");
      expect(cached!.defaultFolder).toBe("old/folder");

      // After invalidation
      resolver.invalidateCache();
      const refreshed = await resolver.getRule("ems__Task");
      expect(refreshed!.defaultFolder).toBe("new/folder");
    });
  });

  describe("targetClass matching", () => {
    it("should match target class via IRI namespace (ems)", async () => {
      await addInstantiationRule(store, {
        uid: "rule-iri-match",
        targetClass: "Task",
        targetClassNamespace: Namespace.EMS,
        defaultFolder: "tasks/",
      });

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
    });

    it("should match target class specified as wikilink literal", async () => {
      const subject = new IRI("obsidian://vault/rule-wikilink.md");
      await store.addAll([
        new Triple(
          subject,
          Namespace.RDF.term("type"),
          Namespace.EXO.term("InstantiationRule"),
        ),
        new Triple(
          subject,
          Namespace.EXO.term("rule_targetClass"),
          new Literal("[[ems__Task]]"),
        ),
        new Triple(
          subject,
          Namespace.EXO.term("rule_defaultFolder"),
          new Literal("wikilink-folder/"),
        ),
      ]);

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.defaultFolder).toBe("wikilink-folder/");
    });
  });

  describe("property set rule loading", () => {
    it("should skip property set rules without a property defined", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-skip-psr",
        targetClass: "Task",
      });

      // Add a PropertySetRule with no rule_property — only value
      const psrSubject = new IRI("obsidian://vault/psr-broken.md");
      await store.addAll([
        new Triple(
          psrSubject,
          Namespace.RDF.term("type"),
          Namespace.EXO.term("PropertySetRule"),
        ),
        new Triple(
          ruleSubject,
          Namespace.EXO.term("rule_propertySetRules"),
          psrSubject,
        ),
        new Triple(
          psrSubject,
          Namespace.EXO.term("rule_value"),
          new Literal("some-value"),
        ),
      ]);

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.propertySetRules).toHaveLength(0);
    });

    it("should handle property specified as wikilink literal", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-wikilink-prop",
        targetClass: "Task",
      });

      const psrSubject = new IRI("obsidian://vault/psr-wikilink.md");
      await store.addAll([
        new Triple(
          psrSubject,
          Namespace.RDF.term("type"),
          Namespace.EXO.term("PropertySetRule"),
        ),
        new Triple(
          ruleSubject,
          Namespace.EXO.term("rule_propertySetRules"),
          psrSubject,
        ),
        new Triple(
          psrSubject,
          Namespace.EXO.term("rule_property"),
          new Literal("[[ems__Effort_status]]"),
        ),
        new Triple(
          psrSubject,
          Namespace.EXO.term("rule_value"),
          new Literal("backlog"),
        ),
      ]);

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.propertySetRules).toHaveLength(1);
      expect(result!.propertySetRules[0].property).toBe("ems__Effort_status");
    });

    it("should handle propertySetRules reference that is a Literal (skip)", async () => {
      const ruleSubject = await addInstantiationRule(store, {
        uid: "rule-literal-ref",
        targetClass: "Task",
      });

      // Add a non-IRI reference to propertySetRules
      await store.add(
        new Triple(
          ruleSubject,
          Namespace.EXO.term("rule_propertySetRules"),
          new Literal("not-an-iri"),
        ),
      );

      const result = await resolver.getRule("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.propertySetRules).toHaveLength(0);
    });
  });
});
