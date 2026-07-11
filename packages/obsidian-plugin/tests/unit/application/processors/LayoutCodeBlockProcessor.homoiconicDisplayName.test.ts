import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import type React from "react";
import { LayoutCodeBlockProcessor } from "@plugin/application/processors/LayoutCodeBlockProcessor";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { TableLayout } from "@plugin/domain/layout";

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
  class MockMarkdownRenderChild {
    constructor(public containerEl: unknown) {}
    onload(): void {}
    onunload(): void {}
  }
  return {
    ...jest.requireActual("obsidian"),
    TFile: MockTFile,
    MarkdownRenderChild: MockMarkdownRenderChild,
  };
});

// Canonical UIDs (verified in-vault; identical to the a577316f DailyNote + 3f65eb4a relation binding tests).
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const SPEC_UID = "d069c316-fcd3-4c25-8f24-3109382b72cf";

const TASK_PATH = "doing-task.md";
const TASK_LABEL = "Write the report";
const PROJECT_PATH = "some-project.md";
const PROJECT_LABEL = "Ship the plugin";
const LABELLESS_PATH = "labelless-note.md";

/**
 * In-memory vault app exposing the SAME surface PrintNameRuleService.scanVault reads
 * (getMarkdownFiles + getFileCache + getFirstLinkpathDest) AND the surface the cell
 * label resolver reads (getFileCache + getFirstLinkpathDest). Carries the REAL 🔄-Doing
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
      on: jest.fn().mockReturnValue({ id: "test-event-ref" }),
      offref: jest.fn(),
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
    workspace: {
      openLinkText: jest.fn(),
    },
  } as unknown as App;
}

/** The real 🔄-Doing spec (d069c316) + PrintedLiteral "🔄 " + PrintedProperty exo__Asset_label. */
function specParts(): Array<{ path: string; frontmatter: Record<string, unknown> }> {
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

/** A code-block cell links to a Task with `statusValue`; the vault also carries a non-Task
 * asset (Project, no applicable spec) and a labelless note, to guard the no-regression path. */
function vaultFiles(
  statusValue: string,
): Array<{ path: string; frontmatter: Record<string, unknown> }> {
  return [
    ...specParts(),
    {
      path: TASK_PATH,
      frontmatter: {
        exo__Instance_class: [`[[${TASK_UID}]]`], // UID-canon — the form that broke a naive strip
        ems__Effort_status: statusValue,
        exo__Asset_label: TASK_LABEL,
      },
    },
    {
      path: PROJECT_PATH,
      frontmatter: {
        exo__Instance_class: ["[[7db5eeff-718a-49b0-8d2b-39b084a356e3|ems__Project]]"],
        ems__Effort_status: `[[${DOING_UID}]]`, // Doing, but NO spec applies to ems__Project
        exo__Asset_label: PROJECT_LABEL,
      },
    },
    {
      path: LABELLESS_PATH,
      frontmatter: {
        exo__Instance_class: [`[[${TASK_UID}]]`],
        ems__Effort_status: `[[${DOING_UID}]]`,
        // no exo__Asset_label
      },
    },
  ];
}

/**
 * Build a production-shape LayoutCodeBlockProcessor over an in-memory vault carrying the real
 * spec, with a REAL PrintNameRuleService compiled from that vault (or absent), then capture the
 * exact `getAssetLabel` cell resolver the processor passes to TableLayoutRenderer and return it.
 * This is the real code-block-table cell-label path — no hand-injected label, no stubbed resolver.
 */
function captureCellLabelResolver(
  statusValue: string,
  opts: { withResolver?: boolean } = {},
): {
  getCellLabel: (path: string) => string | null;
  cleanup: () => void;
} {
  const withResolver = opts.withResolver ?? true;
  const app = createSpecVaultApp(vaultFiles(statusValue));

  let printNameRuleService: PrintNameRuleService | undefined;
  if (withResolver) {
    printNameRuleService = new PrintNameRuleService(app);
    printNameRuleService.initialize(); // real scanVault — compiles the vault spec
  }

  const plugin = {
    app,
    settings: { displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS },
    printNameRuleService, // undefined in the null-resolver scenario
    notifier: { error: jest.fn() },
  } as unknown as ExocortexPlugin;

  const processor = new LayoutCodeBlockProcessor(plugin);

  // Capture the getAssetLabel callback the processor passes to TableLayoutRenderer.
  let captured: ((path: string) => string | null) | undefined;
  jest
    .spyOn(
      (processor as unknown as { reactRenderer: ReactRenderer }).reactRenderer,
      "render",
    )
    .mockImplementation((_container: HTMLElement, component: React.ReactElement) => {
      captured = (
        component as unknown as {
          props: { getAssetLabel: (path: string) => string | null };
        }
      ).props.getAssetLabel;
    });

  const layout = { columns: [] } as unknown as TableLayout;
  (
    processor as unknown as {
      renderTableLayout: (l: TableLayout, r: unknown[], c: HTMLElement) => void;
    }
  ).renderTableLayout(layout, [], document.createElement("div"));

  if (!captured) {
    throw new Error("getAssetLabel cell resolver was not captured");
  }

  return {
    getCellLabel: captured,
    cleanup: () => processor.cleanup(),
  };
}

describe("LayoutCodeBlockProcessor — homoiconic displayName in configured exocortex code-block query tables (req 71cc75f3)", () => {
  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b renders 🔄 for a UID-canon Doing task-link cell via the vault exo__DisplayNameSpec (DisplayNameResolver + PrintNameRuleService), NOT a plain exo__Asset_label", () => {
    const { getCellLabel, cleanup } = captureCellLabelResolver(`[[${DOING_UID}]]`);
    try {
      // The homoiconic name carries the vault-declared 🔄 prefix, resolved through the real stack.
      expect(getCellLabel(TASK_PATH)).toBe("🔄 Write the report");
    } finally {
      cleanup();
    }
  });

  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b resolves 🔄 for the [[<uid>|label]] status form too (dual-IRI)", () => {
    const { getCellLabel, cleanup } = captureCellLabelResolver(
      `[[${DOING_UID}|ems__EffortStatusDoing]]`,
    );
    try {
      expect(getCellLabel(TASK_PATH)).toBe("🔄 Write the report");
    } finally {
      cleanup();
    }
  });

  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b shows the bare label when the linked task is NOT Doing (the conditional spec does not participate)", () => {
    const { getCellLabel, cleanup } = captureCellLabelResolver(`[[${BACKLOG_UID}]]`);
    try {
      expect(getCellLabel(TASK_PATH)).toBe("Write the report");
    } finally {
      cleanup();
    }
  });

  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b leaves a non-matching-class cell (Project, no applicable spec) byte-identical to the plain label", () => {
    const { getCellLabel, cleanup } = captureCellLabelResolver(`[[${DOING_UID}]]`);
    try {
      // A general property-value wikilink cell that is NOT a Doing ems__Task → unchanged.
      expect(getCellLabel(PROJECT_PATH)).toBe(PROJECT_LABEL);
    } finally {
      cleanup();
    }
  });

  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b falls through to the plain resolver (null) for a labelless asset — no basename substitution regression", () => {
    const { getCellLabel, cleanup } = captureCellLabelResolver(`[[${DOING_UID}]]`);
    try {
      // getAssetLabel returns null today for a labelless asset; the wrapper must keep that.
      expect(getCellLabel(LABELLESS_PATH)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("@req:71cc75f3-fc88-4193-b6ab-2a4d2c323a0b falls back to the plain label when printNameRuleService is absent (no-regression guard)", () => {
    // No resolver on the plugin → the cell is byte-identical to the pre-71cc75f3 plain label.
    const { getCellLabel, cleanup } = captureCellLabelResolver(`[[${DOING_UID}]]`, {
      withResolver: false,
    });
    try {
      expect(getCellLabel(TASK_PATH)).toBe("Write the report");
    } finally {
      cleanup();
    }
  });
});
