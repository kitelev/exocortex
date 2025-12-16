/**
 * ImageRenderer - Renders image cell values
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Renders a cell value as an image thumbnail.
 * Supports URLs, vault paths, and embedded images.
 */
export const ImageRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  if (value == null || value === "") {
    return <span className="exo-cell-image exo-cell-image-empty">-</span>;
  }

  const stringValue = String(value);

  // Handle wikilink image format ![[image.png]]
  const wikiImageMatch = stringValue.match(/^!\[\[([^\]]+)\]\]$/);
  if (wikiImageMatch) {
    const imagePath = wikiImageMatch[1];
    return (
      <span className="exo-cell-image">
        <img
          src={`app://local/${imagePath}`}
          alt={imagePath}
          className="exo-cell-image-thumbnail"
          loading="lazy"
        />
      </span>
    );
  }

  // Handle markdown image format ![alt](url)
  const mdImageMatch = stringValue.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (mdImageMatch) {
    const [, alt, url] = mdImageMatch;
    return (
      <span className="exo-cell-image">
        <img
          src={url}
          alt={alt || "Image"}
          className="exo-cell-image-thumbnail"
          loading="lazy"
        />
      </span>
    );
  }

  // Handle direct URL
  if (
    stringValue.startsWith("http://") ||
    stringValue.startsWith("https://") ||
    stringValue.startsWith("data:")
  ) {
    return (
      <span className="exo-cell-image">
        <img
          src={stringValue}
          alt="Image"
          className="exo-cell-image-thumbnail"
          loading="lazy"
        />
      </span>
    );
  }

  // Assume it's a vault path
  return (
    <span className="exo-cell-image">
      <img
        src={`app://local/${stringValue}`}
        alt={stringValue}
        className="exo-cell-image-thumbnail"
        loading="lazy"
      />
    </span>
  );
};
