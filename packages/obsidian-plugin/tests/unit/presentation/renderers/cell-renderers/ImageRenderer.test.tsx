/**
 * ImageRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";


import { ImageRenderer } from "@plugin/presentation/renderers/cell-renderers/ImageRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("ImageRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Image",
    property: "image",
  });

  describe("WikiLink Image Format", () => {
    it("renders wikilink image ![[image.png]]", () => {
      render(
        <ImageRenderer
          value="![[image.png]]"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "app://local/image.png");
      expect(img).toHaveAttribute("alt", "image.png");
    });

    it("renders wikilink image with path", () => {
      render(
        <ImageRenderer
          value="![[attachments/photo.jpg]]"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "app://local/attachments/photo.jpg");
      expect(img).toHaveAttribute("alt", "attachments/photo.jpg");
    });
  });

  describe("Markdown Image Format", () => {
    it("renders markdown image ![alt](url)", () => {
      render(
        <ImageRenderer
          value="![Profile](https://example.com/image.png)"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/image.png");
      expect(img).toHaveAttribute("alt", "Profile");
    });

    it("renders markdown image without alt text", () => {
      render(
        <ImageRenderer
          value="![](https://example.com/image.png)"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/image.png");
      expect(img).toHaveAttribute("alt", "Image");
    });
  });

  describe("Direct URL", () => {
    it("renders https URL", () => {
      render(
        <ImageRenderer
          value="https://example.com/photo.jpg"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
      expect(img).toHaveAttribute("alt", "Image");
    });

    it("renders http URL", () => {
      render(
        <ImageRenderer
          value="http://example.com/photo.jpg"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "http://example.com/photo.jpg");
    });

    it("renders data URL", () => {
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      render(
        <ImageRenderer
          value={dataUrl}
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", dataUrl);
    });
  });

  describe("Vault Path", () => {
    it("renders vault path as app:// URL", () => {
      render(
        <ImageRenderer
          value="attachments/photo.jpg"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "app://local/attachments/photo.jpg");
      expect(img).toHaveAttribute("alt", "attachments/photo.jpg");
    });

    it("renders simple filename", () => {
      render(
        <ImageRenderer
          value="image.png"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "app://local/image.png");
    });
  });

  describe("Image Attributes", () => {
    it("has lazy loading enabled", () => {
      render(
        <ImageRenderer
          value="https://example.com/image.png"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("loading", "lazy");
    });

    it("has thumbnail class", () => {
      render(
        <ImageRenderer
          value="https://example.com/image.png"
          column={createColumn()}
        />
      );

      const img = screen.getByRole("img");
      expect(img).toHaveClass("exo-cell-image-thumbnail");
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <ImageRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-image-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <ImageRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <ImageRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("CSS Classes", () => {
    it("has container class", () => {
      const { container } = render(
        <ImageRenderer
          value="image.png"
          column={createColumn()}
        />
      );

      expect(container.querySelector(".exo-cell-image")).toBeInTheDocument();
    });
  });
});
