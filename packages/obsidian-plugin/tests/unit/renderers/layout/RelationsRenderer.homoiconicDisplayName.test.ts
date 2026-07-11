import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { RelationsRenderer } from "@plugin/presentation/renderers/layout/RelationsRenderer";
import {
  getRelationDisplayLabel,
  getRelationSortLabel,
} from "@plugin/presentation/components/AssetRelationsTable";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import { AssetMetadataService } from "@plugin/presentation/renderers/layout/helpers/AssetMetadataService";
import type { AssetRelation } from "@plugin/presentation/renderers/layout/types";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { BacklinksCacheManager } from "@plugin/adapters/caching/BacklinksCacheManager";
import type { IVaultAdapter, IFile } from "@kitelev/exocortex-core";

jest.mock("obsidian", () => {
  class MockTFile {
    path = "";
    name = "";
    basename = "";
    extension = "";
    parent: unknown = null;
    vault: unknown = null;
    stat: unknown = null;
    constructor(path?: string) {
      if (path) {
        this.path = path;
        this.basename = path.replace(/\.md$/, "");
        this.name = this.basename + ".md";
        this.extension = "md";
      }
    }
  }
  return {
    ...jest.requireActual("obsidian"),
    Keymap: { isModEvent: jest.fn() },
    TFile: MockTFile,
  };
});

// Real relation plumbing: findAllReferencingProperties + isAssetArchived are pure and
// orthogonal to the displayName resolution under test — deterministic-stub them (the
// task IS a backlink of the open asset via ems__Effort_area). The DisplayNameResolver +
// PrintNameRuleService.scanVault path is REAL (no stubbed resolver — test-fixture-realism).
jest.mock("@kitelev/exocortex-core", () => ({
  ...jest.requireActual("@kitelev/exocortex-core"),
  MetadataHelpers: {
    isAssetArchived: jest.fn().mockReturnValue(false),
    findAllReferencingProperties: jest.fn().mockReturnValue(["ems__Effort_area"]),
    getPropertyValue: jest.fn(),
  },
}));

jest.mock("@plugin/presentation/utils/BlockerHelpers", () => ({
  BlockerHelpers: { isEffortBlocked: jest.fn().mockReturnValue(false) },
}));

// Canonical UIDs (verified in-vault; identical to the a577316f DailyNote binding test).
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const SPEC_UID = "d069c316-fcd3-4c25-8f24-3109382b72cf";

const AREA_PATH = "area.md";
const TASK_PATH = "doing-task.md";
const TASK_LABEL = "Write the report";

/**
 * In-memory vault app exposing the SAME surface PrintNameRuleService.scanVault reads
 * (getMarkdownFiles + getFileCache + getFirstLinkpathDest). Carries the REAL 🔄-Doing
 * exo__DisplayNameSpec (d069c316) + its two parts — production-shape, no hand-injected
 * template, no stubbed resolver (test-fixture-realism).
 */
function createSpecVaultApp(
  files: Array<{ path: string; frontmatter: Record<string, unknown> }>,
): App {
  const fileCache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  for (const f of files) {
    const tfile = new TFile(f.path);
    mockFiles.push(tfile);
    fileCache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }
  return {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
    metadataCache: {
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
    workspace: {
      getLeaf: jest.fn().mockReturnValue({ openLinkText: jest.fn() }),
      openLinkText: jest.fn(),
    },
  } as unknown as App;
}

/** The real 🔄-Doing spec (d069c316) + PrintedLiteral "🔄 " + PrintedProperty exo__Asset_label. */
function doingSpecFiles(
  taskFrontmatter: Record<string, unknown>,
): Array<{ path: string; frontmatter: Record<string, unknown> }> {
  return [
    {
      path: `${SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [
          "[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]",
        ],
        exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
        exo__DisplayNameSpec_priority: 100,
        exo__DisplayNameSpec_matchPath:
          "[[44c6e9e3-955f-4afc-9ca5-b4bd70667051|ems__Effort_status]]",
        exo__DisplayNameSpec_matchValue: `[[${DOING_UID}|ems__EffortStatusDoing]]`,
        exo__Asset_label: "displayName spec — ems__Task 🔄 while Doing",
      },
    },
    {
      path: "spec-literal.md",
      frontmatter: {
        exo__Asset_uid: "spec-literal",
        exo__Instance_class: [
          "[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]",
        ],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 0,
        exo__PrintedLiteral_literal: "🔄 ",
      },
    },
    {
      path: "spec-property.md",
      frontmatter: {
        exo__Asset_uid: "spec-property",
        exo__Instance_class: [
          "[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]",
        ],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedProperty_property:
          "[[12a6151b-801f-4be2-bd6e-a787eedd56ae|exo__Asset_label]]",
      },
    },
    // The Doing task itself — carried in the vault so the real AssetMetadataService resolves
    // its label; its frontmatter (instance class + status) is what the resolver reads.
    { path: TASK_PATH, frontmatter: taskFrontmatter },
  ];
}

/**
 * Drive the REAL RelationsRenderer.getAssetRelations over an in-memory vault carrying the
 * real spec, with a REAL PrintNameRuleService compiled from that vault (or absent). Returns
 * the AssetRelation[] the renderer produced — the exact objects the layout relation/query
 * tables render. `statusValue` is stored on the linked task's ems__Effort_status.
 */
async function getRelationsForTaskWithStatus(
  statusValue: string,
  opts: { withResolver?: boolean } = {},
): Promise<AssetRelation[]> {
  const withResolver = opts.withResolver ?? true;

  const taskFrontmatter = {
    exo__Instance_class: [`[[${TASK_UID}]]`], // UID-canon — the form that broke the naive strip
    ems__Effort_status: statusValue,
    ems__Effort_area: `[[${AREA_PATH.replace(".md", "")}]]`,
    exo__Asset_label: TASK_LABEL,
  };

  const app = createSpecVaultApp(doingSpecFiles(taskFrontmatter));

  let printNameRuleService: PrintNameRuleService | undefined;
  if (withResolver) {
    printNameRuleService = new PrintNameRuleService(app);
    printNameRuleService.initialize(); // real scanVault — compiles the vault spec
  }

  const settings = {
    showArchivedAssets: false,
    showEffortVotes: false,
    displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
  } as unknown as ExocortexSettings;

  const plugin = {
    settings: { displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS },
    printNameRuleService, // undefined in the null-resolver scenario
    saveSettings: jest.fn(),
  } as unknown as import("@plugin/types").ExocortexPluginInterface;

  const reactRenderer = {
    render: jest.fn(),
    unmount: jest.fn(),
  } as unknown as jest.Mocked<ReactRenderer>;

  const backlinksCacheManager = {
    getBacklinks: jest.fn().mockReturnValue(new Set([TASK_PATH])),
  } as unknown as jest.Mocked<BacklinksCacheManager>;

  // Real metadata service over the spec vault (resolves the task's label from the app).
  const metadataService = new AssetMetadataService(app as never);

  const taskFile = new TFile(TASK_PATH);
  (taskFile as unknown as { stat: unknown }).stat = {
    ctime: 1,
    mtime: 2,
    size: 0,
  };
  const areaFile = new TFile(AREA_PATH);

  const vaultAdapter = {
    getAbstractFileByPath: jest
      .fn()
      .mockImplementation((p: string) => (p === TASK_PATH ? taskFile : null)),
    getFrontmatter: jest.fn().mockImplementation((f: IFile) => {
      if (f.path === TASK_PATH) return taskFrontmatter;
      if (f.path === AREA_PATH) {
        return { exo__Asset_uid: "area-uid", exo__Asset_label: "My Area" };
      }
      return null;
    }),
  } as unknown as jest.Mocked<IVaultAdapter>;

  const renderer = new RelationsRenderer(
    app as never,
    settings,
    reactRenderer,
    backlinksCacheManager,
    metadataService,
    plugin,
    jest.fn(),
    vaultAdapter,
    // reified-relation deps omitted → getReifiedRelationsGated is a no-op (back-compat)
  );

  return renderer.getAssetRelations(areaFile as unknown as TFile, {});
}

describe("RelationsRenderer — homoiconic displayName in the layout relation/query tables (req 3f65eb4a)", () => {
  // jest.config has resetMocks: true → re-establish the plumbing-stub return values each test.
  beforeEach(() => {
    const { MetadataHelpers } = require("@kitelev/exocortex-core");
    MetadataHelpers.isAssetArchived.mockReturnValue(false);
    MetadataHelpers.findAllReferencingProperties.mockReturnValue([
      "ems__Effort_area",
    ]);
    const { BlockerHelpers } = require("@plugin/presentation/utils/BlockerHelpers");
    BlockerHelpers.isEffortBlocked.mockReturnValue(false);
  });

  it("@req:3f65eb4a-c0df-41da-917e-3112de19b531 renders 🔄 for a UID-canon Doing task link via the vault exo__DisplayNameSpec (DisplayNameResolver + PrintNameRuleService), NOT a plain exo__Asset_label", async () => {
    // Doing status stored UID-canon "[[<doing-uid>]]".
    const relations = await getRelationsForTaskWithStatus(`[[${DOING_UID}]]`);
    expect(relations).toHaveLength(1);

    // The homoiconic name carries the vault-declared 🔄 prefix, resolved through the real stack.
    expect(relations[0].displayName).toBe("🔄 Write the report");

    // The final relation-table cell (what AssetRelationsTable / the exo__Layout query table
    // renders) shows "🔄 <label>".
    expect(getRelationDisplayLabel(relations[0])).toBe("🔄 Write the report");
  });

  it("@req:3f65eb4a-c0df-41da-917e-3112de19b531 shows the bare label when the linked task is NOT Doing (the conditional spec does not participate)", async () => {
    const relations = await getRelationsForTaskWithStatus(`[[${BACKLOG_UID}]]`);
    expect(relations).toHaveLength(1);
    expect(relations[0].displayName).toBe("Write the report");
    expect(getRelationDisplayLabel(relations[0])).toBe("Write the report");
  });

  it("@req:3f65eb4a-c0df-41da-917e-3112de19b531 resolves 🔄 for the [[<uid>|label]] status form too (dual-IRI)", async () => {
    const relations = await getRelationsForTaskWithStatus(
      `[[${DOING_UID}|ems__EffortStatusDoing]]`,
    );
    expect(getRelationDisplayLabel(relations[0])).toBe("🔄 Write the report");
  });

  it("@req:3f65eb4a-c0df-41da-917e-3112de19b531 sorts a Doing task by its UNPREFIXED label (the display 🔄 prefix must not collate rows by emoji)", async () => {
    const relations = await getRelationsForTaskWithStatus(`[[${DOING_UID}]]`);
    // Display carries the 🔄 prefix …
    expect(getRelationDisplayLabel(relations[0])).toBe("🔄 Write the report");
    // … but the SORT key is the plain label (no emoji-codepoint collation regression).
    expect(getRelationSortLabel(relations[0])).toBe("Write the report");
  });

  it("@req:3f65eb4a-c0df-41da-917e-3112de19b531 falls back to the plain label when printNameRuleService is absent (no-regression guard)", async () => {
    // No resolver on the plugin → the cell is byte-identical to the pre-3f65eb4a plain label.
    const relations = await getRelationsForTaskWithStatus(`[[${DOING_UID}]]`, {
      withResolver: false,
    });
    expect(relations).toHaveLength(1);
    expect(getRelationDisplayLabel(relations[0])).toBe("Write the report");
  });
});
