import type {
  IFile,
  IFileResolver,
  IFolder,
  IRI,
  IVaultFileReader,
} from "exocortex";
import { iriToVaultPath } from "exocortex";

/**
 * Production `IFileResolver` for the Obsidian runtime.
 *
 * Translates an `obsidian://vault/<encoded-path>` IRI back into a vault
 * `IFile` by:
 *   1. Stripping the scheme prefix and URL-decoding (via `iriToVaultPath`).
 *   2. Looking up the path through `IVaultFileReader.getAbstractFileByPath`.
 *   3. Returning `null` when the path doesn't resolve to a file, when it
 *      resolves to a folder, or when the IRI doesn't carry the
 *      `obsidian://vault/` scheme at all.
 *
 * Stateless — safe to share a single instance across all renders. The
 * underlying `IVaultFileReader` is itself stateless from this caller's
 * perspective (it just looks up Obsidian's existing in-memory file tree).
 *
 * @see RFC `c7da0bca` Phase 3 — wires this into the cold-start path
 *      via `LazyAssetGraphLoader.ensureLoadedByIRI`.
 */
export class ObsidianFileResolver implements IFileResolver {
  constructor(private readonly vaultReader: IVaultFileReader) {}

  resolveByIRI(iri: IRI): IFile | null {
    const path = iriToVaultPath(iri.value);
    if (path === null) return null;
    const result = this.vaultReader.getAbstractFileByPath(path);
    if (result === null) return null;
    if (this.isFolder(result)) return null;
    return result;
  }

  /**
   * Discriminate `IFile` from `IFolder` via the `basename` field
   * (present on files, absent on folders). Avoids a runtime instanceof
   * check against Obsidian's `TFolder` class (the adapter has already
   * mapped to the role interfaces, so we only see the data shape).
   */
  private isFolder(node: IFile | IFolder): node is IFolder {
    return !("basename" in node);
  }
}
