/**
 * ContextMenuRenderer - DOM-based context menu rendering
 *
 * Renders context menus as DOM elements for graph visualization:
 * - Keyboard-navigable menu structure
 * - Submenu support with animated transitions
 * - Smart positioning to stay within viewport
 * - Icon and keyboard shortcut display
 * - Accessible ARIA attributes
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type {
  ContextMenuState,
  ContextMenuItem,
  ContextMenuTarget,
  ContextMenuRenderer as IContextMenuRenderer,
  Point,
} from "./ContextMenuManager";

/**
 * Configuration for ContextMenuRenderer
 */
export interface ContextMenuRendererConfig {
  /** CSS class prefix for styling (default: 'exo-context-menu') */
  classPrefix: string;
  /** Maximum width of the menu (default: 240) */
  maxWidth: number;
  /** Offset from cursor position (default: { x: 2, y: 2 }) */
  offset: Point;
  /** Animation duration in ms (default: 150) */
  animationDuration: number;
  /** Z-index for the menu (default: 10000) */
  zIndex: number;
  /** Whether to enable keyboard navigation (default: true) */
  enableKeyboardNavigation: boolean;
  /** Submenu open delay in ms (default: 200) */
  submenuDelay: number;
}

/**
 * Set CSS custom properties on an element
 */
function setCssProps(element: HTMLElement, props: Record<string, string>): void {
  for (const [key, value] of Object.entries(props)) {
    element.style.setProperty(key, value);
  }
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ContextMenuRendererConfig = {
  classPrefix: "exo-context-menu",
  maxWidth: 240,
  offset: { x: 2, y: 2 },
  animationDuration: 150,
  zIndex: 10000,
  enableKeyboardNavigation: true,
  submenuDelay: 200,
};

/**
 * ContextMenuRenderer - DOM-based context menu implementation
 *
 * @example
 * ```typescript
 * const renderer = new ContextMenuRenderer(document.body, {
 *   classPrefix: 'my-context-menu',
 *   maxWidth: 280,
 * });
 *
 * renderer.setActionHandler((item, target) => {
 *   console.log("Clicked:", item.id);
 * });
 *
 * renderer.render({
 *   visible: true,
 *   position: { x: 100, y: 100 },
 *   target: { type: 'node', nodeId: '1', node },
 *   items: [...],
 * });
 * ```
 */
export class ContextMenuRenderer implements IContextMenuRenderer {
  private container: HTMLElement;
  private config: ContextMenuRendererConfig;
  private menuElement: HTMLElement | null = null;
  private visible = false;

  // Current state for re-rendering
  private currentState: ContextMenuState | null = null;

  // Action handler callback
  private actionHandler: ((item: ContextMenuItem, target: ContextMenuTarget) => void) | null = null;

  // Keyboard navigation state
  private focusedIndex = -1;
  private activeSubmenu: HTMLElement | null = null;
  private submenuTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound event handlers
  private boundHandleKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundHandleClick: ((e: MouseEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    config?: Partial<ContextMenuRendererConfig>
  ) {
    this.container = container;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the action handler for menu item clicks
   */
  setActionHandler(handler: (item: ContextMenuItem, target: ContextMenuTarget) => void): void {
    this.actionHandler = handler;
  }

  /**
   * Render the context menu
   */
  render(state: ContextMenuState): void {
    this.currentState = state;

    if (!state.visible || state.items.length === 0) {
      this.hide();
      return;
    }

    // Remove existing menu
    this.removeMenuElement();

    // Create menu element
    this.menuElement = this.createMenuElement(state.items);

    // Position the menu
    this.positionMenu(state.position);

    // Add to DOM
    this.container.appendChild(this.menuElement);

    // Setup event listeners
    this.setupEventListeners();

    // Animate in
    requestAnimationFrame(() => {
      if (this.menuElement) {
        this.menuElement.classList.add(`${this.config.classPrefix}--visible`);
      }
    });

    this.visible = true;
    this.focusedIndex = -1;
  }

  /**
   * Hide the context menu
   */
  hide(): void {
    if (!this.visible) {
      return;
    }

    this.clearSubmenuTimer();
    this.removeEventListeners();

    if (this.menuElement) {
      // Animate out
      this.menuElement.classList.remove(`${this.config.classPrefix}--visible`);

      // Remove after animation
      const menu = this.menuElement;
      setTimeout(() => {
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
      }, this.config.animationDuration);
    }

    this.menuElement = null;
    this.visible = false;
    this.focusedIndex = -1;
    this.activeSubmenu = null;
  }

  /**
   * Check if menu is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update menu position
   */
  updatePosition(position: Point): void {
    if (!this.menuElement) {
      return;
    }
    this.positionMenu(position);
  }

  /**
   * Destroy the renderer
   */
  destroy(): void {
    this.hide();
    this.removeMenuElement();
    this.actionHandler = null;
    this.currentState = null;
  }

  /**
   * Create the menu DOM element
   */
  private createMenuElement(items: ContextMenuItem[]): HTMLElement {
    const menu = document.createElement("div");
    menu.className = this.config.classPrefix;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Context menu");
    menu.style.maxWidth = `${this.config.maxWidth}px`;
    menu.style.zIndex = String(this.config.zIndex);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemElement = this.createMenuItemElement(item, i);
      menu.appendChild(itemElement);

      if (item.separator && i < items.length - 1) {
        const separator = document.createElement("div");
        separator.className = `${this.config.classPrefix}__separator`;
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
      }
    }

    return menu;
  }

  /**
   * Create a menu item DOM element
   */
  private createMenuItemElement(item: ContextMenuItem, index: number): HTMLElement {
    const element = document.createElement("div");
    element.className = `${this.config.classPrefix}__item`;
    element.setAttribute("role", "menuitem");
    element.setAttribute("data-item-id", item.id);
    element.setAttribute("data-index", String(index));
    element.setAttribute("tabindex", "-1");

    if (item.disabled) {
      element.classList.add(`${this.config.classPrefix}__item--disabled`);
      element.setAttribute("aria-disabled", "true");
    }

    if (item.danger) {
      element.classList.add(`${this.config.classPrefix}__item--danger`);
    }

    if (item.submenu && item.submenu.length > 0) {
      element.classList.add(`${this.config.classPrefix}__item--has-submenu`);
      element.setAttribute("aria-haspopup", "true");
      element.setAttribute("aria-expanded", "false");
    }

    // Icon
    if (item.icon) {
      const iconElement = document.createElement("span");
      iconElement.className = `${this.config.classPrefix}__icon`;
      const svgElement = this.createIconSvg(item.icon);
      if (svgElement) {
        iconElement.appendChild(svgElement);
      }
      element.appendChild(iconElement);
    } else {
      // Spacer for alignment
      const spacer = document.createElement("span");
      spacer.className = `${this.config.classPrefix}__icon-spacer`;
      element.appendChild(spacer);
    }

    // Label
    const labelElement = document.createElement("span");
    labelElement.className = `${this.config.classPrefix}__label`;
    labelElement.textContent = item.label;
    element.appendChild(labelElement);

    // Shortcut or submenu arrow
    if (item.submenu && item.submenu.length > 0) {
      const arrowElement = document.createElement("span");
      arrowElement.className = `${this.config.classPrefix}__arrow`;
      const arrowSvg = this.createIconSvg("chevron-right");
      if (arrowSvg) {
        arrowElement.appendChild(arrowSvg);
      }
      element.appendChild(arrowElement);
    } else if (item.shortcut) {
      const shortcutElement = document.createElement("span");
      shortcutElement.className = `${this.config.classPrefix}__shortcut`;
      shortcutElement.textContent = item.shortcut;
      element.appendChild(shortcutElement);
    }

    // Event handlers
    if (!item.disabled) {
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.submenu && item.submenu.length > 0) {
          this.toggleSubmenu(element, item);
        } else {
          this.handleItemClick(item);
        }
      });

      element.addEventListener("mouseenter", () => {
        this.handleItemHover(element, item, index);
      });

      element.addEventListener("mouseleave", () => {
        if (!item.submenu) {
          this.clearSubmenuTimer();
        }
      });
    }

    return element;
  }

  /**
   * Handle menu item click
   */
  private handleItemClick(item: ContextMenuItem): void {
    if (item.disabled) {
      return;
    }

    if (this.actionHandler && this.currentState?.target) {
      this.actionHandler(item, this.currentState.target);
    }
  }

  /**
   * Handle menu item hover
   */
  private handleItemHover(element: HTMLElement, item: ContextMenuItem, index: number): void {
    this.focusedIndex = index;

    // Highlight current item
    this.clearFocusHighlight();
    element.classList.add(`${this.config.classPrefix}__item--focused`);

    // Close existing submenu if hovering different item
    if (this.activeSubmenu && !element.classList.contains(`${this.config.classPrefix}__item--has-submenu`)) {
      this.closeSubmenu();
    }

    // Open submenu after delay
    if (item.submenu && item.submenu.length > 0) {
      this.scheduleSubmenuOpen(element, item);
    }
  }

  /**
   * Schedule submenu open with delay
   */
  private scheduleSubmenuOpen(parentElement: HTMLElement, item: ContextMenuItem): void {
    this.clearSubmenuTimer();
    this.submenuTimer = setTimeout(() => {
      this.openSubmenu(parentElement, item);
    }, this.config.submenuDelay);
  }

  /**
   * Clear submenu timer
   */
  private clearSubmenuTimer(): void {
    if (this.submenuTimer !== null) {
      clearTimeout(this.submenuTimer);
      this.submenuTimer = null;
    }
  }

  /**
   * Open a submenu
   */
  private openSubmenu(parentElement: HTMLElement, item: ContextMenuItem): void {
    if (!item.submenu || item.submenu.length === 0) {
      return;
    }

    // Close existing submenu
    this.closeSubmenu();

    // Create submenu
    const submenu = document.createElement("div");
    submenu.className = `${this.config.classPrefix} ${this.config.classPrefix}--submenu`;
    submenu.setAttribute("role", "menu");
    submenu.style.maxWidth = `${this.config.maxWidth}px`;
    submenu.style.zIndex = String(this.config.zIndex + 1);

    for (let i = 0; i < item.submenu.length; i++) {
      const subItem = item.submenu[i];
      const itemElement = this.createMenuItemElement(subItem, i);
      submenu.appendChild(itemElement);

      if (subItem.separator && i < item.submenu.length - 1) {
        const separator = document.createElement("div");
        separator.className = `${this.config.classPrefix}__separator`;
        separator.setAttribute("role", "separator");
        submenu.appendChild(separator);
      }
    }

    // Position submenu
    const parentRect = parentElement.getBoundingClientRect();

    // Set initial position via CSS custom properties
    setCssProps(submenu, {
      "--context-menu-top": `${parentRect.top}px`,
      "--context-menu-left": `${parentRect.right + 2}px`,
      "--context-menu-max-width": `${this.config.maxWidth}px`,
      "--context-menu-z-index": String(this.config.zIndex + 1),
    });

    // Add to DOM
    this.container.appendChild(submenu);

    // Check if submenu goes off-screen and adjust
    const submenuRect = submenu.getBoundingClientRect();
    if (submenuRect.right > window.innerWidth) {
      // Open to the left instead
      setCssProps(submenu, {
        "--context-menu-left": `${parentRect.left - submenuRect.width - 2}px`,
      });
    }
    if (submenuRect.bottom > window.innerHeight) {
      setCssProps(submenu, {
        "--context-menu-top": `${window.innerHeight - submenuRect.height - 8}px`,
      });
    }

    // Animate in
    requestAnimationFrame(() => {
      submenu.classList.add(`${this.config.classPrefix}--visible`);
    });

    // Update parent element
    parentElement.setAttribute("aria-expanded", "true");
    this.activeSubmenu = submenu;
  }

  /**
   * Close the active submenu
   */
  private closeSubmenu(): void {
    if (!this.activeSubmenu) {
      return;
    }

    const submenu = this.activeSubmenu;
    submenu.classList.remove(`${this.config.classPrefix}--visible`);

    setTimeout(() => {
      if (submenu.parentNode) {
        submenu.parentNode.removeChild(submenu);
      }
    }, this.config.animationDuration);

    // Update parent element
    const parentItems = this.menuElement?.querySelectorAll(`[aria-expanded="true"]`);
    parentItems?.forEach((item) => {
      item.setAttribute("aria-expanded", "false");
    });

    this.activeSubmenu = null;
  }

  /**
   * Toggle submenu visibility
   */
  private toggleSubmenu(parentElement: HTMLElement, item: ContextMenuItem): void {
    if (this.activeSubmenu) {
      this.closeSubmenu();
    } else {
      this.openSubmenu(parentElement, item);
    }
  }

  /**
   * Clear focus highlight from all items
   */
  private clearFocusHighlight(): void {
    const focusedItems = this.menuElement?.querySelectorAll(`.${this.config.classPrefix}__item--focused`);
    focusedItems?.forEach((item) => {
      item.classList.remove(`${this.config.classPrefix}__item--focused`);
    });
  }

  /**
   * Position the menu within the viewport
   */
  private positionMenu(position: Point): void {
    if (!this.menuElement) {
      return;
    }

    const menu = this.menuElement;
    // Set position via CSS custom properties
    setCssProps(menu, {
      "--context-menu-left": `${position.x + this.config.offset.x}px`,
      "--context-menu-top": `${position.y + this.config.offset.y}px`,
      "--context-menu-max-width": `${this.config.maxWidth}px`,
      "--context-menu-z-index": String(this.config.zIndex),
    });

    // After adding to DOM, check bounds
    requestAnimationFrame(() => {
      if (!menu.parentNode) {
        return;
      }

      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position
      if (menuRect.right > viewportWidth) {
        setCssProps(menu, {
          "--context-menu-left": `${viewportWidth - menuRect.width - 8}px`,
        });
      }
      if (menuRect.left < 0) {
        setCssProps(menu, {
          "--context-menu-left": "8px",
        });
      }

      // Adjust vertical position
      if (menuRect.bottom > viewportHeight) {
        setCssProps(menu, {
          "--context-menu-top": `${viewportHeight - menuRect.height - 8}px`,
        });
      }
      if (menuRect.top < 0) {
        setCssProps(menu, {
          "--context-menu-top": "8px",
        });
      }
    });
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    if (this.config.enableKeyboardNavigation) {
      this.boundHandleKeyDown = this.handleKeyDown.bind(this);
      document.addEventListener("keydown", this.boundHandleKeyDown);
    }

    // Click outside to close
    this.boundHandleClick = (e: MouseEvent) => {
      if (this.menuElement && !this.menuElement.contains(e.target as Node)) {
        if (!this.activeSubmenu || !this.activeSubmenu.contains(e.target as Node)) {
          this.hide();
        }
      }
    };
    // Delay to prevent immediate close
    setTimeout(() => {
      if (this.boundHandleClick) {
        document.addEventListener("click", this.boundHandleClick);
      }
    }, 0);
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    if (this.boundHandleKeyDown) {
      document.removeEventListener("keydown", this.boundHandleKeyDown);
      this.boundHandleKeyDown = null;
    }
    if (this.boundHandleClick) {
      document.removeEventListener("click", this.boundHandleClick);
      this.boundHandleClick = null;
    }
  }

  /**
   * Handle keyboard navigation
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.visible || !this.menuElement) {
      return;
    }

    const items = this.menuElement.querySelectorAll(
      `.${this.config.classPrefix}__item:not(.${this.config.classPrefix}__item--disabled)`
    );

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.focusedIndex = (this.focusedIndex + 1) % items.length;
        this.updateFocus(items);
        break;

      case "ArrowUp":
        e.preventDefault();
        this.focusedIndex = this.focusedIndex <= 0 ? items.length - 1 : this.focusedIndex - 1;
        this.updateFocus(items);
        break;

      case "ArrowRight":
        if (this.focusedIndex >= 0) {
          const currentItem = items[this.focusedIndex] as HTMLElement;
          if (currentItem.classList.contains(`${this.config.classPrefix}__item--has-submenu`)) {
            e.preventDefault();
            const itemId = currentItem.getAttribute("data-item-id");
            const item = this.currentState?.items.find((i) => i.id === itemId);
            if (item) {
              this.openSubmenu(currentItem, item);
            }
          }
        }
        break;

      case "ArrowLeft":
        if (this.activeSubmenu) {
          e.preventDefault();
          this.closeSubmenu();
        }
        break;

      case "Enter":
      case " ":
        if (this.focusedIndex >= 0) {
          e.preventDefault();
          (items[this.focusedIndex] as HTMLElement).click();
        }
        break;

      case "Escape":
        e.preventDefault();
        this.hide();
        break;

      case "Home":
        e.preventDefault();
        this.focusedIndex = 0;
        this.updateFocus(items);
        break;

      case "End":
        e.preventDefault();
        this.focusedIndex = items.length - 1;
        this.updateFocus(items);
        break;
    }
  }

  /**
   * Update focus highlight based on current index
   */
  private updateFocus(items: NodeListOf<Element>): void {
    this.clearFocusHighlight();
    if (this.focusedIndex >= 0 && this.focusedIndex < items.length) {
      const item = items[this.focusedIndex] as HTMLElement;
      item.classList.add(`${this.config.classPrefix}__item--focused`);
      item.focus();
    }
  }

  /**
   * Remove existing menu element from DOM
   */
  private removeMenuElement(): void {
    if (this.menuElement && this.menuElement.parentNode) {
      this.menuElement.parentNode.removeChild(this.menuElement);
    }
    if (this.activeSubmenu && this.activeSubmenu.parentNode) {
      this.activeSubmenu.parentNode.removeChild(this.activeSubmenu);
    }
    this.menuElement = null;
    this.activeSubmenu = null;
  }

  /**
   * Icon SVG templates (without <svg> wrapper - created programmatically)
   */
  private static readonly ICON_PATHS: Record<string, { paths: Array<{ type: string; attrs: Record<string, string> }> }> = {
    "chevron-right": {
      paths: [{ type: "path", attrs: { d: "M6 4L10 8L6 12", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } }],
    },
    "open-file": {
      paths: [
        { type: "path", attrs: { d: "M14 8.5V13.5C14 13.7761 13.7761 14 13.5 14H2.5C2.22386 14 2 13.7761 2 13.5V2.5C2 2.22386 2.22386 2 2.5 2H7.5", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
        { type: "path", attrs: { d: "M10 2H14V6", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } },
        { type: "path", attrs: { d: "M14 2L8 8", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "focus": {
      paths: [
        { type: "circle", attrs: { cx: "8", cy: "8", r: "3", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "path", attrs: { d: "M8 2V4M8 12V14M2 8H4M12 8H14", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "select": {
      paths: [{ type: "path", attrs: { d: "M3 8L6 11L13 4", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } }],
    },
    "expand": {
      paths: [
        { type: "circle", attrs: { cx: "8", cy: "8", r: "2", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "path", attrs: { d: "M8 2V4M8 12V14M2 8H4M12 8H14M4.22 4.22L5.64 5.64M10.36 10.36L11.78 11.78M11.78 4.22L10.36 5.64M5.64 10.36L4.22 11.78", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "collapse": {
      paths: [
        { type: "circle", attrs: { cx: "8", cy: "8", r: "2", fill: "currentColor" } },
        { type: "path", attrs: { d: "M8 2V5M8 11V14M2 8H5M11 8H14", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "hide": {
      paths: [
        { type: "path", attrs: { d: "M2 2L14 14", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
        { type: "path", attrs: { d: "M6.5 6.5C6.18 6.82 6 7.38 6 8C6 9.1 6.9 10 8 10C8.62 10 9.18 9.82 9.5 9.5M11.83 11.83C10.73 12.58 9.42 13 8 13C4 13 1 8 1 8C1 8 2.17 6.17 4.17 4.83", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
        { type: "path", attrs: { d: "M8 3C12 3 15 8 15 8C15 8 14.5 8.83 13.83 9.83", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "copy": {
      paths: [
        { type: "rect", attrs: { x: "5", y: "5", width: "9", height: "9", rx: "1", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "path", attrs: { d: "M11 2H3C2.44772 2 2 2.44772 2 3V11", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "link": {
      paths: [
        { type: "path", attrs: { d: "M7 9L9 7M6 10L4.5 11.5C3.67 12.33 2.33 12.33 1.5 11.5C0.67 10.67 0.67 9.33 1.5 8.5L3 7", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
        { type: "path", attrs: { d: "M10 6L11.5 4.5C12.33 3.67 13.67 3.67 14.5 4.5C15.33 5.33 15.33 6.67 14.5 7.5L13 9", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "pin": {
      paths: [{ type: "path", attrs: { d: "M10 2L14 6L11 9L10 14L6 10L2 11L7 6L10 2Z", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } }],
    },
    "trash": {
      paths: [{ type: "path", attrs: { d: "M2 4H14M5 4V3C5 2.44772 5.44772 2 6 2H10C10.5523 2 11 2.44772 11 3V4M12 4V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V4H12Z", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } }],
    },
    "plus": {
      paths: [{ type: "path", attrs: { d: "M8 3V13M3 8H13", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } }],
    },
    "search": {
      paths: [
        { type: "circle", attrs: { cx: "7", cy: "7", r: "4", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "path", attrs: { d: "M10 10L14 14", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
    "filter": {
      paths: [{ type: "path", attrs: { d: "M2 3H14L9 9V13L7 14V9L2 3Z", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } }],
    },
    "layout": {
      paths: [
        { type: "rect", attrs: { x: "2", y: "2", width: "5", height: "5", rx: "1", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "rect", attrs: { x: "9", y: "2", width: "5", height: "5", rx: "1", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "rect", attrs: { x: "2", y: "9", width: "5", height: "5", rx: "1", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "rect", attrs: { x: "9", y: "9", width: "5", height: "5", rx: "1", stroke: "currentColor", "stroke-width": "1.5" } },
      ],
    },
    "info": {
      paths: [
        { type: "circle", attrs: { cx: "8", cy: "8", r: "6", stroke: "currentColor", "stroke-width": "1.5" } },
        { type: "path", attrs: { d: "M8 7V11M8 5V5.5", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" } },
      ],
    },
  };

  /**
   * Create SVG icon element programmatically (secure - no innerHTML)
   */
  private createIconSvg(iconName: string): SVGElement | null {
    const iconDef = ContextMenuRenderer.ICON_PATHS[iconName];
    if (!iconDef) {
      return null;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");

    for (const pathDef of iconDef.paths) {
      const element = document.createElementNS(svgNS, pathDef.type);
      for (const [attr, value] of Object.entries(pathDef.attrs)) {
        element.setAttribute(attr, value);
      }
      svg.appendChild(element);
    }

    return svg;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ContextMenuRendererConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextMenuRendererConfig {
    return { ...this.config };
  }
}

/**
 * Default ContextMenuRenderer configuration
 */
export const DEFAULT_CONTEXT_MENU_RENDERER_CONFIG = DEFAULT_CONFIG;
