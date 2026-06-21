/**
 * T1 "Create Instance" (project bbe40f8c) — unit tests for the CLI/headless
 * {@link createVaultFrontmatterRefToFolderResolver}. Pure delegation over
 * `findFilesByMetadata({exo__Asset_uid})`; the fake provider keeps the branch
 * matrix focused. Real NodeFsAdapter integration is exercised via the apply
 * CLI path.
 */
import { createVaultFrontmatterRefToFolderResolver } from "../../../src/services/VaultFrontmatterRefToFolderResolver";
import type { IFileSystemMetadataProvider } from "../../../src/interfaces/IFileSystemAdapter";

function makeProvider(
  uidMatches: Record<string, string[]>,
): IFileSystemMetadataProvider {
  return {
    async findFilesByMetadata(
      query: Record<string, unknown>,
    ): Promise<string[]> {
      if ("exo__Asset_uid" in query) {
        return uidMatches[String(query.exo__Asset_uid)] ?? [];
      }
      return [];
    },
    async getFileMetadata(): Promise<Record<string, unknown>> {
      return {};
    },
    async findFileByUID(): Promise<string | null> {
      return null;
    },
  } as IFileSystemMetadataProvider;
}

describe("createVaultFrontmatterRefToFolderResolver (T1 co-location)", () => {
  it("resolves a UID to the parent folder of its file", async () => {
    const provider = makeProvider({
      "086f71fa-dd30-4284-90cf-e609f2a6c461": [
        "assetspaces/kitelev/exoas-ems/ems/086f71fa-dd30-4284-90cf-e609f2a6c461.md",
      ],
    });
    const resolve = createVaultFrontmatterRefToFolderResolver(provider);
    expect(await resolve("086f71fa-dd30-4284-90cf-e609f2a6c461")).toBe(
      "assetspaces/kitelev/exoas-ems/ems",
    );
  });

  it("returns empty string for a file at the vault root", async () => {
    const provider = makeProvider({ "root-uid": ["root-uid.md"] });
    const resolve = createVaultFrontmatterRefToFolderResolver(provider);
    expect(await resolve("root-uid")).toBe("");
  });

  it("returns null when the UID matches no file", async () => {
    const provider = makeProvider({});
    const resolve = createVaultFrontmatterRefToFolderResolver(provider);
    expect(await resolve("missing")).toBeNull();
  });

  it("returns null for an empty ref", async () => {
    const provider = makeProvider({});
    const resolve = createVaultFrontmatterRefToFolderResolver(provider);
    expect(await resolve("")).toBeNull();
  });
});
