/**
 * FrontmatterService Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Malformed YAML frontmatter
 * - Edge cases in parsing
 * - Special characters handling
 * - Unicode content
 * - Large file handling
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import { FrontmatterService } from "../../../src/utilities/FrontmatterService";

describe("FrontmatterService Edge Cases", () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  describe("parse() Edge Cases", () => {
    it("should handle empty string", () => {
      const result = service.parse("");

      expect(result.exists).toBe(false);
      expect(result.content).toBe("");
      expect(result.originalContent).toBe("");
    });

    it("should handle whitespace-only content", () => {
      const content = "   \n\t\n  ";
      const result = service.parse(content);

      expect(result.exists).toBe(false);
      expect(result.content).toBe("");
    });

    it("should handle file with minimal frontmatter", () => {
      // Note: ---\n--- is not valid (requires newline before closing)
      const content = "---\n\n---";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("");
    });

    it("should handle frontmatter with only whitespace", () => {
      const content = "---\n   \n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("   ");
    });

    it("should NOT match frontmatter that doesn't start at beginning", () => {
      const content = "Some text\n---\nfoo: bar\n---";
      const result = service.parse(content);

      expect(result.exists).toBe(false);
    });

    it("should handle frontmatter with trailing content after delimiter", () => {
      const content = "---\nfoo: bar\n---\n\n# Title\n\nBody content";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("foo: bar");
    });

    it("should handle frontmatter with multiple --- in body", () => {
      const content = "---\nfoo: bar\n---\n\nBody with ---\n\nmore text";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("foo: bar");
    });

    it("should handle unclosed frontmatter", () => {
      const content = "---\nfoo: bar\nno closing delimiter";
      const result = service.parse(content);

      // Unclosed frontmatter should not match
      expect(result.exists).toBe(false);
    });
  });

  describe("updateProperty() Edge Cases", () => {
    it("should create frontmatter on file without any", () => {
      const content = "Just body content";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toContain("---");
      expect(result).toContain("status: draft");
      expect(result).toContain("Just body content");
    });

    it("should handle property name with special characters", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "ems__Effort_status", '"[[Doing]]"');

      expect(result).toContain("ems__Effort_status: \"[[Doing]]\"");
    });

    it("should handle property value with colon", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "url", "http://example.org/path");

      expect(result).toContain("url: http://example.org/path");
    });

    it("should handle property value with quotes", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "label", '"quoted value"');

      expect(result).toContain('label: "quoted value"');
    });

    it("should handle multiline property value", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "description", "line1\nline2\nline3");

      expect(result).toContain("description: line1\nline2\nline3");
    });

    it("should update existing property without duplicating", () => {
      const content = "---\nstatus: draft\npriority: high\n---\nBody";
      const result = service.updateProperty(content, "status", "published");

      const matches = result.match(/status:/g);
      expect(matches).toHaveLength(1);
      expect(result).toContain("status: published");
    });

    it("should preserve other properties when updating", () => {
      const content = "---\nfoo: bar\nstatus: draft\nbaz: qux\n---\nBody";
      const result = service.updateProperty(content, "status", "published");

      expect(result).toContain("foo: bar");
      expect(result).toContain("baz: qux");
      expect(result).toContain("status: published");
    });

    it("should handle null value", () => {
      const content = "---\nstatus: draft\n---\nBody";
      const result = service.updateProperty(content, "status", null as any);

      expect(result).toContain("status: null");
    });

    it("should handle undefined value", () => {
      const content = "---\nstatus: draft\n---\nBody";
      const result = service.updateProperty(content, "status", undefined as any);

      expect(result).toContain("status: undefined");
    });

    it("should handle boolean value", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "archived", true);

      expect(result).toContain("archived: true");
    });

    it("should handle numeric value", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "priority", 42);

      expect(result).toContain("priority: 42");
    });

    it("should handle array value", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "tags", ["a", "b", "c"]);

      expect(result).toContain("tags: a,b,c");
    });
  });

  describe("removeProperty() Edge Cases", () => {
    it("should do nothing when property doesn't exist", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.removeProperty(content, "nonexistent");

      expect(result).toBe(content);
    });

    it("should remove property and preserve others", () => {
      const content = "---\nfoo: bar\nstatus: draft\nbaz: qux\n---\nBody";
      const result = service.removeProperty(content, "status");

      expect(result).toContain("foo: bar");
      expect(result).toContain("baz: qux");
      expect(result).not.toContain("status:");
    });

    it("should handle removing last property", () => {
      const content = "---\nstatus: draft\n---\nBody";
      const result = service.removeProperty(content, "status");

      // Should still have frontmatter delimiters
      expect(result).toContain("---");
    });

    it("should handle property with regex special characters", () => {
      const content = "---\npath[0]: value\n---\nBody";
      const result = service.removeProperty(content, "path[0]");

      expect(result).not.toContain("path[0]:");
    });
  });

  describe("Unicode and Special Characters", () => {
    it("should handle Unicode property values", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "title", "日本語テスト");

      expect(result).toContain("title: 日本語テスト");
    });

    it("should handle emoji in property values", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "status", "🚀 Launched");

      expect(result).toContain("status: 🚀 Launched");
    });

    it("should handle RTL text in property values", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "text", "العربية");

      expect(result).toContain("text: العربية");
    });

    it("should handle escaped characters in property names", () => {
      const content = "---\nprefix\\.property: value\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toContain("prefix\\.property: value");
    });
  });

  describe("Large Content Handling", () => {
    it("should handle large frontmatter", () => {
      const properties = Array.from(
        { length: 100 },
        (_, i) => `property${i}: value${i}`
      ).join("\n");
      const content = `---\n${properties}\n---\nBody`;

      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toContain("property99: value99");
    });

    it("should handle large body content", () => {
      const largeBody = "x".repeat(100000);
      const content = `---\nfoo: bar\n---\n${largeBody}`;

      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("foo: bar");
    });

    it("should handle many updates in sequence", () => {
      let content = "---\n---\nBody";

      for (let i = 0; i < 50; i++) {
        content = service.updateProperty(content, `prop${i}`, `value${i}`);
      }

      const result = service.parse(content);
      expect(result.exists).toBe(true);
      expect(result.content).toContain("prop49: value49");
    });
  });

  describe("YAML Edge Cases", () => {
    it("should handle YAML with complex nesting (as string)", () => {
      const content = "---\ncomplex: \n  nested: value\n  array:\n    - item1\n    - item2\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
    });

    it("should handle YAML anchors and aliases (passthrough)", () => {
      const content = "---\nbase: &base\n  key: value\nderived:\n  <<: *base\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
    });

    it("should handle property with pipe (|) multiline indicator", () => {
      const content = "---\ndescription: |\n  Line 1\n  Line 2\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toContain("description:");
    });

    it("should handle property with greater-than (>) folded style", () => {
      const content = "---\nsummary: >\n  This is a\n  folded string\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
    });
  });

  describe("hasProperty() Edge Cases", () => {
    it("should detect property at start of frontmatter", () => {
      const content = "---\nfirst: value\nsecond: value\n---";
      const parsed = service.parse(content);

      // Use internal check via updateProperty behavior
      const result = service.updateProperty(content, "first", "new");
      const matches = result.match(/first:/g);
      expect(matches).toHaveLength(1);
    });

    it("should detect property at end of frontmatter", () => {
      const content = "---\nfirst: value\nlast: value\n---";
      const result = service.updateProperty(content, "last", "new");

      const matches = result.match(/last:/g);
      expect(matches).toHaveLength(1);
    });

    it("should distinguish similar property names", () => {
      const content = "---\nstatus: draft\nems__Effort_status: doing\n---";
      const result = service.updateProperty(content, "status", "published");

      expect(result).toContain("status: published");
      expect(result).toContain("ems__Effort_status: doing");
    });

    it("should handle property that is substring of another", () => {
      const content = "---\nfoo: bar\nfoobar: baz\n---";
      const result = service.updateProperty(content, "foo", "updated");

      expect(result).toContain("foo: updated");
      expect(result).toContain("foobar: baz");
    });
  });

  describe("createFrontmatter() Edge Cases", () => {
    it("should create frontmatter with single property", () => {
      const content = "Body only";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toMatch(/^---\n/);
      expect(result).toContain("status: draft");
      expect(result).toContain("\n---\nBody only");
    });

    it("should handle body starting with newlines", () => {
      const content = "\n\n\nBody after newlines";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toMatch(/^---\n/);
      expect(result).toContain("Body after newlines");
    });

    it("should handle body that looks like frontmatter", () => {
      const content = "key: value\nBody text";
      const result = service.updateProperty(content, "status", "draft");

      // Should create proper frontmatter, not parse body as frontmatter
      expect(result).toMatch(/^---\n/);
      expect(result).toContain("status: draft");
      expect(result).toContain("key: value");
    });
  });

  describe("Wikilink Value Edge Cases", () => {
    it("should handle wikilink with spaces", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "status", '"[[Status Name With Spaces]]"');

      expect(result).toContain('status: "[[Status Name With Spaces]]"');
    });

    it("should handle wikilink with alias", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "link", '"[[Target|Display Text]]"');

      expect(result).toContain('link: "[[Target|Display Text]]"');
    });

    it("should handle nested brackets in value", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "expr", "[1, [2, 3], 4]");

      expect(result).toContain("expr: [1, [2, 3], 4]");
    });
  });
});
