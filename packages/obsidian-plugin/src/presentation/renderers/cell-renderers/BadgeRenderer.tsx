/**
 * BadgeRenderer - Renders cell values as styled badges
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Extract label from wikilink or return value as-is.
 */
function extractLabel(value: string): string {
  // Match [[target]] or [[target|alias]]
  const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (match) {
    return match[2]?.trim() || match[1].trim();
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
}) => {
  if (value == null || value === "") {
    return <span className="exo-cell-badge exo-cell-badge-empty">-</span>;
  }

  const stringValue = String(value);
  const label = extractLabel(stringValue);
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
