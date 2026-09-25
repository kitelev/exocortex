import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import { AssetClass } from "../domain/constants";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class ConceptCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async createNarrowerConcept(
    parentFile: IFile,
    fileName: string,
    definition: string,
    aliases: string[],
  ): Promise<IFile> {
    const uid = uuidv4();
    const fullFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;

    const frontmatter = this.generateConceptFrontmatter(
      parentFile.basename,
      definition,
      aliases,
      uid,
      await this.inheritedAnchor(parentFile),
    );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    // Beside the PARENT, not in a hardcoded top-level folder (#4291-sibling, issue #4357).
    //
    // `"concepts"` addressed the vault ROOT, which is outside every assetspace — the file
    // belonged to no data repository and ExoSync therefore never carried it: a concept created
    // on one device simply did not exist on another. Measured on vault-my: the root has exactly
    // two entries (`01 Inbox`, `assetspaces`) and no `concepts/` at all, so the first creation
    // also CREATED the stray folder. Real concepts live in `exoas-concept/concept`,
    // `exoas-public/concept` and `exoas-shared-private/concepts{,-private}` — three different
    // assetspaces, which is why no single literal can be right.
    //
    // The parent is an existing, correctly-placed concept, so inheriting its folder is
    // co-location BY CONSTRUCTION rather than by a second resolution that could disagree with it.
    const folderPath = ConceptCreationService.folderOf(parentFile.path);
    const filePath = folderPath ? `${folderPath}/${fullFileName}` : fullFileName;

    if (folderPath) {
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        await this.vault.createFolder(folderPath);
      }
    }

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  /** The parent's folder, or "" when the parent sits at the vault root. */
  private static folderOf(filePath: string): string {
    const cut = filePath.lastIndexOf("/");
    return cut > 0 ? filePath.slice(0, cut) : "";
  }

  /**
   * The parent's `exo__Asset_isDefinedBy`, so the child declares the ontology it is actually
   * co-located with.
   *
   * Falls back to the previous `[[!concepts]]` when the parent has no anchor: a bang-prefixed
   * anchor is fail-open for `audit co-location`, which is exactly why the old placement bug could
   * not be caught by that audit — so the fallback is kept for compatibility, not relied upon.
   */
  private async inheritedAnchor(parentFile: IFile): Promise<string | null> {
    // Feature-detected disk fallback, NOT the cached reader alone: `getFrontmatter` is
    // backed by Obsidian's metadataCache, which is cold on a reset index, a fresh device
    // or right after an ExoSync pull (those write through `vault.adapter`, which does not
    // refresh the cache). A cold read returns null, the anchor silently degrades to the
    // fail-open `[[!concepts]]` sentinel, and the co-location this fix exists to restore
    // is lost again — invisibly, because a bang anchor is fail-open for `audit
    // co-location` by design. Same guard as NoteToRDFConverter.convertNote, which carries
    // a measured live incident (4 of 7 buttons gone until the cache warmed, 2026-08-29).
    const fm = this.vault.getFrontmatterWithFallback
      ? await this.vault.getFrontmatterWithFallback(parentFile)
      : this.vault.getFrontmatter(parentFile);
    const raw = fm?.["exo__Asset_isDefinedBy"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private generateConceptFrontmatter(
    parentConceptName: string,
    definition: string,
    aliases: string[],
    uid: string,
    inheritedAnchor: string | null,
  ): Record<string, unknown> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const frontmatter: Record<string, unknown> = {};
    frontmatter["exo__Asset_isDefinedBy"] = inheritedAnchor ?? "[[!concepts]]";
    frontmatter["exo__Asset_uid"] = uid;
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${AssetClass.CONCEPT}]]"`];
    // `concept__Concept_genus`, NOT `concept__Concept_broader`: the latter is an
    // `exo__DeprecatedProperty` since 2026-07-26 whose `useInstead` names genus first
    // (06d389ff). Cardinality is Single, so this is a scalar wikilink, not a list.
    frontmatter["concept__Concept_genus"] = `[[${parentConceptName}]]`;
    frontmatter["concept__Concept_definition"] = definition;

    if (aliases.length > 0) {
      frontmatter["aliases"] = aliases;
    }

    return frontmatter;
  }
}
