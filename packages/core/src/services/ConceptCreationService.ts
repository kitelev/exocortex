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
    );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const folderPath = "concepts";
    const filePath = `${folderPath}/${fullFileName}`;

    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.vault.createFolder(folderPath);
    }

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  private generateConceptFrontmatter(
    parentConceptName: string,
    definition: string,
    aliases: string[],
    uid: string,
  ): Record<string, unknown> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const frontmatter: Record<string, unknown> = {};
    frontmatter["exo__Asset_isDefinedBy"] = '"[[!concepts]]"';
    frontmatter["exo__Asset_uid"] = uid;
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${AssetClass.CONCEPT}]]"`];
    // `concept__Concept_genus`, NOT `concept__Concept_broader`: the latter is an
    // `exo__DeprecatedProperty` since 2026-07-26 whose `useInstead` names genus first
    // (06d389ff). Cardinality is Single, so this is a scalar wikilink, not a list.
    frontmatter["concept__Concept_genus"] = `"[[${parentConceptName}]]"`;
    frontmatter["concept__Concept_definition"] = definition;

    if (aliases.length > 0) {
      frontmatter["aliases"] = aliases;
    }

    return frontmatter;
  }
}
