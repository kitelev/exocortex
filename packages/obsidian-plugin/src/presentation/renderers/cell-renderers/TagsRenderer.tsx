/**
 * TagsRenderer - Renders array of tags as badges
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a value into an array of tags.
 */
function parseTags(value: unknown): string[] {
  if (value == null) return [];

  // Already an array
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : String(v)))
      .filter((v) => v.length > 0);
  }

  // String - split by commas or newlines
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  return [];
}

/**
 * Extract label from wikilink or return value as-is.
 */
function extractLabel(value: string): { target: string; label: string } {
  const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (match) {
    return {
      target: match[1].trim(),
      label: match[2]?.trim() || match[1].trim(),
    };
  }
  return { target: value, label: value };
}

/**
 * Generate a consistent color class based on the value.
 */
function getTagColorClass(value: string): string {
  const colors = [
    "exo-tag-blue",
    "exo-tag-green",
    "exo-tag-yellow",
    "exo-tag-orange",
    "exo-tag-red",
    "exo-tag-purple",
    "exo-tag-pink",
    "exo-tag-gray",
  ];

  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Renders a cell value as a list of tag badges.
 * Supports arrays, comma-separated strings, and wikilinks.
 */
export const TagsRenderer: React.FC<CellRendererProps> = ({
  value,
  onLinkClick,
}) => {
  const tags = parseTags(value);

  if (tags.length === 0) {
    return <span className="exo-cell-tags exo-cell-tags-empty">-</span>;
  }

  return (
    <span className="exo-cell-tags">
      {tags.map((tag, index) => {
        const { target, label } = extractLabel(tag);
        const colorClass = getTagColorClass(label);
        const isWikiLink = /^\[\[.+\]\]$/.test(tag);

        if (isWikiLink && onLinkClick) {
          return (
            <a
              key={`${tag}-${index}`}
              className={`exo-cell-tag ${colorClass} exo-cell-tag-clickable internal-link`}
              data-href={target}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLinkClick(target, e);
              }}
              style={{ cursor: "pointer" }}
            >
              {label}
            </a>
          );
        }

        return (
          <span key={`${tag}-${index}`} className={`exo-cell-tag ${colorClass}`}>
            {label}
          </span>
        );
      })}
    </span>
  );
};
