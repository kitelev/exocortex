import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { FrontmatterService } from "../utilities/FrontmatterService";

/**
 * Repair missing `exo__Asset_label` by deriving the label from the file's
 * basename. Idempotent: when the asset already has a non-empty label the
 * service is a no-op.
 *
 * This is the shared (plugin + CLI) implementation behind the
 * `fixMissingLabel` grounding service (Issue #2870). The starter-kit
 * "Fix Missing Label" command is gated on a SPARQL ASK precondition that
 * matches assets with a UID but no `exo__Asset_label`, so in practice the
 * service is only invoked when a repair is required — but the handler
 * still checks defensively and skips when the value is already present.
 *
 * `file.basename` is used verbatim per the Obsidian TFile contract
 * (no extension) — see memory `feedback_file_basename_obsidian_tfile_contract`.
 */
@injectable()
export class FixMissingLabelService {
  private readonly frontmatterService = new FrontmatterService();

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async fixMissingLabel(file: IFile): Promise<void> {
    const content = await this.vault.read(file);
    if (this.hasNonEmptyLabel(content)) return;
    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Asset_label",
      file.basename,
    );
    if (updated === content) return;
    await this.vault.modify(file, updated);
  }

  private hasNonEmptyLabel(content: string): boolean {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) return false;
    const match = parsed.content.match(
      /^exo__Asset_label:\s*(.*)$/m,
    );
    if (!match) return false;
    const raw = match[1].trim();
    if (raw === "" || raw === '""' || raw === "''") return false;
    return true;
  }
}
