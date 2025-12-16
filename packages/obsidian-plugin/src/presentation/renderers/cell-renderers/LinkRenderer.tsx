/**
 * LinkRenderer - Renders wikilink cell values as clickable links
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a wikilink string into target and optional alias.
 *
 * @param value - Value that might be a wikilink
 * @returns Parsed target and alias, or null if not a wikilink
 */
function parseWikiLink(value: string): { target: string; alias?: string } | null {
  // Match [[target]] or [[target|alias]]
  const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (match) {
    return {
      target: match[1].trim(),
      alias: match[2]?.trim(),
    };
  }
  return null;
}

/**
 * Renders a cell value as a clickable link.
 * Supports wikilink format ([[target]] or [[target|alias]]).
 */
export const LinkRenderer: React.FC<CellRendererProps> = ({
  value,
  assetPath,
  onLinkClick,
}) => {
  if (value == null || value === "") {
    return <span className="exo-cell-link exo-cell-link-empty">-</span>;
  }

  const stringValue = String(value);
  const parsed = parseWikiLink(stringValue);

  // If it's a wikilink
  if (parsed) {
    const displayText = parsed.alias || parsed.target;
    const linkPath = parsed.target;

    return (
      <a
        className="exo-cell-link internal-link"
        data-href={linkPath}
        role="link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onLinkClick?.(linkPath, e);
        }}
        style={{ cursor: "pointer" }}
      >
        {displayText}
      </a>
    );
  }

  // If assetPath is provided, make the text a link to it
  if (assetPath) {
    return (
      <a
        className="exo-cell-link internal-link"
        data-href={assetPath}
        role="link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onLinkClick?.(assetPath, e);
        }}
        style={{ cursor: "pointer" }}
      >
        {stringValue}
      </a>
    );
  }

  // Plain text fallback
  return <span className="exo-cell-link">{stringValue}</span>;
};
