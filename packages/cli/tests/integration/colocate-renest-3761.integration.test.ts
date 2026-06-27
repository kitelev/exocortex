import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { NodeFsAdapter } from "../../src/adapters/NodeFsAdapter.js";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

/**
 * Issue #3761 — co-located create path-doubling.
 *
 * A co-location folder resolver (`GroundingExecutor.parentFolderOf` /
 * `VaultFrontmatterRefToFolderResolver.parentFolderOf`) "relativizes" an
 * ABSOLUTE folder path by stripping its leading slash, yielding a fake-relative
 * `<vault-root-without-leading-slash>/assetspaces/...` string. That string is
 * NOT `path.isAbsolute`, so a vault adapter's `isAbsolute` early-return guard
 * misses it and `path.join(rootPath, fakeRelative)` nests the whole vault-root
 * path UNDER the vault root, `mkdir -p`-ing a phantom duplicate directory tree.
 *
 * Production-shape: drives the REAL adapters against a REAL temp filesystem
 * (no mocks) so the assertions observe the actual on-disk tree — the doubled
 * directory is a filesystem phenomenon, not a string-arg detail.
 *
 * Revert-verify (integration-test-revert-verify): with the re-nest guard
 * removed from `resolvePath`, the "leading-slash-stripped absolute" scenarios
 * recreate the phantom `<root>/<root-1st-segment>/...` tree (RED). With the
 * guard, the write lands in the correct co-located folder and no phantom tree
 * exists (GREEN). The relative / true-absolute regression scenarios pass both
 * ways.
 */
describe("#3761 — co-located create must not re-nest the vault root", () => {
  let root: string;
  const REL_FOLDER = "assetspaces/kitelev/exoas-tbank/tbank-efforts";
  const UID = "aaaa1111-2222-4333-8444-555566667777";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "exo-3761-"));
    await fs.ensureDir(path.join(root, REL_FOLDER));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  /** The directory the bug `mkdir -p`'d under the vault root, if it exists. */
  const phantomRootSegment = (): string => {
    // root e.g. "/var/folders/xx/exo-3761-yyy"; stripped → "var/..." → the
    // phantom tree begins at "<root>/var".
    const firstSegment = root.replace(/^\/+/, "").split("/")[0];
    return path.join(root, firstSegment);
  };

  const content = "---\nexo__Asset_uid: " + UID + "\n---\n";
  const correctTarget = (): string =>
    path.join(root, REL_FOLDER, `${UID}.md`);

  describe("NodeFsAdapter.createFile (the `apply create-instance` fileWriter)", () => {
    it("leading-slash-stripped absolute folder → writes to correct co-located folder, no phantom tree", async () => {
      const adapter = new NodeFsAdapter(root);
      // exactly what parentFolderOf produces from an absolute ontology folder
      const fakeRelative =
        root.replace(/^\/+/, "") + `/${REL_FOLDER}/${UID}.md`;

      await adapter.createFile(fakeRelative, content);

      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });

    it("ordinary vault-relative folder still works (regression guard)", async () => {
      const adapter = new NodeFsAdapter(root);
      await adapter.createFile(`${REL_FOLDER}/${UID}.md`, content);
      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });

    it("true-absolute folder inside the vault still works (regression guard)", async () => {
      const adapter = new NodeFsAdapter(root);
      await adapter.createFile(
        path.join(root, REL_FOLDER, `${UID}.md`),
        content,
      );
      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });

    it("guard holds when the adapter root has a trailing separator (robustness)", async () => {
      const adapter = new NodeFsAdapter(root + path.sep);
      const fakeRelative =
        root.replace(/^\/+/, "") + `/${REL_FOLDER}/${UID}.md`;
      await adapter.createFile(fakeRelative, content);
      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });
  });

  describe("FileSystemVaultAdapter (the `cli create` write path)", () => {
    it("leading-slash-stripped absolute folder → createFolder + create land correctly, no phantom tree", async () => {
      const adapter = new FileSystemVaultAdapter(root);
      const fakeFolder = root.replace(/^\/+/, "") + `/${REL_FOLDER}`;

      // mirrors GenericAssetCreationService.createAsset: createFolder then create
      await adapter.createFolder(fakeFolder);
      await adapter.create(`${fakeFolder}/${UID}.md`, content);

      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });

    it("ordinary vault-relative folder still works (regression guard)", async () => {
      const adapter = new FileSystemVaultAdapter(root);
      await adapter.createFolder(REL_FOLDER);
      await adapter.create(`${REL_FOLDER}/${UID}.md`, content);
      expect(await fs.pathExists(correctTarget())).toBe(true);
      expect(await fs.pathExists(phantomRootSegment())).toBe(false);
    });
  });
});
