/**
 * TextRenderer - Renders plain text cell values with wikilink resolution
 *
 * Features:
 * - Renders plain text content
 * - Resolves embedded wikilinks to display target asset labels
 * - Supports inline editing when column.editable is true
 */
import React, { useState, useRef, useEffect } from "react";
import type { CellRendererProps } from "./types";

/**
 * Interface for parsed embedded wikilink segments.
 */
interface WikilinkSegment {
  type: "text" | "wikilink";
  content: string;
  target?: string;
  displayText?: string;
}

/**
 * Check if a string contains any wikilinks (embedded or standalone).
 *
 * @param value - Value to check
 * @returns true if the value contains any wikilinks
 */
function containsWikilinks(value: string): boolean {
  return /\[\[[^\]]+\]\]/.test(value);
}

/**
 * Parse text containing embedded wikilinks into segments.
 * Each segment is either plain text or a wikilink.
 *
 * @param content - Text content that may contain wikilinks
 * @param getAssetLabel - Optional function to resolve asset labels
 * @returns Array of segments representing the parsed content
 */
function parseEmbeddedWikilinks(
  content: string,
  getAssetLabel?: (path: string) => string | null,
): WikilinkSegment[] {
  const segments: WikilinkSegment[] = [];
  const wikilinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  let lastIndex = 0;
  let match;

  while ((match = wikilinkPattern.exec(content)) !== null) {
    // Add text before the wikilink
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.substring(lastIndex, match.index),
      });
    }

    const target = match[1].trim();
    const alias = match[2]?.trim();

    let displayText: string;
    if (alias) {
      displayText = alias;
    } else if (getAssetLabel) {
      const resolvedLabel = getAssetLabel(target);
      displayText = resolvedLabel || target;
    } else {
      displayText = target;
    }

    segments.push({
      type: "wikilink",
      content: match[0],
      target,
      displayText,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last wikilink
  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      content: content.substring(lastIndex),
    });
  }

  return segments;
}

/**
 * Renders a plain text cell value.
 * Supports inline editing when column.editable is true.
 * Resolves wikilinks in the text to display their target asset labels.
 */
export const TextRenderer: React.FC<CellRendererProps> = ({
  value,
  column,
  onChange,
  isEditing,
  onBlur,
  onLinkClick,
  getAssetLabel,
}) => {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setLocalValue(String(value ?? ""));
  }, [value]);

  if (isEditing && column.editable) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="exo-cell-input exo-cell-input-text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== String(value ?? "")) {
            onChange?.(localValue);
          }
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (localValue !== String(value ?? "")) {
              onChange?.(localValue);
            }
            onBlur?.();
          } else if (e.key === "Escape") {
            setLocalValue(String(value ?? ""));
            onBlur?.();
          }
        }}
      />
    );
  }

  const stringValue = value != null && value !== "" ? String(value) : "";
  const isEmpty = stringValue === "";

  if (isEmpty) {
    return (
      <span className="exo-cell-text exo-cell-text-empty">
        -
      </span>
    );
  }

  // Check if text contains embedded wikilinks that need resolution
  if (containsWikilinks(stringValue)) {
    const segments = parseEmbeddedWikilinks(stringValue, getAssetLabel);

    return (
      <span className="exo-cell-text">
        {segments.map((segment, index) => {
          if (segment.type === "wikilink" && segment.target) {
            const target = segment.target;
            return (
              <a
                key={index}
                data-href={target}
                className="internal-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onLinkClick?.(target, e);
                }}
                style={{ cursor: "pointer" }}
              >
                {segment.displayText}
              </a>
            );
          }
          return <React.Fragment key={index}>{segment.content}</React.Fragment>;
        })}
      </span>
    );
  }

  // Plain text without wikilinks
  return (
    <span className="exo-cell-text">
      {stringValue}
    </span>
  );
};
