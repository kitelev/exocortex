/**
 * Cell Renderers
 *
 * This module exports all cell renderer components and types
 * for use with TableLayoutRenderer.
 *
 * @packageDocumentation
 */

// Types
export type {
  CellValue,
  CellRendererProps,
  CellRendererComponent,
  CellRendererRegistry,
  TableRow,
  TableSortState,
  TableLayoutOptions,
} from "./types";

// Cell Renderer Components
export { TextRenderer } from "./TextRenderer";
export { LinkRenderer } from "./LinkRenderer";
export { BadgeRenderer } from "./BadgeRenderer";
export { DateTimeRenderer, DateRenderer, TimeRenderer } from "./DateTimeRenderer";
export { DurationRenderer } from "./DurationRenderer";
export { BooleanRenderer } from "./BooleanRenderer";
export { ProgressRenderer } from "./ProgressRenderer";
export { NumberRenderer } from "./NumberRenderer";
export { TagsRenderer } from "./TagsRenderer";
export { ImageRenderer } from "./ImageRenderer";

// Re-export ColumnRenderer type from domain
export type { ColumnRenderer } from "../../../domain/layout";

import type { ColumnRenderer } from "../../../domain/layout";
import type { CellRendererComponent } from "./types";

import { TextRenderer } from "./TextRenderer";
import { LinkRenderer } from "./LinkRenderer";
import { BadgeRenderer } from "./BadgeRenderer";
import { DateTimeRenderer } from "./DateTimeRenderer";
import { DurationRenderer } from "./DurationRenderer";
import { BooleanRenderer } from "./BooleanRenderer";
import { ProgressRenderer } from "./ProgressRenderer";
import { NumberRenderer } from "./NumberRenderer";
import { TagsRenderer } from "./TagsRenderer";
import { ImageRenderer } from "./ImageRenderer";

/**
 * Default cell renderer registry.
 * Maps column renderer types to their component implementations.
 */
export const defaultCellRenderers: Record<ColumnRenderer, CellRendererComponent> = {
  text: TextRenderer,
  link: LinkRenderer,
  badge: BadgeRenderer,
  datetime: DateTimeRenderer,
  duration: DurationRenderer,
  boolean: BooleanRenderer,
  progress: ProgressRenderer,
  number: NumberRenderer,
  tags: TagsRenderer,
  image: ImageRenderer,
  custom: TextRenderer, // Fallback to text for custom renderers
};

/**
 * Get the appropriate cell renderer for a column renderer type.
 *
 * @param rendererType - The column renderer type
 * @returns The cell renderer component
 */
export function getCellRenderer(rendererType: ColumnRenderer | undefined): CellRendererComponent {
  const type = rendererType || "text";
  return defaultCellRenderers[type] || TextRenderer;
}
