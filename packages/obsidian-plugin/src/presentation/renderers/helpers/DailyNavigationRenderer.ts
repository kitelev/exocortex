import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { MetadataExtractor, IVaultAdapter, DateFormatter, IFile } from "exocortex";
import { DailyNoteHelpers } from "./DailyNoteHelpers";
import { ObsidianApp } from '@plugin/types';

/**
 * Renders daily note navigation (previous/next day links)
 */
export class DailyNavigationRenderer {
  constructor(
    private app: ObsidianApp,
    private vaultAdapter: IVaultAdapter,
    private metadataExtractor: MetadataExtractor,
    private logger: ILogger,
  ) {}

  /**
   * Render daily navigation for a file
   */
  render(el: HTMLElement, file: TFile): void {
    const dailyNoteInfo = DailyNoteHelpers.extractDailyNoteInfo(
      file,
      this.metadataExtractor,
      this.logger,
    );

    if (!dailyNoteInfo.isDailyNote || !dailyNoteInfo.day) {
      return;
    }

    const currentDate = new Date(dailyNoteInfo.day);
    if (isNaN(currentDate.getTime())) {
      this.logger.debug(`Invalid date format: ${dailyNoteInfo.day}`);
      return;
    }

    const prevDate = DateFormatter.addDays(currentDate, -1);
    const nextDate = DateFormatter.addDays(currentDate, 1);

    const prevDateStr = DateFormatter.toDateString(prevDate);
    const nextDateStr = DateFormatter.toDateString(nextDate);

    const prevDailyNote = DailyNoteHelpers.findDailyNoteByDate(
      this.vaultAdapter,
      this.metadataExtractor,
      prevDateStr,
    );
    const nextDailyNote = DailyNoteHelpers.findDailyNoteByDate(
      this.vaultAdapter,
      this.metadataExtractor,
      nextDateStr,
    );

    const navContainer = el.createDiv({ cls: "exocortex-daily-navigation" });

    this.renderNavLink(navContainer, file, prevDailyNote, prevDateStr, "prev");
    this.renderNavLink(navContainer, file, nextDailyNote, nextDateStr, "next");
  }

  private renderNavLink(
    navContainer: HTMLElement,
    currentFile: TFile,
    targetNote: IFile | null,
    dateStr: string,
    direction: "prev" | "next",
  ): void {
    const spanClass = direction === "prev" ? "exocortex-nav-prev" : "exocortex-nav-next";
    const linkText = direction === "prev" ? `← ${dateStr}` : `${dateStr} →`;

    const span = navContainer.createSpan({ cls: spanClass });

    if (targetNote) {
      const link = span.createEl("a", {
        text: linkText,
        cls: "internal-link",
        attr: { "data-href": targetNote.path },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(targetNote.path, currentFile.path, false);
      });
    } else {
      span.createSpan({
        text: linkText,
        cls: "exocortex-nav-disabled",
      });
    }
  }
}
