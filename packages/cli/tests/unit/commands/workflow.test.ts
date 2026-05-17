import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { Command } from "commander";

// Mock fs module
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockExistsSync = jest.fn();

jest.unstable_mockModule("fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
}));

// Mock exocortex
const mockValidate = jest.fn();
jest.unstable_mockModule("exocortex", () => ({
  FrontmatterService: jest.fn(() => ({
    parse: jest.fn((content) => {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { exists: false, content: "", originalContent: content };
      return { exists: true, content: match[1], originalContent: content };
    }),
  })),
  // Minimal stub matching the public WikiLinkHelpers.resolveSymbolic shape.
  // Real impl is exercised by `packages/exocortex/tests/utilities/WikiLinkHelpers.test.ts`;
  // here we only need a passthrough that returns the canonical alias / target
  // so the workflow class-name substring discriminator runs against symbolic
  // strings, not UUIDs.
  WikiLinkHelpers: {
    resolveSymbolic: (value, resolver) => {
      if (typeof value !== "string") return "";
      const stripped = value.replace(/^\[\[|\]\]$/g, "").trim();
      if (!stripped) return "";
      const pipeIdx = stripped.indexOf("|");
      if (pipeIdx !== -1) {
        const target = stripped.substring(0, pipeIdx);
        const alias = stripped.substring(pipeIdx + 1);
        return alias || target;
      }
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidPattern.test(stripped)) {
        const resolved = resolver(stripped);
        return resolved && resolved.length > 0 ? resolved : stripped;
      }
      return stripped;
    },
  },
  WorkflowEngine: jest.fn(() => ({
    validate: mockValidate,
  })),
  AssetClass: {
    TASK: "ems__Task",
    PROJECT: "ems__Project",
    WORKFLOW: "ems__Workflow",
  },
  EffortStatus: {
    DRAFT: "ems__EffortStatusDraft",
    BACKLOG: "ems__EffortStatusBacklog",
    DOING: "ems__EffortStatusDoing",
    DONE: "ems__EffortStatusDone",
    TRASHED: "ems__EffortStatusTrashed",
  },
}));

const { workflowCommand } = await import("../../../src/commands/workflow.js");

/**
 * Issue #2365: Tests for workflow CLI command registration and behavior
 */
describe("Issue #2365: workflow command", () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue("");
    mockValidate.mockReturnValue({ valid: true, errors: [] });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe("command registration", () => {
    it("should create a command with name 'workflow'", () => {
      const cmd = workflowCommand();
      expect(cmd).toBeInstanceOf(Command);
      expect(cmd.name()).toBe("workflow");
    });

    it("should have a description", () => {
      const cmd = workflowCommand();
      expect(cmd.description()).toBeTruthy();
    });

    it("should register 'list' subcommand", () => {
      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");
      expect(listCmd).toBeDefined();
      expect(listCmd.description()).toBeTruthy();
    });

    it("should register 'show' subcommand", () => {
      const cmd = workflowCommand();
      const showCmd = cmd.commands.find((c) => c.name() === "show");
      expect(showCmd).toBeDefined();
    });

    it("should register 'validate' subcommand", () => {
      const cmd = workflowCommand();
      const validateCmd = cmd.commands.find((c) => c.name() === "validate");
      expect(validateCmd).toBeDefined();
    });

    it("should have 3 subcommands total", () => {
      const cmd = workflowCommand();
      expect(cmd.commands).toHaveLength(3);
    });

    it("list subcommand should have --vault option with default", () => {
      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");
      const vaultOpt = listCmd.options.find((o) => o.long === "--vault");
      expect(vaultOpt).toBeDefined();
      expect(vaultOpt.defaultValue).toBeDefined();
    });

    it("list subcommand should have --output option with default 'text'", () => {
      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");
      const outputOpt = listCmd.options.find((o) => o.long === "--output");
      expect(outputOpt).toBeDefined();
      expect(outputOpt.defaultValue).toBe("text");
    });

    it("show subcommand should accept uid argument", () => {
      const cmd = workflowCommand();
      const showCmd = cmd.commands.find((c) => c.name() === "show");
      expect(showCmd.registeredArguments).toBeDefined();
      expect(showCmd.registeredArguments.length).toBeGreaterThan(0);
    });

    it("validate subcommand should accept uid argument", () => {
      const cmd = workflowCommand();
      const validateCmd = cmd.commands.find((c) => c.name() === "validate");
      expect(validateCmd.registeredArguments).toBeDefined();
      expect(validateCmd.registeredArguments.length).toBeGreaterThan(0);
    });
  });

  describe("list execution", () => {
    it("should print 'No workflows found' for empty vault", async () => {
      mockReaddirSync.mockReturnValue([]);

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith("No workflows found in vault.");
    });

    it("should print table when workflows exist", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [
            { name: "workflow.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockReturnValue(
        "---\nexo__Instance_class: ems__Workflow\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Task Workflow\nems__Workflow_targetClass: ems__Task\nems__Workflow_isDefault: true\n---\n"
      );

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found 1 workflow(s)")
      );
    });

    it("should output JSON when --output json is specified", async () => {
      mockReaddirSync.mockReturnValue([]);

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault", "--output", "json"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"totalWorkflows"')
      );
    });

    it("should classify workflow classes stored in UID-canon form (RFC-004)", async () => {
      // After `strip-aliases.py` Phase 3 (2026-05-16), `exo__Instance_class`
      // stores bare `[[<uuid>]]` instead of `[[<uuid>|ems__Workflow]]` or
      // `ems__Workflow`. The substring discriminator must resolve UUIDs to
      // labels via the prebuilt UID→label map before checking
      // `.includes("ems__Workflow")` etc.
      const workflowClassUid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const stateClassUid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const transitionClassUid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const workflowInstanceUid = "wf-uid-uidcanon";

      mockReaddirSync.mockImplementation((dir) => {
        if (dir.includes("test-vault")) {
          return [
            { name: `${workflowClassUid}.md`, isDirectory: () => false },
            { name: `${stateClassUid}.md`, isDirectory: () => false },
            { name: `${transitionClassUid}.md`, isDirectory: () => false },
            { name: "wf-instance.md", isDirectory: () => false },
            { name: "state-inst.md", isDirectory: () => false },
            { name: "trans-inst.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      const fileContents = {
        // TBox class files — provide UID → label so the resolver works.
        [`${workflowClassUid}.md`]: [
          "---",
          `exo__Asset_uid: ${workflowClassUid}`,
          "exo__Asset_label: ems__Workflow",
          "---",
        ].join("\n"),
        [`${stateClassUid}.md`]: [
          "---",
          `exo__Asset_uid: ${stateClassUid}`,
          "exo__Asset_label: ems__WorkflowState",
          "---",
        ].join("\n"),
        [`${transitionClassUid}.md`]: [
          "---",
          `exo__Asset_uid: ${transitionClassUid}`,
          "exo__Asset_label: ems__WorkflowTransition",
          "---",
        ].join("\n"),
        // ABox instances — `exo__Instance_class` is the UID-canon form.
        "wf-instance.md": [
          "---",
          `exo__Instance_class: \"[[${workflowClassUid}]]\"`,
          `exo__Asset_uid: ${workflowInstanceUid}`,
          "exo__Asset_label: My Workflow",
          "ems__Workflow_targetClass: ems__Task",
          "---",
        ].join("\n"),
        "state-inst.md": [
          "---",
          `exo__Instance_class: \"[[${stateClassUid}]]\"`,
          `ems__WorkflowState_workflow: \"[[${workflowInstanceUid}]]\"`,
          "---",
        ].join("\n"),
        "trans-inst.md": [
          "---",
          `exo__Instance_class: \"[[${transitionClassUid}]]\"`,
          `ems__WorkflowTransition_workflow: \"[[${workflowInstanceUid}]]\"`,
          "---",
        ].join("\n"),
      };

      mockReadFileSync.mockImplementation((filePath) => {
        for (const [name, content] of Object.entries(fileContents)) {
          if (filePath.endsWith(name)) return content;
        }
        return "";
      });

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(
        ["node", "test", "--vault", "/tmp/test-vault", "--output", "json"],
        { from: "node" },
      );

      const jsonOutput = consoleLogSpy.mock.calls.find((call) =>
        call[0]?.includes?.("totalWorkflows"),
      );
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput[0]);
      // Pre-fix: zero workflows because `[[<uuid>]]` did not match
      // `.includes("ems__Workflow")`. Post-fix: resolved via labelByUid.
      expect(parsed.data.totalWorkflows).toBe(1);
      expect(parsed.data.workflows[0].uid).toBe(workflowInstanceUid);
      expect(parsed.data.workflows[0].stateCount).toBe(1);
      expect(parsed.data.workflows[0].transitionCount).toBe(1);
    });

    it("should count linked states and transitions for a workflow", async () => {
      const workflowUid = "wf-uid-001";
      const files = [
        { name: "workflow.md", isDirectory: () => false },
        { name: "state1.md", isDirectory: () => false },
        { name: "state2.md", isDirectory: () => false },
        { name: "transition1.md", isDirectory: () => false },
      ];

      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) return files;
        return [];
      });

      const fileContents = {
        "workflow.md": [
          "---",
          "exo__Instance_class: ems__Workflow",
          `exo__Asset_uid: ${workflowUid}`,
          "exo__Asset_label: Counted Workflow",
          "ems__Workflow_targetClass: ems__Task",
          "ems__Workflow_isDefault: false",
          "---",
        ].join("\n"),
        "state1.md": [
          "---",
          "exo__Instance_class: ems__WorkflowState",
          `ems__WorkflowState_workflow: \"[[${workflowUid}]]\"`,
          "---",
        ].join("\n"),
        "state2.md": [
          "---",
          "exo__Instance_class: ems__WorkflowState",
          `ems__WorkflowState_workflow: \"[[${workflowUid}]]\"`,
          "---",
        ].join("\n"),
        "transition1.md": [
          "---",
          "exo__Instance_class: ems__WorkflowTransition",
          `ems__WorkflowTransition_workflow: \"[[${workflowUid}]]\"`,
          "---",
        ].join("\n"),
      };

      mockReadFileSync.mockImplementation((filePath) => {
        for (const [name, content] of Object.entries(fileContents)) {
          if (filePath.endsWith(name)) return content;
        }
        return "";
      });

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault", "--output", "json"], { from: "node" });

      const jsonOutput = consoleLogSpy.mock.calls.find((call) =>
        call[0]?.includes?.("stateCount")
      );
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput[0]);
      expect(parsed.data.workflows[0].stateCount).toBe(2);
      expect(parsed.data.workflows[0].transitionCount).toBe(1);
    });

    it("should show 0 counts when workflow has no linked states or transitions", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [{ name: "lonely-workflow.md", isDirectory: () => false }];
        }
        return [];
      });

      mockReadFileSync.mockReturnValue(
        "---\nexo__Instance_class: ems__Workflow\nexo__Asset_uid: lonely-uid\nexo__Asset_label: Lonely Workflow\nems__Workflow_targetClass: ems__Task\nems__Workflow_isDefault: false\n---\n"
      );

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault", "--output", "json"], { from: "node" });

      const jsonOutput = consoleLogSpy.mock.calls.find((call) =>
        call[0]?.includes?.("stateCount")
      );
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput[0]);
      expect(parsed.data.workflows[0].stateCount).toBe(0);
      expect(parsed.data.workflows[0].transitionCount).toBe(0);
    });

    it("should not count state referencing a different workflow UID", async () => {
      const workflowUid = "wf-uid-target";
      const otherUid = "wf-uid-other";

      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [
            { name: "workflow.md", isDirectory: () => false },
            { name: "state-wrong-ref.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      const fileContents = {
        "workflow.md": [
          "---",
          "exo__Instance_class: ems__Workflow",
          `exo__Asset_uid: ${workflowUid}`,
          "exo__Asset_label: Target Workflow",
          "ems__Workflow_targetClass: ems__Task",
          "ems__Workflow_isDefault: false",
          "---",
        ].join("\n"),
        "state-wrong-ref.md": [
          "---",
          "exo__Instance_class: ems__WorkflowState",
          `ems__WorkflowState_workflow: \"[[${otherUid}]]\"`,
          "---",
        ].join("\n"),
      };

      mockReadFileSync.mockImplementation((filePath) => {
        for (const [name, content] of Object.entries(fileContents)) {
          if (filePath.endsWith(name)) return content;
        }
        return "";
      });

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault", "--output", "json"], { from: "node" });

      const jsonOutput = consoleLogSpy.mock.calls.find((call) =>
        call[0]?.includes?.("stateCount")
      );
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput[0]);
      expect(parsed.data.workflows[0].stateCount).toBe(0);
    });

    it("should default targetClass to ems__Task when ems__Workflow_targetClass is absent", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [{ name: "no-target.md", isDirectory: () => false }];
        }
        return [];
      });

      mockReadFileSync.mockReturnValue(
        "---\nexo__Instance_class: ems__Workflow\nexo__Asset_uid: no-target-uid\nexo__Asset_label: No Target Workflow\nems__Workflow_isDefault: false\n---\n"
      );

      const cmd = workflowCommand();
      const listCmd = cmd.commands.find((c) => c.name() === "list");

      await listCmd.parseAsync(["node", "test", "--vault", "/tmp/test-vault", "--output", "json"], { from: "node" });

      const jsonOutput = consoleLogSpy.mock.calls.find((call) =>
        call[0]?.includes?.("targetClass")
      );
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput[0]);
      expect(parsed.data.workflows[0].targetClass).toBe("ems__Task");
    });
  });

  describe("show execution", () => {
    it("should print 'not found' for unknown UID", async () => {
      mockReaddirSync.mockReturnValue([]);

      const cmd = workflowCommand();
      const showCmd = cmd.commands.find((c) => c.name() === "show");

      await showCmd.parseAsync(["node", "test", "nonexistent-uid", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });

    it("should print workflow details for valid UID", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [
            { name: "workflow.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      const workflowContent = [
        "---",
        "exo__Instance_class: ems__Workflow",
        "exo__Asset_uid: found-uid-456",
        "exo__Asset_label: My Workflow",
        "ems__Workflow_targetClass: ems__Task",
        "ems__Workflow_initialState: ems__EffortStatusDraft",
        "ems__Workflow_isDefault: true",
        "ems__Workflow_terminalStates:",
        "  - ems__EffortStatusDone",
        "  - ems__EffortStatusTrashed",
        "ems__Workflow_states:",
        "  - ems__EffortStatusDraft",
        "  - ems__EffortStatusDoing",
        "  - ems__EffortStatusDone",
        "ems__Workflow_transitions:",
        "---",
        "",
      ].join("\n");

      mockReadFileSync.mockReturnValue(workflowContent);

      const cmd = workflowCommand();
      const showCmd = cmd.commands.find((c) => c.name() === "show");

      await showCmd.parseAsync(["node", "test", "found-uid-456", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("My Workflow")
      );
    });
  });

  describe("validate execution", () => {
    it("should print 'not found' for unknown UID", async () => {
      mockReaddirSync.mockReturnValue([]);

      const cmd = workflowCommand();
      const validateCmd = cmd.commands.find((c) => c.name() === "validate");

      await validateCmd.parseAsync(["node", "test", "nonexistent-uid", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });

    it("should print valid result for correct workflow", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [
            { name: "workflow.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      const workflowContent = [
        "---",
        "exo__Instance_class: ems__Workflow",
        "exo__Asset_uid: valid-uid-789",
        "exo__Asset_label: Valid Workflow",
        "ems__Workflow_targetClass: ems__Task",
        "ems__Workflow_initialState: ems__EffortStatusDraft",
        "ems__Workflow_isDefault: true",
        "ems__Workflow_states:",
        "  - ems__EffortStatusDraft",
        "  - ems__EffortStatusDone",
        "ems__Workflow_transitions:",
        "---",
        "",
      ].join("\n");

      mockReadFileSync.mockReturnValue(workflowContent);
      mockValidate.mockReturnValue({ valid: true, errors: [] });

      const cmd = workflowCommand();
      const validateCmd = cmd.commands.find((c) => c.name() === "validate");

      await validateCmd.parseAsync(["node", "test", "valid-uid-789", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("is valid")
      );
    });

    it("should print errors for invalid workflow", async () => {
      mockReaddirSync.mockImplementation((dir, opts) => {
        if (dir.includes("test-vault")) {
          return [
            { name: "workflow.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      const workflowContent = [
        "---",
        "exo__Instance_class: ems__Workflow",
        "exo__Asset_uid: invalid-uid-000",
        "exo__Asset_label: Bad Workflow",
        "ems__Workflow_targetClass: ems__Task",
        "ems__Workflow_initialState: ems__EffortStatusDraft",
        "ems__Workflow_isDefault: false",
        "ems__Workflow_states:",
        "  - ems__EffortStatusDraft",
        "ems__Workflow_transitions:",
        "---",
        "",
      ].join("\n");

      mockReadFileSync.mockReturnValue(workflowContent);
      mockValidate.mockReturnValue({
        valid: false,
        errors: ["State has no outgoing forward transitions"],
      });

      const cmd = workflowCommand();
      const validateCmd = cmd.commands.find((c) => c.name() === "validate");

      await validateCmd.parseAsync(["node", "test", "invalid-uid-000", "--vault", "/tmp/test-vault"], { from: "node" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("error(s)")
      );
    });
  });
});
