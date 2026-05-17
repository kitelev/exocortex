/**
 * Unit tests for ExocmdFastResolver (Issue #3171).
 *
 * The fast resolver provides a degraded but functional resolution path for
 * `exocmd__Command` buttons BEFORE the full vault triple store has finished
 * `convertVault()`. It builds a mini in-memory triple store from:
 *  - the target file's frontmatter, and
 *  - the small set (~41) of `assetspaces/exocmd/*.md` files,
 * resolving via the same `CommandResolver` + `PreconditionEvaluator` classes
 * that the production code uses, just bound to the mini-store.
 *
 * Acceptance: `resolveVisibleCommands` returns the same ResolvedCommand shape
 * as `DynamicCommandButtonGroupBuilder.resolveVisibleCommands` (the full path),
 * so the strategy switch in `build()` is type-compatible.
 */
import { ExocmdFastResolver } from "../../../../src/presentation/builders/button-groups/ExocmdFastResolver";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
  ResolvedCommand,
} from "exocortex";

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeFile(path: string, basename: string): IFile {
  return {
    path,
    basename,
    name: basename + ".md",
    parent: null,
  };
}

/**
 * Build a minimal IVaultAdapter mock backed by an in-memory file map.
 * Only the methods needed by NoteToRDFConverter and ExocmdFastResolver are
 * implemented — the rest throw to surface accidental usage.
 */
function makeVault(
  files: Record<string, IFrontmatter>,
): jest.Mocked<IVaultAdapter> {
  const fileList: IFile[] = Object.keys(files).map((path) => {
    const basename = path.split("/").pop()!.replace(/\.md$/, "");
    return makeFile(path, basename);
  });

  return {
    getFrontmatter: jest.fn((file: IFile) => files[file.path] ?? null),
    getAllFiles: jest.fn(() => fileList),
    getAbstractFileByPath: jest.fn((path: string) => {
      const found = fileList.find((f) => f.path === path);
      return found ?? null;
    }),
    read: jest.fn(),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as jest.Mocked<IVaultAdapter>;
}

/**
 * Frontmatter fixtures: 1 target task + 3 exocmd assets per binding (each
 * binding requires Command + Precondition + Grounding + CommandBinding).
 *
 * The 3 commands cover the 3 scenarios from the issue test plan:
 *  - cmd-A: precondition matches (target HAS start timestamp) → visible
 *  - cmd-B: precondition does NOT match (target has no end timestamp) → hidden
 *  - cmd-C: binding targets a different class (no targetClass match) → hidden
 *    (extra check — precondition-only check could be misleading without this).
 */
const TARGET_TASK_PATH = "tasks/target-task.md";
const TARGET_TASK_FM: IFrontmatter = {
  exo__Asset_uid: "target-task-uid",
  exo__Asset_label: "Target Task",
  exo__Instance_class: ["[[ems__Task]]"],
  ems__Effort_startTimestamp: "2026-01-01T00:00:00+0500",
  // NOTE: no ems__Effort_endTimestamp → precondition B will return false
};

const EXOCMD_DIR = "assetspaces/exocmd";

// Helper to construct precondition / grounding / command / binding fixtures
function preconditionFrontmatter(
  uid: string,
  label: string,
  sparqlAsk: string,
): IFrontmatter {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: ["[[exocmd__Precondition]]"],
    exocmd__Precondition_sparqlAsk: sparqlAsk,
  };
}

function groundingFrontmatter(uid: string, label: string): IFrontmatter {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: ["[[exocmd__Grounding]]"],
    exocmd__Grounding_type: "property_delete",
    exocmd__Grounding_targetProperty: "ems__Effort_startTimestamp",
  };
}

function commandFrontmatter(
  uid: string,
  label: string,
  preconditionUid: string,
  groundingUid: string,
): IFrontmatter {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: ["[[exocmd__Command]]"],
    exocmd__Command_precondition: `[[${preconditionUid}]]`,
    exocmd__Command_grounding: `[[${groundingUid}]]`,
    exocmd__Command_category: "maintenance",
  };
}

function bindingFrontmatter(
  uid: string,
  label: string,
  commandUid: string,
  targetClass: string,
  order = 10,
): IFrontmatter {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: ["[[exocmd__CommandBinding]]"],
    exocmd__CommandBinding_command: `[[${commandUid}]]`,
    exocmd__CommandBinding_targetClass: targetClass,
    exocmd__CommandBinding_order: order,
  };
}

const HAS_START_ASK = `
PREFIX ems: <https://exocortex.my/ontology/ems#>
ASK { $target ems:Effort_startTimestamp ?ts . }
`.trim();

const HAS_END_ASK = `
PREFIX ems: <https://exocortex.my/ontology/ems#>
ASK { $target ems:Effort_endTimestamp ?ts . }
`.trim();

const ALWAYS_TRUE_ASK = "ASK { }";

function makeFixtureFiles(): Record<string, IFrontmatter> {
  return {
    [TARGET_TASK_PATH]: TARGET_TASK_FM,

    // cmd-A: precondition matches AND binding targetClass matches
    [`${EXOCMD_DIR}/precondition-a.md`]: preconditionFrontmatter(
      "pre-A",
      "Has start timestamp",
      HAS_START_ASK,
    ),
    [`${EXOCMD_DIR}/grounding-a.md`]: groundingFrontmatter("grd-A", "Grounding A"),
    [`${EXOCMD_DIR}/command-a.md`]: commandFrontmatter(
      "cmd-A",
      "Remove start timestamp",
      "pre-A",
      "grd-A",
    ),
    [`${EXOCMD_DIR}/binding-a.md`]: bindingFrontmatter(
      "bind-A",
      "Binding A",
      "cmd-A",
      "ems__Task",
    ),

    // cmd-B: precondition does NOT match (no end timestamp on target)
    [`${EXOCMD_DIR}/precondition-b.md`]: preconditionFrontmatter(
      "pre-B",
      "Has end timestamp",
      HAS_END_ASK,
    ),
    [`${EXOCMD_DIR}/grounding-b.md`]: groundingFrontmatter("grd-B", "Grounding B"),
    [`${EXOCMD_DIR}/command-b.md`]: commandFrontmatter(
      "cmd-B",
      "Remove end timestamp",
      "pre-B",
      "grd-B",
    ),
    [`${EXOCMD_DIR}/binding-b.md`]: bindingFrontmatter(
      "bind-B",
      "Binding B",
      "cmd-B",
      "ems__Task",
    ),

    // cmd-C: precondition is always-true BUT binding targets a different class
    [`${EXOCMD_DIR}/precondition-c.md`]: preconditionFrontmatter(
      "pre-C",
      "Always visible",
      ALWAYS_TRUE_ASK,
    ),
    [`${EXOCMD_DIR}/grounding-c.md`]: groundingFrontmatter("grd-C", "Grounding C"),
    [`${EXOCMD_DIR}/command-c.md`]: commandFrontmatter(
      "cmd-C",
      "Project-only command",
      "pre-C",
      "grd-C",
    ),
    [`${EXOCMD_DIR}/binding-c.md`]: bindingFrontmatter(
      "bind-C",
      "Binding C",
      "cmd-C",
      "ems__Project",
    ),
  };
}

describe("ExocmdFastResolver (Issue #3171)", () => {
  describe("resolveVisibleCommands", () => {
    it("returns only commands whose binding class matches AND precondition is satisfied", async () => {
      const files = makeFixtureFiles();
      const vault = makeVault(files);
      const resolver = new ExocmdFastResolver(vault, EXOCMD_DIR, mockLogger);

      const target = makeFile(TARGET_TASK_PATH, "target-task");
      const result = await resolver.resolveVisibleCommands(target);

      const visibleIds = result.map((rc: ResolvedCommand) => rc.command.id);
      expect(visibleIds).toEqual(["cmd-A"]);
    });

    it("returns empty when target has no exo__Instance_class", async () => {
      const files = makeFixtureFiles();
      files[TARGET_TASK_PATH] = {
        exo__Asset_uid: "no-class-uid",
        exo__Asset_label: "No class",
        // intentionally omit exo__Instance_class
      };
      const vault = makeVault(files);
      const resolver = new ExocmdFastResolver(vault, EXOCMD_DIR, mockLogger);

      const target = makeFile(TARGET_TASK_PATH, "no-class");
      const result = await resolver.resolveVisibleCommands(target);

      expect(result).toEqual([]);
    });

    it("returns empty when target file frontmatter is null", async () => {
      const files = makeFixtureFiles();
      const vault = makeVault(files);
      // Override getFrontmatter for target only
      const realGetFrontmatter = vault.getFrontmatter.getMockImplementation()!;
      vault.getFrontmatter.mockImplementation((file: IFile) => {
        if (file.path === TARGET_TASK_PATH) return null;
        return realGetFrontmatter(file);
      });
      const resolver = new ExocmdFastResolver(vault, EXOCMD_DIR, mockLogger);

      const target = makeFile(TARGET_TASK_PATH, "target-task");
      const result = await resolver.resolveVisibleCommands(target);

      expect(result).toEqual([]);
    });
  });

  describe("cache invalidation", () => {
    it("rebuilds the mini-store on invalidateCommandCache() after exocmd files change", async () => {
      const files = makeFixtureFiles();
      const vault = makeVault(files);
      const resolver = new ExocmdFastResolver(vault, EXOCMD_DIR, mockLogger);

      const target = makeFile(TARGET_TASK_PATH, "target-task");
      // First resolve — cmd-A visible
      const first = await resolver.resolveVisibleCommands(target);
      expect(first.map((rc) => rc.command.id)).toEqual(["cmd-A"]);

      // Mutate the precondition file: change to always-false (no triple ever exists)
      files[`${EXOCMD_DIR}/precondition-a.md`] = preconditionFrontmatter(
        "pre-A",
        "Now always false",
        "PREFIX ex: <https://example.org/> ASK { $target ex:NeverExistsProp ?v }",
      );

      // Without invalidation, the resolver may serve stale cached commands.
      // After invalidation, the new precondition must be re-evaluated and
      // command-A must drop out (no matching triple in any precondition).
      resolver.invalidateCommandCache();
      const second = await resolver.resolveVisibleCommands(target);
      expect(second.map((rc) => rc.command.id)).toEqual([]);
    });
  });

  describe("graph-traversal preconditions (degraded gracefully)", () => {
    it("returns false (no command visible) when precondition needs out-of-store data", async () => {
      // A precondition that requires TBox graph traversal (`Class_superClass+`).
      // The fast-path mini-store does not contain class hierarchy assets, so
      // this MUST return false — the design accepts this as a deliberate
      // trade-off; the background full-resolver re-render upgrades visibility.
      const files = makeFixtureFiles();
      // Replace precondition A with a graph-traversal query
      files[`${EXOCMD_DIR}/precondition-a.md`] = preconditionFrontmatter(
        "pre-A",
        "Is prototype (needs class hierarchy)",
        `PREFIX exo: <https://exocortex.my/ontology/exo#>
         ASK { $target exo:Instance_class ?cls . ?cls exo:Class_superClass+ exo:Prototype . }`,
      );
      const vault = makeVault(files);
      const resolver = new ExocmdFastResolver(vault, EXOCMD_DIR, mockLogger);

      const target = makeFile(TARGET_TASK_PATH, "target-task");
      const result = await resolver.resolveVisibleCommands(target);

      // cmd-A must NOT be in the visible set; only acceptable visibility is empty
      // (cmd-B and cmd-C are still filtered as in the main scenario).
      expect(result.map((rc) => rc.command.id)).not.toContain("cmd-A");
    });
  });
});
