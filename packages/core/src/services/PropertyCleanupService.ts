import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import type { ILogger } from "../interfaces/ILogger";
import { DI_TOKENS } from "../interfaces/tokens";
import { NullLogger } from "../infrastructure/NullLogger";

/**
 * Service for cleaning empty properties from file frontmatter
 */
@injectable()
export class PropertyCleanupService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    @inject(DI_TOKENS.ILogger) private logger: ILogger = NullLogger
  ) {
    this.logger.debug("PropertyCleanupService initialized");
  }

  /**
   * Remove all empty properties from file frontmatter
   * Empty properties are: null, undefined, "", [], {}
   */
  async cleanEmptyProperties(file: IFile): Promise<void> {
    this.logger.debug("Cleaning empty properties", { path: file.path });
    const fileContent = await this.vault.read(file);
    const updatedContent = this.removeEmptyPropertiesFromContent(fileContent);
    await this.vault.modify(file, updatedContent);
    this.logger.info("Empty properties cleaned", { path: file.path });
  }

  /**
   * Remove empty properties from file content
   */
  private removeEmptyPropertiesFromContent(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return content;
    }

    const frontmatterContent = match[1];
    const lines = frontmatterContent.split("\n");
    const cleanedLines: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === "") {
        cleanedLines.push(line);
        i++;
        continue;
      }

      // Check if this is a property line (key: value)
      const propertyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (propertyMatch) {
        const value = propertyMatch[2];

        // Check if this is a list property (value is empty and next lines are indented)
        if (value === "" && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (nextLine.match(/^\s+- /)) {
            // This is a list property, collect all list items
            const listItems: string[] = [];
            let j = i + 1;
            while (j < lines.length && lines[j].match(/^\s+- /)) {
              listItems.push(lines[j]);
              j++;
            }

            // Check if all list items are empty
            const allEmpty = listItems.every((item) => {
              const itemValue = item.replace(/^\s+- /, "").trim();
              return this.isEmptyValue(itemValue);
            });

            if (allEmpty) {
              // Skip the property key and all list items
              i = j;
              continue;
            } else {
              // Keep the property and its list items
              cleanedLines.push(line);
              for (let k = i + 1; k < j; k++) {
                cleanedLines.push(lines[k]);
              }
              i = j;
              continue;
            }
          }
        }

        // Check if value is empty (but not a list)
        if (this.isEmptyValue(value)) {
          // Skip this line (remove empty property)
          i++;
          continue;
        }

        // Keep non-empty property
        cleanedLines.push(line);
        i++;
      } else if (trimmed.match(/^\s*- /)) {
        // This is a list item without a property key (orphaned)
        // This shouldn't happen in valid YAML, but skip it
        i++;
      } else {
        // Not a property line (might be continuation), keep it
        cleanedLines.push(line);
        i++;
      }
    }

    const cleanedFrontmatter = cleanedLines.join("\n");
    // Issue #4528 (req `a00031b2-43cd-47fa-8486-4493e22f4386`) — the replacement
    // is a FUNCTION, not a string, and that is load-bearing. As a string, JS
    // interprets `$$`, `$&`, `` $` ``, `$'` and `$1`..`$99` inside it as special
    // replacement patterns — and the string here is built from the FILE'S OWN
    // frontmatter, so any such sequence in a surviving VALUE rewrote the file.
    // A function's return value is inserted verbatim
    // ([[string-replace-dollar-corruption]]).
    //
    // ⛔ Measured on `origin/main` `cbff7ef5` through this very service, bytes
    // read back (`ems__Effort_result: <value>` plus one empty property):
    //   `cost $& ref`   → the WHOLE matched block re-inserted inside the value:
    //                     a duplicate `exo__Asset_label`, the empty key the
    //                     repair had just removed RESURRECTED, a stray
    //                     `--- ref` and two closing `---` (93 → 155 bytes)
    //   `cost $1 ref`   → capture group 1 (the original frontmatter) inlined
    //   `cost $100`     → ⛔ an ORDINARY money value: `$1` expands and `00` is
    //                     appended, yielding `ems__Effort_area:00`
    //   `cost $` + backtick → everything BEFORE the match (empty) — silently deleted
    //   `cost $' ref`   → everything AFTER the match (the note BODY) swallowed
    //   `cost $$100`    → silently becomes `cost $100`
    //
    // ⛤ `$1` DOES expand here, unlike the generic floor's warning that a `$1`
    // fixture is vacuous: that holds for a pattern WITHOUT capture groups, and
    // `frontmatterRegex` has one. Measured, not inherited. The axes therefore
    // carry BOTH `$&` (survives a refactor that drops the group) and `$100`
    // (the realistic carrier: 79 live assets across the three canonical vaults
    // hold a frontmatter value with a form that actually corrupts, 2026-10-03).
    //
    // ⛔ ONLY THESE FORMS CORRUPT, and the list is from EXECUTION — every token
    // was pushed through this exact regex: `$$`, `$&`, `` $` ``, `$'`, `$01`, and
    // `$1` with any digits after it (`$10`, `$12`, `$100`, `$1000`). ⛔ `$0` and
    // `$2`..`$9` are INERT — with ONE capture group, group 2..9 does not exist,
    // so JS leaves the token literal and `cost $2 500` comes out byte-identical.
    // An earlier revision of this comment (and of commit 45d32a2c) said "169",
    // counting every `$`+digit bucket; that predicate was WIDER than "corrupts"
    // and inflated the figure 2.1×. The corrected sweep is deduped by
    // assetspace-relative path: 16 (vault-my) + 16 (vault-tbank) + 79
    // (vault-exodev), the first 16 being the same shared assetspace mounted
    // twice ⇒ 79 distinct. Hits by form: `$$` 147 · `$1` 44 · `` $` `` 8 ·
    // `$&` 6 · `$'` 4.
    //
    // ⛔ This is the REPAIR path (`apply clean-properties`, the sanctioned cure
    // for the empty-value class — founder decision #4274 / req `5d2c7ede`), i.e.
    // the one path whose entire job is to leave every surviving value
    // byte-identical. The cure corrupted what it was meant to preserve.
    //
    // ⛤ A splice-by-index would also work and is not needed: the regex is
    // `^`-anchored and non-global, so there is exactly one match and it starts
    // at index 0 — the only hazard was `$`-interpretation, which the function
    // replacer removes entirely, at a one-token diff.
    return content.replace(
      frontmatterRegex,
      () => `---\n${cleanedFrontmatter}\n---`,
    );
  }

  /**
   * Check if a value string represents an empty value
   */
  private isEmptyValue(value: string): boolean {
    const trimmed = value.trim();

    // Empty string
    if (trimmed === "") return true;

    // null or undefined
    if (trimmed === "null" || trimmed === "undefined") return true;

    // Empty array []
    if (trimmed === "[]") return true;

    // Empty object {}
    if (trimmed === "{}") return true;

    // Quoted empty string
    if (trimmed === '""' || trimmed === "''") return true;

    return false;
  }
}
