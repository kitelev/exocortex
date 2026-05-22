import type { App, TFile } from "obsidian";
import { createObsidianClassLabelResolver } from "../../../src/infrastructure/services/ObsidianClassLabelResolver";

/**
 * Issue #3223 — unit coverage for the alias-index-backed class-label → UID
 * resolver wired into GroundingExecutor by ExocortexPlugin. Replaces the
 * #3220 test suite that stubbed `getFirstLinkpathDest` to satisfy a wrong
 * assumption about Obsidian's API.
 *
 * Test fakes model the real Obsidian API contract: aliases are read from
 * cached frontmatter per file via `metadataCache.getFileCache(file)`. There
 * is no autonomous alias-resolving entry point — clients must iterate files.
 */
describe("createObsidianClassLabelResolver (#3223)", () => {
  type FakeFile = TFile;

  const file = (path: string): FakeFile => ({ path } as unknown as FakeFile);

  const CLASS_FILE = file("assetspaces/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md");
  const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

  const OTHER_FILE = file("assetspaces/ems/d70eb2ba-e0ac-401d-af3e-958fdde89fa2.md");
  const OTHER_UID = "d70eb2ba-e0ac-401d-af3e-958fdde89fa2";

  function makeApp(opts: {
    files?: FakeFile[];
    frontmatters?: Map<string, Record<string, unknown> | undefined>;
    getMarkdownFiles?: unknown;
    getFileCache?: unknown;
  }): App {
    const files = opts.files ?? [];
    const fmMap = opts.frontmatters ?? new Map();
    return {
      vault: {
        getMarkdownFiles:
          opts.getMarkdownFiles ?? jest.fn().mockReturnValue(files),
      },
      metadataCache: {
        getFileCache:
          opts.getFileCache ??
          jest.fn().mockImplementation((f: FakeFile) => {
            const fm = fmMap.get(f.path);
            return fm !== undefined ? { frontmatter: fm } : null;
          }),
      },
    } as unknown as App;
  }

  it("resolves a label via aliases:[…] array on UUID-named TBox file", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [
          CLASS_FILE.path,
          {
            exo__Asset_uid: CLASS_UID,
            exo__Asset_label: "ems__Task",
            aliases: ["ems__Task"],
          },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBe(CLASS_UID);
  });

  it("resolves a label via exo__Asset_label when aliases is absent", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [
          CLASS_FILE.path,
          { exo__Asset_uid: CLASS_UID, exo__Asset_label: "ems__Task" },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBe(CLASS_UID);
  });

  it("resolves via single-string aliases value (Obsidian YAML quirk)", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [
          CLASS_FILE.path,
          { exo__Asset_uid: CLASS_UID, aliases: "ems__Task" },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBe(CLASS_UID);
  });

  it("skips files whose substring-containing labels do NOT exact-match", () => {
    // Reproduces the vault-2025 scenario: several ems__Task_* siblings exist;
    // bare "ems__Task" must match only the canonical TBox, not ems__Task_size etc.
    const app = makeApp({
      files: [OTHER_FILE, CLASS_FILE],
      frontmatters: new Map([
        [
          OTHER_FILE.path,
          {
            exo__Asset_uid: OTHER_UID,
            exo__Asset_label: "ems__Task_size",
            aliases: ["ems__Task_size"],
          },
        ],
        [
          CLASS_FILE.path,
          {
            exo__Asset_uid: CLASS_UID,
            exo__Asset_label: "ems__Task",
            aliases: ["ems__Task"],
          },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBe(CLASS_UID);
  });

  it("returns null when no file's aliases or label match", () => {
    const app = makeApp({
      files: [OTHER_FILE],
      frontmatters: new Map([
        [
          OTHER_FILE.path,
          {
            exo__Asset_uid: OTHER_UID,
            exo__Asset_label: "ems__Task_size",
            aliases: ["ems__Task_size"],
          },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Unknown")).toBeNull();
  });

  it("returns null when the matching file has no exo__Asset_uid", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [CLASS_FILE.path, { aliases: ["ems__Task"] }],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("returns null when the matching file's exo__Asset_uid is non-string/empty", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [CLASS_FILE.path, { aliases: ["ems__Task"], exo__Asset_uid: "" }],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("skips files without cached frontmatter (getFileCache returns null)", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      // No frontmatters Map entries → getFileCache returns null for every file.
    });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("returns null for empty label", () => {
    const app = makeApp({
      files: [CLASS_FILE],
      frontmatters: new Map([
        [
          CLASS_FILE.path,
          {
            exo__Asset_uid: CLASS_UID,
            aliases: ["ems__Task"],
            exo__Asset_label: "ems__Task",
          },
        ],
      ]),
    });
    expect(createObsidianClassLabelResolver(app)("")).toBeNull();
  });

  it("returns null gracefully when vault or metadata-cache surface is unavailable", () => {
    const noVault = { metadataCache: { getFileCache: jest.fn() } } as unknown as App;
    expect(createObsidianClassLabelResolver(noVault)("ems__Task")).toBeNull();

    const noMetadata = { vault: { getMarkdownFiles: () => [] } } as unknown as App;
    expect(createObsidianClassLabelResolver(noMetadata)("ems__Task")).toBeNull();

    const partial = {
      vault: {},
      metadataCache: {},
    } as unknown as App;
    expect(createObsidianClassLabelResolver(partial)("ems__Task")).toBeNull();
  });

  it("iterates files via vault.getMarkdownFiles and reads cache via metadataCache.getFileCache", () => {
    const getMarkdownFiles = jest.fn().mockReturnValue([CLASS_FILE]);
    const getFileCache = jest.fn().mockReturnValue({
      frontmatter: { exo__Asset_uid: CLASS_UID, aliases: ["ems__Task"] },
    });
    const app = makeApp({ getMarkdownFiles, getFileCache });
    createObsidianClassLabelResolver(app)("ems__Task");
    expect(getMarkdownFiles).toHaveBeenCalled();
    expect(getFileCache).toHaveBeenCalledWith(CLASS_FILE);
  });
});
