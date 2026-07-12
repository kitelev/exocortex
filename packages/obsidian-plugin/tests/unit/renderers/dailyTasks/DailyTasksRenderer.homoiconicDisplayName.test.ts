import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { DailyTasksRenderer } from "@plugin/presentation/renderers/DailyTasksRenderer";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import { getDisplayName } from "@plugin/presentation/components/daily-tasks/helpers";
import { AssetMetadataService } from "@plugin/presentation/renderers/layout/helpers/AssetMetadataService";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";
import type { ILogger } from "@plugin/infrastructure/logging/ILogger";
import type { MetadataExtractor, IVaultAdapter } from "@kitelev/exocortex-core";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { DailyTask } from "@plugin/presentation/components/daily-tasks/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Keymap: { isModEvent: jest.fn() },
}));

// Canonical UIDs (verified in-vault this session).
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const SPEC_UID = "d069c316-fcd3-4c25-8f24-3109382b72cf";
const DAY = "2026-07-11";

/**
 * In-memory vault mock exposing the SAME surface PrintNameRuleService.scanVault reads
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
    tfile.basename = f.path.replace(".md", "");
    tfile.extension = "md";
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
function doingSpecFiles(): Array<{
  path: string;
  frontmatter: Record<string, unknown>;
}> {
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
  ];
}

/**
 * Drive the REAL DailyTasksRenderer with a REAL PrintNameRuleService (compiled from the vault
 * spec) wired onto the plugin. Returns the DailyTask[] the renderer handed to React — the exact
 * objects getDisplayName renders. `statusValue` is stored on the task's ems__Effort_status.
 */
async function renderTaskWithStatus(statusValue: string): Promise<DailyTask[]> {
  const app = createSpecVaultApp(doingSpecFiles());
  const printNameRuleService = new PrintNameRuleService(app);
  printNameRuleService.initialize(); // real scanVault — compiles the vault spec

  const settings = {
    showEffortArea: false,
    showEffortVotes: false,
    showTimeEstimate: false,
    // Same DisplayNameSettings the native-link patches read.
    displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
  } as unknown as ExocortexSettings;

  const plugin = {
    settings: { displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS },
    printNameRuleService,
    saveSettings: jest.fn(),
  } as unknown as import("@plugin/types").ExocortexPluginInterface;

  const logger: jest.Mocked<ILogger> = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as jest.Mocked<ILogger>;

  const dailyNoteFile = {
    path: `${DAY}.md`,
    parent: { path: "DailyNotes" },
    basename: DAY,
  } as TFile;
  const dailyNoteMetadata = {
    exo__Instance_class: "[[pn__DailyNote]]",
    pn__DailyNote_day: `[[${DAY}]]`,
  };

  const taskFile = { path: "doing-task.md", basename: "doing-task" } as TFile;
  const taskMetadata = {
    // UID-canon instance class + UID-canon status — the exact form that broke the naive strip.
    exo__Instance_class: [`[[${TASK_UID}]]`],
    ems__Effort_day: `[[${DAY}]]`,
    ems__Effort_startTimestamp: `${DAY}T09:00:00`,
    ems__Effort_status: statusValue,
    exo__Asset_label: "Write the report",
  };

  const metadataExtractor = {
    extractMetadata: jest
      .fn()
      .mockReturnValueOnce(dailyNoteMetadata)
      .mockReturnValueOnce(taskMetadata),
    extractInstanceClass: jest.fn().mockReturnValueOnce("[[pn__DailyNote]]"),
    extractStatus: jest.fn(),
    extractIsArchived: jest.fn(),
  } as unknown as jest.Mocked<MetadataExtractor>;

  const reactRenderer = {
    render: jest.fn(),
    unmount: jest.fn(),
  } as unknown as jest.Mocked<ReactRenderer>;

  const vaultAdapter = {
    getAllFiles: jest.fn().mockReturnValue([taskFile]),
    getFirstLinkpathDest: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;

  const metadataService = new AssetMetadataService(app);

  const renderer = new DailyTasksRenderer(
    app as never,
    settings,
    plugin,
    logger,
    metadataExtractor,
    reactRenderer,
    jest.fn(),
    metadataService,
    vaultAdapter,
  );

  const el: HTMLElement = document.createElement("div");
  (el as unknown as { createDiv: (o?: unknown) => HTMLElement }).createDiv = (
    opts?: unknown,
  ) => {
    const div = document.createElement("div") as unknown as {
      className?: string;
      createEl: (t: string, o?: { cls?: string; text?: string }) => HTMLElement;
      createDiv: (o?: unknown) => HTMLElement;
    };
    const cls = (opts as { cls?: string } | undefined)?.cls;
    if (cls) (div as unknown as HTMLElement).className = cls;
    el.appendChild(div as unknown as HTMLElement);
    div.createEl = (tag: string, o?: { cls?: string; text?: string }) => {
      const e = document.createElement(tag);
      if (o?.cls) e.className = o.cls;
      if (o?.text) e.textContent = o.text;
      (div as unknown as HTMLElement).appendChild(e);
      return e;
    };
    div.createDiv = (el as unknown as { createDiv: (o?: unknown) => HTMLElement })
      .createDiv;
    return div as unknown as HTMLElement;
  };

  await renderer.render(el, dailyNoteFile);

  expect(reactRenderer.render).toHaveBeenCalled();
  return (
    reactRenderer.render.mock.calls[0][1] as {
      props: { tasks: DailyTask[] };
    }
  ).props.tasks;
}

describe("DailyTasksRenderer — homoiconic displayName (req a577316f)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("@req:a577316f-f2ff-469b-a6d3-ff946eccc68f renders 🔄 for a UID-canon Doing task via the vault exo__DisplayNameSpec (DisplayNameResolver + PrintNameRuleService), NOT a hardcoded emoji map", async () => {
    // Doing status stored UID-canon "[[<doing-uid>]]" — the reported symptom.
    const tasks = await renderTaskWithStatus(`[[${DOING_UID}]]`);
    expect(tasks).toHaveLength(1);

    // The homoiconic name carries the vault-declared 🔄 prefix, resolved through the real stack.
    expect(tasks[0].displayName).toBe("🔄 Write the report");

    // The final DailyNote-table cell (what the row renders) shows "🔄 <label>".
    expect(getDisplayName(tasks[0])).toBe("🔄 Write the report");
  });

  it("@req:a577316f-f2ff-469b-a6d3-ff946eccc68f shows the bare label when the same task is NOT Doing (the conditional spec does not participate)", async () => {
    // Backlog status (UID-canon) — the 🔄-Doing conditional matcher must not match.
    const tasks = await renderTaskWithStatus(
      "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]",
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].displayName).toBe("Write the report");
    expect(getDisplayName(tasks[0])).toBe("Write the report");
  });

  it("@req:a577316f-f2ff-469b-a6d3-ff946eccc68f resolves 🔄 for the [[<uid>|label]] status form too (dual-IRI)", async () => {
    const tasks = await renderTaskWithStatus(
      `[[${DOING_UID}|ems__EffortStatusDoing]]`,
    );
    expect(getDisplayName(tasks[0])).toBe("🔄 Write the report");
  });
});

describe("getDisplayName — 🚩 residual REMOVED, blocked marker is homoiconic [req 1a550210]", () => {
  /** Minimal DailyTask shape getDisplayName reads (displayName / label / title / path / isBlocked). */
  const task = (over: Partial<DailyTask>): DailyTask =>
    ({
      file: { path: "t.md", basename: "t" },
      path: "t.md",
      title: "Ship it",
      label: "Ship it",
      startTime: "09:00",
      endTime: "10:00",
      status: "Doing",
      metadata: {},
      isDoing: true,
      isBlocked: false,
      ...over,
    }) as DailyTask;

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 does NOT re-add a 🚩 residual — the 🚩 comes from the composed displayName only, so a blocked task is NOT double-🚩 [revert-verify anchor]", () => {
    // The resolver now composes 🚩 into displayName (via the live isEffortBlocked spec). The
    // DailyNote renderer residual (blockerIcon) is REMOVED. Revert-verify RED anchor: re-adding the
    // residual (`blockerIcon = task.isBlocked ? "🚩 " : ""`) makes this "🚩 🚩 🔄 Ship it" → RED;
    // restore → "🚩 🔄 Ship it".
    const blockedDoing = task({ displayName: "🚩 🔄 Ship it", isBlocked: true });
    expect(getDisplayName(blockedDoing)).toBe("🚩 🔄 Ship it");
    expect(getDisplayName(blockedDoing)).not.toContain("🚩 🚩");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 a blocked NON-Doing row shows a single 🚩 (from displayName), not the old renderer-doubled 🚩", () => {
    // The blocked, non-Doing task's resolved displayName is "🚩 <label>". With the residual removed,
    // the row shows exactly one 🚩 (re-adding the residual would double it → "🚩 🚩 ...").
    const blockedBacklog = task({
      displayName: "🚩 Ship it",
      isBlocked: true,
      isDoing: false,
    });
    expect(getDisplayName(blockedBacklog)).toBe("🚩 Ship it");
    expect(getDisplayName(blockedBacklog)).not.toContain("🚩 🚩");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 an unblocked task keeps its plain composed displayName (no phantom 🚩)", () => {
    const unblocked = task({ displayName: "🔄 Ship it", isBlocked: false });
    expect(getDisplayName(unblocked)).toBe("🔄 Ship it");
  });
});
