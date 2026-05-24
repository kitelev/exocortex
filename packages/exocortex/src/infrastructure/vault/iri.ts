export const OBSIDIAN_VAULT_SCHEME = "obsidian://vault/";

export function vaultPathToIRI(relativePath: string): string {
  const normalized = relativePath.startsWith("./")
    ? relativePath.slice(2)
    : relativePath;
  return `${OBSIDIAN_VAULT_SCHEME}${encodeURI(normalized)}`;
}

/**
 * Inverse of `vaultPathToIRI`. Strips the `obsidian://vault/` scheme
 * prefix and URL-decodes the remainder back into a vault-relative path.
 *
 * Returns `null` when the input does NOT carry the expected prefix —
 * caller can treat that as "not a vault asset IRI" and skip lookup.
 *
 * Round-trip property (by construction):
 *   iriToVaultPath(vaultPathToIRI(p)) === p, for any `p` that does not
 *   start with `./` (the prefix is normalised away by vaultPathToIRI).
 *
 * @example
 *   iriToVaultPath("obsidian://vault/My%20Folder/Note.md")
 *     === "My Folder/Note.md"
 *   iriToVaultPath("https://example.com/foo") === null
 */
export function iriToVaultPath(iri: string): string | null {
  if (!iri.startsWith(OBSIDIAN_VAULT_SCHEME)) return null;
  const encoded = iri.slice(OBSIDIAN_VAULT_SCHEME.length);
  try {
    return decodeURI(encoded);
  } catch {
    // URIError on malformed escape sequence — treat as "not resolvable".
    return null;
  }
}
