/**
 * Layout Application Module
 *
 * Provides application services for working with Layout definitions,
 * including query generation and orchestrated rendering pipeline.
 *
 * @module application/layout
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   LayoutService,
 *   LayoutQueryBuilder,
 *   type LayoutRenderResult,
 *   type QueryBuildResult,
 * } from "./application/layout";
 *
 * // Using LayoutService (recommended - full orchestration)
 * const layoutService = new LayoutService(app, vaultAdapter);
 * await layoutService.initialize();
 *
 * const result = await layoutService.renderLayout(layoutFile);
 * if (result.success) {
 *   console.log("Layout:", result.layout);
 *   console.log("Rows:", result.rows);
 * }
 *
 * // Using LayoutQueryBuilder directly
 * const builder = new LayoutQueryBuilder();
 * const queryResult = builder.build(tableLayout);
 * if (queryResult.success) {
 *   console.log("Generated query:", queryResult.query);
 * }
 * ```
 */

export {
  LayoutQueryBuilder,
  SPARQL_PREFIXES,
  type QueryBuildResult,
  type QueryBuildOptions,
} from "./LayoutQueryBuilder";

export {
  LayoutService,
  type LayoutRenderResult,
  type LayoutRenderOptions,
  type CellEditResult,
} from "./LayoutService";
