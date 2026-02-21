import { TFile, Notice, App } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCopyFleetingNoteLabel,
  LoggingService,
} from "exocortex";

/**
 * Command to copy the first line of body (label) from a fleeting note to clipboard.
 *
 * The label is extracted from the note body (first non-empty line after frontmatter).
 * This is useful for quickly referencing fleeting notes in other documents.
 *
 * Visibility: Only available for ztlk__FleetingNote assets.
 */
export class CopyFleetingNoteLabelCommand implements ICommand {
  id = "copy-fleeting-note-label";
  name = "Copy Label";

  constructor(private app: App) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCopyFleetingNoteLabel(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to copy label: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Copy fleeting note label error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const label = this.extractLabelFromContent(content);

    if (!label) {
      new Notice("Label is empty");
      return;
    }

    await navigator.clipboard.writeText(label);
    new Notice("Label copied to clipboard");
  }

  /**
   * Extracts the label (first non-empty line of body) from file content.
   *
   * @param content - Full file content including frontmatter
   * @returns The trimmed first line of body, or null if empty
   */
  private extractLabelFromContent(content: string): string | null {
    const lines = content.split("\n");

    // Find body start after frontmatter
    let bodyStartIndex = 0;
    if (lines[0] === "---") {
      // Find closing ---
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") {
          bodyStartIndex = i + 1;
          break;
        }
      }
    }

    // Find first non-empty line in body
    for (let i = bodyStartIndex; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (trimmedLine) {
        return trimmedLine;
      }
    }

    return null;
  }
}
