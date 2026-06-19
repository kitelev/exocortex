import type { IFileSystemMetadataProvider } from "../interfaces/IFileSystemAdapter";
import type { RefToFolderResolver } from "./GroundingExecutor";

/**
 * T1 "Create Instance" homoiconic button (project bbe40f8c) — filesystem-
 * frontmatter-backed {@link RefToFolderResolver}, the CLI/headless counterpart
 * of the plugin's metadata-cache resolver (`createObsidianRefToFolderResolver`).
 *
 * `GroundingExecutor.executeCreateInstance` co-locates a new instance in its
 * chosen `exo__Asset_isDefinedBy` ontology's folder (co-location invariant)
 * when the grounding's `targetFolder` is the `$isDefinedByFolder` token. The
 * core executor is storage-agnostic, so the host injects this resolver to map
 * a bare asset UID to the vault-relative folder of the file it points at.
 *
 * Wiring this in the CLI keeps `apply <create-instance> <class>` co-location-
 * correct, matching the plugin button (UI/CLI parity, Issue #3417). Returns
 * `null` when nothing matches; the executor then falls back to the host folder
 * rather than failing the create.
 */
export function createVaultFrontmatterRefToFolderResolver(
  metadataProvider: IFileSystemMetadataProvider,
): RefToFolderResolver {
  return async (ref: string): Promise<string | null> => {
    if (!ref) return null;

    const matches = await metadataProvider.findFilesByMetadata({
      exo__Asset_uid: ref,
    });
    if (matches.length === 0) return null;

    return parentFolderOf(matches[0]);
  };
}

/** Vault-relative parent folder of a path (empty string at vault root). */
function parentFolderOf(filePath: string): string {
  const normalized = filePath.replace(/^\/+/, "");
  const slashIdx = normalized.lastIndexOf("/");
  return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
}
