import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';

/**
 * Manages collapse/expand state for layout sections
 */
export class SectionStateManager {
  private collapsedSections: Map<string, boolean>;

  constructor(defaultSections: string[] = [
    "properties", "buttons", "daily-tasks", "area-tree", "relations"
  ]) {
    this.collapsedSections = new Map(defaultSections.map(id => [id, false]));
  }

  /**
   * Check if a section is collapsed
   */
  isCollapsed(sectionId: string): boolean {
    return this.collapsedSections.get(sectionId) || false;
  }

  /**
   * Toggle the collapsed state of a section
   */
  toggle(sectionId: string, container: HTMLElement): void {
    const currentState = this.collapsedSections.get(sectionId) || false;
    this.collapsedSections.set(sectionId, !currentState);

    const contentElement = container.querySelector(".exocortex-section-content") as HTMLElement;
    const toggleButton = container.querySelector(".exocortex-section-toggle") as HTMLElement;

    if (contentElement && toggleButton) {
      const newState = !currentState;
      contentElement.setAttribute("data-collapsed", newState.toString());
      toggleButton.textContent = newState ? "▶" : "▼";
      toggleButton.setAttribute("aria-expanded", (!newState).toString());
      toggleButton.setAttribute("aria-label", `${newState ? "Expand" : "Collapse"} section`);
    }
  }

  /**
   * Render a collapsible section header with toggle button
   */
  renderHeader(
    container: HTMLElement,
    sectionId: string,
    title: string,
    eventManager: EventListenerManager,
  ): void {
    const isCollapsed = this.isCollapsed(sectionId);

    const header = container.createDiv({ cls: "exocortex-section-header" });

    const toggleButton = header.createEl("button", {
      cls: "exocortex-section-toggle",
      attr: {
        "aria-expanded": (!isCollapsed).toString(),
        "aria-label": `${isCollapsed ? "Expand" : "Collapse"} ${title}`,
        "type": "button",
      },
    });
    toggleButton.textContent = isCollapsed ? "▶" : "▼";

    eventManager.register(toggleButton, "click", (e: Event) => {
      e.stopPropagation();
      this.toggle(sectionId, container);
    });

    eventManager.register(toggleButton, "keydown", (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      if (keyboardEvent.key === " " || keyboardEvent.key === "Enter") {
        e.preventDefault();
        this.toggle(sectionId, container);
      }
    });

    header.createEl("h3", { text: title });
  }

  /**
   * Returns the number of sections being tracked.
   */
  get size(): number {
    return this.collapsedSections.size;
  }

  /**
   * Clears all section states.
   * Should be called in cleanup() methods.
   */
  cleanup(): void {
    this.collapsedSections.clear();
  }
}
