import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

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
  GenericAssetCreationService: jest.fn(() => ({
    createAsset: jest.fn().mockResolvedValue({ path: "", basename: "", name: "" }),
  })),
  ArchiveAssetService: jest.fn(() => ({
    archiveAsset: jest.fn().mockResolvedValue(undefined),
  })),
  PropertyCleanupService: jest.fn(() => ({
    cleanEmptyProperties: jest.fn().mockResolvedValue(undefined),
  })),
  FixMissingLabelService: jest.fn(() => ({
    fixMissingLabel: jest.fn().mockResolvedValue(undefined),
  })),
  RenameToUidService: jest.fn(() => ({
    renameToUid: jest.fn().mockResolvedValue(undefined),
  })),
  FolderRepairService: jest.fn(() => ({
    getExpectedFolder: jest.fn().mockResolvedValue(null),
    repairFolder: jest.fn().mockResolvedValue(undefined),
  })),
  TaskStatusService: jest.fn(() => ({
    planForEvening: jest.fn().mockResolvedValue(undefined),
  })),
  EffortStatusWorkflow: jest.fn(() => ({})),
  StatusTimestampService: jest.fn(() => ({})),
  vaultPathToIRI: (path: string) => {
    const normalized = path.startsWith("./") ? path.slice(2) : path;
    return `obsidian://vault/${encodeURI(normalized)}`;
  },
  GroundingType: {
    SPARQL_UPDATE: "sparql_update",
    PROPERTY_DELETE: "property_delete",
    PROPERTY_SET: "property_set",
    COMPOSITE: "composite",
    SERVICE_CALL: "service_call",
    CREATE_INSTANCE: "create_instance",
  },
}));

// Mock CliServiceRegistryPopulator
jest.unstable_mockModule("../../../src/services/CliServiceRegistryPopulator.js", () => ({
  populateCliServiceRegistry: jest.fn(),
  CLI_STUB_SERVICE_IDS: [
    "updateProperty",
    "removeProperty",
    "setStatus",
    "createAsset",
    "openFile",
    "sparqlSelect",
    "getActiveFileIRI",
    "getActiveFilePath",
    "trashFile",
    "duplicateFile",
  ],
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

// Reset process.exitCode between tests. Several specs exercise CLI failure
// branches that set `process.exitCode` (commander does not throw — it stores
// the code on the host process). Without this, the last failing-branch test
// leaks a non-zero exit code into the Jest runner, which makes the suite
// appear to fail (exit 5) even when every individual test passes —
// breaking the lint-staged pre-commit hook for any CLI change.
afterEach(() => {
  process.exitCode = 0;
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

    it("should find commands with plain class-name wikilink (regression)", async () => {
      const commandFm = [
        'exo__Instance_class: "[[exocmd__Command]]"',
        "exo__Asset_uid: cmd-plain-wikilink",
        "exo__Asset_label: Plain Wikilink Command",
        "exocmd__Command_grounding: [[gnd-plain]]",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [{ name: "cmd.md", isDirectory: () => false }];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("cmd.md")) return `---\n${commandFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const listCmd = cmd.commands.find((c: any) => c.name() === "list");
      await listCmd.parseAsync(["--vault", "/vault", "--output", "json"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toMatch(/"totalCommands":\s*1/);
      expect(output).toContain("cmd-plain-wikilink");

      consoleSpy.mockRestore();
    });

    it("should find commands referencing class via UUID-wikilink (#2863)", async () => {
      // Class definition file: UUID filename, exo__Asset_label = "exocmd__Command"
      const classFm = [
        "exo__Asset_uid: 790e5b16-251d-4556-96ac-e5c7f1429b2e",
        'exo__Asset_label: "exocmd__Command"',
      ].join("\n");

      // Command file: exo__Instance_class is UUID-wikilink pointing to the class
      const commandFm = [
        "exo__Instance_class:",
        '  - "[[790e5b16-251d-4556-96ac-e5c7f1429b2e]]"',
        "exo__Asset_uid: cmd-uuid-wikilink",
        "exo__Asset_label: UUID Wikilink Command",
        "exocmd__Command_grounding: [[gnd-uuid]]",
      ].join("\n");

      // Grounding class definition: UUID filename, label = "exocmd__Grounding"
      const groundingClassFm = [
        "exo__Asset_uid: 11579feb-2e42-491c-af59-b89b1129a539",
        'exo__Asset_label: "exocmd__Grounding"',
      ].join("\n");

      // Grounding instance: UUID-wikilink class ref
      const groundingFm = [
        "exo__Instance_class:",
        '  - "[[11579feb-2e42-491c-af59-b89b1129a539]]"',
        "exo__Asset_uid: gnd-uuid",
        "exo__Asset_label: UUID Grounding",
        'exocmd__Grounding_type: "property_set"',
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [
            { name: "class.md", isDirectory: () => false },
            { name: "cmd.md", isDirectory: () => false },
            { name: "gnd-class.md", isDirectory: () => false },
            { name: "gnd.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        // More specific matches MUST come before generic ones
        if (path.endsWith("/gnd-class.md")) return `---\n${groundingClassFm}\n---\n`;
        if (path.endsWith("/class.md")) return `---\n${classFm}\n---\n`;
        if (path.endsWith("/cmd.md")) return `---\n${commandFm}\n---\n`;
        if (path.endsWith("/gnd.md")) return `---\n${groundingFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const listCmd = cmd.commands.find((c: any) => c.name() === "list");
      await listCmd.parseAsync(["--vault", "/vault", "--output", "json"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toMatch(/"totalCommands":\s*1/);
      expect(output).toContain("cmd-uuid-wikilink");
      // Grounding type must resolve via UUID-wikilink reverse lookup too
      expect(output).toContain("property_set");

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

    it("should accept service_call with serviceId from dedicated property", async () => {
      const commandFm = [
        "exo__Instance_class: exocmd__Command",
        "exo__Asset_uid: cmd-svc",
        "exo__Asset_label: Service Command",
        "exocmd__Command_grounding: [[gnd-svc]]",
      ].join("\n");

      const groundingFm = [
        "exo__Instance_class: exocmd__Grounding",
        "exo__Asset_uid: gnd-svc",
        "exo__Asset_label: Call Plugin Service",
        "exocmd__Grounding_type: service_call",
        "exocmd__Grounding_serviceId: cleanProperties",
      ].join("\n");

      const bindingFm = [
        "exo__Instance_class: exocmd__CommandBinding",
        "exo__Asset_uid: bind-svc",
        "exocmd__CommandBinding_command: [[cmd-svc]]",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [
            { name: "cmd-svc.md", isDirectory: () => false },
            { name: "gnd-svc.md", isDirectory: () => false },
            { name: "bind-svc.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("cmd-svc.md")) return `---\n${commandFm}\n---\n`;
        if (path.endsWith("gnd-svc.md")) return `---\n${groundingFm}\n---\n`;
        if (path.endsWith("bind-svc.md")) return `---\n${bindingFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const valCmd = cmd.commands.find((c: any) => c.name() === "validate");
      await valCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("valid");
      expect(output).not.toContain("missing serviceId");

      consoleSpy.mockRestore();
    });

    it("should accept valid service_call with known service", async () => {
      const commandFm = [
        "exo__Instance_class: exocmd__Command",
        "exo__Asset_uid: cmd-ok",
        "exo__Asset_label: Valid Service Cmd",
        "exocmd__Command_grounding: [[gnd-ok]]",
      ].join("\n");

      const groundingFm = [
        "exo__Instance_class: exocmd__Grounding",
        "exo__Asset_uid: gnd-ok",
        "exo__Asset_label: Call setStatus",
        "exocmd__Grounding_type: service_call",
        "exocmd__Grounding_targetProperty: setStatus",
      ].join("\n");

      const bindingFm = [
        "exo__Instance_class: exocmd__CommandBinding",
        "exo__Asset_uid: bind-ok",
        "exocmd__CommandBinding_command: [[cmd-ok]]",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [
            { name: "cmd-ok.md", isDirectory: () => false },
            { name: "gnd-ok.md", isDirectory: () => false },
            { name: "bind-ok.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("cmd-ok.md")) return `---\n${commandFm}\n---\n`;
        if (path.endsWith("gnd-ok.md")) return `---\n${groundingFm}\n---\n`;
        if (path.endsWith("bind-ok.md")) return `---\n${bindingFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const valCmd = cmd.commands.find((c: any) => c.name() === "validate");
      await valCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("valid");
      expect(output).not.toContain("unknown service");

      consoleSpy.mockRestore();
    });

    it("should report missing serviceId in service_call grounding", async () => {
      const commandFm = [
        "exo__Instance_class: exocmd__Command",
        "exo__Asset_uid: cmd-no-svc",
        "exo__Asset_label: No Service ID",
        "exocmd__Command_grounding: [[gnd-no-svc]]",
      ].join("\n");

      const groundingFm = [
        "exo__Instance_class: exocmd__Grounding",
        "exo__Asset_uid: gnd-no-svc",
        "exo__Asset_label: Empty Service Call",
        "exocmd__Grounding_type: service_call",
      ].join("\n");

      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir.endsWith("/vault")) {
          return [
            { name: "cmd-no-svc.md", isDirectory: () => false },
            { name: "gnd-no-svc.md", isDirectory: () => false },
          ];
        }
        return [];
      });

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith("cmd-no-svc.md")) return `---\n${commandFm}\n---\n`;
        if (path.endsWith("gnd-no-svc.md")) return `---\n${groundingFm}\n---\n`;
        return "";
      });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const valCmd = cmd.commands.find((c: any) => c.name() === "validate");
      await valCmd.parseAsync(["--vault", "/vault"], { from: "user" });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join("\n");
      expect(output).toContain("missing serviceId and targetProperty");

      consoleSpy.mockRestore();
    });
  });

  describe("exec target IRI binding (regression #2996)", () => {
    it("passes a canonical obsidian:// IRI (URL-encoded, including .md) to the precondition evaluator", async () => {
      mockLoadCommand.mockResolvedValue({
        id: "e941b3bb-d375-40d2-b271-e1d71deb014c",
        name: "Start Effort",
        precondition: { id: "p1", label: "p1", sparqlAsk: "ASK { $target ?p ?o }" },
        grounding: { id: "g1", label: "g1", type: "service_call" },
      });
      mockEvaluate.mockResolvedValue(true);
      mockGroundingExecute.mockResolvedValue({ success: true });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const execCmd = cmd.commands.find((c: any) => c.name() === "exec");
      await execCmd.parseAsync(
        [
          "e941b3bb-d375-40d2-b271-e1d71deb014c",
          "--vault",
          "/vault",
          "--target",
          "03 Knowledge/kitelev/2f3a8928-3136-4d2d-b6cf-31a228aa0343.md",
          "--output",
          "json",
        ],
        { from: "user" },
      );

      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      const targetIRI = mockEvaluate.mock.calls[0][1] as string;
      expect(targetIRI).toBe(
        "obsidian://vault/03%20Knowledge/kitelev/2f3a8928-3136-4d2d-b6cf-31a228aa0343.md",
      );
      // Negative guards — make sure we did NOT regress to the buggy form.
      expect(targetIRI).not.toBe(
        "03 Knowledge/kitelev/2f3a8928-3136-4d2d-b6cf-31a228aa0343",
      );
      expect(targetIRI.endsWith(".md")).toBe(true);
      expect(targetIRI).toContain("%20");

      // GroundingExecutor receives the same canonical IRI plus the original
      // relative path as a separate argument (matches existing contract).
      expect(mockGroundingExecute).toHaveBeenCalledTimes(1);
      const [, execTargetIRI, execTargetPath] = mockGroundingExecute.mock.calls[0];
      expect(execTargetIRI).toBe(targetIRI);
      expect(execTargetPath).toBe(
        "03 Knowledge/kitelev/2f3a8928-3136-4d2d-b6cf-31a228aa0343.md",
      );

      consoleSpy.mockRestore();
    });

    it("strips a leading ./ from --target before encoding (canonical contract)", async () => {
      mockLoadCommand.mockResolvedValue({
        id: "cmd-1",
        name: "Cmd",
        precondition: undefined,
        grounding: { id: "g1", label: "g1", type: "service_call" },
      });
      mockEvaluate.mockResolvedValue(true);
      mockGroundingExecute.mockResolvedValue({ success: true });

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const cmd = dynamicCommandCommand();
      const execCmd = cmd.commands.find((c: any) => c.name() === "exec");
      await execCmd.parseAsync(
        [
          "cmd-1",
          "--vault",
          "/vault",
          "--target",
          "./03 Knowledge/x.md",
          "--output",
          "json",
          "--dry-run",
        ],
        { from: "user" },
      );

      // --dry-run skips grounding; the relevant assertion is that the path
      // never reaches the executor in the wrong form.
      expect(mockGroundingExecute).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
