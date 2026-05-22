import type { App } from "obsidian";
import { createObsidianClassLabelResolver } from "../../../src/infrastructure/services/ObsidianClassLabelResolver";

/**
 * Issue #3220 — unit coverage for the metadata-cache-backed class-label → UID
 * resolver wired into GroundingExecutor by ExocortexPlugin.
 */
describe("createObsidianClassLabelResolver (#3220)", () => {
  const CLASS_FILE = { path: "assetspaces/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md" };
  const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

  function makeApp(opts: {
    dest?: unknown;
    frontmatter?: Record<string, unknown> | undefined;
    getFirstLinkpathDest?: unknown;
    getFileCache?: unknown;
  }): App {
    return {
      metadataCache: {
        getFirstLinkpathDest:
          opts.getFirstLinkpathDest ??
          jest.fn().mockReturnValue(opts.dest ?? null),
        getFileCache:
          opts.getFileCache ??
          jest.fn().mockReturnValue(
            opts.frontmatter !== undefined
              ? { frontmatter: opts.frontmatter }
              : {},
          ),
      },
    } as unknown as App;
  }

  it("resolves a label to the class file's exo__Asset_uid (alias-matched UUID-named TBox)", () => {
    const app = makeApp({
      dest: CLASS_FILE,
      frontmatter: { exo__Asset_uid: CLASS_UID, exo__Asset_label: "ems__Task" },
    });
    const resolve = createObsidianClassLabelResolver(app);
    expect(resolve("ems__Task")).toBe(CLASS_UID);
  });

  it("passes the requested label and empty source path to getFirstLinkpathDest", () => {
    const getFirstLinkpathDest = jest.fn().mockReturnValue(CLASS_FILE);
    const app = makeApp({
      getFirstLinkpathDest,
      frontmatter: { exo__Asset_uid: CLASS_UID },
    });
    createObsidianClassLabelResolver(app)("ems__Task");
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("ems__Task", "");
  });

  it("returns null when the label resolves to no file", () => {
    const app = makeApp({ dest: null });
    expect(createObsidianClassLabelResolver(app)("ems__Unknown")).toBeNull();
  });

  it("returns null when the resolved file has no exo__Asset_uid", () => {
    const app = makeApp({ dest: CLASS_FILE, frontmatter: { exo__Asset_label: "ems__Task" } });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("returns null when the resolved file has no frontmatter at all", () => {
    const app = makeApp({ dest: CLASS_FILE, frontmatter: undefined });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("returns null when exo__Asset_uid is a non-string / empty value", () => {
    const app = makeApp({ dest: CLASS_FILE, frontmatter: { exo__Asset_uid: "" } });
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });

  it("returns null gracefully when the metadata-cache API surface is unavailable", () => {
    const app = { metadataCache: {} } as unknown as App;
    expect(createObsidianClassLabelResolver(app)("ems__Task")).toBeNull();
  });
});
