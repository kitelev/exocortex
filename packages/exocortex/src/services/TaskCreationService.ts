import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { WikiLinkHelpers } from "../utilities/WikiLinkHelpers";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import { AssetClass } from "../domain/constants";
import { TaskFrontmatterGenerator } from "./TaskFrontmatterGenerator";
import { AlgorithmExtractor } from "./AlgorithmExtractor";
import * as IVaultAdapterModule from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class TaskCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapterModule.IVaultAdapter,
    private frontmatterGenerator: TaskFrontmatterGenerator,
    private algorithmExtractor: AlgorithmExtractor,
  ) {}

  async createTask(
    sourceFile: IVaultAdapterModule.IFile,
    sourceMetadata: Record<string, any>,
    sourceClass: string,
    label?: string,
    taskSize?: string | null,
    plannedStartTimestamp?: string,
  ): Promise<IVaultAdapterModule.IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;
    const frontmatter = this.frontmatterGenerator.generateTaskFrontmatter(
      sourceMetadata,
      sourceFile.basename,
      sourceClass,
      label,
      uid,
      taskSize,
      plannedStartTimestamp,
    );

    let bodyContent = "";
    const cleanSourceClass = WikiLinkHelpers.normalize(sourceClass);
    if (cleanSourceClass === AssetClass.TASK_PROTOTYPE) {
      const prototypeContent = await this.vault.read(sourceFile);
      const algorithmSection = this.algorithmExtractor.extractH2Section(
        prototypeContent,
        "Algorithm",
      );
      if (algorithmSection) {
        bodyContent = `## Algorithm\n\n${algorithmSection}`;
      }
    }

    const fileContent = MetadataHelpers.buildFileContent(
      frontmatter,
      bodyContent,
    );

    const folderPath = sourceFile.parent?.path || "";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  async createRelatedTask(
    sourceFile: IVaultAdapterModule.IFile,
    sourceMetadata: Record<string, any>,
    label?: string,
    taskSize?: string | null,
  ): Promise<IVaultAdapterModule.IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;

    const frontmatter =
      this.frontmatterGenerator.generateRelatedTaskFrontmatter(
        sourceMetadata,
        sourceFile.basename,
        label,
        uid,
        taskSize,
      );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const folderPath = sourceFile.parent?.path || "";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const createdFile = await this.vault.create(filePath, fileContent);

    await this.addRelationToSourceFile(sourceFile, uid);

    return createdFile;
  }

  generateTaskFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    sourceClass: string,
    label?: string,
    uid?: string,
    taskSize?: string | null,
    plannedStartTimestamp?: string,
  ): Record<string, any> {
    return this.frontmatterGenerator.generateTaskFrontmatter(
      sourceMetadata,
      sourceName,
      sourceClass,
      label,
      uid,
      taskSize,
      plannedStartTimestamp,
    );
  }

  // Used only by unit tests via (service as any).generateRelatedTaskFrontmatter
  // @ts-ignore - Used by tests through type casting
  private generateRelatedTaskFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    label?: string,
    uid?: string,
    taskSize?: string | null,
  ): Record<string, any> {
    return this.frontmatterGenerator.generateRelatedTaskFrontmatter(
      sourceMetadata,
      sourceName,
      label,
      uid,
      taskSize,
    );
  }

  // Used only by unit tests via (service as any).extractH2Section
  // @ts-ignore - Used by tests through type casting
  private extractH2Section(content: string, heading: string): string | null {
    return this.algorithmExtractor.extractH2Section(content, heading);
  }

  private async addRelationToSourceFile(
    sourceFile: IVaultAdapterModule.IFile,
    newTaskUid: string,
  ): Promise<void> {
    const content = await this.vault.read(sourceFile);
    const updatedContent = this.addRelationToFrontmatter(content, newTaskUid);
    await this.vault.modify(sourceFile, updatedContent);
  }

  private addRelationToFrontmatter(
    content: string,
    relatedTaskUid: string,
  ): string {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    if (!match) {
      const newFrontmatter = `---${lineEnding}exo__Asset_relates:${lineEnding}  - "[[${relatedTaskUid}]]"${lineEnding}---${lineEnding}${content}`;
      return newFrontmatter;
    }

    const frontmatterContent = match[1];
    let updatedFrontmatter = frontmatterContent;

    if (updatedFrontmatter.includes("exo__Asset_relates:")) {
      const relatesMatch = updatedFrontmatter.match(
        /exo__Asset_relates:\r?\n((?: {2}- .*\r?\n)*)/,
      );
      if (relatesMatch) {
        const existingItems = relatesMatch[1];
        const newItem = `  - "[[${relatedTaskUid}]]"${lineEnding}`;
        updatedFrontmatter = updatedFrontmatter.replace(
          /exo__Asset_relates:\r?\n((?: {2}- .*\r?\n)*)/,
          `exo__Asset_relates:${lineEnding}${existingItems}${newItem}`,
        );
      }
    } else {
      updatedFrontmatter += `${lineEnding}exo__Asset_relates:${lineEnding}  - "[[${relatedTaskUid}]]"`;
    }

    return content.replace(
      frontmatterRegex,
      `---${lineEnding}${updatedFrontmatter}${lineEnding}---`,
    );
  }
}
