import { injectable, inject } from "tsyringe";
import * as yaml from "js-yaml";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import {
  decodeYamlQuotedScalar,
  isCompleteDoubleQuotedScalar,
  needsYamlQuoting,
  quoteYamlString,
} from "../utilities/yamlScalar";

@injectable()
export class RenameToUidService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async renameToUid(file: IFile, metadata: Record<string, unknown>): Promise<void> {
    const uid = metadata.exo__Asset_uid;

    if (!uid || typeof uid !== "string") {
      throw new Error("Asset has no exo__Asset_uid property");
    }

    const currentBasename = file.basename;
    const targetBasename: string = uid;

    if (currentBasename === targetBasename) {
      throw new Error("File is already named according to UID");
    }

    const currentLabel = metadata.exo__Asset_label as string | undefined;
    const needsLabelUpdate = !currentLabel || currentLabel.trim() === "";
    const needsAliasUpdate = !this.isAssetArchived(metadata);

    if (needsLabelUpdate || needsAliasUpdate) {
      await this.updateFrontmatter(file, currentBasename, {
        setLabel: needsLabelUpdate,
        appendAlias: needsAliasUpdate,
      });
    }

    const folderPath = file.parent?.path || "";
    const newPath = folderPath
      ? `${folderPath}/${targetBasename}.md`
      : `${targetBasename}.md`;

    await this.vault.updateLinks(file.path, newPath, currentBasename);

    await this.vault.rename(file, newPath);
  }

  private async updateFrontmatter(
    file: IFile,
    basename: string,
    opts: { setLabel: boolean; appendAlias: boolean },
  ): Promise<void> {
    await this.vault.process(file, (content) => {
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = content.match(frontmatterRegex);

      if (!match) {
        return content;
      }

      let frontmatterContent = match[1];

      if (opts.setLabel) {
        frontmatterContent = `${frontmatterContent}\nexo__Asset_label: ${this.yamlScalar(basename)}`;
      }

      if (opts.appendAlias) {
        frontmatterContent = this.updateAliases(frontmatterContent, basename);
      }

      // Function replacer: the basename may contain `$1` / `$&` / `$$`, which a
      // STRING replacement would read as a replacement pattern (review MEDIUM).
      return content.replace(
        frontmatterRegex,
        () => `---\n${frontmatterContent}\n---`,
      );
    });
  }

  /**
   * Updates the aliases property in frontmatter content.
   * - If aliases doesn't exist: creates new aliases with the label
   * - If aliases is empty ([], null, ~, or no value): replaces with new aliases
   * - If aliases has existing values: appends the label if not already present
   */
  private updateAliases(frontmatterContent: string, label: string): string {
    // Check if aliases property exists
    const aliasesExistPattern = /^aliases\s*:/m;
    if (!aliasesExistPattern.test(frontmatterContent)) {
      // No aliases property - add new one
      return `${frontmatterContent}\naliases:\n  - ${this.yamlScalar(label)}`;
    }

    // Check for existing non-empty aliases in list format (  - value)
    const aliasesWithValuesPattern =
      /^aliases\s*:\s*\n((?:[ \t]*-[ \t]+[^\n]+\n?)+)/m;
    const aliasesWithValuesMatch = frontmatterContent.match(
      aliasesWithValuesPattern,
    );

    if (aliasesWithValuesMatch) {
      // Has existing aliases in list format - extract them and append new one
      const existingAliasesBlock = aliasesWithValuesMatch[1];
      const existingAliases = existingAliasesBlock
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .map((line) => line.replace(/^[ \t]*-[ \t]+/, "").trim());

      // Check if label already exists in aliases (avoid duplicates). The
      // items are the RAW list text; an alias stored quoted (`- "Foo"`, the
      // shape `apply set-label` writes) is the same alias as the plain
      // basename, so compare the DECODED value (ticket 77ffc37a).
      if (existingAliases.map(decodeYamlQuotedScalar).includes(label)) {
        // Already exists - no change needed
        return frontmatterContent;
      }

      // Append new alias to existing block. Splice by the MATCH POSITION: a
      // `replace(<block text>, …)` edited the FIRST occurrence of that text,
      // which is an identical list under an earlier key (`tags:`) when one
      // exists (review LOW-2), and it read `$…` in the basename as a
      // replacement pattern (review MEDIUM).
      const newAliasesBlock = `${existingAliasesBlock.trimEnd()}\n  - ${this.yamlScalar(label)}\n`;
      const blockStart =
        (aliasesWithValuesMatch.index ?? 0) +
        aliasesWithValuesMatch[0].length -
        existingAliasesBlock.length;
      return (
        frontmatterContent.slice(0, blockStart) +
        newAliasesBlock +
        frontmatterContent.slice(blockStart + existingAliasesBlock.length)
      );
    }

    // Check for inline array format aliases: [value1, value2]. The flow
    // sequence is delimited by a quote-aware bracket scan, not by the first
    // `]`: a quoted item may itself contain `]` (req 2f642d6c, Y11b), and the
    // sequence may span lines.
    const inlineHead = /^aliases\s*:[ \t]*\[/m.exec(frontmatterContent);
    const inlineEnd =
      inlineHead === null
        ? -1
        : this.findFlowSequenceEnd(
            frontmatterContent,
            inlineHead.index + inlineHead[0].length,
          );

    if (inlineHead !== null && inlineEnd !== -1) {
      const start = inlineHead.index;
      const bodyStart = inlineHead.index + inlineHead[0].length;
      const inlineContent = frontmatterContent.slice(bodyStart, inlineEnd).trim();
      const before = frontmatterContent.slice(0, start);
      const after = frontmatterContent.slice(inlineEnd + 1);
      if (inlineContent === "") {
        // Empty inline array - replace with list format
        return `${before}aliases:\n  - ${this.yamlScalar(label)}${after}`;
      }

      // Non-empty inline array - read the existing items with the YAML reader
      // (the same js-yaml the frontmatter parser uses) so a quoted item that
      // contains `,` or `]` is one item, not several (req 2f642d6c, Y11).
      // The raw text is kept for the rebuild below — the surrounding shape is
      // preserved, only the appended item is escaped.
      const existingAliases = this.readInlineFlowItems(inlineContent);

      if (existingAliases.includes(label)) {
        return frontmatterContent;
      }

      // Append new alias to inline array. A plain scalar inside a FLOW
      // sequence additionally reserves `,` `[` `]` `{` `}`, which the
      // quote-when-needed predicate does not model, so this item is always
      // emitted as a complete double-quoted scalar (ticket 77ffc37a).
      return `${before}aliases: [${inlineContent}, ${quoteYamlString(label)}]${after}`;
    }

    // Empty aliases property (aliases:, aliases: null, aliases: ~) - replace it
    const emptyAliasesPattern = /^aliases\s*:\s*(?:null|~)?\s*$/m;
    return frontmatterContent.replace(
      emptyAliasesPattern,
      () => `aliases:\n  - ${this.yamlScalar(label)}`,
    );
  }

  /**
   * Index of the `]` that closes the flow sequence whose `[` sits just before
   * `from`, skipping `"…"` (with `\"` escapes) and `'…'` runs and nested
   * brackets; -1 when unbalanced. Quote-aware so a quoted item containing `]`
   * does not end the sequence (req 2f642d6c, Y11b).
   */
  private findFlowSequenceEnd(text: string, from: number): number {
    let depth = 1;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        for (i++; i < text.length && text[i] !== '"'; i++) {
          if (text[i] === "\\") i++;
        }
      } else if (ch === "'") {
        for (i++; i < text.length && text[i] !== "'"; i++) {
          /* single-quoted: no escapes */
        }
      } else if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Items of an inline `aliases: […]` flow sequence, read by js-yaml with the
   * FAILSAFE schema: every item comes back as the STRING it spells (quotes
   * decoded, escapes resolved, no bool/number/date coercion), which is the
   * comparison the dedup needs — the label is text. The sequence was already
   * parsed as part of the asset's frontmatter, so it is valid YAML here.
   */
  private readInlineFlowItems(inlineContent: string): string[] {
    const parsed = yaml.load(`[${inlineContent}]`, {
      schema: yaml.FAILSAFE_SCHEMA,
    });
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  }

  /**
   * ONE escaper for every basename this service writes into frontmatter
   * (ticket 77ffc37a). Quote-when-needed keeps a safe basename in the plain
   * form it has always had (`  - old-name`), so the rename produces no quote
   * churn; a basename with a leading `-`, a `: `, a ` #`, a scalar-looking
   * shape (`2026-01-15`, `123`) or a control character becomes an escaped
   * double-quoted scalar via {@link quoteYamlString}. A basename that is
   * itself a complete `"…"` run is quoted too: `serializeYamlScalar`'s
   * pass-through exists for pre-wrapped wikilinks, and here the text IS the
   * value — passing it through verbatim would make `aliases[0] !== basename`.
   */
  private yamlScalar(value: string): string {
    return needsYamlQuoting(value, true) || isCompleteDoubleQuotedScalar(value)
      ? quoteYamlString(value)
      : value;
  }

  /** Shared reader — same three carrier spellings as every other consumer (req 960d7a3f). */
  private isAssetArchived(metadata: Record<string, unknown>): boolean {
    return MetadataHelpers.isAssetArchived(metadata);
  }
}
