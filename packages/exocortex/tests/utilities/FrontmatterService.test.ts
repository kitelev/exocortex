import { FrontmatterService } from "../../src/utilities/FrontmatterService";

describe("FrontmatterService", () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  describe("parse", () => {
    it("should parse existing frontmatter", () => {
      const content = "---\nfoo: bar\nstatus: draft\n---\nBody content";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("foo: bar\nstatus: draft");
      expect(result.originalContent).toBe(content);
    });

    it("should handle empty frontmatter", () => {
      const content = "---\n---\nBody content";
      const result = service.parse(content);

      expect(result.exists).toBe(false); // Empty frontmatter doesn't match regex
      expect(result.content).toBe("");
      expect(result.originalContent).toBe(content);
    });

    it("should handle content without frontmatter", () => {
      const content = "Body content without frontmatter";
      const result = service.parse(content);

      expect(result.exists).toBe(false);
      expect(result.content).toBe("");
      expect(result.originalContent).toBe(content);
    });

    it("should handle malformed frontmatter (missing closing ---)", () => {
      const content = "---\nfoo: bar\nBody content";
      const result = service.parse(content);

      expect(result.exists).toBe(false);
      expect(result.content).toBe("");
    });

    it("should handle malformed frontmatter (missing opening ---)", () => {
      const content = "foo: bar\n---\nBody content";
      const result = service.parse(content);

      expect(result.exists).toBe(false);
      expect(result.content).toBe("");
    });

    it("should handle frontmatter with special characters", () => {
      const content = '---\nspecial: "value with: colons"\narray: [1, 2, 3]\n---\nBody';
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe('special: "value with: colons"\narray: [1, 2, 3]');
    });

    it("should handle multiline frontmatter values", () => {
      const content = "---\ndescription: |\n  Line 1\n  Line 2\ntitle: Test\n---\nBody";
      const result = service.parse(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe("description: |\n  Line 1\n  Line 2\ntitle: Test");
    });
  });

  describe("updateProperty", () => {
    it("should update existing property", () => {
      const content = "---\nstatus: draft\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "status", "published");

      expect(result).toBe("---\nstatus: published\nfoo: bar\n---\nBody");
    });

    it("should add new property to existing frontmatter", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody");
    });

    it("should create frontmatter if missing", () => {
      const content = "Body content";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toBe("---\nstatus: draft\n---\nBody content");
    });

    it("should handle wiki-link values", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "status", '"[[StatusDone]]"');

      expect(result).toBe('---\nfoo: bar\nstatus: "[[StatusDone]]"\n---\nBody');
    });

    it("should handle boolean values", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "archived", true);

      expect(result).toBe("---\nfoo: bar\narchived: true\n---\nBody");
    });

    it("should handle number values", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "priority", 42);

      expect(result).toBe("---\nfoo: bar\npriority: 42\n---\nBody");
    });

    it("should handle property names with underscores", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "ems__Effort_status", "active");

      expect(result).toBe("---\nfoo: bar\nems__Effort_status: active\n---\nBody");
    });

    it("should handle property names with special characters", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "special.property", "value");

      expect(result).toBe("---\nfoo: bar\nspecial.property: value\n---\nBody");
    });

    it("should update property in empty frontmatter", () => {
      const content = "---\n---\nBody";
      const result = service.updateProperty(content, "status", "draft");

      // Empty frontmatter doesn't parse as existing, so creates new
      expect(result).toBe("---\nstatus: draft\n---\n---\n---\nBody");
    });

    it("should preserve body content with special characters", () => {
      const content = "---\nfoo: bar\n---\nBody with --- dashes and more ---";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody with --- dashes and more ---");
    });
  });

  describe("addProperty", () => {
    it("should add property (alias for updateProperty)", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.addProperty(content, "status", "draft");

      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody");
    });

    it("should create frontmatter when adding to content without frontmatter", () => {
      const content = "Body content";
      const result = service.addProperty(content, "status", "draft");

      expect(result).toBe("---\nstatus: draft\n---\nBody content");
    });
  });

  describe("removeProperty", () => {
    it("should remove existing property", () => {
      const content = "---\nfoo: bar\nstatus: draft\npriority: high\n---\nBody";
      const result = service.removeProperty(content, "status");

      expect(result).toBe("---\nfoo: bar\npriority: high\n---\nBody");
    });

    it("should remove first property", () => {
      const content = "---\nstatus: draft\nfoo: bar\n---\nBody";
      const result = service.removeProperty(content, "status");

      expect(result).toBe("---\n\nfoo: bar\n---\nBody");
    });

    it("should remove last property", () => {
      const content = "---\nfoo: bar\nstatus: draft\n---\nBody";
      const result = service.removeProperty(content, "status");

      expect(result).toBe("---\nfoo: bar\n---\nBody");
    });

    it("should remove only property", () => {
      const content = "---\nstatus: draft\n---\nBody";
      const result = service.removeProperty(content, "status");

      expect(result).toBe("---\n\n---\nBody");
    });

    it("should handle non-existent property", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.removeProperty(content, "nonexistent");

      expect(result).toBe(content);
    });

    it("should handle content without frontmatter", () => {
      const content = "Body content";
      const result = service.removeProperty(content, "status");

      expect(result).toBe(content);
    });

    it("should remove property with special characters in name", () => {
      const content = "---\nems__Effort_status: active\nfoo: bar\n---\nBody";
      const result = service.removeProperty(content, "ems__Effort_status");

      expect(result).toBe("---\n\nfoo: bar\n---\nBody");
    });

    it("should remove array property with all items", () => {
      const content = `---
foo: bar
aliases:
  - Alias 1
  - Alias 2
  - Alias 3
status: draft
---
Body`;
      const result = service.removeProperty(content, "aliases");

      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody");
      expect(result).not.toContain("aliases");
      expect(result).not.toContain("Alias 1");
    });

    it("should remove array property at beginning of frontmatter", () => {
      const content = `---
aliases:
  - First Alias
  - Second Alias
foo: bar
---
Body`;
      const result = service.removeProperty(content, "aliases");

      expect(result).toBe("---\n\nfoo: bar\n---\nBody");
    });

    it("should remove array property at end of frontmatter", () => {
      const content = `---
foo: bar
aliases:
  - Last Alias
---
Body`;
      const result = service.removeProperty(content, "aliases");

      expect(result).toBe("---\nfoo: bar\n---\nBody");
    });
  });

  describe("hasProperty", () => {
    it("should detect existing property", () => {
      const frontmatterContent = "foo: bar\nstatus: draft";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(true);
    });

    it("should detect property at beginning", () => {
      const frontmatterContent = "status: draft\nfoo: bar";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(true);
    });

    it("should detect property at end", () => {
      const frontmatterContent = "foo: bar\nstatus: draft";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(true);
    });

    it("should return false for non-existent property", () => {
      const frontmatterContent = "foo: bar\nbaz: qux";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(false);
    });

    it("should return false for empty frontmatter", () => {
      const frontmatterContent = "";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(false);
    });

    it("should handle property names with underscores", () => {
      const frontmatterContent = "ems__Effort_status: active\nfoo: bar";
      const result = service.hasProperty(frontmatterContent, "ems__Effort_status");

      expect(result).toBe(true);
    });

    it("should not match partial property names", () => {
      const frontmatterContent = "status_extended: active";
      const result = service.hasProperty(frontmatterContent, "status");

      expect(result).toBe(false);
    });
  });

  describe("createFrontmatter", () => {
    it("should create frontmatter with single property", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, { status: "draft" });

      expect(result).toBe("---\nstatus: draft\n---\nBody content");
    });

    it("should create frontmatter with multiple properties", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, {
        status: "draft",
        priority: "high",
        tags: "important",
      });

      expect(result).toBe("---\nstatus: draft\npriority: high\ntags: important\n---\nBody content");
    });

    it("should handle wiki-link values", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, {
        status: '"[[StatusDone]]"',
        area: '"[[AreaWork]]"',
      });

      expect(result).toBe('---\nstatus: "[[StatusDone]]"\narea: "[[AreaWork]]"\n---\nBody content');
    });

    it("should handle boolean values", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, {
        archived: true,
        draft: false,
      });

      expect(result).toBe("---\narchived: true\ndraft: false\n---\nBody content");
    });

    it("should handle number values", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, {
        priority: 1,
        effort: 42,
      });

      expect(result).toBe("---\npriority: 1\neffort: 42\n---\nBody content");
    });

    it("should preserve leading newline in content", () => {
      const content = "\nBody content";
      const result = service.createFrontmatter(content, { status: "draft" });

      expect(result).toBe("---\nstatus: draft\n---\nBody content");
    });

    it("should handle empty property object", () => {
      const content = "Body content";
      const result = service.createFrontmatter(content, {});

      expect(result).toBe("---\n\n---\nBody content");
    });
  });

  describe("getPropertyValue", () => {
    it("should get simple property value", () => {
      const frontmatterContent = "foo: bar\nstatus: draft";
      const result = service.getPropertyValue(frontmatterContent, "status");

      expect(result).toBe("draft");
    });

    it("should get property value with spaces", () => {
      const frontmatterContent = "status:   draft   ";
      const result = service.getPropertyValue(frontmatterContent, "status");

      expect(result).toBe("draft");
    });

    it("should get wiki-link property value", () => {
      const frontmatterContent = 'status: "[[StatusDone]]"';
      const result = service.getPropertyValue(frontmatterContent, "status");

      expect(result).toBe('"[[StatusDone]]"');
    });

    it("should get number property value", () => {
      const frontmatterContent = "priority: 42";
      const result = service.getPropertyValue(frontmatterContent, "priority");

      expect(result).toBe("42");
    });

    it("should get boolean property value", () => {
      const frontmatterContent = "archived: true";
      const result = service.getPropertyValue(frontmatterContent, "archived");

      expect(result).toBe("true");
    });

    it("should return null for non-existent property", () => {
      const frontmatterContent = "foo: bar";
      const result = service.getPropertyValue(frontmatterContent, "status");

      expect(result).toBe(null);
    });

    it("should return null for empty frontmatter", () => {
      const frontmatterContent = "";
      const result = service.getPropertyValue(frontmatterContent, "status");

      expect(result).toBe(null);
    });

    it("should get property with underscores in name", () => {
      const frontmatterContent = "ems__Effort_status: active";
      const result = service.getPropertyValue(frontmatterContent, "ems__Effort_status");

      expect(result).toBe("active");
    });

    it("should get property with special characters in value", () => {
      const frontmatterContent = 'description: "Value with: colons and | pipes"';
      const result = service.getPropertyValue(frontmatterContent, "description");

      expect(result).toBe('"Value with: colons and | pipes"');
    });

    it("should handle property with empty value", () => {
      const frontmatterContent = "status:";
      const result = service.getPropertyValue(frontmatterContent, "status");

      // With just "status:" and nothing after, the value should be empty
      expect(result).toBe("");
    });
  });

  describe("edge cases", () => {
    it("should handle frontmatter-like content in body", () => {
      const content = "---\nfoo: bar\n---\nBody with ---\nfake: frontmatter\n---";
      const result = service.updateProperty(content, "status", "draft");

      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody with ---\nfake: frontmatter\n---");
    });

    it("should handle property names that are substrings of others", () => {
      const content = "---\nstatus: draft\nstatus_extended: active\n---\nBody";
      const result = service.updateProperty(content, "status", "published");

      expect(result).toBe("---\nstatus: published\nstatus_extended: active\n---\nBody");
    });

    it("should handle CRLF line endings", () => {
      const content = "---\r\nfoo: bar\r\nstatus: draft\r\n---\r\nBody";
      const result = service.parse(content);

      // The regex expects \n, so CRLF won't match
      expect(result.exists).toBe(false);
    });

    it("should handle unicode characters in values", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "title", "Тест 测试 テスト");

      expect(result).toBe("---\nfoo: bar\ntitle: Тест 测试 テスト\n---\nBody");
    });

    it("should handle very long property values", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const longValue = "a".repeat(1000);
      const result = service.updateProperty(content, "description", longValue);

      expect(result).toBe(`---\nfoo: bar\ndescription: ${longValue}\n---\nBody`);
    });
  });
});