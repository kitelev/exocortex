import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock the executor
const mockExecutor = {
  executeRenameToUid: jest.fn(),
  executeUpdateLabel: jest.fn(),
  executeStart: jest.fn(),
  executeComplete: jest.fn(),
  executeTrash: jest.fn(),
  executeArchive: jest.fn(),
  executeMoveToBacklog: jest.fn(),
  executeMoveToAnalysis: jest.fn(),
  executeMoveToToDo: jest.fn(),
  executeCreateTask: jest.fn(),
  executeCreateMeeting: jest.fn(),
  executeCreateProject: jest.fn(),
  executeCreateArea: jest.fn(),
  executeSchedule: jest.fn(),
  executeSetDeadline: jest.fn(),
  execute: jest.fn(),
};

jest.unstable_mockModule("../../../src/executors/CommandExecutor.js", () => ({
  CommandExecutor: jest.fn(() => mockExecutor),
}));

const { commandCommand } = await import("../../../src/commands/command.js");

describe("commandCommand", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let processCwdSpy: jest.SpiedFunction<typeof process.cwd>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    processCwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/default/vault");

    // Reset all mock executor methods
    Object.values(mockExecutor).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = commandCommand();
      expect(cmd.name()).toBe("command");
    });

    it("should have correct description", () => {
      const cmd = commandCommand();
      expect(cmd.description()).toBe("Execute plugin command on single asset");
    });

    it("should define required arguments", () => {
      const cmd = commandCommand();
      // Command should have command-name and filepath arguments
      expect(cmd.registeredArguments).toHaveLength(2);
    });
  });

  describe("rename-to-uid command", () => {
    it("should execute rename-to-uid", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "rename-to-uid", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeRenameToUid).toHaveBeenCalledWith("task.md");
    });
  });

  describe("update-label command", () => {
    it("should execute update-label with label", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "update-label", "task.md", "--vault", "/test/vault", "--label", "New Label"]);

      expect(mockExecutor.executeUpdateLabel).toHaveBeenCalledWith("task.md", "New Label");
    });

    it("should error when label is missing", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "update-label", "task.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--label option is required"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("status transition commands", () => {
    it("should execute start", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "start", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeStart).toHaveBeenCalledWith("task.md");
    });

    it("should print deprecation warning when start is invoked (T7.2)", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "start", "task.md", "--vault", "/test/vault"]);

      const deprecationCalls = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && (call[0] as string).includes("DEPRECATED"),
      );
      expect(deprecationCalls.length).toBeGreaterThan(0);
      const warning = deprecationCalls[0][0] as string;
      expect(warning).toContain("dyncommand exec");
      expect(warning).toContain("command start");
      // Backward-compat: executor still invoked
      expect(mockExecutor.executeStart).toHaveBeenCalledWith("task.md");
    });

    it("should NOT print deprecation warning for non-start commands (T7.2)", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "complete", "task.md", "--vault", "/test/vault"]);

      const deprecationCalls = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && (call[0] as string).includes("DEPRECATED"),
      );
      expect(deprecationCalls).toHaveLength(0);
    });

    it("should execute complete", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "complete", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeComplete).toHaveBeenCalledWith("task.md");
    });

    it("should execute trash", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "trash", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeTrash).toHaveBeenCalledWith("task.md");
    });

    it("should execute archive", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "archive", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeArchive).toHaveBeenCalledWith("task.md");
    });

    it("should execute move-to-backlog", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "move-to-backlog", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeMoveToBacklog).toHaveBeenCalledWith("task.md");
    });

    it("should execute move-to-analysis", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "move-to-analysis", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeMoveToAnalysis).toHaveBeenCalledWith("task.md");
    });

    it("should execute move-to-todo", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "move-to-todo", "task.md", "--vault", "/test/vault"]);

      expect(mockExecutor.executeMoveToToDo).toHaveBeenCalledWith("task.md");
    });
  });

  describe("creation commands", () => {
    it("should execute create-task with all options", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "create-task", "task.md",
        "--vault", "/test/vault",
        "--label", "My Task",
        "--prototype", "proto-123",
        "--area", "area-456",
        "--parent", "parent-789",
      ]);

      expect(mockExecutor.executeCreateTask).toHaveBeenCalledWith("task.md", "My Task", {
        prototype: "proto-123",
        area: "area-456",
        parent: "parent-789",
      });
    });

    it("should error when create-task without label", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "create-task", "task.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--label option is required for create-task"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should execute create-meeting with all options", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "create-meeting", "meeting.md",
        "--vault", "/test/vault",
        "--label", "Team Sync",
        "--prototype", "meeting-proto",
        "--area", "area-123",
        "--parent", "parent-456",
      ]);

      expect(mockExecutor.executeCreateMeeting).toHaveBeenCalledWith("meeting.md", "Team Sync", {
        prototype: "meeting-proto",
        area: "area-123",
        parent: "parent-456",
      });
    });

    it("should error when create-meeting without label", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "create-meeting", "meeting.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--label option is required for create-meeting"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should execute create-project with all options", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "create-project", "project.md",
        "--vault", "/test/vault",
        "--label", "Website Redesign",
        "--prototype", "project-proto",
        "--area", "engineering",
        "--parent", "parent-project",
      ]);

      expect(mockExecutor.executeCreateProject).toHaveBeenCalledWith("project.md", "Website Redesign", {
        prototype: "project-proto",
        area: "engineering",
        parent: "parent-project",
      });
    });

    it("should error when create-project without label", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "create-project", "project.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--label option is required for create-project"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should execute create-area with all options", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "create-area", "area.md",
        "--vault", "/test/vault",
        "--label", "Engineering",
        "--prototype", "area-proto",
        "--area", "top-area",
        "--parent", "parent-area",
      ]);

      expect(mockExecutor.executeCreateArea).toHaveBeenCalledWith("area.md", "Engineering", {
        prototype: "area-proto",
        area: "top-area",
        parent: "parent-area",
      });
    });

    it("should error when create-area without label", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "create-area", "area.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--label option is required for create-area"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("planning commands", () => {
    it("should execute schedule with date", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "schedule", "task.md",
        "--vault", "/test/vault",
        "--date", "2025-12-01",
      ]);

      expect(mockExecutor.executeSchedule).toHaveBeenCalledWith("task.md", "2025-12-01");
    });

    it("should error when schedule without date", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "schedule", "task.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--date option is required for schedule"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should execute set-deadline with date", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "set-deadline", "task.md",
        "--vault", "/test/vault",
        "--date", "2025-12-31",
      ]);

      expect(mockExecutor.executeSetDeadline).toHaveBeenCalledWith("task.md", "2025-12-31");
    });

    it("should error when set-deadline without date", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "set-deadline", "task.md", "--vault", "/test/vault"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--date option is required for set-deadline"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("generic command fallback", () => {
    it("should use generic execute for unknown commands", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "unknown-command", "file.md",
        "--vault", "/test/vault",
      ]);

      expect(mockExecutor.execute).toHaveBeenCalledWith("unknown-command", "file.md", expect.any(Object));
    });
  });

  describe("vault path handling", () => {
    it("should use current directory as default vault", async () => {
      processCwdSpy.mockReturnValue("/current/directory");

      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "start", "task.md"]);

      // CommandExecutor should be called with resolved path
      expect(mockExecutor.executeStart).toHaveBeenCalled();
    });

    it("should resolve relative vault path", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync(["node", "test", "start", "task.md", "--vault", "./my-vault"]);

      expect(mockExecutor.executeStart).toHaveBeenCalled();
    });
  });

  describe("dry-run option", () => {
    it("should pass dry-run flag to executor", async () => {
      const cmd = commandCommand();
      await cmd.parseAsync([
        "node", "test", "start", "task.md",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Verify CommandExecutor was created with dry-run flag
      // The executor's methods should still be called
      expect(mockExecutor.executeStart).toHaveBeenCalled();
    });
  });
});
