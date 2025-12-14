import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { SupervisionFormData } from "../types/SupervisionFormData";
import { DateFormatter } from "../utilities/DateFormatter";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class SupervisionCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async createSupervision(formData: SupervisionFormData): Promise<IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;
    const frontmatter = this.generateFrontmatter(uid);
    const body = this.generateBody(formData);
    const fileContent = this.buildFileContent(frontmatter, body);

    const filePath = `01 Inbox/${fileName}`;

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  generateFrontmatter(uid: string): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    return {
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Asset_uid: uid,
      exo__Asset_createdAt: timestamp,
      exo__Instance_class: ['"[[ztlk__FleetingNote]]"'],
      ztlk__FleetingNote_type: '"[[CBT-Diary Record]]"',
    };
  }

  generateBody(formData: SupervisionFormData): string {
    const fields = [
      { label: "Ситуация/триггер", value: formData.situation },
      { label: "Эмоции", value: formData.emotions },
      { label: "Мысли", value: formData.thoughts },
      { label: "Поведение", value: formData.behavior },
      {
        label: "Краткосрочные последствия поведения",
        value: formData.shortTermConsequences,
      },
      {
        label: "Долгосрочные последствия поведения",
        value: formData.longTermConsequences,
      },
    ];

    return fields.map((field) => `- ${field.label}: ${field.value}`).join("\n");
  }

  private buildFileContent(
    frontmatter: Record<string, any>,
    body: string,
  ): string {
    const frontmatterLines = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const arrayItems = value.map((item) => `  - ${item}`).join("\n");
          return `${key}:\n${arrayItems}`;
        }
        return `${key}: ${value}`;
      })
      .join("\n");

    return `---\n${frontmatterLines}\n---\n\n${body}\n`;
  }
}
