import { WidgetType } from "@codemirror/view";
import { setIcon } from "obsidian";

/**
 * Result type for the onClick callback to support optimistic UI.
 */
export interface RedundantAliasRemoveClickResult {
  success: boolean;
  error?: string;
}

/**
 * Widget that displays an icon to remove a redundant alias from a wikilink.
 * Appears next to wikilinks where the alias equals the target's exo__Asset_label,
 * since the plugin already renders the label automatically.
 *
 * Clicking transforms [[uuid|Label]] → [[uuid]].
 *
 * Implements optimistic UI: icon hides immediately on click, reappears on error.
 */
export class RedundantAliasRemoveWidget extends WidgetType {
  private isProcessing = false;

  constructor(
    private readonly wikilinkFrom: number,
    private readonly wikilinkTo: number,
    private readonly targetPath: string,
    private readonly alias: string,
    private readonly onClick: (
      wikilinkFrom: number,
      wikilinkTo: number,
      targetPath: string,
      alias: string,
    ) => Promise<RedundantAliasRemoveClickResult>,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "exocortex-alias-remove-icon";
    span.setAttribute("aria-label", `Remove redundant alias "${this.alias}"`);
    span.setAttribute("data-target-path", this.targetPath);
    span.setAttribute("data-alias", this.alias);

    setIcon(span, "bookmark-minus");

    span.addEventListener("mouseenter", () => {
      span.classList.add("is-hovered");
    });

    span.addEventListener("mouseleave", () => {
      span.classList.remove("is-hovered");
    });

    span.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleClick(span);
    });

    return span;
  }

  private async handleClick(element: HTMLElement): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    element.classList.add("is-hidden");

    try {
      const result = await this.onClick(
        this.wikilinkFrom,
        this.wikilinkTo,
        this.targetPath,
        this.alias,
      );

      if (!result.success) {
        element.classList.remove("is-hidden");
      }
    } catch {
      element.classList.remove("is-hidden");
    } finally {
      this.isProcessing = false;
    }
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof RedundantAliasRemoveWidget)) {
      return false;
    }
    return (
      other.wikilinkFrom === this.wikilinkFrom &&
      other.wikilinkTo === this.wikilinkTo &&
      other.targetPath === this.targetPath &&
      other.alias === this.alias
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
