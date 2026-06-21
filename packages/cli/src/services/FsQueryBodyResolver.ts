import {
  type IQueryBodyResolver,
  type ITripleStore,
  IRI,
  Literal,
  Namespace,
  iriToVaultPath,
  extractSparqlBlock,
  stripFrontmatter,
} from "@kitelev/exocortex-core";
import type { IFileSystemReader } from "@kitelev/exocortex-core";

/**
 * RFC 78c2b7d0 C4 — CLI-side `IQueryBodyResolver` for `query__NamedQuery`
 * (and `exoql__Query`) SPARQL bodies.
 *
 * Resolution path (no Obsidian metadataCache available in the CLI):
 *   1. Look up the asset's file IRI in the already-hydrated triple store via
 *      `?s exo:Asset_uid "<uid>"`.
 *   2. Convert the `obsidian://vault/...` IRI to a vault-relative path
 *      (`iriToVaultPath`) and read the file through the injected fs reader.
 *   3. Strip frontmatter and extract the first ```sparql block (shared
 *      `extractSparqlBlock` — same M2-lock contract as
 *      `ObsidianQueryBodyResolver`).
 *
 * Returns `null` when the UID is unknown to the store, the IRI is not a vault
 * path, the file cannot be read, or no sparql block is present — callers fail
 * closed / fail loud as appropriate.
 */
export class FsQueryBodyResolver implements IQueryBodyResolver {
  constructor(
    private readonly tripleStore: ITripleStore,
    private readonly reader: IFileSystemReader,
  ) {}

  async resolveSparql(queryUid: string): Promise<string | null> {
    if (!queryUid) return null;

    const matches = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_uid"),
      new Literal(queryUid),
    );
    const subject = matches[0]?.subject;
    if (!(subject instanceof IRI)) return null;

    const relativePath = iriToVaultPath(subject.value);
    if (!relativePath) return null;

    let content: string;
    try {
      content = await this.reader.readFile(relativePath);
    } catch {
      return null;
    }

    return extractSparqlBlock(stripFrontmatter(content));
  }
}
