import { jest, describe, it, expect, beforeEach } from "@jest/globals";

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
const mockLoadCommand = jest.fn();
const mockFindBindings = jest.fn();
const mockConvertVault = jest.fn();
const mockAddAll = jest.fn();
const mockEvaluate = jest.fn();
const mockGroundingExecute = jest.fn();

jest.unstable_mockModule("exocortex", () => ({
  FrontmatterService: jest.fn(() => ({
    parse: jest.fn((content) => {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { exists: false, content: "", originalContent: content };
      return { exists: true, content: match[1], originalContent: content };
    }),
  })),
  InMemoryTripleStore: jest.fn(() => ({
    addAll: mockAddAll,
    add: jest.fn(),
    match: jest.fn().mockResolvedValue([]),
  })),
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: mockConvertVault.mockResolvedValue([]),
  })),
  CommandResolver: jest.fn(() => ({
    loadCommand: mockLoadCommand,
    findBindings: mockFindBindings,
    resolveForAsset: jest.fn().mockResolvedValue([]),
  })),
  PreconditionEvaluator: jest.fn(() => ({
    evaluate: mockEvaluate,
  })),
  GroundingExecutor: jest.fn(() => ({
    execute: mockGroundingExecute,
  })),
  ServiceRegistry: jest.fn(() => ({
    register: jest.fn(),
    get: jest.fn(),
    has: jest.fn(),
    getRegisteredIds: jest.fn().mockReturnValue([]),
  })),
  GroundingType: {
    SPARQL_UPDATE: "sparql_update",
    PROPERTY_DELETE: "property_delete",
    PROPERTY_SET: "property_set",
    COMPOSITE: "composite",
    SERVICE_CALL: "service_call",
  },
}));

// Mock adapters
jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(() => ({
    getMarkdownFiles: jest.fn().mockReturnValue([]),
    readFile: jest.fn().mockResolvedValue(""),
  })),
}));

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => ({
    readFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
    fileExists: jest.fn().mockResolvedValue(false),
  })),
}));

// Mock ErrorHandler and ResponseBuilder
jest.unstable_mockModule("../../../src/utils/ErrorHandler.js", () => ({
  ErrorHandler: {
    setFormat: jest.fn(),
    handle: jest.fn(),
  },
}));

jest.unstable_mockModule("../../../src/responses/index.js", () => ({
  ResponseBuilder: {
    success: jest.fn((data) => ({ success: true, data })),
  },
}));

jest.unstable_mockModule("../../../src/utils/errors/index.js", () => ({
  VaultNotFoundError: class VaultNotFoundError extends Error {
    constructor(path) { super(`Vault not found: ${path}`); }
  },
}));

jest.unstable_mockModule("../../../src/utils/ExitCodes.js", () => ({
  ExitCodes: {
    SUCCESS: 0,
    GENERAL_ERROR: 1,
    INVALID_ARGUMENTS: 2,
    FILE_NOT_FOUND: 3,
    OPERATION_FAILED: 5,
  },
}));

// Dynamic import after mocking
let dynamicCommandCommand: any;

beforeEach(async () => {
  jest.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  const mod = await import("../../../src/commands/dynamic-command.js");
  dynamicCommandCommand = mod.dynamicCommandCommand;
});

describe("dynamic-command CLI", () => {
  describe("command structure", () => {
    it("should create dyncommand command group", () => {
      const cmd = dynamicCommandCommand();
      expect(cmd.name()).toBe("dyncommand");
      expect(cmd.description()).toContain("dynamic commands");
    });

    it("should have list subcommand", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "list");
      expect(sub).toBeDefined();
      expect(sub.description()).toContain("List");
    });

    it("should have show subcommand with uid argument", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "show");
      expect(sub).toBeDefined();
      const args = sub.registeredArguments?.map((a: any) => a.name()) ?? [];
      expect(args).toContain("uid");
    });

    it("should have exec subcommand with uid argument", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "exec");
      expect(sub).toBeDefined();
      const args = sub.registeredArguments?.map((a: any) => a.name()) ?? [];
      expect(args).toContain("uid");
    });

    it("should have validate subcommand", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "validate");
      expect(sub).toBeDefined();
      expect(sub.description()).toContain("Validate");
    });

    it("exec should have --dry-run option", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "exec");
      const opts = sub.options.map((o: any) => o.long);
      expect(opts).toContain("--dry-run");
    });

    it("exec should have --target option", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "exec");
      const opts = sub.options.map((o: any) => o.long);
      expect(opts).toContain("--target");
    });

    it("list should have --target option for filtering", () => {
      const cmd = dynamicCommandCommand();
      const sub = cmd.commands.find((c: any) => c.name() === "list");
      const opts = sub.options.map((o: any) => o.long);
      expect(opts).toContain("--target");
    });

    it("all subcommands should have --vault option", () => {
      const cmd = dynamicCommandCommand();
      for (const sub of cmd.commands) {
        const opts = sub.options.map((o: any) => o.long);
        expect(opts).toContain("--vault");
      }
    });

    it("all subcommands should have --output option", () => {
      const cmd = dynamicCommandCommand();
      for (const sub of cmd.commands) {
        const opts = sub.options.map((o: any) => o.long);
        expect(opts).toContain("--output");
      }
    });
  });

  describe("list action with file scanning", () => {
    it("should find commands in vault", async () => {
      // Set up mock vault files
      const commandFm = [
        "exo__Instance_class: exocmd__Command",
        "exo__Asset_uid: cmd-001",
        "exo__Asset_label: Start Task",
        "exocmd__Command_category: status",
        "exocmd__Command_grounding: [[gnd-001]]",
      ].join("\n");

      const groundingFm = [
        "exo__Instance_class: exocmd__Grounding",
        "exo__Asset_uid: gnd-001",
        "exo__Asset_label: Set Start",
        "exocmd__Grounding_type: property_set",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string, opts: any) => {
        if (dir.endsWith("/vault")) {
          return [
            { name: "cmd.md", isDirectory: () => false },
            { name: "gnd.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("cmd.md")) return `---\n${commandFm}\n---\n`;
        if (path.endsWith("gnd.md")) return `---\n${groundingFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const listCmd = cmd.commands.find((c: any) => c.name() === "list");
      await listCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      // Verify output was produced
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("Start Task");

      consoleSpy.mockRestore();
    });

    it("should handle empty vault", async () => {
      mockReaddirSync.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const listCmd = cmd.commands.find((c: any) => c.name() === "list");
      await listCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("No dynamic commands found");

      consoleSpy.mockRestore();
    });
  });

  describe("show action", () => {
    it("should display command details when found", async () => {
      mockLoadCommand.mockResolvedValue({
        id: "cmd-001",
        name: "Start Task",
        icon: "play",
        category: "status",
        precondition: {
          id: "pre-001",
          label: "Has no startTimestamp",
          sparqlAsk: "ASK { $target ems:Effort_startTimestamp ?ts }",
        },
        grounding: {
          id: "gnd-001",
          label: "Set startTimestamp",
          type: "property_set",
          targetProperty: "ems__Effort_startTimestamp",
          targetValue: "$now",
        },
      });
      mockFindBindings.mockResolvedValue([]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const showCmd = cmd.commands.find((c: any) => c.name() === "show");
      await showCmd.parseAsync(["cmd-001", "--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("Start Task");
      expect(output).toContain("property_set");

      consoleSpy.mockRestore();
    });

    it("should show not found message for unknown uid", async () => {
      mockLoadCommand.mockResolvedValue(null);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const showCmd = cmd.commands.find((c: any) => c.name() === "show");
      await showCmd.parseAsync(["nonexistent", "--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("not found");

      consoleSpy.mockRestore();
    });
  });

  describe("validate action with file scanning", () => {
    it("should report missing grounding", async () => {
      const commandFm = [
        "exo__Instance_class: exocmd__Command",
        "exo__Asset_uid: cmd-broken",
        "exo__Asset_label: Broken Command",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [{ name: "broken.md", isDirectory: () => false }];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("broken.md")) return `---\n${commandFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const valCmd = cmd.commands.find((c: any) => c.name() === "validate");
      await valCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("Missing exocmd__Command_grounding");

      consoleSpy.mockRestore();
    });

    it("should report all valid when no issues", async () => {
      // Empty vault = no commands = no issues
      mockReaddirSync.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const valCmd = cmd.commands.find((c: any) => c.name() === "validate");
      await valCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("valid");

      consoleSpy.mockRestore();
    });
  });
});
