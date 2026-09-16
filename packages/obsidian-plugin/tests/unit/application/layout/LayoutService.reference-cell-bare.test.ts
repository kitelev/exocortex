/**
 * req 27fbe40b (ticket 73b16cc4, PR #4248 review MEDIUM) — the ONLY production
 * caller of the plugin's object write path, `LayoutService.handleCellEdit`,
 * hands a reference cell value to the REAL `ObsidianVaultAdapter` /
 * `FrontmatterService.applyPatch` as the BARE `[[uid]]`: the live
 * `processFrontMatter` object carries `[[uid]]`, never `'"[[uid]]"'` (the
 * pre-27fbe40b `formatValueForFrontmatter` pre-quoted wikilinks, so the quotes
 * became part of the string and the disk shape was the double wrap the ticket
 * describes). The single mocked seam is `processFrontMatter` (a plain object
 * stands in for Obsidian's live frontmatter) — same seam as
 * `LayoutService.archived-key-parity.test.ts`.
 *
 * Revert-verify (PR body): mutant M5 (restore the pre-quoting branch in
 * `formatValueForFrontmatter`) → F6 RED.
 *
 * @req:27fbe40b-080f-4928-b675-3c767223c875
 */
import { describe, it, expect, jest } from "@jest/globals";
import type { ILogger, INotificationService } from "@kitelev/exocortex-core";
import { TFile } from "obsidian";
import type { Vault, MetadataCache, App, FileManager } from "obsidian";

const mockSparql = {
  initialize: jest.fn(),
  query: jest.fn(),
  refresh: jest.fn(),
  updateFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  dispose: jest.fn(),
  getTripleStore: jest.fn(),
};
jest.mock("../../../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: function () {
    return mockSparql;
  },
}));
jest.mock("../../../../src/infrastructure/layout/LayoutParser", () => ({
  LayoutParser: function () {
    return {
      parseFromFile: jest.fn(),
      parseFromWikiLink: jest.fn(),
      clearCache: jest.fn(),
      invalidateCache: jest.fn(),
    };
  },
}));
jest.mock("@plugin/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

import { LayoutService } from "../../../../src/application/layout";
import { ObsidianVaultAdapter } from "../../../../src/adapters/ObsidianVaultAdapter";

const REQ = "@req:27fbe40b-080f-4928-b675-3c767223c875";
const PATH = "tasks/task.md";
const PARENT_UID = "3f1d005c-7a2e-4b8f-9c1d-5e6f7a8b9c0d";

describe("LayoutService.handleCellEdit → ObsidianVaultAdapter — reference cell lands BARE (req 27fbe40b) [REVERT-VERIFY]", () => {
  let live: Record<string, unknown>;
  let service: LayoutService;

  function build(initial: Record<string, unknown>): void {
    live = { ...initial };
    const tfile: TFile = Object.create(TFile.prototype);
    Object.assign(tfile, { path: PATH, basename: "task", name: "task.md", parent: null });

    const vault = {
      getAbstractFileByPath: jest.fn((p: string) => (p === PATH ? tfile : null)),
      getMarkdownFiles: jest.fn(() => [tfile]),
    } as unknown as Vault;
    const metadataCache = {
      getFileCache: jest.fn(() => ({ frontmatter: { ...live } })),
      getFirstLinkpathDest: jest.fn(() => null),
    } as unknown as MetadataCache;
    const fileManager = {
      processFrontMatter: jest.fn(async (_f: TFile, processor: (fm: Record<string, unknown>) => void) => {
        processor(live);
      }),
    } as unknown as FileManager;
    const app = { vault, fileManager, metadataCache } as unknown as App;

    const adapter = new ObsidianVaultAdapter(vault, metadataCache, app);
    const logger: ILogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const notifier: INotificationService = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      success: jest.fn(),
      confirm: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
    };
    service = new LayoutService(app, adapter, logger, notifier);
  }

  it(`F6 editing a reference cell with "[[uid]]" writes the BARE [[uid]] into the live frontmatter object — no embedded quotes ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", exo__Asset_label: "Task" });

    const result = await service.handleCellEdit(PATH, "ems__Effort_parent", `[[${PARENT_UID}]]`);

    expect(result.success).toBe(true);
    expect(live.ems__Effort_parent).toBe(`[[${PARENT_UID}]]`);
    expect(String(live.ems__Effort_parent)).not.toContain('"');
    // The rest of the object is re-emitted unchanged (PATCH via applyPatch).
    expect(live.exo__Asset_uid).toBe("u");
    expect(live.exo__Asset_label).toBe("Task");
  });

  it(`F6b a plain text cell is still written verbatim (control) ${REQ}`, async () => {
    build({ exo__Asset_uid: "u" });
    const result = await service.handleCellEdit(PATH, "exo__Asset_label", "New label");
    expect(result.success).toBe(true);
    expect(live.exo__Asset_label).toBe("New label");
  });
});
