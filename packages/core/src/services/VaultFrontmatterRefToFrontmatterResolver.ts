import type { IFileSystemMetadataProvider } from "../interfaces/IFileSystemAdapter";
import type { RefToFrontmatterResolver } from "./GroundingExecutor";

/**
 * req c03f9e3e — per-ontology efforts routing — filesystem-frontmatter-backed
 * {@link RefToFrontmatterResolver}, the CLI/headless counterpart of the plugin's
 * metadata-cache resolver (`createObsidianRefToFrontmatterResolver`).
 *
 * `GroundingExecutor` makes a SECOND hop when a create-instance grounding uses
 * the `targetRefProperty` token: from the click-target (an area) → the area's
 * `exo__Asset_isDefinedBy` ontology → that ontology's `exo__Ontology_effortsOntology`.
 * The core executor is storage-agnostic, so the host injects this resolver to map
 * a bare asset UID to the parsed frontmatter of the file it points at.
 *
 * Wiring this in the CLI keeps `apply <create-instance> <area>` routing-correct,
 * matching the plugin button (UI/CLI parity, Issue #3417). Returns `null` when
 * nothing matches; the executor then leaves isDefinedBy unrouted and co-locates
 * the new instance with the click-target rather than failing the create.
 */
export function createVaultFrontmatterRefToFrontmatterResolver(
  metadataProvider: IFileSystemMetadataProvider,
): RefToFrontmatterResolver {
  return async (ref: string): Promise<Record<string, unknown> | null> => {
    if (!ref) return null;

    const matches = await metadataProvider.findFilesByMetadata({
      exo__Asset_uid: ref,
    });
    if (matches.length === 0) return null;

    return metadataProvider.getFileMetadata(matches[0]);
  };
}
