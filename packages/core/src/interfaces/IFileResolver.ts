import type { IRI } from "../domain/models/rdf/IRI";
import type { IFile } from "./IVaultAdapter";

/**
 * Resolves vault asset IRIs to concrete `IFile` handles.
 *
 * Decouples `LazyAssetGraphLoader` (and any future on-demand loader) from
 * the IRI→path encoding. Production wires a wrapper that strips the
 * `obsidian://vault/` prefix and URL-decodes the remainder, then delegates
 * to `IVaultFileReader.getAbstractFileByPath`. Tests inject in-memory fakes.
 *
 * Returning `null` for an unresolvable IRI is normal — the caller must
 * treat the absence gracefully (e.g. emit a warn-level diagnostic and
 * continue). Throwing from this method is reserved for genuine I/O errors.
 *
 * @see RFC c7da0bca Phase 2 — Lazy precondition evaluation
 */
export interface IFileResolver {
  /**
   * @param iri - The IRI of a vault asset (typically `obsidian://vault/...`).
   * @returns The corresponding `IFile`, or `null` when no file exists for
   *          this IRI (e.g. broken wikilink, IRI built from a value that
   *          doesn't correspond to a real vault asset).
   */
  resolveByIRI(iri: IRI): IFile | null;
}
