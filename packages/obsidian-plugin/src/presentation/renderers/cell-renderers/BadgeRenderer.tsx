/**
 * BadgeRenderer - Renders cell values as styled badges
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Extract a display label from a wikilink (or return the value as-is).
 *
 * Mirrors LinkRenderer: an explicit alias wins; otherwise, when getAssetLabel
 * is provided, the alias-less target is resolved to its exo:Asset_label so a
 * badge bound to a wikilink/IRI property shows the human label instead of the
 * raw UUID/IRI (#3629).
 */
function extractLabel(
  value: string,
  getAssetLabel?: (path: string) => string | null,
): string {
  // Match [[target]] or [[target|alias]]
  const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (match) {
    const target = match[1].trim();
    const alias = match[2]?.trim();
    if (alias) {
      return alias;
    }
    if (getAssetLabel) {
      const resolved = getAssetLabel(target);
      if (resolved) {
        return resolved;
      }
    }
    return target;
  }
  return value;
}

/**
 * Generate a consistent color class based on the value.
 * Uses a simple hash to assign one of the badge color classes.
 */
function getBadgeColorClass(value: string): string {
  const colors = [
    "exo-badge-blue",
    "exo-badge-green",
    "exo-badge-yellow",
    "exo-badge-orange",
    "exo-badge-red",
    "exo-badge-purple",
    "exo-badge-pink",
    "exo-badge-gray",
  ];

  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Renders a cell value as a styled badge.
 * Useful for status, tags, or categorical values.
 */
export const BadgeRenderer: React.FC<CellRendererProps> = ({
  value,
  onLinkClick,
  getAssetLabel,
}) => {
  if (value == null || value === "") {
    return <span className="exo-cell-badge exo-cell-badge-empty">-</span>;
  }

  const stringValue = String(value);
  const label = extractLabel(stringValue, getAssetLabel);
  const colorClass = getBadgeColorClass(label);

  // Check if this is a wikilink - if so, make it clickable
  const isWikiLink = /^\[\[.+\]\]$/.test(stringValue);
  const linkTarget = stringValue.match(/^\[\[([^\]|]+)/)?.[1];

  if (isWikiLink && linkTarget && onLinkClick) {
    return (
      <a
        className={`exo-cell-badge ${colorClass} exo-cell-badge-clickable internal-link`}
        data-href={linkTarget}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onLinkClick(linkTarget, e);
        }}
        style={{ cursor: "pointer" }}
      >
        {label}
      </a>
    );
  }

  return (
    <span className={`exo-cell-badge ${colorClass}`}>
      {label}
    </span>
  );
};
