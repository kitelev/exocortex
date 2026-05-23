import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// -- Test helpers --

async function addCommandAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    labelTemplate?: string;
    icon?: string;
    preconditionRef?: string;
    groundingRef: string;
    confirmMessage?: string;
    successMessage?: string;
    category?: string;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(subject, Namespace.EXOCMD.term("Command_grounding"), new IRI(`obsidian://vault/${opts.groundingRef}.md`)),
  ];

  if (opts.labelTemplate) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_labelTemplate"), new Literal(opts.labelTemplate)));
  }
  if (opts.icon) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_icon"), new Literal(opts.icon)));
  }
  if (opts.preconditionRef) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_precondition"), new IRI(`obsidian://vault/${opts.preconditionRef}.md`)));
  }
  if (opts.confirmMessage) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_confirmMessage"), new Literal(opts.confirmMessage)));
  }
  if (opts.successMessage) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_successMessage"), new Literal(opts.successMessage)));
  }
  if (opts.category) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_category"), new Literal(opts.category)));
  }

  await store.addAll(triples);
  return subject;
}

async function addPreconditionAsset(
  store: InMemoryTripleStore,
  opts: { uid: string; label: string; sparqlAsk?: string; hostFunction?: string },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
  ];

  if (opts.sparqlAsk) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Precondition_sparqlAsk"), new Literal(opts.sparqlAsk)));
  }
  if (opts.hostFunction) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Precondition_hostFunction"), new Literal(opts.hostFunction)));
  }

  await store.addAll(triples);
  return subject;
}

async function addGroundingAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    type: string;
    targetProperty?: string;
    targetValue?: string;
    sparqlUpdate?: string;
    stepRefs?: string[];
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(subject, Namespace.EXOCMD.term("Grounding_type"), new Literal(opts.type)),
  ];

  if (opts.targetProperty) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal(opts.targetProperty)));
  }
  if (opts.targetValue) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Grounding_targetValue"), new Literal(opts.targetValue)));
  }
  if (opts.sparqlUpdate) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Grounding_sparqlUpdate"), new Literal(opts.sparqlUpdate)));
  }
  if (opts.stepRefs) {
    for (const ref of opts.stepRefs) {
      triples.push(new Triple(subject, Namespace.EXOCMD.term("Grounding_steps"), new IRI(`obsidian://vault/${ref}.md`)));
    }
  }

  await store.addAll(triples);
  return subject;
}

async function addBindingAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    commandRef: string;
    targetClass?: string;
    targetPrototype?: string;
    targetAsset?: string;
    position?: string;
    order?: number;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(subject, Namespace.EXOCMD.term("CommandBinding_command"), new IRI(`obsidian://vault/${opts.commandRef}.md`)),
  ];

  if (opts.targetClass) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal(opts.targetClass)));
  }
  if (opts.targetPrototype) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("CommandBinding_targetPrototype"), new Literal(opts.targetPrototype)));
  }
  if (opts.targetAsset) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("CommandBinding_targetAsset"), new Literal(opts.targetAsset)));
  }
  if (opts.position) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("CommandBinding_position"), new Literal(opts.position)));
  }
  if (opts.order !== undefined) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("CommandBinding_order"), new Literal(String(opts.order))));
  }

  await store.addAll(triples);
  return subject;
}

// -- Tests --

describe("CommandResolver", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
  });

  describe("loadCommand", () => {
    it("should load a command with all properties", async () => {
      await addPreconditionAsset(store, {
        uid: "pre-has-start",
        label: "Has startTimestamp",
        sparqlAsk: "ASK { $target ems:Effort_startTimestamp ?ts }",
      });

      await addGroundingAsset(store, {
        uid: "gnd-remove-start",
        label: "Delete startTimestamp",
        type: "property_delete",
        targetProperty: "ems__Effort_startTimestamp",
      });

      await addCommandAsset(store, {
        uid: "cmd-remove-start",
        label: "Remove start timestamp",
        icon: "clock-x",
        preconditionRef: "pre-has-start",
        groundingRef: "gnd-remove-start",
        confirmMessage: "Delete start timestamp?",
        successMessage: "Deleted",
        category: "maintenance",
      });

      const cmd = await resolver.loadCommand("cmd-remove-start");

      expect(cmd).not.toBeNull();
      expect(cmd!.id).toBe("cmd-remove-start");
      expect(cmd!.name).toBe("Remove start timestamp");
      expect(cmd!.icon).toBe("clock-x");
      expect(cmd!.confirmMessage).toBe("Delete start timestamp?");
      expect(cmd!.successMessage).toBe("Deleted");
      expect(cmd!.category).toBe("maintenance");
    });

    it("should load linked precondition transitively", async () => {
      await addPreconditionAsset(store, {
        uid: "pre-has-start",
        label: "Has start",
        sparqlAsk: "ASK { $target ems:Effort_startTimestamp ?ts }",
      });

      await addGroundingAsset(store, {
        uid: "gnd-remove",
        label: "Remove",
        type: "property_delete",
        targetProperty: "ems__Effort_startTimestamp",
      });

      await addCommandAsset(store, {
        uid: "cmd-test",
        label: "Test",
        preconditionRef: "pre-has-start",
        groundingRef: "gnd-remove",
      });

      const cmd = await resolver.loadCommand("cmd-test");

      expect(cmd!.precondition).toBeDefined();
      expect(cmd!.precondition!.id).toBe("pre-has-start");
      expect(cmd!.precondition!.sparqlAsk).toContain("ASK");
    });

    it("should load linked grounding transitively", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-set-status",
        label: "Set status",
        type: "property_set",
        targetProperty: "ems__Effort_status",
        targetValue: "ems__EffortStatusDoing",
      });

      await addCommandAsset(store, {
        uid: "cmd-start",
        label: "Start",
        groundingRef: "gnd-set-status",
      });

      const cmd = await resolver.loadCommand("cmd-start");

      expect(cmd!.grounding).toBeDefined();
      expect(cmd!.grounding.type).toBe("property_set");
      expect(cmd!.grounding.targetProperty).toBe("ems__Effort_status");
    });

    // RFC 918a2b65 Phase 4 (#3242): the legacy `Grounding_targetValue` loader
    // + reverse-mapping logic was removed from `CommandResolver`. The tests
    // that exercised that loader (IRI reverse-mapping, UUID wikilink alias,
    // missing-UUID preservation, alias roundtrip, non-wikilink passthrough)
    // are no longer applicable. Equivalent coverage for typed predicates lives
    // in the "RFC 31c1a0be typed predicates" describe blocks below.

    it("should read Grounding_linkBackProperty as IRI wikilink and resolve to bare property name", async () => {
      const groundingSubject = new IRI(`obsidian://vault/gnd-linkback.md`);
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-linkback")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("Create Next Iter")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_linkBackProperty"),
          Namespace.EMS.term("Effort_prevIteration"),
        ),
      ]);

      await addCommandAsset(store, {
        uid: "cmd-linkback",
        label: "Create Next Iter",
        groundingRef: "gnd-linkback",
      });

      const cmd = await resolver.loadCommand("cmd-linkback");

      expect(cmd!.grounding.linkBackProperty).toBe("ems__Effort_prevIteration");
    });

    it("should set linkBackProperty to undefined when Grounding_linkBackProperty absent", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-no-linkback",
        label: "No LinkBack",
        type: "create_instance",
      });

      await addCommandAsset(store, {
        uid: "cmd-no-linkback",
        label: "No LinkBack",
        groundingRef: "gnd-no-linkback",
      });

      const cmd = await resolver.loadCommand("cmd-no-linkback");

      expect(cmd!.grounding.linkBackProperty).toBeUndefined();
    });

    // RFC v2 Phase 5 (#3167): legacy JSON-literal parser removed. The
    // `Grounding_propertyDefaults` (plural) predicate is no longer read; only
    // ref-form `Grounding_propertyDefault` (singular) → `exocmd__PropertyDefault`
    // instances drive the propertyDefault pipeline. The deprecated triple, if
    // still present on a hand-edited Grounding, is ignored (no field emitted,
    // no error thrown) — but a one-shot transitional deprecation warn is
    // logged per Grounding-uid so the silent-regression surfaces in logs.
    it("RFC v2 Phase 5: legacy Grounding_propertyDefaults JSON triple is ignored with transitional warn", async () => {
      const warnings: string[] = [];
      const recordingLogger = {
        debug() {},
        info() {},
        warn(message: string) {
          warnings.push(message);
        },
        error() {},
      };
      const resolverWithLogger = new CommandResolver(store, recordingLogger);
      const groundingSubject = new IRI(`obsidian://vault/gnd-legacy-defaults.md`);
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-legacy-defaults")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("Legacy defaults ignored")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_propertyDefaults"),
          new Literal('{"ems__Effort_plannedStartTimestamp":"$today"}'),
        ),
      ]);
      await addCommandAsset(store, {
        uid: "cmd-legacy-defaults",
        label: "Legacy",
        groundingRef: "gnd-legacy-defaults",
      });

      const cmd = await resolverWithLogger.loadCommand("cmd-legacy-defaults");

      expect(cmd).not.toBeNull();
      expect((cmd!.grounding as unknown as Record<string, unknown>).propertyDefaults).toBeUndefined();
      expect(cmd!.grounding.propertyDefault).toBeUndefined();
      // Transitional deprecation warn was logged exactly once.
      const deprecationWarns = warnings.filter((w) =>
        /deprecated exocmd__Grounding_propertyDefaults/.test(w),
      );
      expect(deprecationWarns).toHaveLength(1);
      expect(deprecationWarns[0]).toContain("gnd-legacy-defaults");
    });

    it("should parse exocmd__Grounding_prefillLabelWithDate true literal as boolean flag", async () => {
      const groundingSubject = new IRI("obsidian://vault/gnd-prefill.md");
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-prefill")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("Create Wim Hof session")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_prefillLabelWithDate"),
          new Literal("true"),
        ),
      ]);
      await addCommandAsset(store, {
        uid: "cmd-prefill",
        label: "Create Wim Hof Session",
        groundingRef: "gnd-prefill",
      });

      const cmd = await resolver.loadCommand("cmd-prefill");

      expect(cmd!.grounding.prefillLabelWithDate).toBe(true);
    });

    it("should leave prefillLabelWithDate undefined when triple is absent (backward-compat)", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-no-prefill",
        label: "Plain create_instance",
        type: "create_instance",
      });
      await addCommandAsset(store, {
        uid: "cmd-no-prefill",
        label: "Plain",
        groundingRef: "gnd-no-prefill",
      });

      const cmd = await resolver.loadCommand("cmd-no-prefill");

      expect(cmd!.grounding.prefillLabelWithDate).toBeUndefined();
    });

    it("should leave prefillLabelWithDate undefined for non-true literals (only 'true' opts in)", async () => {
      const groundingSubject = new IRI("obsidian://vault/gnd-not-true.md");
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-not-true")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("Disabled prefill")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_prefillLabelWithDate"),
          new Literal("false"),
        ),
      ]);
      await addCommandAsset(store, {
        uid: "cmd-not-true",
        label: "Disabled",
        groundingRef: "gnd-not-true",
      });

      const cmd = await resolver.loadCommand("cmd-not-true");

      expect(cmd!.grounding.prefillLabelWithDate).toBeUndefined();
    });

    it("should pass through `default` and `defaultValue` from inputSchema JSON Schema properties", async () => {
      const groundingSubject = new IRI("obsidian://vault/gnd-defaults-input.md");
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-defaults-input")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("With input defaults")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_inputSchema"),
          new Literal(
            JSON.stringify({
              type: "object",
              properties: {
                label: { type: "string", title: "Label", default: "Static default" },
                note: { type: "string", title: "Note", defaultValue: "from defaultValue" },
                empty: { type: "string", title: "Empty" },
              },
              required: ["label"],
            }),
          ),
        ),
      ]);
      await addCommandAsset(store, {
        uid: "cmd-defaults-input",
        label: "With input defaults",
        groundingRef: "gnd-defaults-input",
      });

      const cmd = await resolver.loadCommand("cmd-defaults-input");
      const inputSchema = (cmd!.grounding as unknown as Record<string, unknown>)[
        "inputSchema"
      ] as Array<Record<string, unknown>>;

      expect(inputSchema).toEqual([
        {
          name: "label",
          type: "text",
          label: "Label",
          required: true,
          defaultValue: "Static default",
        },
        {
          name: "note",
          type: "text",
          label: "Note",
          required: false,
          defaultValue: "from defaultValue",
        },
        {
          name: "empty",
          type: "text",
          label: "Empty",
          required: false,
        },
      ]);
    });

    // RFC v2 Phase 5 (#3167): the legacy fail-loud-on-invalid-JSON test was
    // removed alongside the parser. Invalid JSON in the deprecated triple is
    // simply ignored — there is no longer a parser to throw.
    it("RFC v2 Phase 5: invalid Grounding_propertyDefaults JSON does not throw (parser removed)", async () => {
      const groundingSubject = new IRI(`obsidian://vault/gnd-bad-legacy.md`);
      await store.addAll([
        new Triple(groundingSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-bad-legacy")),
        new Triple(groundingSubject, Namespace.EXO.term("Asset_label"), new Literal("Bad legacy")),
        new Triple(groundingSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
        new Triple(
          groundingSubject,
          Namespace.EXOCMD.term("Grounding_propertyDefaults"),
          new Literal("not-json"),
        ),
      ]);
      await addCommandAsset(store, {
        uid: "cmd-bad-legacy",
        label: "Bad",
        groundingRef: "gnd-bad-legacy",
      });

      const cmd = await resolver.loadCommand("cmd-bad-legacy");
      expect(cmd).not.toBeNull();
    });

    it("should return null for missing UID", async () => {
      const cmd = await resolver.loadCommand("non-existent");
      expect(cmd).toBeNull();
    });

    it("should return null if grounding is missing", async () => {
      // Command without grounding reference
      const subject = new IRI("obsidian://vault/cmd-no-grounding.md");
      await store.addAll([
        new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
        new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("cmd-no-grounding")),
        new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal("No grounding")),
      ]);

      const cmd = await resolver.loadCommand("cmd-no-grounding");
      expect(cmd).toBeNull();
    });

    it("should load precondition with hostFunction instead of sparqlAsk", async () => {
      await addPreconditionAsset(store, {
        uid: "pre-host-fn",
        label: "Has obsolete properties",
        hostFunction: "hasObsoleteProperties",
      });

      await addGroundingAsset(store, {
        uid: "gnd-clean",
        label: "Clean properties",
        type: "property_delete",
        targetProperty: "deprecated_prop",
      });

      await addCommandAsset(store, {
        uid: "cmd-clean",
        label: "Clean Properties",
        preconditionRef: "pre-host-fn",
        groundingRef: "gnd-clean",
      });

      const cmd = await resolver.loadCommand("cmd-clean");

      expect(cmd).not.toBeNull();
      expect(cmd!.precondition).toBeDefined();
      expect(cmd!.precondition!.id).toBe("pre-host-fn");
      expect(cmd!.precondition!.hostFunction).toBe("hasObsoleteProperties");
      expect(cmd!.precondition!.sparqlAsk).toBeUndefined();
    });

    it("should load precondition with both sparqlAsk and hostFunction", async () => {
      await addPreconditionAsset(store, {
        uid: "pre-both",
        label: "Dual precondition",
        sparqlAsk: "ASK { $target ?p ?o }",
        hostFunction: "customCheck",
      });

      await addGroundingAsset(store, {
        uid: "gnd-dual",
        label: "Dual",
        type: "property_delete",
        targetProperty: "some_prop",
      });

      await addCommandAsset(store, {
        uid: "cmd-dual",
        label: "Dual Command",
        preconditionRef: "pre-both",
        groundingRef: "gnd-dual",
      });

      const cmd = await resolver.loadCommand("cmd-dual");

      expect(cmd).not.toBeNull();
      expect(cmd!.precondition).toBeDefined();
      expect(cmd!.precondition!.sparqlAsk).toBe("ASK { $target ?p ?o }");
      expect(cmd!.precondition!.hostFunction).toBe("customCheck");
    });

    it("should handle command without precondition gracefully", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-simple",
        label: "Simple",
        type: "property_delete",
        targetProperty: "ems__Effort_startTimestamp",
      });

      await addCommandAsset(store, {
        uid: "cmd-no-pre",
        label: "No precondition",
        groundingRef: "gnd-simple",
      });

      const cmd = await resolver.loadCommand("cmd-no-pre");

      expect(cmd).not.toBeNull();
      expect(cmd!.precondition).toBeUndefined();
    });

    it("should load composite grounding with steps", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-step1",
        label: "Set status",
        type: "property_set",
        targetProperty: "ems__Effort_status",
        targetValue: "ems__EffortStatusDoing",
      });

      await addGroundingAsset(store, {
        uid: "gnd-step2",
        label: "Set start",
        type: "property_set",
        targetProperty: "ems__Effort_startTimestamp",
        targetValue: "$now",
      });

      await addGroundingAsset(store, {
        uid: "gnd-composite",
        label: "Start effort",
        type: "composite",
        stepRefs: ["gnd-step1", "gnd-step2"],
      });

      await addCommandAsset(store, {
        uid: "cmd-start-effort",
        label: "Start effort",
        groundingRef: "gnd-composite",
      });

      const cmd = await resolver.loadCommand("cmd-start-effort");

      expect(cmd!.grounding.type).toBe("composite");
      expect(cmd!.grounding.steps).toHaveLength(2);
      expect(cmd!.grounding.steps![0].type).toBe("property_set");
      expect(cmd!.grounding.steps![1].targetProperty).toBe("ems__Effort_startTimestamp");
    });
  });

  describe("findBindings", () => {
    beforeEach(async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G1", type: "property_delete", targetProperty: "test" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
    });

    it("should find bindings by targetClass", async () => {
      await addBindingAsset(store, {
        uid: "bind-1",
        label: "For tasks",
        commandRef: "cmd-1",
        targetClass: "ems__Task",
      });

      const bindings = await resolver.findBindings("ems__Task");

      expect(bindings).toHaveLength(1);
      expect(bindings[0].targetClass).toBe("ems__Task");
    });

    it("should find bindings by targetPrototype", async () => {
      await addBindingAsset(store, {
        uid: "bind-proto",
        label: "For prototype",
        commandRef: "cmd-1",
        targetPrototype: "proto-uid-123",
      });

      const bindings = await resolver.findBindings(undefined, "proto-uid-123");

      expect(bindings).toHaveLength(1);
      expect(bindings[0].targetPrototype).toBe("proto-uid-123");
    });

    it("should find bindings by targetAsset", async () => {
      await addBindingAsset(store, {
        uid: "bind-asset",
        label: "For specific asset",
        commandRef: "cmd-1",
        targetAsset: "asset-uid-456",
      });

      const bindings = await resolver.findBindings(undefined, undefined, "asset-uid-456");

      expect(bindings).toHaveLength(1);
    });

    // Issue #2896: production DynamicCommandButtonGroupBuilder passes the full
    // obsidian:// vault URL as assetIRI, while bindings store the referenced
    // file basename (via iriToObsidianName on the resolved fileIRI).
    // matchesReference must bridge path-based IRIs with basename references.
    it("should match targetAsset basename against obsidian:// path IRI", async () => {
      await addBindingAsset(store, {
        uid: "bind-path-asset",
        label: "For path-addressed asset",
        commandRef: "cmd-1",
        targetAsset: "smoke-task",
      });

      const bindings = await resolver.findBindings(
        undefined,
        undefined,
        "obsidian://vault/Tasks/smoke-task.md",
      );

      expect(bindings).toHaveLength(1);
    });

    it("should return empty array when no bindings match", async () => {
      await addBindingAsset(store, {
        uid: "bind-project",
        label: "For projects",
        commandRef: "cmd-1",
        targetClass: "ems__Project",
      });

      const bindings = await resolver.findBindings("ems__Task");

      expect(bindings).toHaveLength(0);
    });

    it("should skip bindings without any target", async () => {
      // Manually add a binding without targetClass/targetPrototype/targetAsset
      const subject = new IRI("obsidian://vault/bind-no-target.md");
      await store.addAll([
        new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
        new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("bind-no-target")),
        new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal("No target")),
        new Triple(subject, Namespace.EXOCMD.term("CommandBinding_command"), new IRI("obsidian://vault/cmd-1.md")),
      ]);

      const bindings = await resolver.findBindings("ems__Task");

      expect(bindings).toHaveLength(0);
    });

    it("should match when assetClass is UUID|alias and binding targetClass is alias", async () => {
      await addBindingAsset(store, {
        uid: "bind-1",
        label: "For tasks",
        commandRef: "cmd-1",
        targetClass: "ems__Task",
      });

      // Simulates extractAssetClass output from [[UUID|ems__Task]] wikilink format
      const bindings = await resolver.findBindings("1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task");

      expect(bindings).toHaveLength(1);
      expect(bindings[0].targetClass).toBe("ems__Task");
    });

    it("should match when both sides use UUID|alias format with same alias", async () => {
      await addBindingAsset(store, {
        uid: "bind-1",
        label: "For tasks",
        commandRef: "cmd-1",
        targetClass: "ems__Task",
      });

      // Both UUID|alias formats should match as long as alias is the same
      const bindings = await resolver.findBindings("different-uuid|ems__Task");

      expect(bindings).toHaveLength(1);
    });
  });

  describe("resolveForAsset", () => {
    it("should resolve commands for a given asset class", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G1", type: "property_delete", targetProperty: "test" });
      await addCommandAsset(store, { uid: "cmd-1", label: "Command 1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "ems__Task" });

      const resolved = await resolver.resolveForAsset("asset-123", "ems__Task");

      expect(resolved).toHaveLength(1);
      expect(resolved[0].command.name).toBe("Command 1");
      expect(resolved[0].binding.targetClass).toBe("ems__Task");
    });

    it("should resolve commands when assetClass uses UUID|alias format", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G1", type: "property_delete", targetProperty: "test" });
      await addCommandAsset(store, { uid: "cmd-1", label: "Command 1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "ems__Task" });

      // UUID|alias format from [[UUID|ems__Task]] wikilink
      const resolved = await resolver.resolveForAsset(
        "asset-123",
        "1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task",
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0].command.name).toBe("Command 1");
    });

    it("should return empty array when no bindings match", async () => {
      const resolved = await resolver.resolveForAsset("asset-123", "ems__Task");

      expect(resolved).toHaveLength(0);
    });

    it("should sort by binding priority: targetAsset > targetPrototype > targetClass", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G1", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-class", label: "Class cmd", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-proto", label: "Proto cmd", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-asset", label: "Asset cmd", groundingRef: "gnd-1" });

      await addBindingAsset(store, { uid: "bind-class", label: "BC", commandRef: "cmd-class", targetClass: "ems__Task" });
      await addBindingAsset(store, { uid: "bind-proto", label: "BP", commandRef: "cmd-proto", targetPrototype: "proto-1" });
      await addBindingAsset(store, { uid: "bind-asset", label: "BA", commandRef: "cmd-asset", targetAsset: "asset-1" });

      const resolved = await resolver.resolveForAsset("asset-1", "ems__Task", "proto-1");

      expect(resolved).toHaveLength(3);
      expect(resolved[0].command.name).toBe("Asset cmd");     // priority 0
      expect(resolved[1].command.name).toBe("Proto cmd");     // priority 1
      expect(resolved[2].command.name).toBe("Class cmd");     // priority 2
    });

    it("should sort by order within same priority", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-a", label: "A", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-b", label: "B", groundingRef: "gnd-1" });

      await addBindingAsset(store, { uid: "bind-a", label: "BA", commandRef: "cmd-a", targetClass: "ems__Task", order: 200 });
      await addBindingAsset(store, { uid: "bind-b", label: "BB", commandRef: "cmd-b", targetClass: "ems__Task", order: 50 });

      const resolved = await resolver.resolveForAsset("asset-1", "ems__Task");

      expect(resolved[0].command.name).toBe("B"); // order 50
      expect(resolved[1].command.name).toBe("A"); // order 200
    });

    it("should skip bindings referencing non-existent commands", async () => {
      await addBindingAsset(store, {
        uid: "bind-broken",
        label: "Broken",
        commandRef: "cmd-does-not-exist",
        targetClass: "ems__Task",
      });

      const resolved = await resolver.resolveForAsset("asset-1", "ems__Task");

      expect(resolved).toHaveLength(0);
    });
  });

  describe("resolveForAssetMulti (Issue #2958 — Universal exo__Asset bindings)", () => {
    it("should match binding with targetClass=exo__Asset when exo__Asset is in classes array", async () => {
      // AC1: Universal binding visible on subclass instance via multi-class dispatch
      await addGroundingAsset(store, { uid: "gnd-univ", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-clean", label: "Clean Properties", groundingRef: "gnd-univ" });
      await addBindingAsset(store, { uid: "bind-univ", label: "Universal", commandRef: "cmd-clean", targetClass: "exo__Asset" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].command.name).toBe("Clean Properties");
      expect(resolved[0].binding.targetClass).toBe("exo__Asset");
    });

    it("should merge bindings from multiple classes", async () => {
      // AC2: Multi-class asset gets bindings from each declared class
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-task", label: "Task cmd", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-univ", label: "Universal cmd", groundingRef: "gnd-1" });

      await addBindingAsset(store, { uid: "bind-task", label: "BT", commandRef: "cmd-task", targetClass: "ems__Task" });
      await addBindingAsset(store, { uid: "bind-univ", label: "BU", commandRef: "cmd-univ", targetClass: "exo__Asset" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"]);

      expect(resolved).toHaveLength(2);
      const names = resolved.map((rc) => rc.command.name).sort();
      expect(names).toEqual(["Task cmd", "Universal cmd"]);
    });

    it("should deduplicate by binding.id when same binding matches multiple classes", async () => {
      // AC3: dedup by binding.id (NOT commandRef)
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-shared", label: "Shared", groundingRef: "gnd-1" });

      // Two SEPARATE bindings to the same command — both should appear (dedupe by binding.id, not commandRef)
      await addBindingAsset(store, { uid: "bind-task", label: "BT", commandRef: "cmd-shared", targetClass: "ems__Task" });
      await addBindingAsset(store, { uid: "bind-univ", label: "BU", commandRef: "cmd-shared", targetClass: "exo__Asset" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"]);

      // Both bindings appear because they have different binding.id
      expect(resolved).toHaveLength(2);
      const bindingIds = resolved.map((rc) => rc.binding.id).sort();
      expect(bindingIds).toEqual(["bind-task", "bind-univ"]);
    });

    it("should not duplicate when same binding object is matched twice via different classes", async () => {
      // If somehow the same binding gets returned for two classes, dedup by binding.id keeps it once
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
      // Single binding with targetClass=exo__Asset; both array entries trigger same binding
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "exo__Asset" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["exo__Asset", "exo__Asset"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].binding.id).toBe("bind-1");
    });

    it("should return empty when classes array is empty", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "ems__Task" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", []);

      expect(resolved).toHaveLength(0);
    });

    it("should produce stable cache key for any permutation of class array", async () => {
      // Cache key sorts classes — same key for ['A','B'] and ['B','A']
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "exo__Asset" });

      const matchSpy = jest.spyOn(store, "match");

      const first = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"]);
      const callsAfterFirst = matchSpy.mock.calls.length;

      const second = await resolver.resolveForAssetMulti("asset-1", ["exo__Asset", "ems__Task"]);
      const callsAfterSecond = matchSpy.mock.calls.length;

      // Second call hits cache — no new match() calls
      expect(callsAfterSecond).toBe(callsAfterFirst);
      expect(second).toEqual(first);
    });

    it("should pass prototypeIRI through to inner resolution for each class", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-proto", label: "Proto cmd", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-proto", label: "BP", commandRef: "cmd-proto", targetPrototype: "proto-1" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"], "proto-1");

      expect(resolved).toHaveLength(1);
      expect(resolved[0].binding.targetPrototype).toBe("proto-1");
    });

    it("should sort by binding priority across all classes (asset > prototype > class)", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-class", label: "Class cmd", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-univ", label: "Univ cmd", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-asset", label: "Asset cmd", groundingRef: "gnd-1" });

      await addBindingAsset(store, { uid: "bind-class", label: "BC", commandRef: "cmd-class", targetClass: "ems__Task" });
      await addBindingAsset(store, { uid: "bind-univ", label: "BU", commandRef: "cmd-univ", targetClass: "exo__Asset" });
      await addBindingAsset(store, { uid: "bind-asset", label: "BA", commandRef: "cmd-asset", targetAsset: "asset-1" });

      const resolved = await resolver.resolveForAssetMulti("asset-1", ["ems__Task", "exo__Asset"]);

      expect(resolved).toHaveLength(3);
      // targetAsset (priority 0) first, then targetClass entries (priority 2)
      expect(resolved[0].command.name).toBe("Asset cmd");
    });
  });

  describe("cache", () => {
    it("should return cached results on second call", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "ems__Task" });

      const matchSpy = jest.spyOn(store, "match");

      const first = await resolver.resolveForAsset("asset-1", "ems__Task");
      const callCountAfterFirst = matchSpy.mock.calls.length;

      const second = await resolver.resolveForAsset("asset-1", "ems__Task");

      // Second call should not trigger additional match() calls
      const callCountAfterSecond = matchSpy.mock.calls.length;
      expect(callCountAfterSecond).toBe(callCountAfterFirst);
      expect(second).toEqual(first);
    });

    it("should clear cache on invalidateCache()", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-1", label: "C1", groundingRef: "gnd-1" });
      await addBindingAsset(store, { uid: "bind-1", label: "B1", commandRef: "cmd-1", targetClass: "ems__Task" });

      // First call populates cache
      await resolver.resolveForAsset("asset-1", "ems__Task");

      // Clear cache
      resolver.invalidateCache();

      const matchSpy = jest.spyOn(store, "match");

      // Next call should re-query the store
      await resolver.resolveForAsset("asset-1", "ems__Task");

      expect(matchSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should handle invalid grounding type gracefully", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-invalid",
        label: "Invalid type",
        type: "unknown_type",
      });

      await addCommandAsset(store, {
        uid: "cmd-invalid",
        label: "Invalid",
        groundingRef: "gnd-invalid",
      });

      const cmd = await resolver.loadCommand("cmd-invalid");
      expect(cmd).toBeNull(); // Invalid grounding type → null command
    });

    it("should handle precondition with missing sparqlAsk", async () => {
      // Precondition without sparqlAsk
      const preSubject = new IRI("obsidian://vault/pre-no-ask.md");
      await store.addAll([
        new Triple(preSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
        new Triple(preSubject, Namespace.EXO.term("Asset_uid"), new Literal("pre-no-ask")),
        new Triple(preSubject, Namespace.EXO.term("Asset_label"), new Literal("No ASK")),
        // Missing sparqlAsk property
      ]);

      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-bad-pre", label: "Bad pre", preconditionRef: "pre-no-ask", groundingRef: "gnd-1" });

      const cmd = await resolver.loadCommand("cmd-bad-pre");

      // Command should still load, but without precondition
      expect(cmd).not.toBeNull();
      expect(cmd!.precondition).toBeUndefined();
    });

    it("should handle multiple bindings for same command", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-shared", label: "Shared", groundingRef: "gnd-1" });

      // Same command bound to both Task and Project
      await addBindingAsset(store, { uid: "bind-task", label: "BT", commandRef: "cmd-shared", targetClass: "ems__Task" });
      await addBindingAsset(store, { uid: "bind-proj", label: "BP", commandRef: "cmd-shared", targetClass: "ems__Project" });

      const taskCmds = await resolver.resolveForAsset("t-1", "ems__Task");
      const projCmds = await resolver.resolveForAsset("p-1", "ems__Project");

      expect(taskCmds).toHaveLength(1);
      expect(projCmds).toHaveLength(1);
      expect(taskCmds[0].command.id).toBe("cmd-shared");
      expect(projCmds[0].command.id).toBe("cmd-shared");
    });

    it("should use default order 100 when order not specified", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-a", label: "A", groundingRef: "gnd-1" });
      await addCommandAsset(store, { uid: "cmd-b", label: "B", groundingRef: "gnd-1" });

      await addBindingAsset(store, { uid: "bind-a", label: "BA", commandRef: "cmd-a", targetClass: "ems__Task" }); // no order → 100
      await addBindingAsset(store, { uid: "bind-b", label: "BB", commandRef: "cmd-b", targetClass: "ems__Task", order: 50 });

      const resolved = await resolver.resolveForAsset("asset-1", "ems__Task");

      expect(resolved[0].command.name).toBe("B"); // order 50
      expect(resolved[1].command.name).toBe("A"); // order 100 (default)
    });
  });

  describe("resolveLabel", () => {
    it("should return static name when no labelTemplate is set", async () => {
      await addGroundingAsset(store, { uid: "gnd-1", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, { uid: "cmd-static", label: "Static Label", groundingRef: "gnd-1" });

      const cmd = await resolver.loadCommand("cmd-static");
      expect(cmd).not.toBeNull();

      const label = await resolver.resolveLabel(cmd!, "urn:test:asset-1");
      expect(label).toBe("Static Label");
    });

    it("should return template as-is when template has no placeholders", async () => {
      await addGroundingAsset(store, { uid: "gnd-2", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, {
        uid: "cmd-no-placeholder",
        label: "Fallback",
        labelTemplate: "Plain text label",
        groundingRef: "gnd-2",
      });

      const cmd = await resolver.loadCommand("cmd-no-placeholder");
      expect(cmd).not.toBeNull();

      const label = await resolver.resolveLabel(cmd!, "urn:test:asset-1");
      expect(label).toBe("Plain text label");
    });

    it("should substitute SPARQL placeholder with query result", async () => {
      // Set up vote triples for the target asset
      const targetIRI = "obsidian://vault/task-42.md";
      const targetSubject = new IRI(targetIRI);

      await store.addAll([
        new Triple(targetSubject, Namespace.EXO.term("vote"), new Literal("user-a")),
        new Triple(targetSubject, Namespace.EXO.term("vote"), new Literal("user-b")),
        new Triple(targetSubject, Namespace.EXO.term("vote"), new Literal("user-c")),
      ]);

      await addGroundingAsset(store, { uid: "gnd-3", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, {
        uid: "cmd-vote",
        label: "Vote",
        labelTemplate: "Vote ({SELECT (COUNT(?v) AS ?n) WHERE { $target <https://exocortex.my/ontology/exo#vote> ?v }})",
        groundingRef: "gnd-3",
      });

      const cmd = await resolver.loadCommand("cmd-vote");
      expect(cmd).not.toBeNull();

      const label = await resolver.resolveLabel(cmd!, targetIRI);
      expect(label).toBe("Vote (3)");
    });

    it("should replace placeholder with empty string when query returns no results", async () => {
      await addGroundingAsset(store, { uid: "gnd-4", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, {
        uid: "cmd-empty",
        label: "Items",
        labelTemplate: "Items ({SELECT (COUNT(?x) AS ?n) WHERE { $target <https://exocortex.my/ontology/exo#item> ?x }})",
        groundingRef: "gnd-4",
      });

      const cmd = await resolver.loadCommand("cmd-empty");
      expect(cmd).not.toBeNull();

      // No item triples in store → COUNT returns 0
      const label = await resolver.resolveLabel(cmd!, "urn:test:no-items");
      expect(label).toBe("Items (0)");
    });

    it("should replace placeholder with empty string on invalid SPARQL", async () => {
      await addGroundingAsset(store, { uid: "gnd-5", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, {
        uid: "cmd-bad-sparql",
        label: "Bad",
        labelTemplate: "Status ({INVALID SPARQL HERE})",
        groundingRef: "gnd-5",
      });

      const cmd = await resolver.loadCommand("cmd-bad-sparql");
      expect(cmd).not.toBeNull();

      const label = await resolver.resolveLabel(cmd!, "urn:test:asset");
      expect(label).toBe("Status ()");
    });

    it("should load labelTemplate from triple store", async () => {
      await addGroundingAsset(store, { uid: "gnd-6", label: "G", type: "property_delete", targetProperty: "p" });
      await addCommandAsset(store, {
        uid: "cmd-with-tpl",
        label: "Fallback Name",
        labelTemplate: "Dynamic ({SELECT ?x WHERE { ?s ?p ?o }})",
        groundingRef: "gnd-6",
      });

      const cmd = await resolver.loadCommand("cmd-with-tpl");
      expect(cmd).not.toBeNull();
      expect(cmd!.labelTemplate).toBe("Dynamic ({SELECT ?x WHERE { ?s ?p ?o }})");
    });
  });

  describe("findPaletteEnabledCommands (RFC 1429fcd0 PR-2)", () => {
    async function setEnabled(
      uid: string,
      enabled: "true" | "false" | string,
    ): Promise<void> {
      await store.add(
        new Triple(
          new IRI(`obsidian://vault/${uid}.md`),
          Namespace.EXOCMD.term("Command_paletteEnabled"),
          new Literal(enabled),
        ),
      );
    }
    async function setLiteral(
      uid: string,
      predicate: IRI,
      value: string,
    ): Promise<void> {
      await store.add(
        new Triple(
          new IRI(`obsidian://vault/${uid}.md`),
          predicate,
          new Literal(value),
        ),
      );
    }

    it("returns only commands marked paletteEnabled=true", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-p1",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addGroundingAsset(store, {
        uid: "gnd-p2",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addGroundingAsset(store, {
        uid: "gnd-p3",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-enabled",
        label: "Enabled cmd",
        groundingRef: "gnd-p1",
      });
      await addCommandAsset(store, {
        uid: "cmd-disabled",
        label: "Disabled cmd",
        groundingRef: "gnd-p2",
      });
      await addCommandAsset(store, {
        uid: "cmd-absent",
        label: "No flag cmd",
        groundingRef: "gnd-p3",
      });
      await setEnabled("cmd-enabled", "true");
      await setEnabled("cmd-disabled", "false");
      // cmd-absent has no Command_paletteEnabled triple at all

      const found = await resolver.findPaletteEnabledCommands();
      expect(found).toHaveLength(1);
      expect(found[0].command.id).toBe("cmd-enabled");
    });

    it("derives paletteId from Command_paletteId when present", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-id1",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-id1",
        label: "Foo",
        groundingRef: "gnd-id1",
      });
      await setEnabled("cmd-id1", "true");
      await setLiteral(
        "cmd-id1",
        Namespace.EXOCMD.term("Command_paletteId"),
        "stable-id",
      );

      const found = await resolver.findPaletteEnabledCommands();
      expect(found[0].paletteId).toBe("stable-id");
    });

    it("falls back to Command_cliName when paletteId absent", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-id2",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-id2",
        label: "Foo",
        groundingRef: "gnd-id2",
      });
      await setEnabled("cmd-id2", "true");
      await setLiteral(
        "cmd-id2",
        Namespace.EXOCMD.term("Command_cliName"),
        "create-note",
      );

      const found = await resolver.findPaletteEnabledCommands();
      expect(found[0].paletteId).toBe("create-note");
    });

    it("falls back to Asset_uid when neither paletteId nor cliName present", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-id3",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-id3",
        label: "Foo",
        groundingRef: "gnd-id3",
      });
      await setEnabled("cmd-id3", "true");

      const found = await resolver.findPaletteEnabledCommands();
      expect(found[0].paletteId).toBe("cmd-id3");
    });

    it("drops duplicate paletteIds — first wins, logs warning", async () => {
      const warn = jest.fn();
      const debug = jest.fn();
      const info = jest.fn();
      const error = jest.fn();
      resolver = new CommandResolver(store, { warn, debug, info, error });

      await addGroundingAsset(store, {
        uid: "gnd-dup1",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addGroundingAsset(store, {
        uid: "gnd-dup2",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-dup-a",
        label: "A",
        groundingRef: "gnd-dup1",
      });
      await addCommandAsset(store, {
        uid: "cmd-dup-b",
        label: "B",
        groundingRef: "gnd-dup2",
      });
      await setEnabled("cmd-dup-a", "true");
      await setEnabled("cmd-dup-b", "true");
      await setLiteral(
        "cmd-dup-a",
        Namespace.EXOCMD.term("Command_paletteId"),
        "collide",
      );
      await setLiteral(
        "cmd-dup-b",
        Namespace.EXOCMD.term("Command_paletteId"),
        "collide",
      );

      const found = await resolver.findPaletteEnabledCommands();
      expect(found).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("duplicate paletteId"),
      );
    });

    it("treats string 'True' case-insensitively (resilient to YAML quoting)", async () => {
      await addGroundingAsset(store, {
        uid: "gnd-case",
        label: "G",
        type: "property_set",
        targetProperty: "x",
        targetValue: "y",
      });
      await addCommandAsset(store, {
        uid: "cmd-case",
        label: "Foo",
        groundingRef: "gnd-case",
      });
      await setEnabled("cmd-case", "True");

      const found = await resolver.findPaletteEnabledCommands();
      expect(found).toHaveLength(1);
    });

    it("skips commands without grounding (loadCommand returns null)", async () => {
      // Command type triple exists but no grounding link → loadCommand returns null.
      const subject = new IRI("obsidian://vault/cmd-no-grounding.md");
      await store.addAll([
        new Triple(
          subject,
          Namespace.RDF.term("type"),
          Namespace.EXOCMD.term("Command"),
        ),
        new Triple(
          subject,
          Namespace.EXO.term("Asset_uid"),
          new Literal("cmd-no-grounding"),
        ),
        new Triple(
          subject,
          Namespace.EXO.term("Asset_label"),
          new Literal("No grounding"),
        ),
        new Triple(
          subject,
          Namespace.EXOCMD.term("Command_paletteEnabled"),
          new Literal("true"),
        ),
      ]);

      const found = await resolver.findPaletteEnabledCommands();
      expect(found).toHaveLength(0);
    });
  });
});

// -- RFC 31c1a0be Phase 3 — wikilink-form targetProperty resolution --
//
// The corruption fix (HIGH-4 from self-review): when a grounding has
// `targetProperty: "[[<UID>]]"` referencing a property asset, CommandResolver
// must resolve the UUID to the property's exo__Asset_label
// (e.g. "ems__Effort_status"). Otherwise GroundingExecutor would write a
// UUID-named frontmatter key — data corruption.
//
// New typed predicate dispatch (targetValueRef / Literal / Substitution) is
// also exercised here at the resolver level — executor-level tests live in
// GroundingExecutor.test.ts.
describe("CommandResolver — RFC 31c1a0be Phase 3", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
  });

  async function addPropertyAsset(uid: string, label: string): Promise<void> {
    const subject = new IRI(`obsidian://vault/${uid}.md`);
    await store.addAll([
      new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
      new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
    ]);
  }

  async function addSubstitutionToken(uid: string, label: string): Promise<void> {
    const subject = new IRI(`obsidian://vault/${uid}.md`);
    await store.addAll([
      new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
      new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
    ]);
  }

  it("resolves wikilink-form targetProperty UUID to exo__Asset_label (corruption fix)", async () => {
    const propUID = "44c6e9e3-955f-4afc-9ca5-b4bd70667051";
    await addPropertyAsset(propUID, "ems__Effort_status");

    await addGroundingAsset(store, {
      uid: "gnd-1",
      label: "Set status to Done",
      type: "property_set",
      targetProperty: `[[${propUID}]]`,
      targetValue: '"[[ems__EffortStatusDone]]"',
    });
    await addBindingAsset(store, {
      uid: "bind-1",
      label: "Set status to Done → Task binding",
      commandRef: "cmd-1",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-1",
      label: "Mark Done",
      groundingRef: "gnd-1",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].command.grounding.targetProperty).toBe("ems__Effort_status");
    // Bare UUID never reaches the executor — corruption signature absent.
    expect(resolved[0].command.grounding.targetProperty).not.toBe(propUID);
  });

  it("passes symbolic-string targetProperty through unchanged", async () => {
    await addGroundingAsset(store, {
      uid: "gnd-1",
      label: "Set status to Doing",
      type: "property_set",
      targetProperty: "ems__Effort_status",
      targetValue: '"[[ems__EffortStatusDoing]]"',
    });
    await addBindingAsset(store, {
      uid: "bind-1",
      label: "Start Effort → Task binding",
      commandRef: "cmd-1",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-1",
      label: "Start Effort",
      groundingRef: "gnd-1",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );
    expect(resolved[0].command.grounding.targetProperty).toBe("ems__Effort_status");
  });

  it("reads targetValueRef typed predicate as raw UID string", async () => {
    const gndSubject = new IRI("obsidian://vault/gnd-typed.md");
    await store.addAll([
      new Triple(gndSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-typed")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_label"), new Literal("Set status Ref-form")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_set")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_status")),
      new Triple(
        gndSubject,
        Namespace.EXOCMD.term("Grounding_targetValueRef"),
        new Literal("[[7b9b3116-7c3c-438c-9618-94fe301320a6]]"),
      ),
    ]);
    await addBindingAsset(store, {
      uid: "bind-typed",
      label: "Mark Done → Task (typed)",
      commandRef: "cmd-typed",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-typed",
      label: "Mark Done (typed)",
      groundingRef: "gnd-typed",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].command.grounding.targetValueRef).toBe(
      "7b9b3116-7c3c-438c-9618-94fe301320a6",
    );
  });

  it("returns null grounding when targetProperty UID resolves to nothing (fail-loud)", async () => {
    // No property asset registered for this UID — resolveLabelByUID returns null.
    const missingPropUID = "00000000-0000-0000-0000-000000000bad";
    await addGroundingAsset(store, {
      uid: "gnd-bad-prop",
      label: "Bad targetProperty grounding",
      type: "property_set",
      targetProperty: `[[${missingPropUID}]]`,
      targetValue: '"[[some-uid]]"',
    });
    await addBindingAsset(store, {
      uid: "bind-bad-prop",
      label: "Bad → Task binding",
      commandRef: "cmd-bad-prop",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-bad-prop",
      label: "Bad Mark Done",
      groundingRef: "gnd-bad-prop",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );
    // Grounding is inert because we cannot safely resolve targetProperty.
    // CommandResolver skips the entire command (binding has no grounding to attach to).
    expect(resolved).toHaveLength(0);
  });

  it("returns null grounding when targetValueSubstitution UID resolves to nothing (fail-loud)", async () => {
    const missingTokenUID = "00000000-0000-0000-0000-000000000fed";
    const gndSubject = new IRI("obsidian://vault/gnd-bad-subst.md");
    await store.addAll([
      new Triple(gndSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-bad-subst")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_label"), new Literal("Bad subst grounding")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_set")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_reviewTimestamp")),
      new Triple(
        gndSubject,
        Namespace.EXOCMD.term("Grounding_targetValueSubstitution"),
        new Literal(`[[${missingTokenUID}]]`),
      ),
    ]);
    await addBindingAsset(store, {
      uid: "bind-bad-subst",
      label: "Bad subst → Task binding",
      commandRef: "cmd-bad-subst",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-bad-subst",
      label: "Bad Mark Reviewed",
      groundingRef: "gnd-bad-subst",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );
    expect(resolved).toHaveLength(0);
  });

  it("resolves targetValueSubstitution wikilink to SubstitutionToken label", async () => {
    const tokenUID = "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8";
    await addSubstitutionToken(tokenUID, "$nowLocal");

    const gndSubject = new IRI("obsidian://vault/gnd-subst.md");
    await store.addAll([
      new Triple(gndSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_uid"), new Literal("gnd-subst")),
      new Triple(gndSubject, Namespace.EXO.term("Asset_label"), new Literal("Set ts to now (subst)")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_set")),
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_reviewTimestamp")),
      new Triple(
        gndSubject,
        Namespace.EXOCMD.term("Grounding_targetValueSubstitution"),
        new Literal(`[[${tokenUID}]]`),
      ),
    ]);
    await addBindingAsset(store, {
      uid: "bind-subst",
      label: "Mark Reviewed → Task binding",
      commandRef: "cmd-subst",
      targetClass: "ems__Task",
    });
    await addCommandAsset(store, {
      uid: "cmd-subst",
      label: "Mark Reviewed",
      groundingRef: "gnd-subst",
    });

    const resolved = await resolver.resolveForAsset(
      "obsidian://vault/test.md",
      "ems__Task",
    );

    expect(resolved).toHaveLength(1);
    // CommandResolver injects the token's exo__Asset_label so the executor's
    // existing substituteVariables regex paths handle it transparently.
    expect(resolved[0].command.grounding.targetValueSubstitution).toBe("$nowLocal");
  });
});
