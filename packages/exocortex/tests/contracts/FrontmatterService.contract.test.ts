/**
 * FrontmatterService Contract Tests
 *
 * Consumer-driven contract tests for the frontmatter service.
 * These tests verify the behavioral guarantees that the obsidian-plugin
 * depends on when manipulating YAML frontmatter in markdown files.
 *
 * @see packages/core/contracts/FrontmatterService.contract.ts
 */

import { FrontmatterService } from "../../src/utilities/FrontmatterService";
import { FrontmatterServiceContract } from "../../contracts/FrontmatterService.contract";

describe("FrontmatterService Contract Tests", () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  describe(`Contract: ${FrontmatterServiceContract.name} v${FrontmatterServiceContract.version}`, () => {
    describe("parse() method", () => {
      it("returns exists=false for content without frontmatter", () => {
        const content = "Just some markdown content\n\nWith paragraphs.";
        const result = service.parse(content);

        expect(result.exists).toBe(false);
        expect(result.content).toBe("");
      });

      it("returns exists=true for content with valid frontmatter", () => {
        const content = "---\ntitle: Test\nstatus: done\n---\nBody content";
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(result.content).toContain("title: Test");
        expect(result.content).toContain("status: done");
      });

      it("parses empty frontmatter block", () => {
        const content = "---\n\n---\nBody content";
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(result.content).toBe("");
      });

      it("parses frontmatter with nested objects", () => {
        const content = "---\ntitle: Test\nmeta:\n  author: Alice\n  date: 2025-01-01\n---\nBody";
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(result.content).toContain("meta:");
        expect(result.content).toContain("author: Alice");
      });

      it("parses frontmatter with array values", () => {
        const content = "---\ntags:\n  - tag1\n  - tag2\n  - tag3\n---\nBody";
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(result.content).toContain("- tag1");
        expect(result.content).toContain("- tag2");
      });

      it("parses frontmatter with wiki-link values", () => {
        const content = '---\nstatus: "[[StatusDone]]"\nparent: "[[Project1]]"\n---\nBody';
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(result.content).toContain("[[StatusDone]]");
        expect(result.content).toContain("[[Project1]]");
      });
    });

    describe("updateProperty() method", () => {
      it("updates existing property value", () => {
        const content = "---\nstatus: draft\n---\nBody content";
        const updated = service.updateProperty(content, "status", "published");

        expect(updated).toContain("status: published");
        expect(updated).not.toContain("status: draft");
      });

      it("adds new property to existing frontmatter", () => {
        const content = "---\ntitle: Test\n---\nBody content";
        const updated = service.updateProperty(content, "status", "draft");

        expect(updated).toContain("title: Test");
        expect(updated).toContain("status: draft");
      });

      it("creates frontmatter if none exists", () => {
        const content = "Body content only";
        const updated = service.updateProperty(content, "status", "draft");

        expect(updated).toMatch(/^---\n/);
        expect(updated).toContain("status: draft");
        expect(updated).toContain("---\nBody content");
      });

      it("preserves existing properties when updating", () => {
        const content = "---\ntitle: Test\nauthor: Alice\n---\nBody";
        const updated = service.updateProperty(content, "status", "done");

        expect(updated).toContain("title: Test");
        expect(updated).toContain("author: Alice");
        expect(updated).toContain("status: done");
      });

      it("preserves body content after frontmatter", () => {
        const content = "---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.";
        const updated = service.updateProperty(content, "status", "draft");

        expect(updated).toContain("# Heading");
        expect(updated).toContain("Paragraph text.");
      });
    });

    describe("addProperty() method (alias)", () => {
      it("behaves identically to updateProperty", () => {
        const content = "---\ntitle: Test\n---\nBody";
        const updated = service.addProperty(content, "newProp", "value");

        expect(updated).toContain("newProp: value");
        expect(updated).toContain("title: Test");
      });
    });

    describe("removeProperty() method", () => {
      it("removes existing property", () => {
        const content = "---\ntitle: Test\nstatus: draft\n---\nBody";
        const updated = service.removeProperty(content, "status");

        expect(updated).toContain("title: Test");
        expect(updated).not.toContain("status:");
      });

      it("returns unchanged content if property doesn't exist", () => {
        const content = "---\ntitle: Test\n---\nBody";
        const updated = service.removeProperty(content, "nonexistent");

        expect(updated).toBe(content);
      });

      it("returns unchanged content if no frontmatter", () => {
        const content = "Just body content";
        const updated = service.removeProperty(content, "status");

        expect(updated).toBe(content);
      });

      it("removes property with array values", () => {
        const content = "---\ntitle: Test\ntags:\n  - tag1\n  - tag2\n---\nBody";
        const updated = service.removeProperty(content, "tags");

        expect(updated).toContain("title: Test");
        expect(updated).not.toContain("tags:");
        expect(updated).not.toContain("- tag1");
      });
    });

    describe("hasProperty() method", () => {
      it("returns true for existing property", () => {
        const frontmatter = "title: Test\nstatus: draft";
        expect(service.hasProperty(frontmatter, "status")).toBe(true);
      });

      it("returns false for non-existent property", () => {
        const frontmatter = "title: Test";
        expect(service.hasProperty(frontmatter, "status")).toBe(false);
      });

      it("handles properties with special characters", () => {
        const frontmatter = "ems__Effort_status: done\nexo__Asset_label: Test";
        expect(service.hasProperty(frontmatter, "ems__Effort_status")).toBe(true);
        expect(service.hasProperty(frontmatter, "exo__Asset_label")).toBe(true);
      });
    });

    describe("createFrontmatter() method", () => {
      it("creates frontmatter block with given properties", () => {
        const content = "Body content";
        const result = service.createFrontmatter(content, {
          title: "Test",
          status: "draft",
        });

        expect(result).toMatch(/^---\n/);
        expect(result).toContain("title: Test");
        expect(result).toContain("status: draft");
        expect(result).toContain("---\n");
        expect(result).toContain("Body content");
      });

      it("handles empty properties object", () => {
        const content = "Body content";
        const result = service.createFrontmatter(content, {});

        expect(result).toMatch(/^---\n\n---\n/);
        expect(result).toContain("Body content");
      });

      it("preserves property order", () => {
        const content = "Body";
        const result = service.createFrontmatter(content, {
          first: "1",
          second: "2",
          third: "3",
        });

        const firstIdx = result.indexOf("first:");
        const secondIdx = result.indexOf("second:");
        const thirdIdx = result.indexOf("third:");

        expect(firstIdx).toBeLessThan(secondIdx);
        expect(secondIdx).toBeLessThan(thirdIdx);
      });
    });

    describe("getPropertyValue() method", () => {
      it("returns value for existing property", () => {
        const frontmatter = "title: Test Document\nstatus: draft";
        expect(service.getPropertyValue(frontmatter, "title")).toBe("Test Document");
        expect(service.getPropertyValue(frontmatter, "status")).toBe("draft");
      });

      it("returns null for non-existent property", () => {
        const frontmatter = "title: Test";
        expect(service.getPropertyValue(frontmatter, "missing")).toBeNull();
      });

      it("handles quoted string values", () => {
        const frontmatter = 'status: "[[StatusDone]]"';
        expect(service.getPropertyValue(frontmatter, "status")).toBe('"[[StatusDone]]"');
      });

      it("handles numeric values", () => {
        const frontmatter = "count: 42\nprice: 19.99";
        expect(service.getPropertyValue(frontmatter, "count")).toBe("42");
        expect(service.getPropertyValue(frontmatter, "price")).toBe("19.99");
      });

      it("handles boolean values", () => {
        const frontmatter = "published: true\ndraft: false";
        expect(service.getPropertyValue(frontmatter, "published")).toBe("true");
        expect(service.getPropertyValue(frontmatter, "draft")).toBe("false");
      });
    });

    describe("Behavioral guarantees", () => {
      it("handles ISO timestamp values", () => {
        const timestamp = "2025-01-15T10:30:00.000Z";
        const content = `---\ncreated: ${timestamp}\n---\nBody`;
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(service.getPropertyValue(result.content, "created")).toBe(timestamp);
      });

      it("handles multi-line body content after frontmatter", () => {
        const body = `
# Main Heading

First paragraph.

## Subheading

- List item 1
- List item 2

\`\`\`code
code block
\`\`\`
        `.trim();

        const content = `---\ntitle: Test\n---\n${body}`;
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(content.includes(body)).toBe(true);
      });

      it("handles properties with colons in values", () => {
        const content = '---\nurl: http://example.org/page\ntime: "10:30:00"\n---\nBody';
        const result = service.parse(content);

        expect(result.exists).toBe(true);
        expect(service.getPropertyValue(result.content, "url")).toBe("http://example.org/page");
      });

      it("round-trip preserves content structure", () => {
        const original = "---\ntitle: Test\nstatus: draft\n---\n# Content\n\nBody text.";

        // Parse
        const parsed = service.parse(original);
        expect(parsed.exists).toBe(true);

        // Update
        const updated = service.updateProperty(original, "status", "done");

        // Parse again
        const reparsed = service.parse(updated);
        expect(reparsed.exists).toBe(true);

        // Verify structure preserved
        expect(updated).toContain("title: Test");
        expect(updated).toContain("# Content");
        expect(updated).toContain("Body text.");
      });
    });
  });
});
