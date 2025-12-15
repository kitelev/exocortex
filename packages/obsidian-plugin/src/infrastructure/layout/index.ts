/**
 * Layout Infrastructure Module
 *
 * Provides services for loading and parsing Layout definitions from the vault.
 *
 * @module infrastructure/layout
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   LayoutParser,
 *   type LayoutParseResult,
 *   type LayoutParseOptions,
 * } from "./infrastructure/layout";
 *
 * const parser = new LayoutParser(vaultAdapter);
 * const result = await parser.parseFromFile(layoutFile);
 *
 * if (result.success) {
 *   console.log("Layout loaded:", result.layout);
 * } else {
 *   console.error("Parse error:", result.error);
 * }
 * ```
 */

export {
  LayoutParser,
  type LayoutParseResult,
  type LayoutParseOptions,
} from "./LayoutParser";
