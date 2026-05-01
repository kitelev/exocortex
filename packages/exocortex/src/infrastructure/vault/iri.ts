export const OBSIDIAN_VAULT_SCHEME = "obsidian://vault/";

export function vaultPathToIRI(relativePath: string): string {
  const normalized = relativePath.startsWith("./")
    ? relativePath.slice(2)
    : relativePath;
  return `${OBSIDIAN_VAULT_SCHEME}${encodeURI(normalized)}`;
}
