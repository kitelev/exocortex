import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { AssetClass } from "../domain/constants";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataExtractor } from "../utilities/MetadataExtractor";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class AreaCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async createChildArea(
    sourceFile: IFile,
    sourceMetadata: Record<string, any>,
    label?: string,
  ): Promise<IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;
    const frontmatter = this.generateChildAreaFrontmatter(
      sourceMetadata,
      sourceFile.basename,
      label,
      uid,
    );
    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const folderPath = sourceFile.parent?.path || "";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  generateChildAreaFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    label?: string,
    uid?: string,
  ): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const isDefinedBy = MetadataExtractor.extractIsDefinedBy(sourceMetadata);

    const frontmatter: Record<string, any> = {};
    frontmatter["exo__Asset_isDefinedBy"] =
      MetadataHelpers.ensureQuoted(isDefinedBy);
    frontmatter["exo__Asset_uid"] = uid || uuidv4();
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${AssetClass.AREA}]]"`];
    frontmatter["ems__Area_parent"] = `"[[${sourceName}]]"`;

    if (label && label.trim() !== "") {
      const trimmedLabel = label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
    }

    return frontmatter;
  }
}
