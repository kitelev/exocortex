/**
 * Layout Application Module
 *
 * Provides application services for working with Layout definitions,
 * including query generation from Layout models.
 *
 * @module application/layout
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   LayoutQueryBuilder,
 *   type QueryBuildResult,
 *   type QueryBuildOptions,
 *   SPARQL_PREFIXES,
 * } from "./application/layout";
 *
 * const builder = new LayoutQueryBuilder();
 * const result = builder.build(tableLayout);
 *
 * if (result.success) {
 *   console.log("Generated query:", result.query);
 *   // Variables: ["?asset", "?col0", "?col1", ...]
 *   console.log("Variables:", result.variables);
 * } else {
 *   console.error("Build error:", result.error);
 * }
 * ```
 */

export {
  LayoutQueryBuilder,
  SPARQL_PREFIXES,
  type QueryBuildResult,
  type QueryBuildOptions,
} from "./LayoutQueryBuilder";
