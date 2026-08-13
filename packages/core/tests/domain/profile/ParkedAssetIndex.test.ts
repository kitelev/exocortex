import {
  ParkedAssetIndex,
  type ParkedVaultReader,
} from "../../../src/domain/profile/ParkedAssetIndex";
import { PARKED_ROOT } from "../../../src/domain/profile/ParkedMountState";

/**
 * req `c171e24d-15d3-4073-a34b-f6e78d3bc15f` — an asset in a PARKED AssetSpace
 * is findable through the adapter, and an asset that exists nowhere is not.
 *
 * The fake reader models a FILESYSTEM, not an index: it answers `list`/`read`
 * for anything actually written into it, including dot-folders. That is the
 * production contract of `vault.adapter` and the exact property this feature
 * stands on — an index-backed fake would make every assertion here vacuous
 * (it could not see the parked root at all).
 */
function makeReader(files: Record<string, string>): ParkedVaultReader {
  const dirsOf = (path: string): string => {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  };
  // ⛔ Read the map on EVERY call, never snapshot it: the invalidate test mutates
  // `files` mid-run to model an unpark, and a snapshot would make the fake — not
  // the index — the thing under test.
  const currentPaths = (): string[] => Object.keys(files);
  const currentDirs = (): Set<string> => {
    const dirs = new Set<string>();
    for (const p of currentPaths()) {
      let d = dirsOf(p);
      while (d.length > 0) {
        dirs.add(d);
        d = dirsOf(d);
      }
    }
    return dirs;
  };
  return {
    exists: (path) =>
      Promise.resolve(currentDirs().has(path) || files[path] !== undefined),
    list: (path) => {
      const prefix = `${path}/`;
      const childFiles: string[] = [];
      const childFolders = new Set<string>();
      for (const p of currentPaths()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (rest.includes("/")) {
          childFolders.add(`${prefix}${rest.split("/")[0]}`);
        } else {
          childFiles.push(p);
        }
      }
      return Promise.resolve({
        files: childFiles,
        folders: Array.from(childFolders),
      });
    },
    read: (path) => {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: ${path}`));
      }
      return Promise.resolve(content);
    },
  };
}

const PARKED_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const PARKED_PATH = `${PARKED_ROOT}/kitelev/exoas-concepts/concepts/${PARKED_UID}.md`;

const PARKED_FILES: Record<string, string> = {
  [PARKED_PATH]: [
    "---",
    `exo__Asset_uid: ${PARKED_UID}`,
    "exo__Asset_label: МОЧИ",
    "exo__Instance_class:",
    '  - "[[65b58c34-7451-4b89-bea3-483f7c65fe73]]"',
    "---",
    "",
    "body",
  ].join("\n"),
  "assetspaces/kitelev/exoas-my/my/active.md": "---\nexo__Asset_label: Active\n---\n",
};

describe("ParkedAssetIndex", () => {
  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f finds a parked asset and reports its own label plus the AssetSpace holding it", async () => {
    const index = new ParkedAssetIndex(makeReader(PARKED_FILES));

    const hit = await index.lookup(PARKED_UID);

    expect(hit).not.toBeNull();
    expect(hit?.label).toBe("МОЧИ");
    expect(hit?.assetSpace).toBe("kitelev/exoas-concepts");
    expect(hit?.path).toBe(PARKED_PATH);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f NEGATIVE CONTROL — an asset that exists nowhere yields no hit, so a genuinely broken link stays broken", async () => {
    const index = new ParkedAssetIndex(makeReader(PARKED_FILES));

    await expect(index.lookup("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f NEGATIVE CONTROL — an ACTIVE (non-parked) asset is not reported as parked", async () => {
    const index = new ParkedAssetIndex(makeReader(PARKED_FILES));

    await expect(index.lookup("active")).resolves.toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f normalizes wikilink brackets, a heading ref and the .md suffix before lookup", async () => {
    const index = new ParkedAssetIndex(makeReader(PARKED_FILES));

    await expect(index.lookup(`[[${PARKED_UID}.md#Section]]`)).resolves.toMatchObject({
      assetSpace: "kitelev/exoas-concepts",
    });
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f reports a labelless parked asset with a null label rather than inventing one", async () => {
    const uid = "aaaaaaaa-0000-0000-0000-000000000001";
    const index = new ParkedAssetIndex(
      makeReader({
        [`${PARKED_ROOT}/kitelev/exoas-x/ns/${uid}.md`]: `---\nexo__Asset_uid: ${uid}\n---\n`,
      }),
    );

    const hit = await index.lookup(uid);

    expect(hit).not.toBeNull();
    expect(hit?.label).toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f reads a quoted label without its quotes", async () => {
    const uid = "aaaaaaaa-0000-0000-0000-000000000002";
    const index = new ParkedAssetIndex(
      makeReader({
        [`${PARKED_ROOT}/kitelev/exoas-x/ns/${uid}.md`]:
          `---\nexo__Asset_label: "Курс: БАД"\n---\n`,
      }),
    );

    expect((await index.lookup(uid))?.label).toBe("Курс: БАД");
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f does not spill a multi-line list value into the label", async () => {
    const uid = "aaaaaaaa-0000-0000-0000-000000000003";
    const index = new ParkedAssetIndex(
      makeReader({
        [`${PARKED_ROOT}/kitelev/exoas-x/ns/${uid}.md`]: [
          "---",
          "exo__Asset_label:",
          "  - first",
          "  - second",
          "---",
        ].join("\n"),
      }),
    );

    expect((await index.lookup(uid))?.label).toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f skips a nested dot-folder so a parked repo's own .git is never walked", async () => {
    const uid = "aaaaaaaa-0000-0000-0000-000000000004";
    const index = new ParkedAssetIndex(
      makeReader({
        [`${PARKED_ROOT}/kitelev/exoas-x/.git/objects/${uid}.md`]:
          `---\nexo__Asset_label: Hidden\n---\n`,
      }),
    );

    await expect(index.lookup(uid)).resolves.toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f ignores a stray file that does not sit under an <owner>/<repo> pair", async () => {
    const uid = "aaaaaaaa-0000-0000-0000-000000000005";
    const index = new ParkedAssetIndex(
      makeReader({
        [`${PARKED_ROOT}/${uid}.md`]: `---\nexo__Asset_label: Stray\n---\n`,
      }),
    );

    await expect(index.lookup(uid)).resolves.toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f re-walks after invalidate, so an asset activated by apply-profile stops reading as parked", async () => {
    const files = { ...PARKED_FILES };
    const index = new ParkedAssetIndex(makeReader(files));

    expect(await index.lookup(PARKED_UID)).not.toBeNull();

    // Simulate the unpark: the file is no longer under the parked root. Without
    // invalidation the cached directory listing would still report it.
    delete files[PARKED_PATH];
    expect(await index.lookup(PARKED_UID)).not.toBeNull();

    index.invalidate();
    expect(await index.lookup(PARKED_UID)).toBeNull();
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f walks the parked root only once for concurrent lookups", async () => {
    const reader = makeReader(PARKED_FILES);
    let listCalls = 0;
    const counting: ParkedVaultReader = {
      exists: reader.exists.bind(reader),
      read: reader.read.bind(reader),
      list: (path) => {
        listCalls += 1;
        return reader.list(path);
      },
    };
    const index = new ParkedAssetIndex(counting);

    await Promise.all([
      index.lookup(PARKED_UID),
      index.lookup(PARKED_UID),
      index.lookup("nothing"),
    ]);
    const afterFirstWalk = listCalls;

    await index.lookup(PARKED_UID);

    expect(afterFirstWalk).toBeGreaterThan(0);
    expect(listCalls).toBe(afterFirstWalk);
  });
});
