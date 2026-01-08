/**
 * Layout Blocks Application Services
 *
 * This module exports the LayoutBlockService for loading and executing
 * RDF-driven layout blocks.
 *
 * @example
 * ```typescript
 * import { LayoutBlockService } from "./application/layout-blocks";
 *
 * const service = new LayoutBlockService(app, logger);
 * await service.initialize();
 *
 * // Load relations blocks for rendering
 * const { inbound, outbound } = await service.getRelationsBlocks();
 * ```
 *
 * @packageDocumentation
 */

export {
  LayoutBlockService,
  type LayoutBlockServiceOptions,
  type RelationsBlocks,
} from "./LayoutBlockService";
