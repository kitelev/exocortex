/**
 * LayoutService.handleCellEdit → REAL ObsidianVaultAdapter — the cell-edit
 * writer speaks the core chokepoint's key dialect (req `de7131ae`, Scenarios
 * A/B/C/E; tickets `3aa8a7dd`).
 *
 * Drives the PRODUCTION entry point (`handleCellEdit`) through the production
 * adapter so the wiring is locked, not only the helper: the adapter's
 * `processFrontMatter` is the single mocked seam (a plain object stands in for
 * Obsidian's live frontmatter). Each axis is revert-verified by a mutant that
 * removes ONE guarantee (table in the PR body).
 *
 * @req:de7131ae-f9e5-4498-bf06-41ccbaadc7de
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
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

const REQ = "@req:de7131ae-f9e5-4498-bf06-41ccbaadc7de";
const PATH = "tasks/legacy.md";

describe("LayoutService.handleCellEdit → ObsidianVaultAdapter — archive-flag key parity (req de7131ae) [REVERT-VERIFY]", () => {
  let live: Record<string, unknown>;
  let service: LayoutService;
  let tfile: TFile;

  /** Build the service over a REAL adapter whose only seam is `processFrontMatter`. */
  function build(initial: Record<string, unknown>): void {
    live = { ...initial };
    tfile = Object.create(TFile.prototype);
    Object.assign(tfile, { path: PATH, basename: "legacy", name: "legacy.md", parent: null });

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

  const archivedKeys = (fm: Record<string, unknown>): string[] =>
    Object.keys(fm).filter((k) => k.toLowerCase().includes("archived"));

  beforeEach(() => {
    mockSparql.updateFile.mockClear();
  });

  it(`A6 (Scenario A) editing the exo__Asset_archived column of a legacy carrier leaves exactly ONE archive key on disk ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", archived: true });
    const result = await service.handleCellEdit(PATH, "exo__Asset_archived", false);
    expect(result.success).toBe(true);
    expect(archivedKeys(live)).toEqual(["exo__Asset_archived"]);
    expect(live.exo__Asset_archived).toBe(false);
    expect(live.exo__Asset_uid).toBe("u");
  });

  it(`A7 (Scenario B) a column bound to the bare legacy name \`archived\` is upgraded to exo__Asset_archived ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", archived: true });
    const result = await service.handleCellEdit(PATH, "archived", false);
    expect(result.success).toBe(true);
    expect(live).toEqual({ exo__Asset_uid: "u", exo__Asset_archived: false });
  });

  it(`A8 (Scenario C) a dual carrier edited through the bare column keeps the EDIT, not the stale canonical value ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", archived: true, exo__Asset_archived: false });
    const result = await service.handleCellEdit(PATH, "archived", true);
    expect(result.success).toBe(true);
    expect(live).toEqual({ exo__Asset_uid: "u", exo__Asset_archived: true });
  });

  it(`A13 (Scenario E) editing an UNRELATED column of a legacy carrier migrates the flag, value preserved ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", exo__Asset_label: "Old", archived: true });
    const result = await service.handleCellEdit(PATH, "exo__Asset_label", "New");
    expect(result.success).toBe(true);
    expect(live).toEqual({ exo__Asset_uid: "u", exo__Asset_label: "New", exo__Asset_archived: true });
  });

  it(`A14 (IRI-form column) a full-IRI property name lands on the canonical key ${REQ}`, async () => {
    build({ exo__Asset_uid: "u", archived: true });
    const result = await service.handleCellEdit(
      PATH,
      "https://exocortex.my/ontology/exo#Asset_archived",
      false,
    );
    expect(result.success).toBe(true);
    expect(live).toEqual({ exo__Asset_uid: "u", exo__Asset_archived: false });
  });
});
