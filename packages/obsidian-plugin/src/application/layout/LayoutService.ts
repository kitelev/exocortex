/**
 * LayoutService - Orchestrator for Layout rendering pipeline
 *
 * Coordinates the entire layout rendering process:
 * 1. Parse layout definition from vault file (LayoutParser)
 * 2. Build SPARQL query from layout (LayoutQueryBuilder)
 * 3. Execute query against triple store (SPARQLQueryService)
 * 4. Transform results into TableRow format for rendering
 * 5. Handle cell edits via frontmatter updates
 * 6. Handle sort changes with re-query
 *
 * @module application/layout
 * @since 1.0.0
 */

import { TFile, type App } from "obsidian";
import type {
  IVaultAdapter,
  IFile,
  SolutionMapping,
  ILogger,
  INotificationService,
} from "exocortex";
import { Literal, IRI } from "exocortex";

import type {
  Layout,
  LayoutColumn,
  LayoutSort,
} from "../../domain/layout";
import { isTableLayout, isKanbanLayout } from "../../domain/layout";
import { LayoutParser, type LayoutParseOptions } from "../../infrastructure/layout/LayoutParser";
import { LayoutQueryBuilder, type QueryBuildOptions } from "./LayoutQueryBuilder";
import type { TableRow, CellValue } from "../../presentation/renderers/cell-renderers";
import { SPARQLQueryService } from "../services/SPARQLQueryService";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";

/**
 * Result of a layout render operation
 */
export interface LayoutRenderResult {
  /** Whether rendering was successful */
  success: boolean;
  /** The parsed layout definition */
  layout?: Layout;
  /** Row data for rendering */
  rows?: TableRow[];
  /** Generated SPARQL query (for debugging) */
  query?: string;
  /** Variable mapping from query builder */
  variables?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Options for layout rendering
 */
export interface LayoutRenderOptions extends LayoutParseOptions, QueryBuildOptions {
  /**
   * Whether to cache parsed layouts.
   * @default true
   */
  useCache?: boolean;
}

/**
 * Result of a cell edit operation
 */
export interface CellEditResult {
  /** Whether edit was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * LayoutService - Orchestrates the complete layout rendering pipeline
 *
 * @example
 * ```typescript
 * const layoutService = new LayoutService(app, vaultAdapter);
 * await layoutService.initialize();
 *
 * // Render a layout
 * const result = await layoutService.renderLayout(layoutFile);
 * if (result.success) {
 *   // Use result.layout and result.rows with TableLayoutRenderer
 * }
 *
 * // Handle cell edit
 * await layoutService.handleCellEdit(assetPath, columnUid, newValue);
 * ```
 */
export class LayoutService {
  private readonly app: App;
  private readonly vaultAdapter: IVaultAdapter;
  private readonly parser: LayoutParser;
  private readonly queryBuilder: LayoutQueryBuilder;
  private readonly sparqlService: SPARQLQueryService;
  private readonly logger: ILogger;
  private isInitialized = false;

  /**
   * Cache for rendered layouts with their data
   */
  private readonly layoutCache: Map<string, LayoutRenderResult> = new Map();

  constructor(
    app: App,
    vaultAdapter: IVaultAdapter,
    logger?: ILogger,
    notifier?: INotificationService
  ) {
    this.app = app;
    this.vaultAdapter = vaultAdapter;

    const defaultLogger = LoggerFactory.create("LayoutService");
    this.logger = logger || {
      debug: defaultLogger.debug.bind(defaultLogger),
      info: defaultLogger.info.bind(defaultLogger),
      warn: defaultLogger.warn.bind(defaultLogger),
      error: defaultLogger.error.bind(defaultLogger),
    };

    this.parser = new LayoutParser(vaultAdapter);
    this.queryBuilder = new LayoutQueryBuilder();
    this.sparqlService = new SPARQLQueryService(app, this.logger, notifier);
  }

  /**
   * Initialize the service.
   * Must be called before any other operations.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.sparqlService.initialize();
    this.isInitialized = true;
    this.logger.info("LayoutService initialized");
  }

  /**
   * Render a layout from a vault file.
   *
   * Complete pipeline:
   * 1. Parse layout definition
   * 2. Build SPARQL query
   * 3. Execute query
   * 4. Transform results to TableRow format
   *
   * @param layoutFile - The layout definition file
   * @param options - Rendering options
   * @returns Render result with layout and rows
   */
  async renderLayout(
    layoutFile: IFile,
    options: LayoutRenderOptions = {}
  ): Promise<LayoutRenderResult> {
    const { useCache = true } = options;

    // Check cache
    if (useCache) {
      const cached = this.layoutCache.get(layoutFile.path);
      if (cached && cached.success) {
        return cached;
      }
    }

    try {
      // Ensure initialized
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Step 1: Parse layout
      const parseResult = await this.parser.parseFromFile(layoutFile, options);
      if (!parseResult.success || !parseResult.layout) {
        return {
          success: false,
          error: parseResult.error || "Failed to parse layout",
        };
      }

      const layout = parseResult.layout;

      // Step 2: Build query
      const queryResult = this.queryBuilder.build(layout, options);
      if (!queryResult.success || !queryResult.query) {
        return {
          success: false,
          layout,
          error: queryResult.error || "Failed to build query",
        };
      }

      // Step 3: Execute query
      const solutions = await this.sparqlService.query(queryResult.query);

      // Step 4: Transform to TableRow format
      const columns = this.getLayoutColumns(layout);
      const rows = this.transformToTableRows(
        solutions,
        columns,
        queryResult.variables || []
      );

      const result: LayoutRenderResult = {
        success: true,
        layout,
        rows,
        query: queryResult.query,
        variables: queryResult.variables,
      };

      // Cache the result
      if (useCache) {
        this.layoutCache.set(layoutFile.path, result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to render layout: ${errorMessage}`);
      return {
        success: false,
        error: `Layout rendering failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Render a layout from a wikilink reference.
   *
   * @param wikilink - The wikilink reference (e.g., "[[MyTableLayout]]")
   * @param sourcePath - Source path for resolving relative links
   * @param options - Rendering options
   * @returns Render result
   */
  async renderLayoutFromWikiLink(
    wikilink: string,
    sourcePath: string = "",
    options: LayoutRenderOptions = {}
  ): Promise<LayoutRenderResult> {
    const layout = await this.parser.parseFromWikiLink(wikilink, sourcePath, options);
    if (!layout) {
      return {
        success: false,
        error: `Failed to resolve layout from wikilink: ${wikilink}`,
      };
    }

    // Need to find the file for the layout to use renderLayout
    // For now, build the result directly
    try {
      // Ensure initialized
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Build query
      const queryResult = this.queryBuilder.build(layout, options);
      if (!queryResult.success || !queryResult.query) {
        return {
          success: false,
          layout,
          error: queryResult.error || "Failed to build query",
        };
      }

      // Execute query
      const solutions = await this.sparqlService.query(queryResult.query);

      // Transform to TableRow format
      const columns = this.getLayoutColumns(layout);
      const rows = this.transformToTableRows(
        solutions,
        columns,
        queryResult.variables || []
      );

      return {
        success: true,
        layout,
        rows,
        query: queryResult.query,
        variables: queryResult.variables,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to render layout from wikilink: ${errorMessage}`);
      return {
        success: false,
        error: `Layout rendering failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Handle a cell edit operation.
   *
   * Updates the frontmatter of the asset file with the new value.
   *
   * @param assetPath - Path to the asset file
   * @param propertyName - Property name to update (from column definition)
   * @param newValue - New value for the cell
   * @returns Edit result
   */
  async handleCellEdit(
    assetPath: string,
    propertyName: string,
    newValue: CellValue
  ): Promise<CellEditResult> {
    try {
      const file = this.vaultAdapter.getAbstractFileByPath(assetPath);
      if (!file || !("basename" in file)) {
        return {
          success: false,
          error: `File not found: ${assetPath}`,
        };
      }

      const vaultFile = file as IFile;

      // Format the value for YAML frontmatter
      const formattedValue = this.formatValueForFrontmatter(newValue);

      // Update frontmatter
      await this.vaultAdapter.updateFrontmatter(vaultFile, (current) => {
        return {
          ...current,
          [propertyName]: formattedValue,
        };
      });

      // Update the triple store
      const tfile = this.app.vault.getAbstractFileByPath(assetPath);
      if (tfile && tfile instanceof TFile) {
        await this.sparqlService.updateFile(tfile);
      }

      this.logger.debug(`Cell updated: ${assetPath}.${propertyName} = ${String(formattedValue)}`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update cell: ${errorMessage}`);
      return {
        success: false,
        error: `Cell update failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Handle sort change with re-query.
   *
   * Re-executes the query with a new sort configuration.
   *
   * @param layout - The layout definition
   * @param sort - New sort configuration
   * @returns Updated rows
   */
  async handleSortChange(
    layout: Layout,
    sort: LayoutSort
  ): Promise<LayoutRenderResult> {
    try {
      // Ensure initialized
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Create a modified layout with the new sort
      const sortedLayout: Layout = {
        ...layout,
        defaultSort: sort,
      };

      // Build and execute new query
      const queryResult = this.queryBuilder.build(sortedLayout);
      if (!queryResult.success || !queryResult.query) {
        return {
          success: false,
          layout,
          error: queryResult.error || "Failed to build sorted query",
        };
      }

      const solutions = await this.sparqlService.query(queryResult.query);

      const columns = this.getLayoutColumns(layout);
      const rows = this.transformToTableRows(
        solutions,
        columns,
        queryResult.variables || []
      );

      return {
        success: true,
        layout: sortedLayout,
        rows,
        query: queryResult.query,
        variables: queryResult.variables,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to handle sort change: ${errorMessage}`);
      return {
        success: false,
        error: `Sort change failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Refresh layout data.
   *
   * Re-indexes the vault and re-renders the layout.
   *
   * @param layoutFile - The layout file to refresh
   * @returns Updated render result
   */
  async refreshLayout(layoutFile: IFile): Promise<LayoutRenderResult> {
    // Invalidate caches
    this.parser.invalidateCache(layoutFile.path);
    this.layoutCache.delete(layoutFile.path);

    // Refresh the SPARQL index
    await this.sparqlService.refresh();

    // Re-render
    return this.renderLayout(layoutFile, { useCache: false });
  }

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.parser.clearCache();
    this.layoutCache.clear();
    this.logger.debug("Layout caches cleared");
  }

  /**
   * Dispose of resources.
   */
  async dispose(): Promise<void> {
    await this.sparqlService.dispose();
    this.clearCache();
    this.isInitialized = false;
    this.logger.info("LayoutService disposed");
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Get columns from a layout (handles different layout types).
   */
  private getLayoutColumns(layout: Layout): LayoutColumn[] {
    if (isTableLayout(layout)) {
      return layout.columns || [];
    }
    if (isKanbanLayout(layout)) {
      return layout.columns || [];
    }
    return [];
  }

  /**
   * Transform SPARQL solutions to TableRow format.
   */
  private transformToTableRows(
    solutions: SolutionMapping[],
    columns: LayoutColumn[],
    _variables: string[]
  ): TableRow[] {
    const rows: TableRow[] = [];

    for (const solution of solutions) {
      // Get asset URI from first variable (?asset)
      const assetBinding = solution.get("asset");
      if (!assetBinding) {
        continue;
      }

      const assetUri = this.extractValue(assetBinding);
      const assetPath = this.uriToPath(assetUri);
      const assetId = this.extractUidFromPath(assetPath) || assetPath;

      // Build values map from column bindings
      const values: Record<string, CellValue> = {};

      columns.forEach((column, index) => {
        const variableName = `col${index}`;
        const binding = solution.get(variableName);
        values[column.uid] = binding ? this.convertRdfToCellValue(binding, column) : null;
      });

      rows.push({
        id: assetId,
        path: assetPath,
        metadata: solution.toJSON(),
        values,
      });
    }

    return rows;
  }

  /**
   * Extract string value from RDF term.
   */
  private extractValue(term: unknown): string {
    if (term instanceof Literal) {
      return term.value;
    }
    if (term instanceof IRI) {
      return term.value;
    }
    if (typeof term === "object" && term !== null) {
      if ("value" in term) {
        return String((term as { value: unknown }).value);
      }
    }
    return String(term);
  }

  /**
   * Convert RDF term to CellValue based on column type.
   */
  private convertRdfToCellValue(term: unknown, column: LayoutColumn): CellValue {
    const stringValue = this.extractValue(term);

    // Convert based on renderer type
    switch (column.renderer) {
      case "number":
      case "progress":
      case "duration": {
        const num = parseFloat(stringValue);
        return isNaN(num) ? null : num;
      }

      case "boolean": {
        const lower = stringValue.toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes") {
          return true;
        }
        if (lower === "false" || lower === "0" || lower === "no") {
          return false;
        }
        return null;
      }

      case "datetime": {
        // Try to parse as date
        const date = new Date(stringValue);
        return isNaN(date.getTime()) ? stringValue : date;
      }

      case "link": {
        // Keep as string for link rendering
        return stringValue;
      }

      case "tags":
      case "badge":
      case "image":
      case "text":
      default:
        return stringValue;
    }
  }

  /**
   * Convert URI to vault file path.
   */
  private uriToPath(uri: string): string {
    // Handle obsidian:// URIs
    if (uri.startsWith("obsidian://vault/")) {
      let path = uri.replace("obsidian://vault/", "");
      // Decode URL encoding
      path = decodeURIComponent(path);
      return path;
    }

    // Handle file:// URIs
    if (uri.startsWith("file://")) {
      return uri.replace("file://", "");
    }

    // Return as-is if no known prefix
    return uri;
  }

  /**
   * Extract UID from a file path (assumes UUID is in filename).
   */
  private extractUidFromPath(path: string): string | null {
    // Match UUID pattern in path
    const uuidMatch = path.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    return uuidMatch ? uuidMatch[1] : null;
  }

  /**
   * Format a cell value for YAML frontmatter.
   */
  private formatValueForFrontmatter(value: CellValue): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    // String value - check if it needs quoting
    const stringValue = String(value);

    // Wikilinks should be quoted
    if (stringValue.startsWith("[[") && stringValue.endsWith("]]")) {
      return `"${stringValue}"`;
    }

    return stringValue;
  }
}
