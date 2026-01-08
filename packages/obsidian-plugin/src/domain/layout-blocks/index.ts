/**
 * Layout Blocks Domain Models
 *
 * This module exports TypeScript types and interfaces for RDF-driven layout blocks.
 * These types map to the ontology classes defined in exo-ui:LayoutBlock.
 *
 * @example
 * ```typescript
 * import {
 *   LayoutBlock,
 *   LayoutWithBlocks,
 *   LayoutBlockQueryResult,
 *   LAYOUT_URIS,
 *   LAYOUT_BLOCK_URIS,
 * } from "./domain/layout-blocks";
 *
 * // Load a layout with its blocks
 * const layout = await layoutBlockService.loadLayout(LAYOUT_URIS.DEFAULT_ASSET_LAYOUT);
 *
 * // Execute a block's query for a specific asset
 * for (const block of layout.blocks) {
 *   const result = await layoutBlockService.executeBlockQuery(block, assetUri);
 *   console.log(block.renderer, result.bindings.length);
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
  type LayoutBlockRenderer,
  type LayoutBlock,
  type LayoutWithBlocks,
  type LayoutBlockQueryResult,
  LAYOUT_URIS,
  LAYOUT_BLOCK_URIS,
} from "./LayoutBlock";
