import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
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
        targetValue: "Done",
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
        targetValue: "$now",
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
        targetValue: "$today",
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
        targetValue: "$target",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const writtenContent = writer.updateFile.mock.calls[0][1];
      expect(writtenContent).toContain("linked_from: " + TARGET_IRI);
    });

    it("should fail when targetProperty is missing", async () => {
      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetValue: "value",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetProperty");
    });

    it("should fail when targetValue is undefined", async () => {
      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "prop",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("targetValue");
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
            targetValue: "Doing",
          }),
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            targetProperty: "ems__Effort_startTimestamp",
            targetValue: "$now",
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
            targetValue: "Doing",
          }),
          makeGrounding({
            type: GroundingType.PROPERTY_SET,
            // Missing targetProperty → will fail
            targetValue: "broken",
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
        targetValue: "bar",
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
        targetValue: '{"property":"ems__Effort_parent"}',
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
        targetValue: '{"direction":"forward","extra":"default"}',
      });

      const userInput = { direction: "backward" };
      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, userInput);

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledWith(TARGET_IRI, {
        direction: "backward",
        extra: "default",
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
        targetValue: "plain-string-not-json",
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
        targetValue: '{"prototype":"$target"}',
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
        targetValue: '{"prototype":"$target","folder":"03 Knowledge/inbox"}',
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
        targetValue: '{"plannedStartDate":"$today"}',
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
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
        targetValue: '{"direction":"forward"}',
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
      expect(content).toContain("proto-uuid-123");
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

    it("should work without targetPrototype", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "No proto" });

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain("exo__Asset_label: No proto");
      expect(content).not.toContain("exo__Asset_prototype");
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

    it("should include exo__Asset_source linking to target asset", async () => {
      const grounding = makeGrounding({
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const [, content] = writer.createFile.mock.calls[0];
      expect(content).toContain(`"[[${TARGET_IRI}]]"`);
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
      expect(content).toContain("proto-daily-review-uuid");
      expect(content).toContain(`"[[${TARGET_IRI}]]"`);

      // Verify UUID in path matches UUID in frontmatter
      const pathUuid = path.split("/").pop()?.replace(".md", "");
      expect(content).toContain(`exo__Asset_uid: ${pathUuid}`);
    });

    // -- Task 2.4: copy-from-target + configurable back-link --

    describe("copy-from-target + linkBackProperty (Task 2.4)", () => {
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

      it("copies $target frontmatter into new asset (blacklist respected)", async () => {
        reader.readFile.mockResolvedValue(TARGET_FM);

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, { label: "Sub-task" });

        const [, content] = writer.createFile.mock.calls[0];
        // Inherited non-blacklisted properties
        expect(content).toContain('ems__Effort_area: "[[area-uid-42]]"');
        expect(content).toContain('ems__Effort_priority: "[[priority-high]]"');
        expect(content).toContain('"[[tag-alpha]]"');
        expect(content).toContain('"[[tag-beta]]"');
        // Blacklisted — must NOT leak
        expect(content).not.toContain("src-uid");
        expect(content).not.toContain("Source asset");
        expect(content).not.toContain("Old alias");
        expect(content).not.toMatch(/exo__Instance_class:[\s\S]*ems__Project/);
        expect(content).not.toContain("ems__EffortStatusDoing");
        expect(content).not.toContain("ems__Effort_startTimestamp:");
      });

      it("re-quotes wikilink values copied from $target", async () => {
        reader.readFile.mockResolvedValue(
          '---\nems__Effort_area: "[[area-uid-42]]"\nems__Effort_unquoted: [[bare-link]]\n---\n',
        );

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain('ems__Effort_area: "[[area-uid-42]]"');
        expect(content).toContain('ems__Effort_unquoted: "[[bare-link]]"');
      });

      it("does not overwrite properties already set via userInput", async () => {
        reader.readFile.mockResolvedValue(
          '---\nems__Effort_area: "[[area-from-target]]"\n---\n',
        );

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "X",
          ems__Effort_area: '"[[area-from-user]]"',
        });

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain('ems__Effort_area: "[[area-from-user]]"');
        expect(content).not.toContain("area-from-target");
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
        expect(content).toContain(`ems__Effort_parent: "[[${TARGET_IRI}]]"`);
        expect(content).not.toContain("exo__Asset_source:");
      });

      it("falls back to exo__Asset_source when linkBackProperty is absent", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\n");

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
        });

        await executor.execute(grounding, TARGET_IRI, FILE_PATH);

        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(`exo__Asset_source: "[[${TARGET_IRI}]]"`);
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
        expect(content).toContain(`ems__Effort_prevIteration: "[[${TARGET_IRI}]]"`);
        expect(content).not.toContain("exo__Asset_source:");
        expect(content).not.toContain("[[ems__Effort_prevIteration]]:");
      });

      it("returns descriptive error when $target file is missing", async () => {
        reader.readFile.mockRejectedValue(new Error("ENOENT: no such file"));

        const grounding = makeGrounding({
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "01 Inbox",
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

    // Task 4.4 — regression suite for Phase 2 changes (RFC v0.2 copy-from-target +
    // configurable linkBackProperty). Guarantees existing vault groundings authored
    // before RFC v0.2 (e.g. `e01b025b` "Create MeetingPrototype instance",
    // `adc73790`, `3da98088`, `00a6a887`, `a6ef8fda`) keep emitting
    // `exo__Asset_source` and that the no-$target path does NOT introduce a phantom
    // fallback link.
    describe("Phase 2 regression: existing groundings unchanged (Task 4.4)", () => {
      // Fixture mirrors vault grounding `e01b025b-d03f-4028-b4c8-45d3786ff43d`
      // ("Create MeetingPrototype instance") — pre-RFC v0.2 shape: targetClass +
      // targetPrototype + targetFolder, no linkBackProperty.
      const LEGACY_MEETING_GROUNDING = {
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Meeting",
        targetPrototype: "7ab483c7-aafc-4ac8-8aca-0de52db34a93|ems__MeetingPrototype",
        targetFolder: "03 Knowledge/inbox",
      } as const;

      it("legacy grounding (no linkBackProperty) emits exo__Asset_source as before", async () => {
        reader.readFile.mockResolvedValue("---\nfoo: bar\n---\nBody");

        const grounding = makeGrounding({ ...LEGACY_MEETING_GROUNDING });

        const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
          label: "Weekly sync",
        });

        expect(result.success).toBe(true);
        const [, content] = writer.createFile.mock.calls[0];
        expect(content).toContain(`exo__Asset_source: "[[${TARGET_IRI}]]"`);
        expect(content).not.toMatch(/ems__Effort_parent: "\[\[https/);
        expect(content).not.toMatch(/ems__Effort_prevIteration:/);
      });

      it("legacy grounding with targetClass only (no prototype, no linkBackProperty) preserves behavior", async () => {
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
        expect(content).toContain(`exo__Asset_source: "[[${TARGET_IRI}]]"`);
        expect(content).not.toContain("exo__Asset_prototype:");
      });

      it("legacy grounding without $target (empty targetIRI) does NOT emit any back-link", async () => {
        // Pre-RFC v0.2 behavior — when targetIRI is falsy, no link is written.
        // RFC v0.2 must preserve this: must not introduce a phantom
        // `exo__Asset_source: "[[]]"` or write linkBackProperty with empty value.
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
        expect(content).not.toMatch(/"\[\[\]\]"/);
      });

      it("legacy grounding with linkBackProperty=undefined writes exo__Asset_source (no fallback drift)", async () => {
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
        expect(content).toContain(`exo__Asset_source: "[[${TARGET_IRI}]]"`);
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
      targetValue: "$input",
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
      targetValue: "$value",
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
      targetValue: "$input",
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
        targetValue: placeholder,
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
      targetValue: "ems__Task",
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
      targetValue: "ems__Task",
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
        targetValue: "ems__Task",
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
        targetValue: "ems__Task",
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
        targetValue: "ems__Project",
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
        targetValue: "ems__Project",
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

    it("also non-regresses when targetValue is a non-class-flip string", async () => {
      // Defensive: even if a future grounding supplies a targetValue that is
      // neither "ems__Task" nor "ems__Project", dispatch must still reach
      // the registered service (not short-circuit).
      const mockService = { execute: jest.fn().mockResolvedValue(undefined) };
      registry.register("updateProperty", mockService);

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: "some-other-value",
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

  describe("Wrapped wikilink targetValue (real vault shape — Finding 5 follow-up)", () => {
    // Background: CommandResolver.getObsidianWikilinkValue returns a Literal
    // string as-is ("ems__Task") OR wraps an IRI back into wikilink form
    // ("[[ems__Task]]" with literal quotes). The vault grounding abdbdf09
    // stores targetValue as `ems__Task` in YAML, but depending on how the
    // Turtle parser resolves it in the triple store, the parsed
    // GroundingDefinition.targetValue may arrive as `"[[ems__Task]]"` instead
    // of the plain `ems__Task` string. v15.105.5 shipped the composite
    // short-circuit checking only the plain string — live UI confirmed the
    // wrapped form is what reaches the executor in production, so the
    // Convert to Task button still failed with "updateProperty requires
    // userInput.property". This suite locks in both shapes.

    beforeEach(() => {
      reader = createConvertReader("ems__Project");
      writer = createWriter();
      registry = new ServiceRegistry();
      executor = new GroundingExecutor(reader, writer, registry);
    });

    it("flips class to ems__Task when targetValue is wrapped as \"[[ems__Task]]\"", async () => {
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: '"[[ems__Task]]"',
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
      expect(written).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
      expect(written).not.toMatch(/exo__Instance_class:[\s\S]*?ems__Project/);
    });

    it("flips class to ems__Task when targetValue is unquoted [[ems__Task]]", async () => {
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: "[[ems__Task]]",
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

    it("flips class to ems__Project when targetValue is wrapped as \"[[ems__Project]]\"", async () => {
      const projectReader = createConvertReader("ems__Task");
      const projectWriter = createWriter();
      const projectExec = new GroundingExecutor(
        projectReader,
        projectWriter,
        new ServiceRegistry(),
      );

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: '"[[ems__Project]]"',
      });

      const result = await projectExec.execute(
        grounding,
        TARGET_IRI,
        FILE_PATH,
        undefined,
      );

      expect(result.success).toBe(true);
      const written = projectWriter.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /exo__Instance_class:\s*\[?\s*"\[\[ems__Project\]\]"/,
      );
    });

    it("handles wikilink with alias \"[[ems__Task|Task]]\" — extracts ems__Task target", async () => {
      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: '"[[ems__Task|Task]]"',
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

    it("does NOT short-circuit when targetValue wraps an unrelated class", async () => {
      // Defensive: a wrapped wikilink that is NOT ems__Task/ems__Project
      // must still reach the registered service (via the extractor returning
      // the inner token, which fails both matches).
      const mockService = { execute: jest.fn().mockResolvedValue(undefined) };
      registry.register("updateProperty", mockService);

      const grounding = makeSvcCall({
        targetProperty: "updateProperty",
        targetValue: '"[[some__OtherClass]]"',
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH, {
        property: "x",
        value: "y",
      });

      expect(result.success).toBe(true);
      expect(mockService.execute).toHaveBeenCalledTimes(1);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });
  });
});
