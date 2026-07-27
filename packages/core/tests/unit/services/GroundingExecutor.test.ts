import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

// -- Mocks --

function createMockReader(content?: string) {
  const defaultContent = content || "---\nfoo: bar\n---\nBody";
  return {
    readFile: jest.fn().mockResolvedValue(defaultContent),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-test",
    label: "Test Grounding",
    ...overrides,
  } as unknown as GroundingDefinition;
}

// -- Tests --

describe("GroundingExecutor", () => {
  const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
  const FILE_PATH = "/vault/test-asset.md";

  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let registry: ServiceRegistry;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = createMockReader();
    writer = createMockWriter();
    registry = new ServiceRegistry();
    executor = new GroundingExecutor(reader, writer, registry);
  });

  // -- property_set --

  describe("property_set", () => {
    it("should update frontmatter property to new value", async () => {
      reader.readFile.mockResolvedValue("---\nems__status: Backlog\n---\nBody");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__status",
        targetValueLiteral: "Done",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      expect(writer.updateFile).toHaveBeenCalledTimes(1);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).toContain("ems__status: Done");
    });

    it("should substitute $now with ISO timestamp", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_startTimestamp",
        targetValueSubstitution: "$now",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).toMatch(
        /ems__Effort_startTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should substitute $today with YYYY-MM-DD", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "due_date",
        targetValueSubstitution: "$today",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).toMatch(/due_date: \d{4}-\d{2}-\d{2}$/m);
    });

    it("should substitute $target with IRI", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "linked_from",
        targetValueSubstitution: "$target",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).toContain("linked_from: " + TARGET_IRI);
    });

    it("should fail when targetProperty is missing", async () => {
      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetValueLiteral: "value",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetProperty");
    });

    it("should fail when no typed predicate is provided", async () => {
      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "prop",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "targetValueRef/targetValueLiteral/targetValueSubstitution",
      );
    });

    // RFC 31c1a0be Phase 3 — typed predicate dispatch
    describe("RFC 31c1a0be typed predicates", () => {
      it("targetValueRef emits wikilink-form value", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");
        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_status",
          targetValueRef: "7b9b3116-7c3c-438c-9618-94fe301320a6",
        });
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);
        expect(result.success).toBe(true);
        const written = writer.updateFile.mock.calls[0][1];
        expect(written).toContain(
          'ems__Effort_status: "[[7b9b3116-7c3c-438c-9618-94fe301320a6]]"',
        );
      });

      it("targetValueLiteral emits literal value as-is", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");
        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_notes",
          targetValueLiteral: "some plain literal",
        });
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);
        expect(result.success).toBe(true);
        const written = writer.updateFile.mock.calls[0][1];
        expect(written).toContain("ems__Effort_notes: some plain literal");
      });

      it("targetValueSubstitution resolves token label like legacy targetValue", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");
        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_reviewTimestamp",
          // Already-resolved SubstitutionToken.label injected by CommandResolver
          targetValueSubstitution: "$nowLocal",
        });
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);
        expect(result.success).toBe(true);
        const written = writer.updateFile.mock.calls[0][1];
        expect(written).toMatch(
          /ems__Effort_reviewTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        );
      });

      it("rejects more than one typed predicate (cardinality 0..1 each)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__foo",
          targetValueRef: "uid-a",
          targetValueLiteral: "literal-b",
        });
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);
        expect(result.success).toBe(false);
        expect(result.error).toContain("more than one");
      });

      // RFC 31c1a0be Phase 5a + RFC 918a2b65 Phase 4: legacy `targetValue`
      // field has been removed from `GroundingDefinition` entirely. The
      // executor rejects property_set without any typed predicate (verified
      // by the "should fail when no typed predicate is provided" test above);
      // the previous "rejects ONLY legacy targetValue" assertion is no longer
      // expressible because the field doesn't exist on the type.
    });
  });

  // -- property_delete --

  describe("property_delete", () => {
    it("should remove frontmatter property", async () => {
      reader.readFile.mockResolvedValue(
        "---\nfoo: bar\nems__Effort_startTimestamp: 2026-01-01\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "ems__Effort_startTimestamp",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).not.toContain("ems__Effort_startTimestamp");
      expect(writtenContent).toContain("foo: bar");
    });

    it("should succeed when property does not exist (no-op)", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\nBody");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "nonexistent_property",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
    });

    it("should fail when targetProperty is missing", async () => {
      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_DELETE,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetProperty");
    });
  });

  // -- composite --

  describe("composite", () => {
    it("should execute all steps in sequence", async () => {
      reader.readFile.mockResolvedValue("---\nstatus: Backlog\n---\nBody");

      const grounding = makeGrounding({
        type: GroundingType.COMPOSITE,
        steps: [
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            targetProperty: "status",
            targetValueLiteral: "Doing",
          }),
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            targetProperty: "ems__Effort_startTimestamp",
            targetValueSubstitution: "$now",
          }),
        ],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      // readFile called: once for original snapshot + once per property_set step
      expect(reader.readFile).toHaveBeenCalledTimes(3);
      expect(writer.updateFile).toHaveBeenCalledTimes(2);
    });

    it("should rollback on step failure", async () => {
      const originalContent = "---\nstatus: Backlog\n---\nBody";
      reader.readFile.mockResolvedValue(originalContent);

      const grounding = makeGrounding({
        type: GroundingType.COMPOSITE,
        steps: [
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            targetProperty: "status",
            targetValueLiteral: "Doing",
          }),
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            // Missing targetProperty → will fail
            targetValueLiteral: "broken",
          }),
        ],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Composite step 1 failed");
      // Rollback writes original content back
      const lastUpdateCall = writer.updateFile.mock.calls[writer.updateFile.mock.calls.length - 1];
      expect(lastUpdateCall[1]).toBe(originalContent);
    });

    it("should succeed with empty steps array", async () => {
      const grounding = makeGrounding({
        type: GroundingType.COMPOSITE,
        steps: [],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
    });

    it("should succeed with undefined steps", async () => {
      const grounding = makeGrounding({
        type: GroundingType.COMPOSITE,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
    });

    it("should prevent infinite recursion with depth limit", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

      // Create deeply nested composite (depth > MAX_COMPOSITE_DEPTH)
      let innermost = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "foo",
        targetValueLiteral: "bar",
      });

      for (let i = 0; i < 25; i++) {
        innermost = makeGrounding({
          type: GroundingType.COMPOSITE,
          steps: [innermost],
        });
      }

      const result = await executor.execute(innermost, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("maximum depth");
    });
  });

  // -- service_call --

  describe("service_call", () => {
    it("should call registered service with correct args", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("TaskStatusService", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "TaskStatusService",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, undefined);
    });

    it("should pass userInput to service", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("AreaCreationService", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "AreaCreationService",
      });

      const userInput = { label: "New Area", size: "medium" };
      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        userInput,
      );

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, userInput);
    });

    it("should fail for unknown serviceId", async () => {
      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "NonExistentService",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Service not found");
      expect(result.error).toContain("NonExistentService");
    });

    it("should fail when serviceId (targetProperty) is missing", async () => {
      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetProperty");
    });

    it("should capture service execution errors", async () => {
      const mockService = {
        execute: jest.fn().mockRejectedValue(new Error("Service crashed")),
      };
      registry.register("CrashingService", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "CrashingService",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Service crashed");
    });

    it("should merge JSON targetValue as defaults into userInput", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("updateProperty", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "updateProperty",
        serviceCallPayload: '{"property":"ems__Effort_parent"}',
      });

      const userInput = { value: "[[some-asset]]" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        property: "ems__Effort_parent",
        value: "[[some-asset]]",
      });
    });

    it("should let userInput override targetValue defaults", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("testService", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "testService",
        serviceCallPayload: '{"direction":"forward","extra":"default"}',
      });

      const userInput = { direction: "backward" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        direction: "backward",
        extra: "default",
      });
    });

    it("should inject standalone Grounding_isDefinedBy as userInput default", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("createAsset", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "createAsset",
        serviceCallPayload: '{"prototype":"ztlk__FleetingNotePrototype"}',
        isDefinedBy: "[[0aa339bc-9b56-400a-8148-cbde57bbf0b6]]",
      });

      const userInput = { label: "Test note" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        prototype: "ztlk__FleetingNotePrototype",
        isDefinedBy: "[[0aa339bc-9b56-400a-8148-cbde57bbf0b6]]",
        label: "Test note",
      });
    });

    it("should let userInput.isDefinedBy override grounding.isDefinedBy default", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("createAsset", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "createAsset",
        isDefinedBy: "[[default-owner]]",
      });

      const userInput = { label: "x", isDefinedBy: "[[runtime-pick]]" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        label: "x",
        isDefinedBy: "[[runtime-pick]]",
      });
    });

    it("should ignore non-JSON targetValue for service_call", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("myService", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "myService",
        serviceCallPayload: "plain-string-not-json",
      });

      const userInput = { key: "val" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, userInput);
    });

    // Issue #2999 / RFC 5a61a359 Phase C.0 (AC1): create-instance-from-prototype.
    // Grounding `service_call → createAsset` with targetValue carrying `$target`
    // must resolve to the current target IRI before JSON.parse, so the underlying
    // service receives `{prototype: <targetIRI>}` as a default and writes
    // `exo__Asset_prototype: "[[<source-IRI>]]"` on the new instance.
    it("should interpolate $target in JSON targetValue and merge as default (#2999)", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("createAsset", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "createAsset",
        serviceCallPayload: '{"prototype":"$target"}',
      });

      const userInput = { label: "New Instance" };
      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        userInput,
      );

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        prototype: TARGET_IRI,
        label: "New Instance",
      });
    });

    it("should let userInput override $target-interpolated default (#2999)", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("createAsset", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "createAsset",
        serviceCallPayload: '{"prototype":"$target","folder":"03 Knowledge/inbox"}',
      });

      const userInput = { prototype: "explicit-prototype-uid", label: "Lunch 2026-05-02" };
      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        userInput,
      );

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        prototype: "explicit-prototype-uid",
        folder: "03 Knowledge/inbox",
        label: "Lunch 2026-05-02",
      });
    });

    it("should interpolate $today in JSON targetValue defaults (#2999)", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("scheduleTask", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "scheduleTask",
        serviceCallPayload: '{"plannedStartDate":"$today"}',
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      // req 26d79c70 / #3809 — `$today` is the LOCAL calendar day (matches the
      // executor's DateFormatter.toDateString basis), not the UTC slice.
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        plannedStartDate: today,
      });
    });

    it("should use targetValue as sole input when no userInput", async () => {
      const mockService = {
        execute: jest.fn().mockResolvedValue(undefined),
      };
      registry.register("shiftDay", mockService);

      const grounding = makeGrounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "shiftDay",
        serviceCallPayload: '{"direction":"forward"}',
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        direction: "forward",
      });
    });
  });

  // -- sparql_update --

  describe("sparql_update", () => {
    it("should return error (not implemented)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.SPARQL_UPDATE,
        sparqlUpdate: "DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not yet implemented");
    });
  });

  // -- ExecutionResult --

  describe("ExecutionResult", () => {
    it("should return success=true on successful execution", async () => {
      reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "foo",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return success=false + error on failure", async () => {
      reader.readFile.mockRejectedValue(new Error("File not found"));

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "foo",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });
  });

  // -- ServiceRegistry --

  describe("ServiceRegistry", () => {
    it("should register and retrieve a service", () => {
      const mockService = { execute: jest.fn() };

      registry.register("TestService", mockService);

      expect(registry.has("TestService")).toBe(true);
      expect(registry.get("TestService")).toBe(mockService);
    });

    it("should return undefined for unregistered service", () => {
      expect(registry.has("Unknown")).toBe(false);
      expect(registry.get("Unknown")).toBeUndefined();
    });

    it("should list registered service IDs", () => {
      const s1 = { execute: jest.fn() };
      const s2 = { execute: jest.fn() };

      registry.register("ServiceA", s1);
      registry.register("ServiceB", s2);

      const ids = registry.getRegisteredIds();
      expect(ids).toContain("ServiceA");
      expect(ids).toContain("ServiceB");
      expect(ids).toHaveLength(2);
    });
  });

  // -- Variable Substitution --

  describe("substituteVariables", () => {
    it("should replace $target with IRI (no angle brackets)", () => {
      const result = executor.substituteVariables(
        "linked to $target",
        TARGET_IRI,
      );
      expect(result).toBe("linked to " + TARGET_IRI);
    });

    it("should replace $now with ISO timestamp", () => {
      const result = executor.substituteVariables("started at $now", TARGET_IRI);
      expect(result).toMatch(/started at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should replace $nowLocal with local timestamp (no ms, no tz suffix)", () => {
      const result = executor.substituteVariables(
        "started at $nowLocal",
        TARGET_IRI,
      );
      expect(result).toMatch(/^started at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(result).not.toContain(".");
      expect(result).not.toContain("Z");
    });

    it("should replace $nowLocal before $now to avoid prefix collision", () => {
      const result = executor.substituteVariables(
        "$nowLocal then $now",
        TARGET_IRI,
      );
      expect(result).not.toContain("$now");
      expect(result).not.toContain("$nowLocal");
      expect(result).not.toContain("Local");
      expect(result).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} then \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("should replace $today with YYYY-MM-DD", () => {
      const result = executor.substituteVariables(
        "due $today",
        TARGET_IRI,
      );
      expect(result).toMatch(/due \d{4}-\d{2}-\d{2}$/);
    });

    it("should handle multiple variables in one string", () => {
      const result = executor.substituteVariables(
        "$target modified on $today at $now",
        TARGET_IRI,
      );
      expect(result).toContain(TARGET_IRI);
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(result).not.toContain("$target");
      expect(result).not.toContain("$today");
      expect(result).not.toContain("$now");
    });

    it("should return unchanged string when no variables present", () => {
      const result = executor.substituteVariables(
        "plain value",
        TARGET_IRI,
      );
      expect(result).toBe("plain value");
    });

    // Issue #3136 — Q3.b closure
    it("should replace $todayStart with YYYY-MM-DDT00:00:00 (local midnight)", () => {
      const result = executor.substituteVariables(
        "planned $todayStart",
        TARGET_IRI,
      );
      expect(result).toMatch(/^planned \d{4}-\d{2}-\d{2}T00:00:00$/);
    });

    it("should replace $todayStart before $today to avoid prefix collision", () => {
      const result = executor.substituteVariables(
        "$todayStart vs $today",
        TARGET_IRI,
      );
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00 vs \d{4}-\d{2}-\d{2}$/);
      expect(result).not.toContain("Start");
      expect(result).not.toContain("$today");
    });

    // RFC ce27e55d $nowCompact substitution token tests
    it("should replace $nowCompact with YYYY-MM-DD-HH-mm (filename-safe minute precision)", () => {
      const result = executor.substituteVariables(
        "supervision $nowCompact",
        TARGET_IRI,
      );
      expect(result).toMatch(/^supervision \d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });

    it("should replace $nowCompact before $nowLocal/$now to avoid prefix collision", () => {
      const result = executor.substituteVariables(
        "$nowCompact then $nowLocal then $now",
        TARGET_IRI,
      );
      // $nowCompact = YYYY-MM-DD-HH-mm; $nowLocal = YYYY-MM-DDTHH:mm:ss;
      // $now = ISO-UTC with milliseconds Z. Three distinct shapes prove
      // each replacement consumed its own token without prefix collision.
      expect(result).toMatch(
        /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2} then \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} then \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
      );
      expect(result).not.toContain("Compact");
      expect(result).not.toContain("Local");
      expect(result).not.toContain("$now");
    });


    it("should replace $targetFolder with parent dir of targetFilePath", () => {
      const result = executor.substituteVariables(
        "place under $targetFolder",
        TARGET_IRI,
        undefined,
        undefined,
        "03 Knowledge/areas/2026-05-17.md",
      );
      expect(result).toBe("place under 03 Knowledge/areas");
    });

    it("should resolve $targetFolder to empty string at vault root", () => {
      const result = executor.substituteVariables(
        "under [$targetFolder]",
        TARGET_IRI,
        undefined,
        undefined,
        "root-file.md",
      );
      expect(result).toBe("under []");
    });

    it("should fail-fast when $targetFolder is used without targetFilePath", () => {
      expect(() =>
        executor.substituteVariables(
          "place under $targetFolder",
          TARGET_IRI,
        ),
      ).toThrow(/\$targetFolder substitution requires targetFilePath/);
    });

    it("should not let $target consume $targetFolder prefix", () => {
      const result = executor.substituteVariables(
        "iri=$target folder=$targetFolder",
        TARGET_IRI,
        undefined,
        undefined,
        "x/y/z.md",
      );
      expect(result).toBe(`iri=${TARGET_IRI} folder=x/y`);
    });
  });

  // -- create_instance (RFC-016 #2643, #2645) --

  describe("create_instance", () => {
    it("should create file with correct frontmatter", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "gtd__InboxItem",
        targetPrototype: "proto-uuid-123",
        targetFolder: "01 Inbox",
      });
      const userInput = { label: "Buy milk" };

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(writer.createFile).toHaveBeenCalledTimes(1);

      const [path, content] = writer.createFile.mock.calls[0];
      expect(path).toMatch(/^01 Inbox\/[a-f0-9-]+\.md$/);
      expect(content).toContain("exo__Asset_uid:");
      expect(content).toContain("exo__Asset_label: Buy milk");
      expect(content).toContain("gtd__InboxItem");
      // Issue #3184 B1: exo__Asset_prototype links to the $target file
      // (the prototype-instance the user clicked on), not the class UID
      // declared in `grounding.targetPrototype`. The class UID is only
      // used for binding resolution, never materialised into frontmatter.
      expect(content).toContain('exo__Asset_prototype: "[[vault/test-asset]]"');
      expect(content).not.toContain("proto-uuid-123");
    });

    it("should generate valid UUID in filename", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "tasks",
      });

      await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Test" });

      const [path] = writer.createFile.mock.calls[0];
      const filename = path.split("/").pop()?.replace(".md", "");
      expect(filename).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });

    it("should fail when targetFolder is missing", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Test" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetFolder");
    });

    it("should work without grounding.targetPrototype (prototype back-link still applied)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "No proto" });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("exo__Asset_label: No proto");
      // Issue #3184 B2: with a non-empty targetIRI, exo__Asset_prototype is
      // always written by the default back-link — even if grounding.targetPrototype
      // (the class UID) is absent. The link references $target (the parent
      // file the user clicked on), not the class UID.
      expect(content).toContain('exo__Asset_prototype: "[[vault/test-asset]]"');
    });

    // -- T1 "Create Instance" homoiconic button (project bbe40f8c) --
    //
    // The host page IS the class definition. The new instance must:
    //   - get `exo__Instance_class` = the host's own UID (via the
    //     `targetClassSelf` SubstitutionToken resolver, NOT grounding.targetClass);
    //   - get `exo__Asset_isDefinedBy` = the ontology the user picked in the form;
    //   - land co-located in that ontology's folder (via `$isDefinedByFolder`).
    describe("T1 homoiconic Create Instance (host IS the class)", () => {
      const HOST_CLASS_PATH =
        "assetspaces/kitelev/exoas-ems/ems/8619c4fc-64f1-4869-b17e-e34186cacca9.md";
      const HOST_CLASS_IRI =
        "obsidian://vault/8619c4fc-64f1-4869-b17e-e34186cacca9.md";
      // Marker emitted by CommandResolver for a context-dependent
      // SubstitutionToken (token-uid is a real UUID per SUBSTITUTION_MARKER_RE).
      const TARGET_CLASS_SELF_MARKER =
        "__SUBSTITUTE__targetClassSelf__11111111-1111-1111-1111-111111111111__";
      const ONTOLOGY_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
      const ONTOLOGY_FOLDER = "assetspaces/kitelev/exoas-ems/ems";

      beforeEach(() => {
        clearResolvers();
        installDefaultResolvers();
      });

      function makeCreateInstanceGrounding(): GroundingDefinition {
        return makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          // NOTE: no targetClass — host is the class (resolved via PD below).
          targetFolder: "$isDefinedByFolder",
          propertyDefault: [
            {
              propertyName: "exo__Instance_class",
              value: TARGET_CLASS_SELF_MARKER,
            },
          ],
        });
      }

      it("instance_class = host UID, isDefinedBy = picked ontology, co-located in ontology folder", async () => {
        const refToFolder = jest.fn(async (ref: string) =>
          ref === ONTOLOGY_UID ? ONTOLOGY_FOLDER : null,
        );
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
        });

        const userInput = {
          label: "My Instance",
          exo__Asset_isDefinedBy: `"[[${ONTOLOGY_UID}]]"`,
        };

        const result = await executor.execute(
          makeCreateInstanceGrounding(),
          HOST_CLASS_IRI,
          HOST_CLASS_PATH,
          userInput,
        );

        expect(result.success).toBe(true);
        const [path, content] = writer.createFile.mock.calls[0];
        // Co-located in the chosen ontology's folder (NOT the host folder,
        // which happens to differ only by being the same here — assert the
        // resolver was consulted with the bare ontology UID).
        expect(refToFolder).toHaveBeenCalledWith(ONTOLOGY_UID);
        expect(path).toMatch(
          new RegExp(`^${ONTOLOGY_FOLDER}/[a-f0-9-]{36}\\.md$`),
        );
        // instance_class points back at the HOST class file's own UID.
        expect(content).toContain(
          '"[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"',
        );
        expect(content).toContain(`exo__Asset_isDefinedBy: "[[${ONTOLOGY_UID}]]"`);
        expect(content).toContain("exo__Asset_label: My Instance");
        expect(content).toContain("exo__Asset_uid:");
        // openPath surfaced for open-after-create.
        expect(result.openPath).toBe(path);
      });

      it("co-locates the new instance in a DIFFERENT ontology folder than the host", async () => {
        const OTHER_FOLDER = "assetspaces/kitelev/exoas-exo/exo";
        const OTHER_ONTOLOGY = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";
        const refToFolder = jest.fn(async (ref: string) =>
          ref === OTHER_ONTOLOGY ? OTHER_FOLDER : null,
        );
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
        });

        const result = await executor.execute(
          makeCreateInstanceGrounding(),
          HOST_CLASS_IRI,
          HOST_CLASS_PATH,
          { label: "X", exo__Asset_isDefinedBy: `"[[${OTHER_ONTOLOGY}]]"` },
        );

        expect(result.success).toBe(true);
        const [path] = writer.createFile.mock.calls[0];
        // Lands in the picked ontology's folder, NOT the host's ems folder.
        expect(path.startsWith(`${OTHER_FOLDER}/`)).toBe(true);
        expect(path.startsWith("assetspaces/kitelev/exoas-ems/")).toBe(false);
      });

      it("falls back to host folder when no refToFolder resolver is wired", async () => {
        // No refToFolder injected (CLI/test harness).
        const result = await executor.execute(
          makeCreateInstanceGrounding(),
          HOST_CLASS_IRI,
          HOST_CLASS_PATH,
          { label: "Y", exo__Asset_isDefinedBy: `"[[${ONTOLOGY_UID}]]"` },
        );

        expect(result.success).toBe(true);
        const [path] = writer.createFile.mock.calls[0];
        // Host folder (parent of HOST_CLASS_PATH).
        expect(path.startsWith("assetspaces/kitelev/exoas-ems/ems/")).toBe(true);
      });

      it("falls back to host folder when refToFolder returns null (ontology not found)", async () => {
        const refToFolder = jest.fn(async () => null);
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
        });

        const result = await executor.execute(
          makeCreateInstanceGrounding(),
          HOST_CLASS_IRI,
          HOST_CLASS_PATH,
          { label: "Z", exo__Asset_isDefinedBy: `"[[${ONTOLOGY_UID}]]"` },
        );

        expect(result.success).toBe(true);
        const [path] = writer.createFile.mock.calls[0];
        expect(path.startsWith("assetspaces/kitelev/exoas-ems/ems/")).toBe(true);
      });
    });

    // -- req c03f9e3e "per-ontology efforts routing" (TWO-HOP) --
    //
    // When an Effort (task/project) is created from an AREA via a homoiconic
    // Create button, its `exo__Asset_isDefinedBy` is auto-derived TWO-HOP:
    //   area A → A's own `exo__Asset_isDefinedBy` (the area-ontology O)
    //          → O's `exo__Ontology_effortsOntology` (the target efforts-ontology E)
    // and the new Effort co-locates in E's folder (co-location invariant). This
    // drives the REAL executeCreateInstance + the new `targetRefProperty` resolver
    // + the injected `refToFrontmatter` second-hop (async pre-resolution).
    describe("req c03f9e3e per-ontology efforts routing (two-hop)", () => {
      const AREA_PATH =
        "assetspaces/kitelev/exoas-my/my-areas/aaaaaaaa-1111-2222-3333-444444444444.md";
      const AREA_IRI =
        "obsidian://vault/aaaaaaaa-1111-2222-3333-444444444444.md";
      const AREA_FOLDER = "assetspaces/kitelev/exoas-my/my-areas";
      const AREA_ONTOLOGY = "bbbbbbbb-1111-2222-3333-444444444444"; // O
      const EFFORTS_ONTOLOGY = "cccccccc-1111-2222-3333-444444444444"; // E
      const EFFORTS_FOLDER = "assetspaces/kitelev/exoas-my/my-efforts";
      const EFFORT_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task

      // Two-hop resolver marker. Parameter is `<refKey>|<propKey>` — the executor
      // reads targetFm[refKey] (area's isDefinedBy → O), resolves O's frontmatter,
      // and this resolver reads propKey (O's effortsOntology → E). Encoded exactly
      // as CommandResolver.buildParameterisedMarker would (url-safe base64, no pad).
      const REF_PROP_PARAM =
        "exo__Asset_isDefinedBy|exo__Ontology_effortsOntology";
      const REF_PROP_MARKER = `__SUBSTITUTE_P__targetRefProperty__22222222-2222-2222-2222-222222222222__${Buffer.from(
        REF_PROP_PARAM,
        "utf8",
      ).toString("base64url")}__`;
      // Non-parameterised marker for exo__Instance_class (host baked class).
      const CLASS_MARKER =
        "__SUBSTITUTE__groundingTargetClass__33333333-3333-3333-3333-333333333333__";

      beforeEach(() => {
        clearResolvers();
        installDefaultResolvers();
      });

      function makeEffortGrounding(): GroundingDefinition {
        return makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: EFFORT_CLASS,
          targetFolder: "$isDefinedByFolder",
          propertyDefault: [
            { propertyName: "exo__Asset_isDefinedBy", value: REF_PROP_MARKER },
            { propertyName: "exo__Instance_class", value: CLASS_MARKER },
          ],
        });
      }

      it("@req:c03f9e3e-b47d-4a57-af9c-009ead5b9b34 routes the new Effort to the area-ontology's effortsOntology folder (two-hop)", async () => {
        // Area A's own frontmatter: isDefinedBy → the area-ontology O.
        reader.readFile.mockResolvedValue(
          `---\nexo__Asset_isDefinedBy: "[[${AREA_ONTOLOGY}]]"\n---\n`,
        );
        // Second hop: O's frontmatter carries effortsOntology = E.
        const refToFrontmatter = jest.fn(async (ref: string) =>
          ref === AREA_ONTOLOGY
            ? { exo__Ontology_effortsOntology: `"[[${EFFORTS_ONTOLOGY}]]"` }
            : null,
        );
        // Folder resolution: routed isDefinedBy (E) → E's folder; O → area folder.
        const refToFolder = jest.fn(async (ref: string) =>
          ref === EFFORTS_ONTOLOGY
            ? EFFORTS_FOLDER
            : ref === AREA_ONTOLOGY
              ? AREA_FOLDER
              : null,
        );
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
          refToFrontmatter,
        });

        const result = await executor.execute(
          makeEffortGrounding(),
          AREA_IRI,
          AREA_PATH,
          { label: "My Task" },
        );

        expect(result.success).toBe(true);
        const [path, content] = writer.createFile.mock.calls[0];
        // isDefinedBy auto-set to E (read two-hop A → O → O.effortsOntology).
        expect(content).toContain(
          `exo__Asset_isDefinedBy: "[[${EFFORTS_ONTOLOGY}]]"`,
        );
        // File co-located in E's folder, NOT the area folder.
        expect(path.startsWith(`${EFFORTS_FOLDER}/`)).toBe(true);
        expect(path.startsWith(`${AREA_FOLDER}/`)).toBe(false);
        // First hop consulted the area-ontology; folder resolved for E (routed).
        expect(refToFrontmatter).toHaveBeenCalledWith(AREA_ONTOLOGY);
        expect(refToFolder).toHaveBeenCalledWith(EFFORTS_ONTOLOGY);
      });

      it("@req:c03f9e3e-b47d-4a57-af9c-009ead5b9b34 routes per-ontology: O1→E1 folder, O2→E2 folder", async () => {
        const O1 = "d1111111-1111-2222-3333-444444444444";
        const O2 = "d2222222-1111-2222-3333-444444444444";
        const E1 = "e1111111-1111-2222-3333-444444444444";
        const E2 = "e2222222-1111-2222-3333-444444444444";
        const E1_FOLDER = "assetspaces/kitelev/exoas-my/my-efforts";
        const E2_FOLDER = "assetspaces/kitelev/exoas-tbank/work-efforts";
        const refToFrontmatter = jest.fn(async (ref: string) => {
          if (ref === O1)
            return { exo__Ontology_effortsOntology: `"[[${E1}]]"` };
          if (ref === O2)
            return { exo__Ontology_effortsOntology: `"[[${E2}]]"` };
          return null;
        });
        const refToFolder = jest.fn(async (ref: string) => {
          if (ref === E1) return E1_FOLDER;
          if (ref === E2) return E2_FOLDER;
          return null;
        });
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
          refToFrontmatter,
        });

        // Effort from an area under O1.
        reader.readFile.mockResolvedValue(
          `---\nexo__Asset_isDefinedBy: "[[${O1}]]"\n---\n`,
        );
        await executor.execute(makeEffortGrounding(), AREA_IRI, AREA_PATH, {
          label: "A1",
        });
        const path1 = writer.createFile.mock.calls[0][0];

        // Effort from an area under O2.
        reader.readFile.mockResolvedValue(
          `---\nexo__Asset_isDefinedBy: "[[${O2}]]"\n---\n`,
        );
        await executor.execute(makeEffortGrounding(), AREA_IRI, AREA_PATH, {
          label: "A2",
        });
        const path2 = writer.createFile.mock.calls[1][0];

        expect(path1.startsWith(`${E1_FOLDER}/`)).toBe(true);
        expect(path2.startsWith(`${E2_FOLDER}/`)).toBe(true);
        expect(path1.startsWith(E2_FOLDER)).toBe(false);
      });

      it("@req:c03f9e3e-b47d-4a57-af9c-009ead5b9b34 negative control: area-ontology WITHOUT effortsOntology → no routing, Effort co-locates with the area", async () => {
        reader.readFile.mockResolvedValue(
          `---\nexo__Asset_isDefinedBy: "[[${AREA_ONTOLOGY}]]"\n---\n`,
        );
        // O exists but declares NO effortsOntology → second hop yields nothing.
        const refToFrontmatter = jest.fn(async (ref: string) =>
          ref === AREA_ONTOLOGY ? { exo__Ontology_url: "https://x/o#" } : null,
        );
        // isDefinedBy unrouted → resolveIsDefinedByFolder has no ref → host folder.
        const refToFolder = jest.fn(async () => null);
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
          refToFrontmatter,
        });

        const result = await executor.execute(
          makeEffortGrounding(),
          AREA_IRI,
          AREA_PATH,
          { label: "Unrouted" },
        );

        expect(result.success).toBe(true);
        const [path, content] = writer.createFile.mock.calls[0];
        // No isDefinedBy written (routing yielded nothing — opt-in).
        expect(content).not.toContain("exo__Asset_isDefinedBy:");
        // Effort co-locates with the area (host folder = parent of AREA_PATH).
        expect(path.startsWith(`${AREA_FOLDER}/`)).toBe(true);
      });
    });

    // -- W3 "Create Class" homoiconic button (project 85150d63) --
    //
    // Mirror of T1 Create Instance, but the host page IS an `exo__Ontology`
    // (namespace definition) and the OUTPUT is a new `exo__Class`. Reuses the
    // exact same `create_instance` machinery (no new executor code) — only the
    // vault-declared Grounding config differs:
    //   - `targetClass = exo__Class metaclass` (8619c4fc) → the new asset's
    //     `exo__Instance_class` (it IS an exo__Class), via the Universal
    //     Default Template's `exo__Instance_class = $grounding.targetClass`
    //     PropertyDefault (filled here by the executor's scalar top-up because
    //     the test harness has no Universal Template loaded — same as the
    //     Create Instance block above).
    //   - `exo__Asset_isDefinedBy = $targetClassSelf` PropertyDefault → the new
    //     class is defined by the HOST ontology itself (the page IS the
    //     ontology), reusing the T1 `targetClassSelf` token.
    //   - `targetFolder = $isDefinedByFolder` → co-located in the host
    //     ontology's folder. For Create Class this CONVERGES with the host
    //     folder (isDefinedBy === host), so co-location holds even when the
    //     `RefToFolderResolver` is absent — strictly more robust than T1.
    describe("W3 homoiconic Create Class (host IS the ontology)", () => {
      // A real exo__Ontology page ($exocmd) acting as the click target.
      const HOST_ONTOLOGY_UID = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";
      const HOST_ONTOLOGY_FOLDER = "assetspaces/kitelev/exoas-exocmd/exocmd";
      const HOST_ONTOLOGY_PATH = `${HOST_ONTOLOGY_FOLDER}/${HOST_ONTOLOGY_UID}.md`;
      const HOST_ONTOLOGY_IRI = `obsidian://vault/${HOST_ONTOLOGY_UID}.md`;
      // exo__Class metaclass — the class of the new asset (it IS an exo__Class).
      const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
      const TARGET_CLASS_SELF_MARKER =
        "__SUBSTITUTE__targetClassSelf__22222222-2222-2222-2222-222222222222__";

      beforeEach(() => {
        clearResolvers();
        installDefaultResolvers();
      });

      function makeCreateClassGrounding(): GroundingDefinition {
        return makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          // exo__Class metaclass → new asset's exo__Instance_class (it IS a class).
          targetClass: CLASS_METACLASS_UID,
          targetFolder: "$isDefinedByFolder",
          propertyDefault: [
            {
              // isDefinedBy = the host ontology itself (the page IS the ontology).
              propertyName: "exo__Asset_isDefinedBy",
              value: TARGET_CLASS_SELF_MARKER,
            },
          ],
        });
      }

      it("creates a co-located exo__Class (instance_class=metaclass, isDefinedBy=host ontology) in the ontology folder", async () => {
        const refToFolder = jest.fn(async (ref: string) =>
          ref === HOST_ONTOLOGY_UID ? HOST_ONTOLOGY_FOLDER : null,
        );
        executor = new GroundingExecutor(reader, writer, registry, undefined, {
          refToFolder,
        });

        const result = await executor.execute(
          makeCreateClassGrounding(),
          HOST_ONTOLOGY_IRI,
          HOST_ONTOLOGY_PATH,
          { label: "My New Class" },
        );

        expect(result.success).toBe(true);
        const [path, content] = writer.createFile.mock.calls[0];
        // isDefinedBy = host ontology → $isDefinedByFolder resolves to its folder.
        expect(refToFolder).toHaveBeenCalledWith(HOST_ONTOLOGY_UID);
        expect(path).toMatch(
          new RegExp(`^${HOST_ONTOLOGY_FOLDER}/[a-f0-9-]{36}\\.md$`),
        );
        // The new asset IS an exo__Class (instance_class = metaclass), NOT an
        // instance of the host ontology.
        expect(content).toContain(`"[[${CLASS_METACLASS_UID}]]"`);
        // Defined by the host ontology (the clicked page).
        expect(content).toContain(
          `exo__Asset_isDefinedBy: "[[${HOST_ONTOLOGY_UID}]]"`,
        );
        expect(content).toContain("exo__Asset_label: My New Class");
        expect(content).toContain("exo__Asset_uid:");
        // Opened after create.
        expect(result.openPath).toBe(path);
      });

      it("co-location holds without a RefToFolderResolver (host folder === ontology folder)", async () => {
        // No refToFolder injected (CLI/headless). Because isDefinedBy === host,
        // the host-folder fallback lands the class in the SAME ontology folder.
        const result = await executor.execute(
          makeCreateClassGrounding(),
          HOST_ONTOLOGY_IRI,
          HOST_ONTOLOGY_PATH,
          { label: "Fallback Class" },
        );

        expect(result.success).toBe(true);
        const [path, content] = writer.createFile.mock.calls[0];
        expect(path.startsWith(`${HOST_ONTOLOGY_FOLDER}/`)).toBe(true);
        expect(content).toContain(`"[[${CLASS_METACLASS_UID}]]"`);
        expect(content).toContain(
          `exo__Asset_isDefinedBy: "[[${HOST_ONTOLOGY_UID}]]"`,
        );
        expect(content).toContain("exo__Asset_label: Fallback Class");
      });
    });

    // RFC ce27e55d: labelTemplate fallback for one-click create_instance
    // (no input modal). Verifies the executor resolves the new instance's
    // label from `grounding.labelTemplate` when no userInput.label is supplied.
    // Revert-verify discipline: each test must FAIL if the labelTemplate path
    // is removed (advisor's catch — confirm test exercises the new code).
    describe("RFC ce27e55d labelTemplate fallback", () => {
      it("uses labelTemplate when userInput is undefined (one-click flow)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          labelTemplate: "Auto label",
        });

        // Note: no `userInput` arg → triggers labelTemplate fallback.
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Auto label");
        // Aliases auto-populated because label is non-"Untitled".
        expect(content).toContain("aliases:");
      });

      it("userInput.label wins over labelTemplate (explicit user input takes precedence)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          labelTemplate: "Template label",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          FILE_PATH,
          { label: "User explicit" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: User explicit");
        expect(content).not.toContain("Template label");
      });

      it("falls back to Untitled when neither userInput.label nor labelTemplate is set (BC)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Untitled");
      });

      it("substitutes $nowCompact within labelTemplate", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "kitelev__Supervision",
          targetFolder: "03 Knowledge/kitelev",
          labelTemplate: "Осознал, что делаю шелуху $nowCompact",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toMatch(
          /exo__Asset_label: Осознал, что делаю шелуху \d{4}-\d{2}-\d{2}-\d{2}-\d{2}/,
        );
      });

      it("uses labelTemplate when upstream PropertyDefault wrote empty exo__Asset_label (UI smoke fix 2026-05-29)", async () => {
        // Production interaction discovered during UI smoke 2026-05-29:
        // Universal Default Template PD #3 (exo__Asset_label = $userInputLabel)
        // writes an empty literal when userInput.label is undefined. Without
        // this guard, the `=== undefined` check skipped labelTemplate fallback
        // and the empty PD result reached the file on disk.
        reader.readFile.mockResolvedValue(
          [
            "---",
            'exo__Asset_uid: "deaa0051-0236-4cae-b2a5-2b156c3c127a"',
            'exo__Asset_label: "Осознал, что делаю шелуху"',
            "---",
            "Body",
          ].join("\n"),
        );
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "kitelev__Supervision",
          targetFolder: "03 Knowledge/kitelev",
          labelTemplate: "$target.exo__Asset_label $nowCompact",
          // Simulate Universal Default Template PD writing empty exo__Asset_label.
          propertyDefault: [{ propertyName: "exo__Asset_label", value: "" }],
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toMatch(
          /exo__Asset_label: Осознал, что делаю шелуху \d{4}-\d{2}-\d{2}-\d{2}-\d{2}/,
        );
        expect(content).not.toMatch(/exo__Asset_label:\s*$/m);
      });

      it("falls back to Untitled when labelTemplate substitution result is empty string (reviewer MEDIUM)", async () => {
        // Reviewer MEDIUM: empty-string or whitespace-only substitution
        // result must NOT leak into `exo__Asset_label` as a literally empty
        // value. RFC ce27e55d contract: blank result → fallback to "Untitled".
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          labelTemplate: "   ", // whitespace-only template — substitutes to whitespace-only string
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Untitled");
        // No aliases block for Untitled (preserves BC with pre-RFC behavior).
        // Convention match with existing aliases assertion in test suite.
        expect(content).not.toContain("aliases:");
      });

      it("substitutes $target.exo__Asset_label by reading target frontmatter (production shape)", async () => {
        // Production shape: user clicks the prototype-instance whose file
        // contains `exo__Asset_label: «Осознал, что делаю шелуху»`. The
        // executor reads target frontmatter (triggered by `$target.` in
        // labelTemplate) and substitutes the value.
        reader.readFile.mockResolvedValue(
          [
            "---",
            'exo__Asset_uid: "deaa0051-0236-4cae-b2a5-2b156c3c127a"',
            'exo__Asset_label: "Осознал, что делаю шелуху"',
            "---",
            "Body",
          ].join("\n"),
        );

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "kitelev__Supervision",
          targetFolder: "03 Knowledge/kitelev",
          labelTemplate: "$target.exo__Asset_label $nowCompact",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toMatch(
          /exo__Asset_label: Осознал, что делаю шелуху \d{4}-\d{2}-\d{2}-\d{2}-\d{2}/,
        );
      });

      // Bug-fix (false-alarm log): the "Vault may be in an unhealthy state"
      // ERROR must NOT fire when the label was resolved via the *designed*
      // one-click paths (labelTemplate / userInput). Reaching the label
      // top-up block is normal for one-click/CLI creates (PD #3 writes an empty
      // literal), so the unhealthy-state signal belongs only to the genuine
      // "Untitled" fallthrough — not to a successful labelTemplate resolution.
      // Production-shape: a healthy Universal Default Template covers uid /
      // createdAt / instance_class (so they never reach the TS top-up) and
      // writes an EMPTY exo__Asset_label in the one-click flow (PD #3 =
      // $userInputLabel with no input modal). labelTemplate is the designed
      // completion. The unhealthy-state ERROR must NOT fire on this healthy create.
      const HEALTHY_TEMPLATE_DEFAULTS = [
        { propertyName: "exo__Asset_uid", value: "fixed-uid-for-test" },
        { propertyName: "exo__Asset_createdAt", value: "2026-06-28T10:00:00" },
        { propertyName: "exo__Instance_class", value: "[[ems__Task]]" },
        { propertyName: "exo__Asset_label", value: "" },
      ];

      it("does NOT log 'unhealthy state' when labelTemplate resolves the label (one-click flow)", async () => {
        const errorSpy = jest
          .spyOn(
            require("../../../src/services/LoggingService").LoggingService,
            "error",
          )
          .mockImplementation();

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          labelTemplate: "Auto label",
          propertyDefault: HEALTHY_TEMPLATE_DEFAULTS,
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Auto label");
        const calls = errorSpy.mock.calls.flat().map(String);
        expect(
          calls.some((s) =>
            s.includes("did not cover essential scalar primitives"),
          ),
        ).toBe(false);

        errorSpy.mockRestore();
      });

      it("blank userInput.label ('') falls back to 'Untitled' (no blank on disk) AND logs 'unhealthy state' (reviewer LOW)", async () => {
        // A modal-submitted empty label must not write a blank exo__Asset_label
        // to disk nor escape the unhealthy-state signal. "" is not undefined, so
        // the `??` path would keep it; the trim-guard normalises it to "Untitled".
        const errorSpy = jest
          .spyOn(
            require("../../../src/services/LoggingService").LoggingService,
            "error",
          )
          .mockImplementation();

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          propertyDefault: HEALTHY_TEMPLATE_DEFAULTS,
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "",
        });

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Untitled");
        expect(content).not.toMatch(/exo__Asset_label:\s*$/m);
        const calls = errorSpy.mock.calls.flat().map(String);
        expect(
          calls.some(
            (s) =>
              s.includes("did not cover essential scalar primitives") &&
              s.includes("exo__Asset_label"),
          ),
        ).toBe(true);

        errorSpy.mockRestore();
      });

      it("regression: genuine 'Untitled' fallthrough STILL logs 'unhealthy state'", async () => {
        // The degraded-mode signal must survive: when NO userInput.label and NO
        // labelTemplate produce a label, the safety net falls to "Untitled" and
        // the unhealthy-state ERROR must still fire (revert-verify counterpart).
        const errorSpy = jest
          .spyOn(
            require("../../../src/services/LoggingService").LoggingService,
            "error",
          )
          .mockImplementation();

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          // No labelTemplate → label stays empty → falls to "Untitled".
          propertyDefault: HEALTHY_TEMPLATE_DEFAULTS,
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain("exo__Asset_label: Untitled");
        const calls = errorSpy.mock.calls.flat().map(String);
        expect(
          calls.some(
            (s) =>
              s.includes("did not cover essential scalar primitives") &&
              s.includes("exo__Asset_label"),
          ),
        ).toBe(true);

        errorSpy.mockRestore();
      });
    });

    // Issue #3195: strip-canon. For UUID-named prototype-instance targets
    // (UID-canon TBox/ABox convention, 2026-05-17), the `exo__Asset_prototype`
    // back-link must be the BARE UID — `[[<uid>]]` — not the full vault-relative
    // path `[[assetspaces/shared-identities/<uid>]]`. Both resolve to the same
    // file in Obsidian runtime, but the path-form violates the convention.
    //
    // Production shape (from the issue's empirical evidence): the user clicks
    // the Lunch prototype-instance whose file is
    // `assetspaces/shared-identities/4b571141-…fc8410a.md`; `executeCreateInstance`
    // receives that vault-relative path as `targetFilePath`. The fix lives in
    // `extractBacklinkTarget` (a pure string transform — no Obsidian API to
    // mock), so the realism that matters here is the path SHAPE, not a faked
    // API return value.
    describe("strip-canon back-link for UUID-named targets (Issue #3195)", () => {
      const PROTO_UID = "4b571141-5fc3-4ddd-8f07-ca681fc8410a";
      const PROTO_PATH = `assetspaces/shared-identities/${PROTO_UID}.md`;
      const PROTO_IRI = `obsidian://vault/vault-2025/assetspaces/shared-identities/${PROTO_UID}.md`;

      it("writes exo__Asset_prototype as bare UID, not path-form (targetFilePath branch)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetPrototype: "df7e579d-02d4-4f3a-971f-3d1d785b689b|ems__TaskPrototype",
          targetFolder: "03 Knowledge/inbox",
        });

        const result = await executor.execute(
          grounding,
          PROTO_IRI,
          PROTO_PATH,
          { label: "Lunch 2026-05-19" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        // Bare strip-canon UID — the actual fix assertion.
        expect(content).toContain(`exo__Asset_prototype: "[[${PROTO_UID}]]"`);
        // Must NOT leak the path prefix.
        expect(content).not.toContain("assetspaces/shared-identities");
      });

      it("strips path-form to bare UID via the obsidian:// IRI fallback branch too", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "03 Knowledge/inbox",
        });

        // Empty targetFilePath forces the obsidian:// IRI decoding branch.
        const result = await executor.execute(
          grounding,
          PROTO_IRI,
          "",
          { label: "Lunch" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(`exo__Asset_prototype: "[[${PROTO_UID}]]"`);
        expect(content).not.toContain("assetspaces/shared-identities");
      });

      it("leaves non-UUID-named targets in path-form (whitelist: DailyNote etc.)", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "03 Knowledge/inbox",
        });

        // A DailyNote-style basename is NOT a UUID → path-form preserved so
        // Obsidian still resolves it (basename is unique by calendar convention).
        const result = await executor.execute(
          grounding,
          "obsidian://vault/vault-2025/01 Daily/2026-05-19.md",
          "01 Daily/2026-05-19.md",
          { label: "From daily" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain('exo__Asset_prototype: "[[01 Daily/2026-05-19]]"');
      });
    });

    it("should use 'Untitled' as default label when no user input", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("exo__Asset_label: Untitled");
    });

    it("should include exo__Asset_createdAt timestamp", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toMatch(/exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T/);
    });

    it("should include exo__Asset_updatedAt equal to createdAt at create_instance (task 1af85afd)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // create_instance assets carry updatedAt = createdAt from birth (safety-net
      // top-up mirroring the createdAt top-up).
      expect(content).toContain("exo__Asset_updatedAt:");
      const createdAt = content.match(/exo__Asset_createdAt: (\S+)/)?.[1];
      const updatedAt = content.match(/exo__Asset_updatedAt: (\S+)/)?.[1];
      expect(updatedAt).toBeDefined();
      expect(updatedAt).toBe(createdAt);
    });

    it("should emit exo__Asset_createdAt as a local timestamp (no Z / TZ suffix) — Issue #3188", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Match the exact line carrying the timestamp.
      const match = content.match(/^exo__Asset_createdAt:\s*(.+)$/m);
      expect(match).not.toBeNull();
      const ts = match![1].trim();
      // Local timestamp shape: YYYY-MM-DDTHH:mm:ss (no fractional seconds,
      // no timezone designator) — matches DateFormatter.toLocalTimestamp.
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      // Issue #3188: must NOT carry the UTC `Z` or any `±HH:MM` offset.
      expect(ts).not.toMatch(/Z$/);
      expect(ts).not.toMatch(/[+-]\d{2}:?\d{2}$/);
    });

    // RFC v2 Phase 5 (#3167): the legacy JSON-literal `propertyDefaults` field
    // and its executor path were removed. Per-property defaults are now
    // exercised via ref-form `propertyDefault` (see ref-form describe blocks
    // elsewhere in this file). Only the `$targetFolder` token resolution test,
    // which exercises `grounding.targetFolder` substitution (independent of
    // the removed legacy field), survives.
    describe("$targetFolder token resolution", () => {
      it("should resolve $targetFolder token in grounding.targetFolder", async () => {
        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "$targetFolder",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          "03 Knowledge/areas/host.md",
          { label: "task" },
        );

        expect(result.success).toBe(true);
        const [path] = writer.createFile.mock.calls[0];
        expect(path).toMatch(/^03 Knowledge\/areas\/[a-f0-9-]+\.md$/);
      });
    });

    it("should include exo__Instance_class as YAML array", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain('exo__Instance_class:\n  - "[[ems__Task]]"');
    });

    it("should default the back-link to exo__Asset_prototype for create_instance (Issue #3184 B2)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(
        'exo__Asset_prototype: "[[vault/test-asset]]"',
      );
      // Issue #3184 B2: no automatic exo__Asset_source for create_instance.
      // The prototype back-link already conveys the same semantic edge in
      // the RDF graph; doubling it up bloats frontmatter and confuses users.
      expect(content).not.toContain("exo__Asset_source:");
    });

    it("should add aliases when label is provided", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "My task" });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("aliases:\n  - My task");
    });

    it("should not add aliases for default 'Untitled' label", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).not.toContain("aliases:");
    });

    it("should pass additional userInput fields to frontmatter", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const userInput = { label: "Task", ems__Effort_status: '"[[Backlog]]"' };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain('ems__Effort_status: "[[Backlog]]"');
    });

    it("should skip null/undefined userInput values", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const userInput = { label: "Task", nullProp: null, undefProp: undefined };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).not.toContain("nullProp");
      expect(content).not.toContain("undefProp");
    });

    it("should handle file system errors gracefully", async () => {
      writer.createFile.mockRejectedValue(new Error("Disk full"));

      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Disk full");
    });

    // Integration test: full frontmatter verification (RFC-016 #2644)
    it("should create file with complete and correct frontmatter structure", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "gtd__InboxItem",
        targetPrototype: "proto-daily-review-uuid",
        targetFolder: "01 Inbox",
      });
      const userInput = { label: "Купить молоко" };

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      const [path, content] = writer.createFile.mock.calls[0];

      // Verify file path structure
      expect(path).toMatch(/^01 Inbox\//);
      expect(path).toMatch(/\.md$/);

      // Verify frontmatter has all required fields
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("exo__Asset_uid:");
      expect(content).toContain("exo__Asset_createdAt:");
      expect(content).toContain("exo__Asset_label: Купить молоко");
      expect(content).toContain("gtd__InboxItem");
      // Issue #3184 B1: prototype-class UID is NOT materialised; the
      // back-link references the prototype-INSTANCE the user clicked.
      expect(content).not.toContain("proto-daily-review-uuid");
      expect(content).toContain('exo__Asset_prototype: "[[vault/test-asset]]"');

      // Verify UUID in path matches UUID in frontmatter
      const pathUuid = path.split("/").pop()?.replace(".md", "");
      expect(content).toContain(`exo__Asset_uid: ${pathUuid}`);
    });

    // -- Homoiconic create_instance (RFC 32445c1c): NO implicit copy-from-target --
    //
    // Step 4 (copy-from-target + CREATE_INSTANCE_BLACKLIST) was removed in
    // RFC 32445c1c. New instances now receive ONLY properties enumerated by
    // explicit PropertyDefault / InheritanceRule rules, plus the engine-level
    // scaffolding (uid, createdAt, label, Instance_class, back-link).
    //
    // The historical "copy-from-target + linkBackProperty (Task 2.4)" suite
    // is preserved here as the homoiconic-cutover regression guard.

    describe("homoiconic create_instance — no implicit copy + linkBackProperty", () => {
      const TARGET_FM = [
        "---",
        'exo__Asset_uid: "src-uid"',
        'exo__Asset_label: "Source asset"',
        "exo__Instance_class:",
        '  - "[[ems__Project]]"',
        "aliases:",
        "  - Old alias",
        'ems__Effort_status: "[[ems__EffortStatusDoing]]"',
        "ems__Effort_startTimestamp: 2026-01-01T10:00:00",
        'ems__Effort_area: "[[area-uid-42]]"',
        'ems__Effort_priority: "[[priority-high]]"',
        "ems__Effort_tags:",
        '  - "[[tag-alpha]]"',
        '  - "[[tag-beta]]"',
        "---",
        "Body",
      ].join("\n");

      it("does NOT copy any $target frontmatter into new asset when no rules attached (RFC 32445c1c)", async () => {
        reader.readFile.mockResolvedValue(TARGET_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Sub-task" });

        const [, content] = writer.createFile.mock.calls[0];
        // None of target's properties leak — no implicit copy-from-target.
        expect(content).not.toContain('priority-high');
        expect(content).not.toContain('tag-alpha');
        expect(content).not.toContain('tag-beta');
        // Identity / lifecycle properties never leaked even pre-RFC.
        expect(content).not.toContain("src-uid");
        expect(content).not.toContain("Source asset");
        expect(content).not.toContain("Old alias");
        expect(content).not.toMatch(/exo__Instance_class:[\s\S]*ems__Project/);
        expect(content).not.toContain("ems__EffortStatusDoing");
        expect(content).not.toContain("ems__Effort_startTimestamp:");
        // Issue #3184 B3: ems__Effort_area never inherits without explicit rule.
        expect(content).not.toContain("ems__Effort_area:");
        expect(content).not.toContain("area-uid-42");
      });

      it("does not overwrite properties already set via userInput", async () => {
        // userInput precedence is independent of any copy step — verify it
        // still wins even when the engine reads $target frontmatter (for
        // potential InheritanceRule consumption).
        reader.readFile.mockResolvedValue(
          '---\nems__Effort_priority: "[[priority-from-target]]"\n---\n',
        );

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "X",
          ems__Effort_priority: '"[[priority-from-user]]"',
        });

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(
          'ems__Effort_priority: "[[priority-from-user]]"',
        );
        expect(content).not.toContain("priority-from-target");
      });

      it("writes back-link to grounding.linkBackProperty when provided", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          linkBackProperty: "ems__Effort_parent",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Sub" });

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(`ems__Effort_parent: "[[vault/test-asset]]"`);
        expect(content).not.toContain("exo__Asset_source:");
      });

      it("falls back to exo__Asset_prototype when linkBackProperty is absent (Issue #3184 B2)", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(
          'exo__Asset_prototype: "[[vault/test-asset]]"',
        );
        expect(content).not.toContain("exo__Asset_source:");
        expect(content).not.toContain("ems__Effort_prevIteration:");
      });

      it("accepts bare property name (no wikilink wrapping) for linkBackProperty", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          linkBackProperty: "ems__Effort_prevIteration",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Next" });

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(`ems__Effort_prevIteration: "[[vault/test-asset]]"`);
        expect(content).not.toContain("exo__Asset_source:");
        expect(content).not.toContain("[[ems__Effort_prevIteration]]:");
      });

      it("returns descriptive error when $target file is missing (and an InheritanceRule needs it)", async () => {
        // RFC 32445c1c: the executor only reads $target when at least one
        // InheritanceRule is attached (Step 3 needs source-property values).
        // The fail-loud guard fires inside that conditional read — fixture
        // attaches a rule to enter the read branch.
        reader.readFile.mockRejectedValue(new Error("ENOENT: no such file"));

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          inheritanceRule: [
            {
              sourcePropertyName: "exo__Asset_isDefinedBy",
              targetPropertyName: "exo__Asset_isDefinedBy",
              targetClassExclusion: [],
              priority: 10,
            },
          ],
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(false);
        expect(result.error).toContain("$target");
        expect(result.error).toContain(FILE_PATH);
        expect(result.error).toContain("ENOENT");
        // Must not silently fall through to createFile
        expect(writer.createFile).not.toHaveBeenCalled();
      });
    });

    // Issue #3184 (B1+B2) replaces the legacy default `exo__Asset_source` with
    // `exo__Asset_prototype` for create_instance — the prior assumption was
    // that vault groundings (e.g. `e01b025b` "Create MeetingPrototype instance",
    // `adc73790`, `3da98088`, `00a6a887`, `a6ef8fda`) wanted `exo__Asset_source`
    // back-links, but user-facing inspection of created assets showed the
    // source link duplicated semantics already conveyed by the prototype edge.
    // The suite below was originally Task 4.4 (Phase 2 backwards compat); it
    // has been re-pointed at the new default to keep coverage on the no-
    // `linkBackProperty` path without losing the empty-targetIRI guard.
    describe("default back-link path (Issue #3184 B2)", () => {
      // Fixture mirrors vault grounding `e01b025b-d03f-4028-b4c8-45d3786ff43d`
      // ("Create MeetingPrototype instance") — targetClass + targetPrototype +
      // targetFolder, no explicit linkBackProperty.
      const LEGACY_MEETING_GROUNDING = {
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Meeting",
        targetPrototype: "7ab483c7-aafc-4ac8-8aca-0de52db34a93|ems__MeetingPrototype",
        targetFolder: "03 Knowledge/inbox",
      } as const;

      it("vault grounding without linkBackProperty defaults to exo__Asset_prototype", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\nBody");

        const grounding = makeGrounding({ ...LEGACY_MEETING_GROUNDING });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "Weekly sync",
        });

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(
          'exo__Asset_prototype: "[[vault/test-asset]]"',
        );
        expect(content).not.toContain("exo__Asset_source:");
        expect(content).not.toMatch(/ems__Effort_parent: "\[\[https/);
        expect(content).not.toMatch(/ems__Effort_prevIteration:/);
      });

      it("grounding with targetClass only (no prototype, no linkBackProperty) defaults to exo__Asset_prototype", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain('exo__Instance_class:\n  - "[[ems__Task]]"');
        expect(content).toContain(
          'exo__Asset_prototype: "[[vault/test-asset]]"',
        );
        expect(content).not.toContain("exo__Asset_source:");
      });

      it("grounding without $target (empty targetIRI) does NOT emit any back-link", async () => {
        // When targetIRI is falsy, no link is written — neither the legacy
        // `exo__Asset_source: "[[]]"` nor the new
        // `exo__Asset_prototype: "[[]]"` phantom value.
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(grounding, "", "", { label: "Standalone" });

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).not.toContain("exo__Asset_source:");
        expect(content).not.toContain("exo__Asset_prototype:");
        expect(content).not.toMatch(/"\[\[\]\]"/);
      });

      it("grounding with linkBackProperty=undefined still uses the new default (no fallback drift)", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
          linkBackProperty: undefined,
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(
          'exo__Asset_prototype: "[[vault/test-asset]]"',
        );
        expect(content).not.toContain("exo__Asset_source:");
      });
    });

    // =========================================================================
    // Issue #3184 — bug fixes: prototype reference, source removal, blacklist,
    // open-in-tab plumbing. Each bug gets a dedicated test so a future
    // regression points at the exact AC that broke.
    // =========================================================================
    describe("Issue #3184 — grounding bug fixes", () => {
      // Fixture mirrors the "Lunch" prototype-instance from the issue:
      //   ems__Effort_area: "[[5dd75bb5-...]]" (B3)
      //   exo__Asset_relates: "[[some-X]]"    (B4)
      const PROTOTYPE_INSTANCE_FM = [
        "---",
        'exo__Asset_uid: "4b571141-5fc3-4ddd-8f07-ca681fc8410a"',
        'exo__Asset_label: "Lunch"',
        "exo__Instance_class:",
        '  - "[[df7e579d-classid-emsTaskPrototype]]"',
        'ems__Effort_area: "[[5dd75bb5-areauid]]"',
        'exo__Asset_relates: "[[some-related-asset]]"',
        'ems__Effort_priority: "[[priority-mid]]"',
        "---",
        "Body",
      ].join("\n");

      it("B1: exo__Asset_prototype references the prototype-INSTANCE ($target), not the class UID", async () => {
        reader.readFile.mockResolvedValue(PROTOTYPE_INSTANCE_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          // `targetPrototype` is the CLASS UID (`ems__TaskPrototype`) — must
          // NOT bleed into the created asset's frontmatter.
          targetPrototype: "df7e579d-classid-emsTaskPrototype",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          FILE_PATH,
          { label: "Lunch instance" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(
          'exo__Asset_prototype: "[[vault/test-asset]]"',
        );
        expect(content).not.toContain("df7e579d-classid-emsTaskPrototype");
      });

      it("B2: exo__Asset_source is not written by default for create_instance", async () => {
        reader.readFile.mockResolvedValue(PROTOTYPE_INSTANCE_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).not.toContain("exo__Asset_source:");
      });

      it("B3: ems__Effort_area is not inherited from the prototype-instance", async () => {
        reader.readFile.mockResolvedValue(PROTOTYPE_INSTANCE_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          FILE_PATH,
          { label: "task" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).not.toContain("ems__Effort_area:");
        expect(content).not.toContain("5dd75bb5-areauid");
      });

      it("B4: exo__Asset_relates is not inherited from the prototype-instance", async () => {
        reader.readFile.mockResolvedValue(PROTOTYPE_INSTANCE_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          FILE_PATH,
          { label: "task" },
        );

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).not.toContain("exo__Asset_relates:");
        expect(content).not.toContain("some-related-asset");
      });

      it("RFC 32445c1c: properties not in any explicit rule are NOT inherited (no implicit copy-from-target)", async () => {
        // Pre-RFC: ems__Effort_priority (not blacklisted) would copy. After
        // RFC 32445c1c removed Step 4: nothing copies without an explicit
        // PropertyDefault / InheritanceRule attached to the grounding.
        reader.readFile.mockResolvedValue(PROTOTYPE_INSTANCE_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "task",
        });

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).not.toContain('ems__Effort_priority:');
        expect(content).not.toContain('priority-mid');
      });

      it("B5: ExecutionResult.openPath equals the created file path", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        const result = await executor.execute(
          grounding,
          TARGET_IRI,
          FILE_PATH,
          { label: "lunch" },
        );

        expect(result.success).toBe(true);
        expect(result.openPath).toBeDefined();
        expect(result.openPath).toMatch(/^01 Inbox\/[a-f0-9-]+\.md$/);
        // openPath equals the path actually passed to createFile.
        const [createdPath] = writer.createFile.mock.calls[0];
        expect(result.openPath).toBe(createdPath);
      });

      it("B5: other grounding types do not surface openPath", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\nBody");

        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__status",
          targetValueLiteral: "Done",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        expect(result.openPath).toBeUndefined();
      });
    });

    // Plugin adapter test: vault-relative path (RFC-016 #2645)
    it("should pass vault-relative path to createFile (plugin adapter compatibility)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetPrototype: "my-prototype-uid",
        targetFolder: "03 Knowledge/inbox",
      });

      await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Test" });

      const [path] = writer.createFile.mock.calls[0];
      // Path should be vault-relative (no leading /)
      expect(path).not.toMatch(/^\//);
      expect(path).toMatch(/^03 Knowledge\/inbox\//);
    });
  });
});

// =============================================================================
// RFC-028 Findings 3+4 — grounding $input / $value user-input resolution
// =============================================================================
//
// Failing regression suite covering the literal `$input` / `$value` placeholder
// bug — `GroundingExecutor.substituteVariables` (line ~418) handles only
// `$target` / `$now` / `$nowLocal` / `$today`. Buttons "Set Planned Start",
// "Set Planned End", "Set Scheduled Date" (vault `85687461`, `afda78d9`,
// `d222ddaf`) and "Set Result" (vault `c4616dcd`) ship `targetValue: "$input"`
// / `"$value"`. The literal string passes through and gets written to
// frontmatter as-is — P0 data corruption.
//
// Block intentionally appended at EOF to keep merge-conflict surface minimal
// for the parallel 3.C.1 child (also touches this file with a different
// `describe`). Helper / fixture functions are scoped INSIDE the describe to
// avoid global-name collision with that child's later append.
// =============================================================================

describe("substituteVariables — $input/$value user-input resolution (Findings 3+4)", () => {
  const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
  const FILE_PATH = "/vault/test-asset.md";

  // Local fixture helpers — DECLARED INSIDE describe to keep 3.C.1 append safe.
  function createMockReader(content?: string) {
    const defaultContent = content ?? "---\nfoo: bar\n---\nBody";
    return {
      readFile: jest.fn().mockResolvedValue(defaultContent),
      fileExists: jest.fn().mockResolvedValue(true),
      getMarkdownFiles: jest.fn().mockResolvedValue([]),
    };
  }

  function createMockWriter() {
    return {
      createFile: jest.fn().mockResolvedValue(""),
      updateFile: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      renameFile: jest.fn().mockResolvedValue(undefined),
    };
  }

  function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
    return {
      id: "gnd-test-findings34",
      label: "Test Grounding (Findings 3+4)",
      type: GroundingType.PROPERTY_SET,
      ...overrides,
    } as unknown as GroundingDefinition;
  }

  function getWrittenContent(writer: ReturnType<typeof createMockWriter>): string {
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    return writer.updateFile.mock.calls[0][1] as string;
  }

  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let registry: ServiceRegistry;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = createMockReader();
    writer = createMockWriter();
    registry = new ServiceRegistry();
    executor = new GroundingExecutor(reader, writer, registry);
  });

  it("resolves $input placeholder to user-provided value, not literal (Set Planned Start, Finding 3)", async () => {
    // Mirrors vault grounding 85687461-* (Set Planned Start)
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_plannedStartTimestamp",
      targetValueSubstitution: "$input",
    });
    const userInput = { value: "2026-04-19T10:00:00+0500" };

    const result = await executor.execute(
      grounding,
      TARGET_IRI,
      FILE_PATH,
      userInput,
    );

    expect(result.success).toBe(true);
    const written = getWrittenContent(writer);
    expect(written).toContain(
      "ems__Effort_plannedStartTimestamp: 2026-04-19T10:00:00+0500",
    );
    // The bug: literal "$input" is persisted into frontmatter
    expect(written).not.toMatch(/ems__Effort_plannedStartTimestamp:\s*\$input/);
  });

  it("resolves $value placeholder to user-provided value (Set Result, Finding 4)", async () => {
    // Mirrors vault grounding c4616dcd-* (Set Result)
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_result",
      targetValueSubstitution: "$value",
    });
    const userInput = { value: "Completed successfully" };

    const result = await executor.execute(
      grounding,
      TARGET_IRI,
      FILE_PATH,
      userInput,
    );

    expect(result.success).toBe(true);
    const written = getWrittenContent(writer);
    expect(written).toContain("ems__Effort_result: Completed successfully");
    expect(written).not.toMatch(/ems__Effort_result:\s*\$value/);
  });

  it("fails loudly (does NOT silently write literal) when $input placeholder present but no userInput provided", async () => {
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_plannedStartTimestamp",
      targetValueSubstitution: "$input",
    });

    const result = await executor.execute(
      grounding,
      TARGET_IRI,
      FILE_PATH,
      undefined,
    );

    // Outcome-based assertion: either explicit failure OR (if writer was called
    // anyway) the literal "$input" string MUST NOT appear in frontmatter.
    if (result.success) {
      const written = getWrittenContent(writer);
      expect(written).not.toMatch(
        /ems__Effort_plannedStartTimestamp:\s*\$input/,
      );
    } else {
      expect(writer.updateFile).not.toHaveBeenCalled();
      expect(result.error).toMatch(
        /input|placeholder|user input required|missing user input/i,
      );
    }
  });

  it.each([
    [
      "Set Planned Start",
      "ems__Effort_plannedStartTimestamp",
      "$input",
      "2026-04-19T10:00:00+0500",
    ],
    [
      "Set Planned End",
      "ems__Effort_plannedEndTimestamp",
      "$input",
      "2026-04-19T18:00:00+0500",
    ],
    [
      "Set Scheduled Date",
      "ems__Effort_scheduledDate",
      "$input",
      "2026-04-20",
    ],
    [
      "Set Result",
      "ems__Effort_result",
      "$value",
      "Completed successfully",
    ],
  ])(
    "button %s never persists literal %s placeholder as frontmatter value",
    async (_label, property, placeholder, sampleValue) => {
      const grounding = makeGrounding({
        targetProperty: property,
        targetValueSubstitution: placeholder,
      });
      const userInput = { value: sampleValue };

      await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      const written = getWrittenContent(writer);
      // Literal placeholder MUST NOT appear in frontmatter value position
      const literalRegex = new RegExp(
        `${property}:\\s*\\${placeholder}\\b`,
      );
      expect(written).not.toMatch(literalRegex);
      // User-provided value MUST appear
      expect(written).toContain(`${property}: ${sampleValue}`);
    },
  );
});

// =============================================================================
// RFC-028 Finding 5 — Convert to Task grounding end-to-end wiring
// =============================================================================
//
// Failing regression suite covering the silent no-op bug on the "Convert to
// Task" button when clicked on an ems__Project.
//
// Root cause (per vault design spec 85440451 §3.1 Triad C):
//   - `AssetConversionService.convertProjectToTask` EXISTS and is correct.
//   - Vault + starter-kit grounding `abdbdf09-8712-4c11-8cbe-467f46091294`
//     ("Convert to task") dispatches as `type: service_call` with
//     `serviceId = "convertToTask"` — but that service is NOT registered in
//     the core ServiceRegistry (plugin-side service wrapping
//     AssetConversionService does not reach into core's registry).
//   - GroundingExecutor.executeServiceCall returns `{ success: false,
//     error: 'Service not found: "convertToTask"...' }` — swallowed upstream
//     as silent no-op.
//
// Orchestrator decision 2026-04-19T11:45 (per user): Option A — IMPLEMENT
// Project→Task conversion via grounding path. Single-branch assertion — no OR.
//
// Block intentionally appended at EOF (after Findings 3+4 block) to keep
// merge-conflict surface minimal. Helper fixtures scoped INSIDE describe to
// avoid global-name collision.
// =============================================================================

describe("Convert to Task grounding — end-to-end wiring (Finding 5)", () => {
  const TARGET_IRI = "https://exocortex.my/assets/project-under-test-uuid";
  const FILE_PATH = "/vault/project-under-test.md";

  // Local fixture helpers — DECLARED INSIDE describe to keep globals clean.
  function createMockReader(content?: string) {
    const defaultContent =
      content ??
      [
        "---",
        "exo__Asset_uid: project-under-test-uuid",
        'exo__Asset_label: "Audit Project"',
        "exo__Instance_class:",
        '  - "[[ems__Project]]"',
        'ems__Effort_area: "[[area-uuid]]"',
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
        "---",
        "",
        "Body",
      ].join("\n");
    return {
      readFile: jest.fn().mockResolvedValue(defaultContent),
      fileExists: jest.fn().mockResolvedValue(true),
      getMarkdownFiles: jest.fn().mockResolvedValue([]),
    };
  }

  function createMockWriter() {
    return {
      createFile: jest.fn().mockResolvedValue(""),
      updateFile: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      renameFile: jest.fn().mockResolvedValue(undefined),
    };
  }

  function makeGrounding(
    overrides: Record<string, unknown>,
  ): GroundingDefinition {
    return {
      id: "gnd-test-finding5",
      label: "Test Grounding (Finding 5)",
      type: GroundingType.SERVICE_CALL,
      ...overrides,
    } as unknown as GroundingDefinition;
  }

  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let registry: ServiceRegistry;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = createMockReader();
    writer = createMockWriter();
    registry = new ServiceRegistry();
    executor = new GroundingExecutor(reader, writer, registry);
  });

  it("clicking Convert to Task on ems__Project flips exo__Instance_class to [[ems__Task]] via grounding path", async () => {
    // Arrange: grounding definition mirrors vault file abdbdf09 "Convert to task"
    // NOTE: `targetProperty` is the serviceId per executeServiceCall convention
    // (line ~310). Orchestrator decision: serviceId = "convertToTask" dispatches
    // to a service that performs class flip. Pre-fix: service not registered →
    // executor returns { success: false, error: "Service not found: ..." }.
    const grounding = makeGrounding({
      targetProperty: "convertToTask",
      targetValueRef: "ems__Task",
    });

    // Act
    const result = await executor.execute(
      grounding,
      TARGET_IRI,
      FILE_PATH,
      undefined,
    );

    // Assert: success + class flipped (single branch, no OR per orchestrator)
    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    const written = writer.updateFile.mock.calls[0][1] as string;
    expect(written).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
    // No leftover ems__Project on the Instance_class line/array
    expect(written).not.toMatch(/exo__Instance_class:[\s\S]*?ems__Project/);
  });

  it("preserves ems__Effort_area, ems__Effort_status, exo__Asset_label after conversion", async () => {
    // Arrange: same rich Project metadata as above (default reader content)
    const grounding = makeGrounding({
      targetProperty: "convertToTask",
      targetValueRef: "ems__Task",
    });

    // Act
    const result = await executor.execute(
      grounding,
      TARGET_IRI,
      FILE_PATH,
      undefined,
    );

    // Assert: success + all non-class metadata preserved verbatim
    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    const written = writer.updateFile.mock.calls[0][1] as string;
    expect(written).toContain('ems__Effort_area: "[[area-uuid]]"');
    expect(written).toContain(
      'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
    );
    expect(written).toContain('exo__Asset_label: "Audit Project"');
  });
});

// =============================================================================
// RFC-028 Finding 5 completion — production-shape dispatch for Convert commands
// =============================================================================
//
// The fix shipped in PR #2860 short-circuits on `serviceId === "convertToTask"`,
// which is the shape used by unit-test fixtures. But the real vault + starter-kit
// grounding `abdbdf09` ("Convert to task") ships with `serviceId = "updateProperty"`
// + `targetProperty = "exo__Instance_class"` + `targetValue = "ems__Task"`.
//
// The CommandResolver parser overrides `targetProperty` with `Grounding_serviceId`
// for service_call groundings, so at executor time the definition looks like:
//   { type: service_call, targetProperty: "updateProperty", targetValue: "ems__Task" }
//
// That shape DOES NOT match the short-circuit, falls through to
// `serviceRegistry.get("updateProperty")`, which requires `userInput.property`
// → runtime error "updateProperty requires userInput.property" (seen live in
// vault v15.105.4 verification, Task 2f7c7e56).
//
// Scope: extend dispatch to cover BOTH Convert groundings without touching the
// vault data layer. Convert to Project grounding `e8c1d18a` follows the same
// pattern with `targetValue = "ems__Project"` and is wired to `b1b6978e` via
// binding `148aaf8c` (targetClass: ems__Task) — active UI surface.
// =============================================================================

describe("Convert commands — production-shape dispatch (Finding 5 completion)", () => {
  const TARGET_IRI = "https://exocortex.my/assets/convert-under-test";
  const FILE_PATH = "/vault/convert-under-test.md";

  function createConvertReader(sourceClass: "ems__Project" | "ems__Task") {
    const content = [
      "---",
      "exo__Asset_uid: convert-under-test",
      'exo__Asset_label: "Audit Asset"',
      "exo__Instance_class:",
      `  - "[[${sourceClass}]]"`,
      'ems__Effort_area: "[[area-uuid]]"',
      'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      "---",
      "",
      "Body",
    ].join("\n");
    return {
      readFile: jest.fn().mockResolvedValue(content),
      fileExists: jest.fn().mockResolvedValue(true),
      getMarkdownFiles: jest.fn().mockResolvedValue([]),
    };
  }

  function createWriter() {
    return {
      createFile: jest.fn().mockResolvedValue(""),
      updateFile: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      renameFile: jest.fn().mockResolvedValue(undefined),
    };
  }

  function makeSvcCall(overrides: Record<string, unknown>): GroundingDefinition {
    return {
      id: "gnd-prod-shape",
      label: "Prod-shape service_call",
      type: GroundingType.SERVICE_CALL,
      ...overrides,
    } as unknown as GroundingDefinition;
  }

  let reader: ReturnType<typeof createConvertReader>;
  let writer: ReturnType<typeof createWriter>;
  let registry: ServiceRegistry;
  let executor: GroundingExecutor;

  describe("Convert to Task (production grounding shape)", () => {
    beforeEach(() => {
      reader = createConvertReader("ems__Project");
      writer = createWriter();
      registry = new ServiceRegistry();
      executor = new GroundingExecutor(reader, writer, registry);
    });

    it("flips class to ems__Task when serviceId=updateProperty + targetValue=ems__Task", async () => {
      // Arrange: grounding matches parsed shape of vault file abdbdf09
      // after CommandResolver's serviceId-overrides-targetProperty step.
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Task",
      });

      // Act
      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      // Assert
      expect(result.success).toBe(true);
      expect(writer.updateFile).toHaveBeenCalledTimes(1);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
      expect(written).not.toMatch(/exo__Instance_class:[\s\S]*?ems__Project/);
    });

    it("preserves other frontmatter properties (area, status, label)", async () => {
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Task",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toContain('ems__Effort_area: "[[area-uuid]]"');
      expect(written).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      );
      expect(written).toContain('exo__Asset_label: "Audit Asset"');
    });
  });

  describe("Convert to Project (production grounding shape)", () => {
    beforeEach(() => {
      reader = createConvertReader("ems__Task");
      writer = createWriter();
      registry = new ServiceRegistry();
      executor = new GroundingExecutor(reader, writer, registry);
    });

    it("flips class to ems__Project when serviceId=updateProperty + targetValue=ems__Project", async () => {
      // Arrange: grounding matches parsed shape of vault file e8c1d18a
      // ("Convert to project"), mirror of Convert-to-Task path.
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Project",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      expect(writer.updateFile).toHaveBeenCalledTimes(1);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /exo__Instance_class:\s*\[?\s*"\[\[ems__Project\]\]"/,
      );
      expect(written).not.toMatch(/exo__Instance_class:[\s\S]*?ems__Task/);
    });

    it("preserves other frontmatter properties after Task→Project flip", async () => {
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Project",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toContain('ems__Effort_area: "[[area-uuid]]"');
      expect(written).toContain('exo__Asset_label: "Audit Asset"');
    });
  });

  describe("Link-to-parent (non-regression: updateProperty with userInput must not short-circuit)", () => {
    beforeEach(() => {
      reader = createConvertReader("ems__Task");
      writer = createWriter();
      registry = new ServiceRegistry();
      executor = new GroundingExecutor(reader, writer, registry);
    });

    it("dispatches to registered updateProperty service when targetProperty !== exo__Instance_class", async () => {
      // Arrange: grounding mirrors vault file 30b9e8d8 ("Link to parent").
      // After parser override, targetProperty ends up as serviceId="updateProperty",
      // BUT real distinguishing signal is the presence of userInput + absence of
      // class-flip targetValue. Register a mock updateProperty service and assert
      // it is invoked (i.e. the composite short-circuit did NOT swallow this).
      const mockService = { execute: jest.fn().mockResolvedValue(undefined) };
      registry.register("updateProperty", mockService);

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        // targetValue absent — Link-to-parent drives the new parent via userInput
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        property: "ems__Effort_parent",
        value: "[[parent-uuid]]",
      });

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledTimes(1);
      // Writer should NOT have been called by a Convert short-circuit
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("also non-regresses when targetValueRef is a non-class-flip value", async () => {
      // Defensive: even if a future grounding supplies a targetValueRef that
      // is neither "ems__Task" nor "ems__Project", dispatch must still reach
      // the registered service (not short-circuit). RFC 918a2b65 Phase 4:
      // typed predicate replaces legacy `targetValue` here.
      const mockService = { execute: jest.fn().mockResolvedValue(undefined) };
      registry.register("updateProperty", mockService);

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "some-other-value",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        property: "any__prop",
        value: "x",
      });

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledTimes(1);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });
  });

  // RFC 918a2b65 Phase 4 removed the legacy `targetValue` field entirely.
  // The "Wrapped wikilink targetValue (real vault shape)" describe block
  // covered scenarios where the parser delivered targetValue as
  // `"[[ems__Task]]"` (vault IRI shape). Post-migration the parser emits
  // `targetValueRef` as bare-UID or bare-label (CommandResolver strips
  // wikilink wrappers upstream via `getObsidianName` / `unwrapWikilink`).
  // Vault production state observed 2026-05-23: all class-flip groundings
  // store typed targetValueRef as bare UUIDs (1b20a8f0 / 7db5eeff). Plain
  // bare-label is exercised by the "Convert commands — production-shape
  // dispatch" tests above.

  // ===========================================================================
  // Issue #3222: the convert paths (executeConvertToTask / executeConvertToProject)
  // wrote a hardcoded label-form `["[[ems__Task]]"]` / `["[[ems__Project]]"]`,
  // bypassing the execution-time class label→UID resolution added in #3220.
  // When an ObsidianClassLabelResolver is injected (production plugin), the
  // written `exo__Instance_class` must be UUID-canon. With no resolver
  // (tests/CLI/headless), the label-form fallback is preserved.
  // ===========================================================================
  describe("Convert paths — UID-canon resolution (#3222)", () => {
    const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
    const PROJECT_UID = "7db5eeff-718a-49b0-8d2b-39b084a356e3";

    function makeResolver(map: Record<string, string>) {
      const calls: string[] = [];
      const fn = (label: string): string | null => {
        calls.push(label);
        return map[label] ?? null;
      };
      return { fn, calls };
    }

    it("Convert to Task emits UID-form exo__Instance_class when a resolver is wired", async () => {
      const reader = createConvertReader("ems__Project");
      const writer = createWriter();
      const { fn, calls } = makeResolver({ ems__Task: TASK_UID });
      const executor = new GroundingExecutor(
        reader,
        writer,
        new ServiceRegistry(),
        fn,
      );

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Task",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      expect(calls).toContain("ems__Task");
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        new RegExp(`exo__Instance_class:\\s*\\[?\\s*"\\[\\[${TASK_UID}\\]\\]"`),
      );
      // label-form was replaced by UID (regression criterion: pre-fix wrote
      // "[[ems__Task]]") and the source class was overwritten.
      expect(written).not.toMatch(/"\[\[ems__Task\]\]"/);
      expect(written).not.toMatch(/"\[\[ems__Project\]\]"/);
    });

    it("Convert to Project emits UID-form exo__Instance_class when a resolver is wired", async () => {
      const reader = createConvertReader("ems__Task");
      const writer = createWriter();
      const { fn, calls } = makeResolver({ ems__Project: PROJECT_UID });
      const executor = new GroundingExecutor(
        reader,
        writer,
        new ServiceRegistry(),
        fn,
      );

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Project",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      expect(calls).toContain("ems__Project");
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        new RegExp(
          `exo__Instance_class:\\s*\\[?\\s*"\\[\\[${PROJECT_UID}\\]\\]"`,
        ),
      );
      // label-form was replaced by UID (regression criterion: pre-fix wrote
      // "[[ems__Project]]") and the source class was overwritten.
      expect(written).not.toMatch(/"\[\[ems__Project\]\]"/);
      expect(written).not.toMatch(/"\[\[ems__Task\]\]"/);
    });

    it("Convert to Task falls back to label-form when no resolver is injected", async () => {
      const reader = createConvertReader("ems__Project");
      const writer = createWriter();
      const executor = new GroundingExecutor(reader, writer, new ServiceRegistry());

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Task",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
    });

    it("Convert to Project falls back to label-form when no resolver is injected", async () => {
      const reader = createConvertReader("ems__Task");
      const writer = createWriter();
      const executor = new GroundingExecutor(reader, writer, new ServiceRegistry());

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Project",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /exo__Instance_class:\s*\[?\s*"\[\[ems__Project\]\]"/,
      );
    });

    it("Convert to Task preserves label-form when resolver returns null (unresolvable)", async () => {
      const reader = createConvertReader("ems__Project");
      const writer = createWriter();
      const { fn } = makeResolver({}); // resolves nothing
      const executor = new GroundingExecutor(
        reader,
        writer,
        new ServiceRegistry(),
        fn,
      );

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValueRef: "ems__Task",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
    });
  });
});

// -- RFC v2 Phase 3b — 5-step pipeline (Issue #3163) --
//
// Stand-alone top-level suite (NOT inside "Convert commands" describe) so the
// outer-most `executor` instance (no ClassLabelToUidResolver) is the default,
// matching the production GroundingExecutor wiring for headless/CLI contexts.
describe("GroundingExecutor — RFC v2 Phase 3b 5-step pipeline", () => {
  const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
  const FILE_PATH = "/vault/test-asset.md";

  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let registry: ServiceRegistry;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = createMockReader();
    writer = createMockWriter();
    registry = new ServiceRegistry();
    executor = new GroundingExecutor(reader, writer, registry);
  });

  // -- Test fixtures --
  //
  // Tests the executor half of `exocmd__Grounding_propertyDefault` (ref-form)
  // and `exocmd__Grounding_inheritanceRule` wiring. Parser side lives in
  // CommandResolver.ts (Phase 3a, merged via PR #3224).
  //
  // Precedence per RFC v2 §Precedence (high → low):
  //   1. userInput (modal form fields)
  //   2. PropertyDefault (declarative ref-form — constants)
  //   3. InheritanceRule (filter + sort + apply — target-derived values)
  //   (RFC 32445c1c: Step 4 copy-from-target removed; only explicit rules write)
  //   5. [implicit] gaps remain empty
  const TARGET_AREA_UID = "905cc587-0000-0000-0000-000000000001";
  const TARGET_AREA_PATH = "03 Knowledge/areas/host.md";
  const TARGET_AREA_IRI =
    "obsidian://vault/vault-2025/03 Knowledge/areas/host.md";
  const STATUS_DRAFT_UID = "c42245d0-01de-4c35-bfcf-d910445ea28e";
  const STATUS_BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
  const OWNER_ONTOLOGY_UID = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";

  /**
   * Build a target frontmatter string with `exo__Instance_class` plus any
   * extra properties. Authored in symbolic form (`[[ems__Area]]`) so unit
   * tests don't need a wired ClassLabelToUidResolver.
   */
  function buildTargetFm(
      classNames: string[],
      extraProps: Record<string, string> = {},
    ): string {
      const classLines = classNames.map((c) => `  - "[[${c}]]"`).join("\n");
      const extraLines = Object.entries(extraProps)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      return `---\nexo__Asset_uid: ${TARGET_AREA_UID}\nexo__Instance_class:\n${classLines}\n${extraLines}\n---\nBody`;
    }

    // -- Step 1 vs Step 2: userInput overrides PropertyDefault --

    it("userInput overrides PropertyDefault for the same property name (Step 1 > Step 2)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_status",
            value: `"[[${STATUS_DRAFT_UID}]]"`,
          },
        ],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        label: "Override test",
        ems__Effort_status: `"[[${STATUS_BACKLOG_UID}]]"`,
      });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // userInput value wins.
      expect(content).toContain(`ems__Effort_status: "[[${STATUS_BACKLOG_UID}]]"`);
      // PropertyDefault value is NOT present.
      expect(content).not.toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
    });

    // -- Step 2 — PropertyDefault applies new declarative defaults --

    it("PropertyDefault sets a declarative wikilink value when userInput omits it", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_status",
            value: `"[[${STATUS_DRAFT_UID}]]"`,
          },
        ],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        label: "PD test",
      });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
    });

    // -- PropertyDefault writes its declared value even when $target has a
    //    competing value. Pre-RFC 32445c1c (when Step 4 + BLACKLIST existed),
    //    `ems__Effort_status` was BLACKLISTed; PropertyDefault still wrote.
    //    Post-RFC: copy-from-target removed entirely; PropertyDefault is now
    //    the only path that writes constants like `ems__Effort_status`. --
    it("PropertyDefault writes ems__Effort_status regardless of target's competing value", async () => {
      // Target carries its own status field; only PropertyDefault's value
      // should reach the new instance (no implicit copy).
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_status",
            value: `"[[${STATUS_DRAFT_UID}]]"`,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          ems__Effort_status: `"[[${STATUS_BACKLOG_UID}]]"`,
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "BLACKLIST bypass test" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // PropertyDefault writes; target's value never reaches new asset
      // (no copy-from-target after RFC 32445c1c).
      expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
      expect(content).not.toContain(`ems__Effort_status: "[[${STATUS_BACKLOG_UID}]]"`);
    });

    // -- Step 2 — SubstitutionToken marker resolution --

    it("PropertyDefault marker __SUBSTITUTE__target__<uid>__ → [[<target-uid>]] wikilink at runtime", async () => {
      const TOKEN_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_parent",
            value: `__SUBSTITUTE__target__${TOKEN_UID}__`,
          },
        ],
      });
      const PROTO_UID = "4b571141-5fc3-4ddd-8f07-ca681fc8410a";
      const PROTO_PATH = `assetspaces/shared-identities/${PROTO_UID}.md`;
      const PROTO_IRI = `obsidian://vault/vault-2025/${PROTO_PATH}`;

      const result = await executor.execute(grounding, PROTO_IRI, PROTO_PATH, {
        label: "marker target",
      });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Effort_parent: "[[${PROTO_UID}]]"`);
    });

    it("PropertyDefault marker __SUBSTITUTE__targetFolder__<uid>__ → vault-relative folder", async () => {
      const TOKEN_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_sourceFolder",
            value: `__SUBSTITUTE__targetFolder__${TOKEN_UID}__`,
          },
        ],
      });

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        "03 Knowledge/areas/host.md",
        { label: "folder marker" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("ems__Effort_sourceFolder: 03 Knowledge/areas");
    });

    it("PropertyDefault already-resolved date literal passes through the executor unchanged", async () => {
      // A non-marker PropertyDefault value (e.g. an already-resolved literal
      // like "2026-05-23") is written verbatim by the executor. (Bug 3883: date
      // resolvers now emit `__SUBSTITUTE__` markers that the executor swaps —
      // covered elsewhere; this asserts the plain literal pass-through path.)
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_plannedStartTimestamp",
            value: "2026-05-23",
          },
        ],
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        label: "today literal",
      });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(
        "ems__Effort_plannedStartTimestamp: 2026-05-23",
      );
    });

    // -- Step 3 — InheritanceRule applies with class condition --

    it("InheritanceRule applies when target instanceof condition class (uid→area for ems__Area target)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Area"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "area test" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Source `exo__Asset_uid` is a bare UUID → wrapped as wikilink.
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
    });

    it("InheritanceRule skipped when target is NOT instanceof condition class", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      // Target is a Project, not an Area — condition does NOT match.
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Project"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "non-area test" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).not.toContain("ems__Effort_area:");
    });

    // -- Step 3 — InheritanceRule exclusion semantics --

    it("InheritanceRule skipped when target instanceof exclusion class (uid→parent excluded for Area)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: ["ems__Area"],
            priority: 50,
          },
        ],
      });
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Area"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "exclude area" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).not.toContain("ems__Effort_parent:");
    });

    it("InheritanceRule applies when target NOT in exclusion list", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: ["ems__Area"],
            priority: 50,
          },
        ],
      });
      // Target is a Project — NOT excluded.
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Project"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "parent test" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Effort_parent: "[[${TARGET_AREA_UID}]]"`);
    });

    it("InheritanceRule exclusion is multi-valued: ANY excluded class skips rule", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: ["ems__Area", "ems__Quarter"],
            priority: 50,
          },
        ],
      });
      // Target has both Project and Quarter — Quarter is in exclusion.
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Project", "ems__Quarter"]),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "multi exclude" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).not.toContain("ems__Effort_parent:");
    });

    // -- Step 3 — Priority sort and override semantics --

    it("Higher-priority InheritanceRule wins; lower priority does not override same targetProperty", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          // Authored in low-then-high order to verify sort actually runs.
          {
            sourcePropertyName: "exo__Asset_isDefinedBy",
            targetPropertyName: "exo__Asset_isDefinedBy",
            targetClassExclusion: [],
            priority: 10,
          },
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "exo__Asset_isDefinedBy", // intentionally same key
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          exo__Asset_isDefinedBy: `"[[${OWNER_ONTOLOGY_UID}]]"`,
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "priority test" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Priority-100 rule wins: source = exo__Asset_uid (bare UUID → wrapped).
      expect(content).toContain(
        `exo__Asset_isDefinedBy: "[[${TARGET_AREA_UID}]]"`,
      );
      // Priority-10 rule did NOT override (would have written OWNER_ONTOLOGY_UID).
      expect(content).not.toContain(
        `exo__Asset_isDefinedBy: "[[${OWNER_ONTOLOGY_UID}]]"`,
      );
    });

    it("Equal-priority InheritanceRules preserve authoring order (stable sort)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: [],
            priority: 50,
          },
          {
            // Same priority, same target — first one (above) should win.
            sourcePropertyName: "exo__Asset_isDefinedBy",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: [],
            priority: 50,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Project"], {
          exo__Asset_isDefinedBy: `"[[${OWNER_ONTOLOGY_UID}]]"`,
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "stable" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // First-authored equal-priority rule wins.
      expect(content).toContain(`ems__Effort_parent: "[[${TARGET_AREA_UID}]]"`);
      expect(content).not.toContain(
        `ems__Effort_parent: "[[${OWNER_ONTOLOGY_UID}]]"`,
      );
    });

    // -- InheritanceRule is now the only path for ems__Effort_area --
    //
    // Pre-RFC 32445c1c: `ems__Effort_area` was BLACKLISTed from Step 4, with
    // InheritanceRule explicitly writing transformed values into the slot.
    // Post-RFC: Step 4 removed; InheritanceRule remains the only path.
    it("InheritanceRule writes ems__Effort_area (target's own value would NOT leak without rule)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          ems__Effort_area: '"[[outer-area-uid]]"',
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "BLACKLIST bypass IR" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // InheritanceRule wrote target's UID; target's own ems__Effort_area
      // value never appears (no copy-from-target after RFC 32445c1c).
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
      expect(content).not.toContain('ems__Effort_area: "[[outer-area-uid]]"');
    });

    // -- Step 2 > Step 3: PropertyDefault wins over InheritanceRule --

    it("Step 2 (PropertyDefault) takes precedence over Step 3 (InheritanceRule) for same property", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_parent",
            value: '"[[hardcoded-parent-uid]]"',
          },
        ],
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: ["ems__Area"],
            priority: 50,
          },
        ],
      });
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Project"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "PD wins over IR" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain('ems__Effort_parent: "[[hardcoded-parent-uid]]"');
      expect(content).not.toContain(`ems__Effort_parent: "[[${TARGET_AREA_UID}]]"`);
    });

    // -- Step 3 — Source value already wikilink (isDefinedBy pass-through) --

    it("InheritanceRule passes through already-wikilink source values (exo__Asset_isDefinedBy)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_isDefinedBy",
            targetPropertyName: "exo__Asset_isDefinedBy",
            targetClassExclusion: [],
            priority: 10,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          exo__Asset_isDefinedBy: `"[[${OWNER_ONTOLOGY_UID}]]"`,
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "isDefinedBy pass-through" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(
        `exo__Asset_isDefinedBy: "[[${OWNER_ONTOLOGY_UID}]]"`,
      );
    });

    // -- Step 3 — Multi-class target (exo__Instance_class is multi-valued) --

    it("InheritanceRule condition matches when target has multiple classes and ANY is the condition", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      // Target has both ems__Area and a marker class; condition matches via
      // either class entry in the multi-valued list.
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__FocusZone", "ems__Area"]),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "multi-class" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
    });

    // -- ClassLabelToUidResolver path: UID-canon target classes match label-form conditions --

    it("Class condition matches UID-canon target classes via ClassLabelToUidResolver", async () => {
      const AREA_UID = "82c74542-1b14-4217-b852-d84730484b25";
      const labelToUid = jest
        .fn()
        .mockImplementation((label: string) =>
          label === "ems__Area" ? AREA_UID : null,
        );
      const executorWithResolver = new GroundingExecutor(
        reader,
        writer,
        registry,
        labelToUid,
      );
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      // Target authored with UID-canon class wikilink.
      reader.readFile.mockResolvedValue(buildTargetFm([AREA_UID]));

      const result = await executorWithResolver.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "UID-canon class match" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
      expect(labelToUid).toHaveBeenCalledWith("ems__Area");
    });

    // -- Issue #3562: UID-canon condition matches UID-canon target WITHOUT the
    //    label→UID resolver. Reproduces the post-`Apply profile` staleness where
    //    the resolver (Obsidian metadataCache) has not yet indexed the freshly
    //    materialised class TBox and returns null — previously skipping the
    //    conditional rule and orphaning the new child Area (masking the #3555
    //    fix). The fix carries `targetClassConditionUid` so the match is UID↔UID
    //    direct. Revert-verify: FAILS pre-fix (condition matched only via the
    //    null-returning resolver → ems__Area_parent absent), PASSES post-fix.
    it("Issue #3562: UID-canon condition matches UID-canon target even when the label→UID resolver returns null (post-apply stale cache)", async () => {
      const AREA_UID = "82c74542-1b14-4217-b852-d84730484b25";
      // Simulate the post-apply lagging resolver: the class TBox is on disk but
      // not yet in the metadataCache, so label→UID resolution returns null.
      const staleResolver = jest.fn().mockResolvedValue(null);
      const executorStaleResolver = new GroundingExecutor(
        reader,
        writer,
        registry,
        staleResolver,
      );
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Area",
        targetFolder: "03 Knowledge/areas",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Area_parent",
            // Production shape: condition carries the UID-canon form (resolved
            // from the `[[82c74542-…]]` wikilink by CommandResolver). Label is
            // best-effort and irrelevant to the UID-direct match.
            targetClassCondition: "ems__Area",
            targetClassConditionUid: AREA_UID,
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      // Source area authored UID-canon: exo__Instance_class → [[82c74542-…]].
      reader.readFile.mockResolvedValue(buildTargetFm([AREA_UID]));

      const result = await executorStaleResolver.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "Child area pre-reload" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // The conditional rule applied: child area is NOT orphaned.
      expect(content).toContain(`ems__Area_parent: "[[${TARGET_AREA_UID}]]"`);
    });

    // -- Issue #3562: UID-canon EXCLUSION enforced even when the label is
    //    unresolvable (resolver null). The new instance is an Area, so a rule
    //    excluding ems__Area must NOT apply. Revert-verified: pre-fix
    //    `inheritanceExclusionMatches` ignored the UID-only set (empty label
    //    list → no exclusion) → ems__Effort_parent inherited onto the Area
    //    (FAIL); post-fix the UID set is checked independently → excluded. --
    it("Issue #3562: UID-canon exclusion is enforced via UID when the resolver returns null", async () => {
      const AREA_UID = "82c74542-1b14-4217-b852-d84730484b25";
      const staleResolver = jest.fn().mockResolvedValue(null);
      const executorStaleResolver = new GroundingExecutor(
        reader,
        writer,
        registry,
        staleResolver,
      );
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Area",
        targetFolder: "03 Knowledge/areas",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            // Excludes ems__Area (UID-canon). Target IS an Area → must skip.
            targetClassExclusion: [],
            targetClassExclusionUids: [AREA_UID],
            priority: 50,
          },
        ],
      });
      reader.readFile.mockResolvedValue(buildTargetFm([AREA_UID]));

      const result = await executorStaleResolver.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "Area must be excluded" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Exclusion held: ems__Effort_parent must NOT be inherited onto an Area.
      expect(content).not.toContain("ems__Effort_parent:");
    });

    // -- End-to-end Grounding `a6ef8fda` semantics — golden scenario --

    it("End-to-end (Grounding a6ef8fda semantics): Area target → Task with Draft status + area + isDefinedBy", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_status",
            value: `"[[${STATUS_DRAFT_UID}]]"`,
          },
        ],
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_parent",
            targetClassExclusion: ["ems__Area"],
            priority: 50,
          },
          {
            sourcePropertyName: "exo__Asset_isDefinedBy",
            targetPropertyName: "exo__Asset_isDefinedBy",
            targetClassExclusion: [],
            priority: 10,
          },
        ],
      });
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          exo__Asset_isDefinedBy: `"[[${OWNER_ONTOLOGY_UID}]]"`,
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        { label: "Buy groceries" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // PropertyDefault: status = Draft (UID-canon)
      expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
      // InheritanceRule#1 (prio 100, condition Area): area = target uid
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
      // InheritanceRule#2 (exclusion Area): SHOULD NOT have parent
      expect(content).not.toContain("ems__Effort_parent:");
      // InheritanceRule#3 (unconditional): isDefinedBy passes through
      expect(content).toContain(
        `exo__Asset_isDefinedBy: "[[${OWNER_ONTOLOGY_UID}]]"`,
      );
    });

    // RFC v2 Phase 5 (#3167): the legacy + ref-form coexistence defense-in-depth
    // test was removed alongside the legacy `propertyDefaults` field. Ref-form
    // is the only path; no coexistence guard remains.

    // -- Step 1 > Step 3 (review MED-1): userInput overrides InheritanceRule --

    it("userInput overrides InheritanceRule for the same target property (Step 1 > Step 3)", async () => {
      // Mirrors the Step 1 > Step 2 invariant test, but with InheritanceRule
      // instead of PropertyDefault on the same target property. Guards against
      // a future refactor that re-orders Steps 1 and 3 silently breaking the
      // userInput-wins contract documented in RFC v2 §Precedence.
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });
      reader.readFile.mockResolvedValue(buildTargetFm(["ems__Area"]));

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        {
          label: "userInput wins over IR",
          ems__Effort_area: '"[[user-supplied-area-uid]]"',
        },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // userInput value wins.
      expect(content).toContain('ems__Effort_area: "[[user-supplied-area-uid]]"');
      // InheritanceRule value is NOT present.
      expect(content).not.toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
    });

    // -- Three-layer homoiconic pipeline (RFC 32445c1c):
    //    Step 1 (userInput) + Step 2 (PropertyDefault) + Step 3 (InheritanceRule)
    //    each contributes to its own slot. Step 4 (copy-from-target) removed —
    //    properties without an explicit rule never reach the new instance. --

    it("Three-layer pipeline: userInput + PropertyDefault + InheritanceRule (no implicit copy)", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          {
            propertyName: "ems__Effort_status",
            value: `"[[${STATUS_DRAFT_UID}]]"`,
          },
        ],
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
          {
            sourcePropertyName: "exo__Asset_isDefinedBy",
            targetPropertyName: "exo__Asset_isDefinedBy",
            targetClassExclusion: [],
            priority: 10,
          },
        ],
      });
      // Target carries ems__Effort_priority but no rule mentions it →
      // RFC 32445c1c: it MUST NOT appear in the created instance.
      reader.readFile.mockResolvedValue(
        buildTargetFm(["ems__Area"], {
          exo__Asset_isDefinedBy: `"[[${OWNER_ONTOLOGY_UID}]]"`,
          ems__Effort_priority: '"[[priority-high]]"',
        }),
      );

      const result = await executor.execute(
        grounding,
        TARGET_AREA_IRI,
        TARGET_AREA_PATH,
        {
          label: "Three-layer test",
          ems__Effort_responsible: '"[[user-uid]]"', // Step 1: userInput
        },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Step 1 (userInput) contributes ems__Effort_responsible.
      expect(content).toContain('ems__Effort_responsible: "[[user-uid]]"');
      // Step 2 (PropertyDefault) contributes ems__Effort_status.
      expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
      // Step 3 (InheritanceRule) contributes ems__Effort_area (Area target match).
      expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
      // Step 3 (InheritanceRule) contributes exo__Asset_isDefinedBy
      // (unconditional rule on target's value).
      expect(content).toContain(
        `exo__Asset_isDefinedBy: "[[${OWNER_ONTOLOGY_UID}]]"`,
      );
      // RFC 32445c1c: ems__Effort_priority is on target but no rule mentions
      // it → must NOT leak into new instance (Bug 3 regression guard).
      expect(content).not.toContain('ems__Effort_priority:');
      expect(content).not.toContain('priority-high');
    });

    // -- Backward compatibility: Groundings without propertyDefault / inheritanceRule --

    it("Backward compat: Grounding without propertyDefault / inheritanceRule still creates instance correctly", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        label: "backward compat",
      });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("exo__Asset_label: backward compat");
      expect(content).toContain("ems__Task");
    });

  // -- RFC 918a2b65 Phase 2 — typed predicates for service_call + property_append --
  describe("RFC 918a2b65 typed predicates", () => {
    describe("service_call: serviceCallPayload (JSON merge)", () => {
      it("merges serviceCallPayload JSON as defaults into userInput", async () => {
        const mockService = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        registry.register("updateProperty", mockService);

        const grounding = makeGrounding({
          type: GroundingType.SERVICE_CALL,
          targetProperty: "updateProperty",
          serviceCallPayload: '{"property":"ems__Effort_parent"}',
        });

        const userInput = { value: "[[some-asset]]" };
        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

        expect(result.success).toBe(true);
        expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
          property: "ems__Effort_parent",
          value: "[[some-asset]]",
        });
      });

      it("substitutes $target inside serviceCallPayload before JSON.parse", async () => {
        const mockService = {
          execute: jest.fn().mockResolvedValue(undefined),
        };
        registry.register("createAsset", mockService);

        const grounding = makeGrounding({
          type: GroundingType.SERVICE_CALL,
          targetProperty: "createAsset",
          serviceCallPayload:
            '{"prototype":"$target","instanceClass":"ems__Task","folder":"03 Knowledge/inbox"}',
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
          prototype: TARGET_IRI,
          instanceClass: "ems__Task",
          folder: "03 Knowledge/inbox",
        });
      });
    });

    describe("service_call: class-flip via targetValueRef (Convert to Task / Project)", () => {
      it("dispatches Convert to Task when targetValueRef is the ems__Task UUID", async () => {
        const reader2 = createMockReader(
          "---\nexo__Instance_class: '[[ems__Project]]'\n---",
        );
        const writer2 = createMockWriter();
        const executor2 = new GroundingExecutor(reader2, writer2, registry);

        const grounding = makeGrounding({
          type: GroundingType.SERVICE_CALL,
          targetProperty: "updateProperty",
          targetValueRef: "1b20a8f0-d745-4e93-91db-4531b3df120e",
        });

        const result = await executor2.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer2.updateFile.mock.calls[0];
        expect(content).toContain("ems__Task");
      });

      it("dispatches Convert to Project when targetValueRef is the ems__Project UUID", async () => {
        const reader2 = createMockReader(
          "---\nexo__Instance_class: '[[ems__Task]]'\n---",
        );
        const writer2 = createMockWriter();
        const executor2 = new GroundingExecutor(reader2, writer2, registry);

        const grounding = makeGrounding({
          type: GroundingType.SERVICE_CALL,
          targetProperty: "updateProperty",
          targetValueRef: "7db5eeff-718a-49b0-8d2b-39b084a356e3",
        });

        const result = await executor2.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer2.updateFile.mock.calls[0];
        expect(content).toContain("ems__Project");
      });

      it("accepts targetValueRef in bare-label form (#3220 downgrade path)", async () => {
        const reader2 = createMockReader(
          "---\nexo__Instance_class: '[[ems__Project]]'\n---",
        );
        const writer2 = createMockWriter();
        const executor2 = new GroundingExecutor(reader2, writer2, registry);

        const grounding = makeGrounding({
          type: GroundingType.SERVICE_CALL,
          targetProperty: "updateProperty",
          targetValueRef: "ems__Task",
        });

        const result = await executor2.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer2.updateFile.mock.calls[0];
        expect(content).toContain("ems__Task");
      });

    });

    describe("property_append: appendExpression", () => {
      it("resolves appendExpression via substituteVariables", async () => {
        const reader2 = createMockReader(
          "---\nexo__Asset_label: My Asset\naliases:\n  - existing\n---",
        );
        const writer2 = createMockWriter();
        const executor2 = new GroundingExecutor(reader2, writer2, registry);

        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_APPEND,
          targetProperty: "aliases",
          appendExpression: "$target.exo__Asset_label",
        });

        const result = await executor2.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(true);
        const [, content] = writer2.updateFile.mock.calls[0];
        expect(content).toContain("My Asset");
        expect(content).toContain("existing");
      });

      it("fails-loud when appendExpression is not set", async () => {
        const grounding = makeGrounding({
          type: GroundingType.PROPERTY_APPEND,
          targetProperty: "aliases",
        });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        expect(result.success).toBe(false);
        expect(result.error).toContain("appendExpression");
      });
    });
  });

  // RFC 727572d2 — safety-net top-up coverage (HIGH-1+2 reviewer fixes)
  describe("RFC 727572d2 partial-PD safety-net top-up", () => {
    it("PD covers only uid + createdAt → top-up fills label + Instance_class + backlink; error flags only the genuine gap (Instance_class), NOT the userInput-provided label", async () => {
      // Simulate Universal Default Template with only 2 of 4 essential primitives
      // (e.g. partial vault corruption / in-flight migration). PR ships
      // executor with selective top-up: missing essentials filled from legacy
      // TS, log emitted to surface vault-health regression. NOTE: the label here
      // is supplied via userInput (the modal/input flow) — that is the DESIGNED
      // path, not a template gap, so the unhealthy-state error must NOT list
      // exo__Asset_label (only the genuinely-uncovered exo__Instance_class).
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          // Provided: exo__Asset_uid + exo__Asset_createdAt (already-resolved strings)
          { propertyName: "exo__Asset_uid", value: "abc12345-6789-4abc-8def-012345678901" },
          { propertyName: "exo__Asset_createdAt", value: "2026-05-25T10:00:00" },
        ],
      });

      const errorSpy = jest.spyOn(require("../../../src/services/LoggingService").LoggingService, "error").mockImplementation();

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        { label: "My New Asset" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];

      // PD-provided values appear unchanged
      expect(content).toContain("exo__Asset_uid: abc12345-6789-4abc-8def-012345678901");
      expect(content).toContain("exo__Asset_createdAt: 2026-05-25T10:00:00");

      // Top-up filled missing essentials
      expect(content).toContain("exo__Asset_label: My New Asset");
      expect(content).toContain("exo__Instance_class:"); // top-up fills
      expect(content).toContain("aliases:"); // bonus: label-derived alias

      // Backlink top-up: target known, no per-Grounding linkBackProperty, no IR fired
      expect(content).toContain('exo__Asset_prototype: "[[');

      // Error log emitted (vault-health visibility) — but ONLY for the genuine
      // gap. exo__Instance_class was not covered by the partial PDs → flagged.
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.flat().map(String);
      expect(
        calls.some(
          (s) =>
            s.includes("essential scalar primitives") &&
            s.includes("exo__Instance_class"),
        ),
      ).toBe(true);
      // Bug-fix (false-alarm log): the label came from userInput (modal flow),
      // so it must NOT be reported as a missing/uncovered primitive.
      expect(
        calls.some(
          (s) =>
            s.includes("essential scalar primitives") &&
            s.includes("exo__Asset_label"),
        ),
      ).toBe(false);

      errorSpy.mockRestore();
    });

    it("Full Universal PDs → no top-up + no error log (happy path)", async () => {
      // When all 4 essentials are covered by PDs (i.e. healthy Universal
      // Template), top-up SKIPS and no error log fires.
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "03 Knowledge/inbox",
        propertyDefault: [
          { propertyName: "exo__Asset_uid", value: "abc12345-6789-4abc-8def-012345678901" },
          { propertyName: "exo__Asset_createdAt", value: "2026-05-25T10:00:00" },
          { propertyName: "exo__Asset_label", value: "Universal-provided Label" },
          { propertyName: "exo__Instance_class", value: '"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"' },
        ],
        inheritanceRule: [
          // Universal IR that fires for ems__Task — writes backlink
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "exo__Asset_prototype",
            targetClassCondition: "ems__Task",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });

      // Target has ems__Task class so IR fires
      reader.readFile.mockResolvedValue(
        "---\nexo__Asset_uid: target-uid-1\nexo__Instance_class:\n  - \"[[ems__Task]]\"\n---\nBody",
      );

      const errorSpy = jest.spyOn(require("../../../src/services/LoggingService").LoggingService, "error").mockImplementation();

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        { label: "Overridden by Universal" },
      );

      expect(result.success).toBe(true);
      // No error log (top-up didn't fire)
      const calls = errorSpy.mock.calls.flat().map(String);
      const topUpLogs = calls.filter((s) => s.includes("essential scalar primitives"));
      expect(topUpLogs).toHaveLength(0);

      errorSpy.mockRestore();
    });
  });

  // =========================================================================
  // Issue #3561 — area-targeted creates must NOT emit the legacy
  // exo__Asset_prototype fallback (+ red "No backlink rule fired" error) when an
  // InheritanceRule already linked the new instance back to the target Area.
  //
  // Root cause: applyMissingBacklinkTopUp recognised ONLY exo__Asset_prototype
  // and ems__Effort_parent as "backlink already written". Area creates link via
  // ems__Effort_area (Task/Project-on-Area) or ems__Area_parent (Area-on-Area),
  // which the named-key guard missed → a spurious exo__Asset_prototype=[[area]]
  // + console error, even though the area relationship was set correctly.
  // Fix detects the link by VALUE (any property already pointing at the target).
  // =========================================================================
  describe("Issue #3561 — area-targeted create backlink detection", () => {
    // UID-canon fixture mirrors the real vault: the target Area's file is named
    // <area-uid>.md and its exo__Asset_uid equals that uid, so the IR-copied
    // value ("[[<area-uid>]]") and extractBacklinkTarget (<area-uid>) coincide.
    const AREA_UID = "a1b2c3d4-1111-4222-8333-444455556666";
    const AREA_FILE_PATH = `assetspaces/areas/${AREA_UID}.md`;
    // UID-canon vaults store exo__Asset_uid BARE (verified against real
    // ems__Area assets), so the InheritanceRule wraps it into a wikilink
    // ("[[<uid>]]") via formatInheritedScalar — which is what makes the area
    // relationship coincide with the back-link target.
    const AREA_TARGET_FM = [
      "---",
      `exo__Asset_uid: ${AREA_UID}`,
      'exo__Asset_label: "My Area"',
      "exo__Instance_class:",
      '  - "[[ems__Area]]"',
      "---",
      "Body",
    ].join("\n");

    function spyOnError() {
      return jest
        .spyOn(
          require("../../../src/services/LoggingService").LoggingService,
          "error",
        )
        .mockImplementation();
    }

    it("Task created on an Area: ems__Effort_area IR fires → NO exo__Asset_prototype, NO 'No backlink rule fired' error", async () => {
      reader.readFile.mockResolvedValue(AREA_TARGET_FM);
      const errorSpy = spyOnError();

      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Effort_area",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        AREA_FILE_PATH,
        { label: "Task on Area" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      // Correct relationship is set ...
      expect(content).toContain(`ems__Effort_area: "[[${AREA_UID}]]"`);
      // ... and the spurious legacy fallback is gone.
      expect(content).not.toContain("exo__Asset_prototype:");
      const calls = errorSpy.mock.calls.flat().map(String);
      expect(calls.some((s) => s.includes("No backlink rule fired"))).toBe(false);

      errorSpy.mockRestore();
    });

    it("child Area created on an Area: ems__Area_parent IR fires → NO exo__Asset_prototype, NO error", async () => {
      reader.readFile.mockResolvedValue(AREA_TARGET_FM);
      const errorSpy = spyOnError();

      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Area",
        targetFolder: "01 Inbox",
        inheritanceRule: [
          {
            sourcePropertyName: "exo__Asset_uid",
            targetPropertyName: "ems__Area_parent",
            targetClassCondition: "ems__Area",
            targetClassExclusion: [],
            priority: 100,
          },
        ],
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        AREA_FILE_PATH,
        { label: "Sub-area" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`ems__Area_parent: "[[${AREA_UID}]]"`);
      expect(content).not.toContain("exo__Asset_prototype:");
      const calls = errorSpy.mock.calls.flat().map(String);
      expect(calls.some((s) => s.includes("No backlink rule fired"))).toBe(false);

      errorSpy.mockRestore();
    });

    it("regression: genuine degraded mode (no IR, nothing links to target) STILL writes legacy exo__Asset_prototype + error", async () => {
      // No inheritanceRule → no backlink established → the degraded-mode safety
      // net must remain intact (the asset would otherwise be orphaned).
      reader.readFile.mockResolvedValue(AREA_TARGET_FM);
      const errorSpy = spyOnError();

      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(
        grounding,
        TARGET_IRI,
        AREA_FILE_PATH,
        { label: "Orphan" },
      );

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`exo__Asset_prototype: "[[${AREA_UID}]]"`);
      const calls = errorSpy.mock.calls.flat().map(String);
      expect(calls.some((s) => s.includes("No backlink rule fired"))).toBe(true);

      errorSpy.mockRestore();
    });
  });
});

// Issue #3779 — named-input substitution `$input.<key>` (relabel / set-parent
// dogfooding parity). Lets a vault grounding bind an inputSchema-named CLI input
// (`--input '{"label":...}'` / `'{"parent":...}'`) instead of the single
// anonymous `$input`/`$value` slot. Additive: bare `$input`/`$value` still
// resolve to userInput.value.
describe("substituteVariables — $input.<key> named-input resolution (#3779)", () => {
  const TARGET_IRI = "https://exocortex.my/assets/test-asset-3779";
  const FILE_PATH = "/vault/test-asset.md";

  function createMockReader(content?: string) {
    return {
      readFile: jest.fn().mockResolvedValue(content ?? "---\nfoo: bar\n---\nBody"),
      fileExists: jest.fn().mockResolvedValue(true),
      getMarkdownFiles: jest.fn().mockResolvedValue([]),
    };
  }
  function createMockWriter() {
    return {
      createFile: jest.fn().mockResolvedValue(""),
      updateFile: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      renameFile: jest.fn().mockResolvedValue(undefined),
    };
  }
  function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
    return {
      id: "gnd-test-3779",
      label: "Test Grounding (#3779)",
      type: GroundingType.PROPERTY_SET,
      ...overrides,
    } as unknown as GroundingDefinition;
  }
  function written(writer: ReturnType<typeof createMockWriter>): string {
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    return writer.updateFile.mock.calls[0][1] as string;
  }

  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let executor: GroundingExecutor;

  beforeEach(() => {
    reader = createMockReader();
    writer = createMockWriter();
    executor = new GroundingExecutor(reader, writer, new ServiceRegistry());
  });

  it("resolves $input.<key> to the matching userInput key (set-parent via targetValueRef)", async () => {
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_parent",
      targetValueRef: "$input.parent", // executor wraps to "[[<resolved>]]"
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      parent: "99999999-0000-0000-0000-000000000009",
    });

    expect(result.success).toBe(true);
    expect(written(writer)).toContain(
      'ems__Effort_parent: "[[99999999-0000-0000-0000-000000000009]]"',
    );
  });

  it("resolves $input.<key> inside a literal value (relabel via targetValueLiteral)", async () => {
    const grounding = makeGrounding({
      targetProperty: "exo__Asset_label",
      targetValueLiteral: "$input.label",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      label: "New Label",
    });

    expect(result.success).toBe(true);
    expect(written(writer)).toMatch(/exo__Asset_label: New Label\b/);
  });

  it("YAML-quotes a string-scalar property value that needs quoting (label with ': ')", async () => {
    const grounding = makeGrounding({
      targetProperty: "exo__Asset_label",
      targetValueLiteral: "$input.label",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      label: "Meeting: Q3 review",
    });

    expect(result.success).toBe(true);
    expect(written(writer)).toContain('exo__Asset_label: "Meeting: Q3 review"');
  });

  it("fails loud (no write) when the referenced $input.<key> key is absent", async () => {
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_parent",
      targetValueRef: "$input.parent",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      value: "wrong-key",
    });

    expect(result.success).toBe(false);
    expect(writer.updateFile).not.toHaveBeenCalled();
    expect(result.error).toMatch(/input|placeholder/i);
  });

  it("still resolves the anonymous $input slot to userInput.value (backward compatible)", async () => {
    const grounding = makeGrounding({
      targetProperty: "ems__Effort_result",
      targetValueSubstitution: "$input",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      value: "done",
    });

    expect(result.success).toBe(true);
    expect(written(writer)).toContain("ems__Effort_result: done");
  });

  it("does not clobber resolved free-text that contains a $value substring (single-pass substitution)", async () => {
    // Resolve $input.label to text containing the literal token "$value", AND
    // pass a `value` key too. A naive two-pass substitution would re-scan the
    // inserted text and replace the literal "$value" with userInput.value.
    const grounding = makeGrounding({
      targetProperty: "exo__Asset_label",
      targetValueLiteral: "$input.label",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      label: "Fix $value handling",
      value: "CLOBBERED",
    });

    expect(result.success).toBe(true);
    const out = written(writer);
    expect(out).toContain("Fix $value handling");
    expect(out).not.toContain("CLOBBERED");
  });

  it("does not false-reject a label that resolves to $input free-text (gate checks the template)", async () => {
    // Template references $input.label which IS provided; the resolved value
    // contains "$input" free-text. Gate must NOT reject (it checks the template).
    const grounding = makeGrounding({
      targetProperty: "exo__Asset_label",
      targetValueLiteral: "$input.label",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
      label: "About $input substitution",
    });

    expect(result.success).toBe(true);
    expect(written(writer)).toContain("About $input substitution");
  });
});
