import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { FolderRepairService } from "./FolderRepairService";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class ClassCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    @inject(DI_TOKENS.FolderRepairService)
    private folderRepair: FolderRepairService,
  ) {}

  async createSubclass(
    parentFile: IFile,
    label: string,
    parentMetadata: Record<string, unknown>,
  ): Promise<IFile> {
    const uid = uuidv4();

    const frontmatter = this.generateClassFrontmatter(
      parentFile.basename,
      label,
      uid,
      parentMetadata,
    );

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    // UUID-CANON TBOX (CLAUDE.md): TBox classes MUST be UID-named, never
    // label-named — so the symbolic-IRI subject scheme resolves and SHACL can
    // verify class membership. Mirrors Create Instance, which UID-names too.
    const fullFileName = `${uid}.md`;

    // CO-LOCATION INVARIANT (CLAUDE.md, RFC 0b7a2fad): place the new class in
    // the folder of its `exo__Asset_isDefinedBy` ontology, using the same
    // resolver as Create Instance (`$isDefinedByFolder`) / `apply
    // repair-folder` (FolderRepairService → IVaultAdapter.getFirstLinkpathDest).
    // The new class inherits the parent's isDefinedBy, so resolution targets
    // the parent's ontology folder. Falls back to the parent class's own
    // folder when the ontology ref can't be resolved (empty / `!`-anchor /
    // unresolvable isDefinedBy) — a degraded-but-co-located location matching
    // GroundingExecutor's host-folder fallback; the parent class is itself
    // co-located, so the subclass stays in-ontology either way.
    const resolvedFolder = this.folderRepair.getExpectedFolderSync(
      parentFile,
      frontmatter,
    );
    const folderPath =
      resolvedFolder ?? ClassCreationService.parentFolderOf(parentFile.path);

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

  /** Vault-relative parent folder of a file path ("" when at the vault root). */
  private static parentFolderOf(filePath: string | undefined): string {
    if (!filePath) return "";
    const normalized = filePath.replace(/^\/+/, "");
    const slashIdx = normalized.lastIndexOf("/");
    return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
  }

  private generateClassFrontmatter(
    parentClassName: string,
    label: string,
    uid: string,
    parentMetadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const frontmatter: Record<string, unknown> = {};
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
