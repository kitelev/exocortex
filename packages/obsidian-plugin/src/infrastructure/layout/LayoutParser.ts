/**
 * LayoutParser - Infrastructure service for loading Layout definitions from vault
 *
 * Reads markdown files with YAML frontmatter, parses Layout definitions,
 * resolves wikilinks, and recursively loads related objects (columns, filters, sort).
 *
 * @module infrastructure/layout
 * @since 1.0.0
 */

import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "exocortex";

import {
  type Layout,
  type TableLayout,
  type KanbanLayout,
  type GraphLayout,
  type CalendarLayout,
  type ListLayout,
  type LayoutColumn,
  type LayoutFilter,
  type LayoutSort,
  type LayoutGroup,
  type LayoutActions,
  type CommandRef,
  LayoutType,
  getLayoutTypeFromInstanceClass,
  isLayoutFrontmatter,
  createLayoutColumnFromFrontmatter,
  createLayoutFilterFromFrontmatter,
  createLayoutSortFromFrontmatter,
  createLayoutGroupFromFrontmatter,
  createLayoutActionsFromFrontmatter,
  createCommandRefFromFrontmatter,
  isLayoutActionsFrontmatter,
  isCommandFrontmatter,
  isValidCalendarView,
} from "../../domain/layout";

/**
 * Result of a layout parsing operation
 */
export interface LayoutParseResult {
  /** Whether parsing was successful */
  success: boolean;
  /** Parsed layout (if successful) */
  layout?: Layout;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Options for layout parsing
 */
export interface LayoutParseOptions {
  /**
   * Maximum depth for recursive loading of related objects.
   * Prevents infinite recursion in case of circular references.
   * @default 10
   */
  maxDepth?: number;

  /**
   * Whether to continue parsing if some related objects fail to load.
   * If true, missing columns/filters/sorts will be skipped.
   * If false, any loading error will fail the entire parse.
   * @default true
   */
  gracefulDegradation?: boolean;
}

/**
 * LayoutParser - Service for loading Layout definitions from Obsidian vault
 *
 * Features:
 * - Parses YAML frontmatter from markdown files
 * - Resolves wikilinks to actual file paths
 * - Recursively loads columns, filters, sorts, and groups
 * - Handles missing/optional properties gracefully
 * - Prevents infinite recursion with depth limits
 *
 * @example
 * ```typescript
 * const parser = new LayoutParser(vaultAdapter);
 *
 * // Parse from file
 * const result = await parser.parseFromFile(layoutFile);
 * if (result.success) {
 *   console.log("Layout:", result.layout);
 * }
 *
 * // Parse from wikilink
 * const layout = await parser.parseFromWikiLink("[[MyTableLayout]]");
 * ```
 */
export class LayoutParser {
  private readonly vaultAdapter: IVaultAdapter;

  /**
   * Cache of loaded layouts to prevent redundant parsing.
   * Key is the file path, value is the parsed layout.
   */
  private readonly cache: Map<string, Layout> = new Map();

  /**
   * Set of file paths currently being parsed.
   * Used to detect circular references.
   */
  private readonly parsingStack: Set<string> = new Set();

  constructor(vaultAdapter: IVaultAdapter) {
    this.vaultAdapter = vaultAdapter;
  }

  /**
   * Parse a Layout from a vault file.
   *
   * @param file - The vault file containing the Layout definition
   * @param options - Parsing options
   * @returns Parse result with layout or error
   */
  async parseFromFile(
    file: IFile,
    options: LayoutParseOptions = {},
  ): Promise<LayoutParseResult> {
    const { maxDepth = 10, gracefulDegradation = true } = options;

    // Check cache first
    const cachedLayout = this.cache.get(file.path);
    if (cachedLayout) {
      return { success: true, layout: cachedLayout };
    }

    // Check for circular reference
    if (this.parsingStack.has(file.path)) {
      return {
        success: false,
        error: `Circular reference detected: ${file.path}`,
      };
    }

    // Check depth limit
    if (this.parsingStack.size >= maxDepth) {
      return {
        success: false,
        error: `Maximum parsing depth (${maxDepth}) exceeded`,
      };
    }

    try {
      this.parsingStack.add(file.path);

      // Get frontmatter
      const frontmatter = this.vaultAdapter.getFrontmatter(file);
      if (!frontmatter) {
        return {
          success: false,
          error: `No frontmatter found in file: ${file.path}`,
        };
      }

      // Verify this is a Layout asset
      if (!isLayoutFrontmatter(frontmatter)) {
        return {
          success: false,
          error: `File is not a Layout asset: ${file.path}`,
        };
      }

      // Parse the layout based on type
      const layout = await this.parseLayoutFromFrontmatter(
        frontmatter,
        { maxDepth, gracefulDegradation },
      );

      if (!layout) {
        return {
          success: false,
          error: `Failed to parse Layout from: ${file.path}`,
        };
      }

      // Cache the result
      this.cache.set(file.path, layout);

      return { success: true, layout };
    } finally {
      this.parsingStack.delete(file.path);
    }
  }

  /**
   * Parse a Layout from a wikilink reference.
   *
   * @param wikilink - The wikilink reference (e.g., "[[MyTableLayout]]")
   * @param sourcePath - The source file path for resolving relative links
   * @param options - Parsing options
   * @returns The parsed Layout or null if not found/invalid
   */
  async parseFromWikiLink(
    wikilink: string,
    sourcePath: string = "",
    options: LayoutParseOptions = {},
  ): Promise<Layout | null> {
    const file = this.resolveWikiLink(wikilink, sourcePath);
    if (!file) {
      return null;
    }

    const result = await this.parseFromFile(file, options);
    return result.success && result.layout ? result.layout : null;
  }

  /**
   * Parse a Layout from frontmatter data.
   *
   * @param frontmatter - The YAML frontmatter object
   * @param options - Parsing options
   * @returns The parsed Layout or null
   */
  async parseLayoutFromFrontmatter(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions = {},
  ): Promise<Layout | null> {
    // Extract base properties
    const uid = frontmatter["exo__Asset_uid"] as string | undefined;
    const label = frontmatter["exo__Asset_label"] as string | undefined;
    const description = frontmatter["exo__Asset_description"] as string | undefined;
    const targetClass = frontmatter["exo__Layout_targetClass"] as string | undefined;
    const instanceClass = frontmatter["exo__Instance_class"];

    const layoutType = getLayoutTypeFromInstanceClass(instanceClass);

    if (!uid || !label || !layoutType || !targetClass) {
      return null;
    }

    // Load related objects
    const filters = await this.loadFilters(frontmatter, options);
    const defaultSort = await this.loadDefaultSort(frontmatter, options);
    const groupBy = await this.loadGroupBy(frontmatter, options);

    // Build the layout based on type
    switch (layoutType) {
      case LayoutType.Table:
        return this.buildTableLayout(
          uid,
          label,
          description,
          targetClass,
          frontmatter,
          filters,
          defaultSort,
          groupBy,
          options,
        );

      case LayoutType.Kanban:
        return this.buildKanbanLayout(
          uid,
          label,
          description,
          targetClass,
          frontmatter,
          filters,
          defaultSort,
          groupBy,
          options,
        );

      case LayoutType.Graph:
        return this.buildGraphLayout(
          uid,
          label,
          description,
          targetClass,
          frontmatter,
          filters,
          defaultSort,
          groupBy,
        );

      case LayoutType.Calendar:
        return this.buildCalendarLayout(
          uid,
          label,
          description,
          targetClass,
          frontmatter,
          filters,
          defaultSort,
          groupBy,
        );

      case LayoutType.List:
        return this.buildListLayout(
          uid,
          label,
          description,
          targetClass,
          frontmatter,
          filters,
          defaultSort,
          groupBy,
        );

      default:
        return null;
    }
  }

  /**
   * Clear the layout cache.
   * Call this when vault files change to ensure fresh data.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Remove a specific file from the cache.
   *
   * @param filePath - The path of the file to remove from cache
   */
  invalidateCache(filePath: string): void {
    this.cache.delete(filePath);
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Resolve a wikilink to a vault file.
   */
  private resolveWikiLink(wikilink: string, sourcePath: string): IFile | null {
    // Extract link path from wikilink format [[...]]
    const match = wikilink.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/);
    const linkPath = match ? match[1] : wikilink;

    // Try to resolve the link
    let file = this.vaultAdapter.getFirstLinkpathDest(linkPath, sourcePath);

    // Try with .md extension if not found (Obsidian file lookup pattern)
    if (!file && !linkPath.endsWith(".md")) {
      file = this.vaultAdapter.getFirstLinkpathDest(linkPath + ".md", sourcePath);
    }

    // Check if result is a file (not folder)
    if (file && "basename" in file) {
      return file as IFile;
    }

    return null;
  }

  /**
   * Load filters from frontmatter wikilinks.
   */
  private async loadFilters(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<LayoutFilter[] | undefined> {
    const filtersValue = frontmatter["exo__Layout_filters"];
    if (!filtersValue) {
      return undefined;
    }

    const filterLinks = this.normalizeToArray(filtersValue);
    const filters: LayoutFilter[] = [];

    for (const link of filterLinks) {
      const filter = await this.loadFilter(link, options);
      if (filter) {
        filters.push(filter);
      } else if (!options.gracefulDegradation) {
        throw new Error(`Failed to load filter: ${link}`);
      }
    }

    return filters.length > 0 ? filters : undefined;
  }

  /**
   * Load a single filter from a wikilink.
   */
  private async loadFilter(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<LayoutFilter | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    return createLayoutFilterFromFrontmatter(frontmatter);
  }

  /**
   * Load default sort from frontmatter wikilink.
   */
  private async loadDefaultSort(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<LayoutSort | undefined> {
    const sortValue = frontmatter["exo__Layout_defaultSort"];
    if (!sortValue) {
      return undefined;
    }

    // Handle both single link and array of links (take first if array)
    const sortLinks = this.normalizeToArray(sortValue);
    if (sortLinks.length === 0) {
      return undefined;
    }

    const sort = await this.loadSort(sortLinks[0], options);
    return sort || undefined;
  }

  /**
   * Load a single sort from a wikilink.
   */
  private async loadSort(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<LayoutSort | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    return createLayoutSortFromFrontmatter(frontmatter);
  }

  /**
   * Load groupBy from frontmatter wikilink.
   */
  private async loadGroupBy(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<LayoutGroup | undefined> {
    const groupValue = frontmatter["exo__Layout_groupBy"];
    if (!groupValue) {
      return undefined;
    }

    // Handle both single link and array of links (take first if array)
    const groupLinks = this.normalizeToArray(groupValue);
    if (groupLinks.length === 0) {
      return undefined;
    }

    const group = await this.loadGroup(groupLinks[0], options);
    return group || undefined;
  }

  /**
   * Load a single group from a wikilink.
   */
  private async loadGroup(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<LayoutGroup | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    return createLayoutGroupFromFrontmatter(frontmatter);
  }

  /**
   * Load actions from frontmatter wikilink.
   */
  private async loadActions(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<LayoutActions | undefined> {
    const actionsValue = frontmatter["exo__Layout_actions"];
    if (!actionsValue) {
      return undefined;
    }

    // Handle both single link and array of links (take first if array)
    const actionsLinks = this.normalizeToArray(actionsValue);
    if (actionsLinks.length === 0) {
      return undefined;
    }

    const actions = await this.loadLayoutActions(actionsLinks[0], options);
    return actions || undefined;
  }

  /**
   * Load a LayoutActions object from a wikilink.
   */
  private async loadLayoutActions(
    wikilink: string,
    options: LayoutParseOptions,
  ): Promise<LayoutActions | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    // Verify this is a LayoutActions asset
    if (!isLayoutActionsFrontmatter(frontmatter)) {
      return null;
    }

    const partial = createLayoutActionsFromFrontmatter(frontmatter);
    if (!partial) {
      return null;
    }

    // Load commands
    const commands = await this.loadCommands(frontmatter, options);

    return {
      uid: partial.uid!,
      label: partial.label!,
      commands,
      position: partial.position || "column",
      showLabels: partial.showLabels || false,
    };
  }

  /**
   * Load commands from frontmatter wikilinks.
   */
  private async loadCommands(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<CommandRef[]> {
    const commandsValue = frontmatter["exo__LayoutActions_commands"];
    if (!commandsValue) {
      return [];
    }

    const commandLinks = this.normalizeToArray(commandsValue);
    const commands: CommandRef[] = [];

    for (const link of commandLinks) {
      const command = await this.loadCommand(link, options);
      if (command) {
        commands.push(command);
      } else if (!options.gracefulDegradation) {
        throw new Error(`Failed to load command: ${link}`);
      }
    }

    return commands;
  }

  /**
   * Load a single command from a wikilink.
   */
  private async loadCommand(
    wikilink: string,
    options: LayoutParseOptions,
  ): Promise<CommandRef | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    // Verify this is a Command asset
    if (!isCommandFrontmatter(frontmatter)) {
      return null;
    }

    const partial = createCommandRefFromFrontmatter(frontmatter);
    if (!partial) {
      return null;
    }

    // Load precondition SPARQL
    let preconditionSparql: string | undefined;
    const preconditionLink = frontmatter["exo__Command_precondition"] as string | undefined;
    if (preconditionLink) {
      preconditionSparql = await this.loadPreconditionSparql(preconditionLink, options);
    }

    // Load grounding SPARQL
    let groundingSparql: string | undefined;
    const groundingLink = frontmatter["exo__Command_grounding"] as string | undefined;
    if (groundingLink) {
      groundingSparql = await this.loadGroundingSparql(groundingLink, options);
    }

    return {
      uid: partial.uid!,
      label: partial.label!,
      icon: partial.icon,
      preconditionSparql,
      groundingSparql,
    };
  }

  /**
   * Load precondition SPARQL from a wikilink to a Precondition asset.
   */
  private async loadPreconditionSparql(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<string | undefined> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return undefined;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return undefined;
    }

    // Get the SPARQL ASK query from Precondition
    return frontmatter["exo__Precondition_sparql"] as string | undefined;
  }

  /**
   * Load grounding SPARQL from a wikilink to a Grounding asset.
   */
  private async loadGroundingSparql(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<string | undefined> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return undefined;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return undefined;
    }

    // Get the SPARQL UPDATE query from Grounding
    return frontmatter["exo__Grounding_sparql"] as string | undefined;
  }

  /**
   * Load columns from frontmatter wikilinks.
   */
  private async loadColumns(
    frontmatter: IFrontmatter,
    options: LayoutParseOptions,
  ): Promise<LayoutColumn[]> {
    const columnsValue = frontmatter["exo__Layout_columns"];
    if (!columnsValue) {
      return [];
    }

    const columnLinks = this.normalizeToArray(columnsValue);
    const columns: LayoutColumn[] = [];

    for (const link of columnLinks) {
      const column = await this.loadColumn(link, options);
      if (column) {
        columns.push(column);
      } else if (!options.gracefulDegradation) {
        throw new Error(`Failed to load column: ${link}`);
      }
    }

    return columns;
  }

  /**
   * Load a single column from a wikilink.
   */
  private async loadColumn(
    wikilink: string,
    _options: LayoutParseOptions,
  ): Promise<LayoutColumn | null> {
    const file = this.resolveWikiLink(wikilink, "");
    if (!file) {
      return null;
    }

    const frontmatter = this.vaultAdapter.getFrontmatter(file);
    if (!frontmatter) {
      return null;
    }

    return createLayoutColumnFromFrontmatter(frontmatter);
  }

  /**
   * Normalize a value to an array of strings (wikilinks).
   */
  private normalizeToArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string");
    }
    if (typeof value === "string") {
      return [value];
    }
    return [];
  }

  // ============================================
  // Layout Type Builders
  // ============================================

  private async buildTableLayout(
    uid: string,
    label: string,
    description: string | undefined,
    targetClass: string,
    frontmatter: IFrontmatter,
    filters: LayoutFilter[] | undefined,
    defaultSort: LayoutSort | undefined,
    groupBy: LayoutGroup | undefined,
    options: LayoutParseOptions,
  ): Promise<TableLayout> {
    const columns = await this.loadColumns(frontmatter, options);
    const actions = await this.loadActions(frontmatter, options);

    return {
      uid,
      label,
      description,
      type: LayoutType.Table,
      targetClass,
      columns,
      filters,
      defaultSort,
      groupBy,
      actions,
    };
  }

  private async buildKanbanLayout(
    uid: string,
    label: string,
    description: string | undefined,
    targetClass: string,
    frontmatter: IFrontmatter,
    filters: LayoutFilter[] | undefined,
    defaultSort: LayoutSort | undefined,
    groupBy: LayoutGroup | undefined,
    options: LayoutParseOptions,
  ): Promise<KanbanLayout | null> {
    const laneProperty = frontmatter["exo__KanbanLayout_laneProperty"] as string | undefined;
    if (!laneProperty) {
      return null;
    }

    const lanesValue = frontmatter["exo__KanbanLayout_lanes"];
    const lanes = lanesValue ? this.normalizeToArray(lanesValue) : undefined;

    // Optional columns for card content
    const columns = await this.loadColumns(frontmatter, options);
    const actions = await this.loadActions(frontmatter, options);

    return {
      uid,
      label,
      description,
      type: LayoutType.Kanban,
      targetClass,
      laneProperty,
      lanes,
      columns: columns.length > 0 ? columns : undefined,
      filters,
      defaultSort,
      groupBy,
      actions,
    };
  }

  private buildGraphLayout(
    uid: string,
    label: string,
    description: string | undefined,
    targetClass: string,
    frontmatter: IFrontmatter,
    filters: LayoutFilter[] | undefined,
    defaultSort: LayoutSort | undefined,
    groupBy: LayoutGroup | undefined,
  ): GraphLayout {
    const nodeLabel = frontmatter["exo__GraphLayout_nodeLabel"] as string | undefined;
    const edgePropertiesValue = frontmatter["exo__GraphLayout_edgeProperties"];
    const edgeProperties = edgePropertiesValue
      ? this.normalizeToArray(edgePropertiesValue)
      : undefined;
    const depth = frontmatter["exo__GraphLayout_depth"] as number | undefined;

    return {
      uid,
      label,
      description,
      type: LayoutType.Graph,
      targetClass,
      nodeLabel,
      edgeProperties: edgeProperties && edgeProperties.length > 0 ? edgeProperties : undefined,
      depth,
      filters,
      defaultSort,
      groupBy,
    };
  }

  private buildCalendarLayout(
    uid: string,
    label: string,
    description: string | undefined,
    targetClass: string,
    frontmatter: IFrontmatter,
    filters: LayoutFilter[] | undefined,
    defaultSort: LayoutSort | undefined,
    groupBy: LayoutGroup | undefined,
  ): CalendarLayout | null {
    const startProperty = frontmatter["exo__CalendarLayout_startProperty"] as string | undefined;
    if (!startProperty) {
      return null;
    }

    const endProperty = frontmatter["exo__CalendarLayout_endProperty"] as string | undefined;
    const viewValue = frontmatter["exo__CalendarLayout_view"];
    const view = isValidCalendarView(viewValue) ? viewValue : "week";

    return {
      uid,
      label,
      description,
      type: LayoutType.Calendar,
      targetClass,
      startProperty,
      endProperty,
      view,
      filters,
      defaultSort,
      groupBy,
    };
  }

  private buildListLayout(
    uid: string,
    label: string,
    description: string | undefined,
    targetClass: string,
    frontmatter: IFrontmatter,
    filters: LayoutFilter[] | undefined,
    defaultSort: LayoutSort | undefined,
    groupBy: LayoutGroup | undefined,
  ): ListLayout {
    const template = frontmatter["exo__ListLayout_template"] as string | undefined;
    const showIcon = frontmatter["exo__ListLayout_showIcon"] as boolean | undefined;

    return {
      uid,
      label,
      description,
      type: LayoutType.List,
      targetClass,
      template,
      showIcon: showIcon ?? false,
      filters,
      defaultSort,
      groupBy,
    };
  }
}
