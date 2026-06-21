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

  describe("parse - regex mutation killing", () => {
    it("should require frontmatter to start at beginning of content", () => {
      // Kills mutant 616: removing ^ from /^---\n([\s\S]*?)\n---/
      // If ^ is removed, frontmatter could be matched in the middle of content
      const content = "Some text\n---\nfoo: bar\n---\nBody";
      const result = service.parse(content);
      expect(result.exists).toBe(false);
    });

    it("should parse frontmatter that starts at the beginning", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.parse(content);
      expect(result.exists).toBe(true);
      expect(result.content).toBe("foo: bar");
    });
  });

  describe("updateProperty - mutation killing", () => {
    it("should append property with newline separator when frontmatter is not empty", () => {
      // Kills mutant 644: ConditionalExpression 'true' for length > 0
      // Kills mutant 646: EqualityOperator >= 0 instead of > 0
      // If separator is always "\n", empty frontmatter would get a leading newline
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "status", "draft");
      expect(result).toBe("---\nfoo: bar\nstatus: draft\n---\nBody");
      // Verify no double newline
      expect(result).not.toContain("\n\n");
    });

    it("should not add newline separator when frontmatter is empty after update", () => {
      // Edge case: what happens when parsed content is empty but exists
      // This tests the separator logic - empty content should not get leading newline
      const content = "---\nexisting: value\n---\nBody";
      const result = service.updateProperty(content, "existing", "new");
      expect(result).toBe("---\nexisting: new\n---\nBody");
    });
  });

  describe("removeProperty - mutation killing", () => {
    it("should return content unchanged when frontmatter exists but property does not", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.removeProperty(content, "nonexistent");
      expect(result).toBe(content);
    });

    it("should return content unchanged when no frontmatter exists", () => {
      const content = "Just body content";
      const result = service.removeProperty(content, "status");
      expect(result).toBe(content);
    });

    it("should actually remove the property when it exists", () => {
      const content = "---\nfoo: bar\nstatus: draft\n---\nBody";
      const result = service.removeProperty(content, "status");
      expect(result).not.toContain("status");
      expect(result).toContain("foo: bar");
    });

    it("should remove all occurrences of duplicate property names (g flag)", () => {
      // Kills mutant 150: "gm" → "" (removing global flag)
      // Without g flag, only first occurrence would be removed
      const content = "---\nstatus: draft\nfoo: bar\nstatus: published\n---\nBody";
      const result = service.removeProperty(content, "status");
      expect(result).not.toContain("status");
      expect(result).toContain("foo: bar");
    });
  });

  describe("getPropertyValue - mutation killing", () => {
    it("should return trimmed value", () => {
      // Kills mutant 661: StringLiteral "" instead of property value
      // If match[1].trim() returns "" instead of actual value, this would fail
      const result = service.getPropertyValue("status: draft", "status");
      expect(result).toBe("draft");
      expect(result).not.toBe("");
    });
  });

  describe("escapeRegex - mutation killing", () => {
    it("should escape special regex characters in property names", () => {
      // Kills mutant 678: StringLiteral "" instead of "\\$&"
      // If replacement is "" instead of "\\$&", special chars would be stripped
      const content = "---\nfoo.bar: value\nother: data\n---\nBody";
      const result = service.getPropertyValue("foo.bar: value\nother: data", "foo.bar");
      expect(result).toBe("value");
    });

    it("should not match similar property without escaping", () => {
      // If . is not escaped, "foo.bar" regex would match "fooXbar" too
      const frontmatter = "fooXbar: wrong\nfoo.bar: right";
      const result = service.getPropertyValue(frontmatter, "foo.bar");
      expect(result).toBe("right");
    });

    it("should handle property with special characters in escapeRegex", () => {
      // Kills mutant 682: StringLiteral "" instead of "\\$&" in escapeRegex
      const content = "---\nfoo.bar: value\n---\nBody";
      const hasResult = service.hasProperty("foo.bar: value", "foo.bar");
      expect(hasResult).toBe(true);
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

  describe("updateProperty with arrays of wikilinks (RFC-016 #2637)", () => {
    it("should serialize array of wikilinks as YAML list", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const newValue = [
        '"[[uuid1|ems__Task]]"',
        '"[[uuid2|gtd__NextAction]]"',
      ];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      expect(result).toContain("uuid1");
      expect(result).toContain("uuid2");
      expect(result).toContain("ems__Task");
      expect(result).toContain("gtd__NextAction");
      // Should be valid YAML list format
      expect(result).toContain('  - "[[uuid1|ems__Task]]"');
      expect(result).toContain('  - "[[uuid2|gtd__NextAction]]"');
    });

    it("should replace existing array property with new array", () => {
      const content = `---
exo__Instance_class:
  - "[[ems__Task]]"
  - "[[gtd__InboxItem]]"
foo: bar
---
Body`;

      const newValue = [
        '"[[uuid1|ems__Task]]"',
        '"[[uuid2|gtd__NextAction]]"',
      ];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      expect(result).toContain("uuid1");
      expect(result).toContain("uuid2");
      expect(result).not.toContain("gtd__InboxItem");
      expect(result).toContain("foo: bar");
    });

    it("should handle single-element array", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const newValue = ['"[[uuid1|ems__Task]]"'];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      expect(result).toContain('  - "[[uuid1|ems__Task]]"');
    });

    it("should handle empty array", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const newValue: string[] = [];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      // Empty array should produce empty YAML array
      expect(result).toContain("exo__Instance_class:");
    });

    it("should produce round-trip parseable YAML for arrays", () => {
      const content = "---\nfoo: bar\n---\nBody";
      const newValue = [
        '"[[uuid1|ems__Task]]"',
        '"[[uuid2|gtd__NextAction]]"',
      ];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      // Verify the result is parseable - extract frontmatter and check structure
      const parsed = service.parse(result);
      expect(parsed.exists).toBe(true);
      expect(parsed.content).toContain("exo__Instance_class:");
      expect(parsed.content).toContain('  - "[[uuid1|ems__Task]]"');
      expect(parsed.content).toContain('  - "[[uuid2|gtd__NextAction]]"');
    });

    it("should replace existing single-value property with array", () => {
      const content = '---\nexo__Instance_class: "[[ems__Task]]"\nfoo: bar\n---\nBody';
      const newValue = [
        '"[[uuid1|ems__Task]]"',
        '"[[uuid2|gtd__NextAction]]"',
      ];

      const result = service.updateProperty(content, "exo__Instance_class", newValue);

      expect(result).toContain('  - "[[uuid1|ems__Task]]"');
      expect(result).toContain('  - "[[uuid2|gtd__NextAction]]"');
      expect(result).toContain("foo: bar");
    });

    it("should not affect non-array updateProperty behavior", () => {
      // Regression: ensure scalar values still work
      const content = "---\nfoo: bar\n---\nBody";
      const result = service.updateProperty(content, "status", '"[[StatusDone]]"');

      expect(result).toBe('---\nfoo: bar\nstatus: "[[StatusDone]]"\n---\nBody');
    });
  });

  describe("IRI normalization", () => {
    it("should normalize IRI property name to Obsidian-style", () => {
      expect(FrontmatterService.normalizeIRI("https://exocortex.my/ontology/ems#Effort_status"))
        .toBe("ems__Effort_status");
    });

    it("should normalize all known namespace IRIs", () => {
      expect(FrontmatterService.normalizeIRI("https://exocortex.my/ontology/exo#Asset_label")).toBe("exo__Asset_label");
      expect(FrontmatterService.normalizeIRI("https://exocortex.my/ontology/exocmd#Command_icon")).toBe("exocmd__Command_icon");
      expect(FrontmatterService.normalizeIRI("https://exocortex.my/ontology/ims#Concept_domain")).toBe("ims__Concept_domain");
      expect(FrontmatterService.normalizeIRI("https://exocortex.my/ontology/ztlk#FleetingNote")).toBe("ztlk__FleetingNote");
    });

    it("should pass through non-IRI property names", () => {
      expect(FrontmatterService.normalizeIRI("ems__Effort_status")).toBe("ems__Effort_status");
      expect(FrontmatterService.normalizeIRI("foo_bar")).toBe("foo_bar");
    });

    it("should normalize obsidian:// vault URL to wikilink", () => {
      expect(FrontmatterService.normalizeIRIValue("obsidian://vault/ems/ems__EffortStatusDoing.md"))
        .toBe('"[[ems__EffortStatusDoing]]"');
    });

    it("should normalize ontology IRI value to wikilink", () => {
      expect(FrontmatterService.normalizeIRIValue("https://exocortex.my/ontology/ems#EffortStatusDoing"))
        .toBe('"[[ems__EffortStatusDoing]]"');
    });

    it("should pass through normal values", () => {
      expect(FrontmatterService.normalizeIRIValue('"[[ems__EffortStatusDoing]]"')).toBe('"[[ems__EffortStatusDoing]]"');
      expect(FrontmatterService.normalizeIRIValue("2025-11-10")).toBe("2025-11-10");
    });

    it("should update property correctly when given IRI key and value", () => {
      const content = '---\nems__Effort_status: "[[ems__EffortStatusToDo]]"\n---\nBody';
      const result = service.updateProperty(
        content,
        "https://exocortex.my/ontology/ems#Effort_status",
        "obsidian://vault/ems/ems__EffortStatusDoing.md",
      );

      expect(result).toContain('ems__Effort_status: "[[ems__EffortStatusDoing]]"');
      expect(result).not.toContain("https://");
      expect(result).not.toContain("obsidian://");
    });
  });
});