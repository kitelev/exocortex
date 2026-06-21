export { normalizeRef } from "./normalizeRef";

export {
  LAYOUT_CLASS_IRI,
  LAYOUT_CLASS_UID,
  createLayoutFromFrontmatter,
  isLayout,
  isLayoutFrontmatter,
  type CreateLayoutOptions,
  type Layout,
} from "./Layout";

export {
  BACKLINKS_TABLE_BLOCK_CLASS_IRI,
  BACKLINKS_TABLE_BLOCK_CLASS_UID,
  PROPERTIES_BLOCK_CLASS_IRI,
  PROPERTIES_BLOCK_CLASS_UID,
  createLayoutBlockFromFrontmatter,
  isBacklinksTableBlock,
  isLayoutBlockFrontmatter,
  isPropertiesBlock,
  type BacklinksTableBlock,
  type CreateLayoutBlockOptions,
  type LayoutBlock,
  type LayoutBlockBase,
  type PropertiesBlock,
} from "./LayoutBlock";
