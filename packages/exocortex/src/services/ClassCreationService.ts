import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class ClassCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async createSubclass(
    parentFile: IFile,
    label: string,
    parentMetadata: Record<string, any>,
  ): Promise<IFile> {
    const uid = uuidv4();
    const fileName = this.generateFileName(label);
    const fullFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;

    const frontmatter = this.generateClassFrontmatter(
      parentFile.basename,
      label,
      uid,
      parentMetadata,
    );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const folderPath = "classes";
    const filePath = `${folderPath}/${fullFileName}`;

    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.vault.createFolder(folderPath);
    }

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  private generateFileName(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private generateClassFrontmatter(
    parentClassName: string,
    label: string,
    uid: string,
    parentMetadata: Record<string, any>,
  ): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const frontmatter: Record<string, any> = {};
    frontmatter["exo__Asset_uid"] = uid;
    frontmatter["exo__Asset_label"] = label;
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[exo__Class]]"`];
    frontmatter["exo__Class_superClass"] = `"[[${parentClassName}]]"`;

    const isDefinedBy =
      parentMetadata.exo__Asset_isDefinedBy || '"[[Ontology/EXO]]"';
    frontmatter["exo__Asset_isDefinedBy"] = isDefinedBy;

    frontmatter["aliases"] = [label];

    return frontmatter;
  }
}
