import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { WikiLinkHelpers } from "../utilities/WikiLinkHelpers";
import { AssetClass } from "../domain/constants";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataExtractor } from "../utilities/MetadataExtractor";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Mapping of source class to effort property name
 * Implements Strategy pattern for property selection
 */
const EFFORT_PROPERTY_MAP: Record<string, string> = {
  [AssetClass.AREA]: "ems__Effort_area",
  [AssetClass.INITIATIVE]: "ems__Effort_parent",
  [AssetClass.PROJECT]: "ems__Effort_parent",
};

@injectable()
export class ProjectCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async createProject(
    sourceFile: IFile,
    sourceMetadata: Record<string, any>,
    sourceClass: string,
    label?: string,
  ): Promise<IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;
    const frontmatter = this.generateProjectFrontmatter(
      sourceMetadata,
      sourceFile.basename,
      sourceClass,
      label,
      uid,
    );
    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const folderPath = sourceFile.parent?.path || "";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  generateProjectFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    sourceClass: string,
    label?: string,
    uid?: string,
  ): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const isDefinedBy = MetadataExtractor.extractIsDefinedBy(sourceMetadata);

    // Get appropriate effort property name based on source class
    const cleanSourceClass = WikiLinkHelpers.normalize(sourceClass);
    const effortProperty =
      EFFORT_PROPERTY_MAP[cleanSourceClass] || "ems__Effort_area";

    const frontmatter: Record<string, any> = {};
    frontmatter["exo__Asset_isDefinedBy"] =
      MetadataHelpers.ensureQuoted(isDefinedBy);
    frontmatter["exo__Asset_uid"] = uid || uuidv4();
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${AssetClass.PROJECT}]]"`];
    frontmatter["ems__Effort_status"] = '"[[ems__EffortStatusDraft]]"';
    frontmatter[effortProperty] = `"[[${sourceName}]]"`;

    if (label && label.trim() !== "") {
      const trimmedLabel = label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
    }

    return frontmatter;
  }
}
