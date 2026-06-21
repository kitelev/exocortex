import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { FrontmatterService } from "../utilities/FrontmatterService";

/**
 * Archive an Exocortex asset by marking it `archived: true` (top-level
 * frontmatter) and removing `aliases`. Idempotent: a second call on an
 * already-archived asset without aliases is a no-op.
 *
 * This is the shared (plugin + CLI) implementation behind the
 * `archiveAsset` grounding service (Issue #2867). Semantics mirror the
 * legacy `cli archive` subcommand's `executeArchive`
 * (StatusCommandExecutor): in-place frontmatter mutation, no physical
 * file move. Batch cross-vault archival remains the separate domain of
 * `ArchiveService` / `cli archive`.
 */
@injectable()
export class ArchiveAssetService {
  private readonly frontmatterService = new FrontmatterService();

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async archiveAsset(file: IFile): Promise<void> {
    const content = await this.vault.read(file);
    let updated = this.frontmatterService.updateProperty(
      content,
      "archived",
      "true",
    );
    updated = this.frontmatterService.removeProperty(updated, "aliases");
    if (updated === content) return;
    await this.vault.modify(file, updated);
  }
}
