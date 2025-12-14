import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";

describe("MetadataHelpers", () => {
  describe("findAllReferencingProperties", () => {
    it("should find single property referencing file", () => {
      const metadata = {
        status: "draft",
        area: "[[MyFile]]",
        priority: "high",
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      expect(result).toEqual(["area"]);
    });

    it("should find multiple properties referencing file", () => {
      const metadata = {
        area: "[[MyFile]]",
        related: "See [[MyFile]] for details",
        parent: "[[MyFile]]",
        other: "[[OtherFile]]",
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      expect(result).toEqual(["area", "related", "parent"]);
    });

    it("should find references in arrays", () => {
      const metadata = {
        tags: ["tag1", "[[MyFile]]", "tag2"],
        links: ["[[MyFile]]", "[[OtherFile]]"],
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      expect(result).toEqual(["tags", "links"]);
    });

    it("should NOT find plain text references (wiki-links only)", () => {
      const metadata = {
        path: "folder/MyFile",
        reference: "MyFile",
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      // Plain text without [[ ]] should NOT create relations
      expect(result).toEqual([]);
    });

    it("should handle .md extension in filename", () => {
      const metadata = {
        link: "[[MyFile]]",
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      expect(result).toEqual(["link"]);
    });

    it("should return empty array when no references found", () => {
      const metadata = {
        status: "draft",
        priority: "high",
      };
      const result = MetadataHelpers.findAllReferencingProperties(metadata, "MyFile.md");

      expect(result).toEqual([]);
    });

    it("should handle empty metadata", () => {
      const result = MetadataHelpers.findAllReferencingProperties({}, "MyFile.md");

      expect(result).toEqual([]);
    });
  });

  describe("findReferencingProperty", () => {
    it("should find first property referencing file", () => {
      const metadata = {
        status: "draft",
        area: "[[MyFile]]",
        parent: "[[MyFile]]",
      };
      const result = MetadataHelpers.findReferencingProperty(metadata, "MyFile.md");

      expect(result).toBe("area");
    });

    it("should return undefined when no reference found", () => {
      const metadata = {
        status: "draft",
        priority: "high",
      };
      const result = MetadataHelpers.findReferencingProperty(metadata, "MyFile.md");

      expect(result).toBeUndefined();
    });

    it("should find reference in array", () => {
      const metadata = {
        tags: ["tag1", "[[MyFile]]"],
      };
      const result = MetadataHelpers.findReferencingProperty(metadata, "MyFile.md");

      expect(result).toBe("tags");
    });

    it("should handle empty metadata", () => {
      const result = MetadataHelpers.findReferencingProperty({}, "MyFile.md");

      expect(result).toBeUndefined();
    });
  });

  describe("containsReference", () => {
    describe("wiki-link matching", () => {
      it("should find wikilink reference [[Page]]", () => {
        const result = MetadataHelpers.containsReference("[[MyFile]]", "MyFile.md");

        expect(result).toBe(true);
      });

      it("should find wikilink with alias [[Page|Alias]]", () => {
        const result = MetadataHelpers.containsReference("[[MyFile|Alias Text]]", "MyFile.md");

        expect(result).toBe(true);
      });

      it("should find wikilink with path [[folder/Page]]", () => {
        const result = MetadataHelpers.containsReference("[[folder/MyFile]]", "MyFile.md");

        expect(result).toBe(true);
      });

      it("should find wikilink with nested path [[a/b/Page]]", () => {
        const result = MetadataHelpers.containsReference("[[a/b/MyFile]]", "MyFile.md");

        expect(result).toBe(true);
      });

      it("should find reference in longer string", () => {
        const result = MetadataHelpers.containsReference(
          "See [[MyFile]] for details",
          "MyFile.md"
        );

        expect(result).toBe(true);
      });

      it("should find multiple wikilinks in string", () => {
        const result = MetadataHelpers.containsReference(
          "See [[OtherFile]] and [[MyFile]] for info",
          "MyFile.md"
        );

        expect(result).toBe(true);
      });
    });

    describe("plain text NOT matching (wiki-links only)", () => {
      it("should NOT find plain text reference", () => {
        const result = MetadataHelpers.containsReference("MyFile", "MyFile.md");

        expect(result).toBe(false);
      });

      it("should NOT find plain text in sentence", () => {
        const result = MetadataHelpers.containsReference(
          "This mentions MyFile in plain text",
          "MyFile.md"
        );

        expect(result).toBe(false);
      });

      it("should NOT find plain text with path", () => {
        const result = MetadataHelpers.containsReference("folder/MyFile", "MyFile.md");

        expect(result).toBe(false);
      });

      it("should NOT find partial match", () => {
        const result = MetadataHelpers.containsReference("[[MyFileExtended]]", "MyFile.md");

        expect(result).toBe(false);
      });

      it("should NOT find mismatched wikilink", () => {
        const result = MetadataHelpers.containsReference("[[OtherFile]]", "MyFile.md");

        expect(result).toBe(false);
      });
    });

    it("should find reference in array", () => {
      const result = MetadataHelpers.containsReference(
        ["tag1", "[[MyFile]]", "tag2"],
        "MyFile.md"
      );

      expect(result).toBe(true);
    });

    it("should find nested reference in array", () => {
      const result = MetadataHelpers.containsReference(
        ["tag1", ["nested", "[[MyFile]]"]],
        "MyFile.md"
      );

      expect(result).toBe(true);
    });

    it("should return false for non-matching string", () => {
      const result = MetadataHelpers.containsReference("[[OtherFile]]", "MyFile.md");

      expect(result).toBe(false);
    });

    it("should return false for null value", () => {
      const result = MetadataHelpers.containsReference(null, "MyFile.md");

      expect(result).toBe(false);
    });

    it("should return false for undefined value", () => {
      const result = MetadataHelpers.containsReference(undefined, "MyFile.md");

      expect(result).toBe(false);
    });

    it("should return false for number value", () => {
      const result = MetadataHelpers.containsReference(123, "MyFile.md");

      expect(result).toBe(false);
    });

    it("should return false for boolean value", () => {
      const result = MetadataHelpers.containsReference(true, "MyFile.md");

      expect(result).toBe(false);
    });

    it("should handle .md extension correctly", () => {
      const result = MetadataHelpers.containsReference("[[MyFile]]", "MyFile.md");

      expect(result).toBe(true);
    });

    it("should return false for empty array", () => {
      const result = MetadataHelpers.containsReference([], "MyFile.md");

      expect(result).toBe(false);
    });
  });

  describe("isAssetArchived", () => {
    it("should return true for exo__Asset_isArchived: true", () => {
      const metadata = { exo__Asset_isArchived: true };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for exo__Asset_isArchived: false", () => {
      const metadata = { exo__Asset_isArchived: false };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return true for exo__Asset_isArchived: 1", () => {
      const metadata = { exo__Asset_isArchived: 1 };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for exo__Asset_isArchived: 'true'", () => {
      const metadata = { exo__Asset_isArchived: "true" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for exo__Asset_isArchived: 'yes'", () => {
      const metadata = { exo__Asset_isArchived: "yes" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for exo__Asset_isArchived: '1'", () => {
      const metadata = { exo__Asset_isArchived: "1" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for exo__Asset_isArchived: 'false'", () => {
      const metadata = { exo__Asset_isArchived: "false" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for exo__Asset_isArchived: 0", () => {
      const metadata = { exo__Asset_isArchived: 0 };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should handle exo__Asset_isArchived uppercase strings", () => {
      const metadata = { exo__Asset_isArchived: "TRUE" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should handle exo__Asset_isArchived strings with whitespace", () => {
      const metadata = { exo__Asset_isArchived: "  yes  " };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for archived: true", () => {
      const metadata = { archived: true };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for archived: false", () => {
      const metadata = { archived: false };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return true for archived: 1", () => {
      const metadata = { archived: 1 };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for archived: 0", () => {
      const metadata = { archived: 0 };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return true for archived: 'true'", () => {
      const metadata = { archived: "true" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for archived: 'yes'", () => {
      const metadata = { archived: "yes" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for archived: '1'", () => {
      const metadata = { archived: "1" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for archived: 'false'", () => {
      const metadata = { archived: "false" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived: 'no'", () => {
      const metadata = { archived: "no" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived: '0'", () => {
      const metadata = { archived: "0" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should handle uppercase strings", () => {
      const metadata = { archived: "TRUE" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should handle strings with whitespace", () => {
      const metadata = { archived: "  yes  " };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for archived: null", () => {
      const metadata = { archived: null };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived: undefined", () => {
      const metadata = { archived: undefined };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for missing archived property", () => {
      const metadata = { status: "draft" };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for empty metadata", () => {
      const result = MetadataHelpers.isAssetArchived({});

      expect(result).toBe(false);
    });

    it("should prefer exo__Asset_isArchived over archived", () => {
      const metadata = {
        exo__Asset_isArchived: true,
        archived: false,
      };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(true);
    });

    it("should handle archived: array (invalid type)", () => {
      const metadata = { archived: ["true"] };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });

    it("should handle archived: object (invalid type)", () => {
      const metadata = { archived: { value: true } };
      const result = MetadataHelpers.isAssetArchived(metadata);

      expect(result).toBe(false);
    });
  });

  describe("getPropertyValue", () => {
    const relation = {
      title: "My Document",
      created: 1234567890,
      modified: 1234567900,
      path: "folder/document.md",
      metadata: {
        status: "draft",
        priority: "high",
      },
    };

    it("should get Name property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "Name");

      expect(result).toBe("My Document");
    });

    it("should get title property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "title");

      expect(result).toBe("My Document");
    });

    it("should get created property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "created");

      expect(result).toBe(1234567890);
    });

    it("should get modified property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "modified");

      expect(result).toBe(1234567900);
    });

    it("should get path property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "path");

      expect(result).toBe("folder/document.md");
    });

    it("should get metadata property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "status");

      expect(result).toBe("draft");
    });

    it("should get nested metadata property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "priority");

      expect(result).toBe("high");
    });

    it("should return undefined for non-existent metadata property", () => {
      const result = MetadataHelpers.getPropertyValue(relation, "nonexistent");

      expect(result).toBeUndefined();
    });

    it("should handle relation without metadata", () => {
      const relationNoMeta = {
        title: "Document",
        created: 123,
        modified: 456,
        path: "doc.md",
      };
      const result = MetadataHelpers.getPropertyValue(relationNoMeta, "status");

      expect(result).toBeUndefined();
    });
  });

  describe("ensureQuoted", () => {
    it("should add quotes to unquoted string", () => {
      const result = MetadataHelpers.ensureQuoted("hello");

      expect(result).toBe('"hello"');
    });

    it("should not add quotes to already quoted string", () => {
      const result = MetadataHelpers.ensureQuoted('"hello"');

      expect(result).toBe('"hello"');
    });

    it("should handle empty string", () => {
      const result = MetadataHelpers.ensureQuoted("");

      expect(result).toBe('""');
    });

    it("should handle string with only quotes", () => {
      const result = MetadataHelpers.ensureQuoted('""');

      expect(result).toBe('""');
    });

    it("should handle null value", () => {
      const result = MetadataHelpers.ensureQuoted(null as any);

      expect(result).toBe('""');
    });

    it("should handle undefined value", () => {
      const result = MetadataHelpers.ensureQuoted(undefined as any);

      expect(result).toBe('""');
    });

    it("should handle string with partial quotes", () => {
      const result = MetadataHelpers.ensureQuoted('"hello');

      expect(result).toBe('""hello"');
    });

    it("should handle string with quotes in middle", () => {
      const result = MetadataHelpers.ensureQuoted('hel"lo');

      expect(result).toBe('"hel"lo"');
    });
  });

  describe("buildFileContent", () => {
    it("should build content with simple frontmatter", () => {
      const frontmatter = {
        title: "My Document",
        status: "draft",
      };
      const result = MetadataHelpers.buildFileContent(frontmatter);

      expect(result).toBe("---\ntitle: My Document\nstatus: draft\n---\n\n");
    });

    it("should build content with body", () => {
      const frontmatter = {
        title: "My Document",
      };
      const body = "This is the body content.";
      const result = MetadataHelpers.buildFileContent(frontmatter, body);

      expect(result).toBe("---\ntitle: My Document\n---\n\nThis is the body content.\n");
    });

    it("should handle array values", () => {
      const frontmatter = {
        title: "My Document",
        tags: ["tag1", "tag2", "tag3"],
      };
      const result = MetadataHelpers.buildFileContent(frontmatter);

      expect(result).toBe("---\ntitle: My Document\ntags:\n  - tag1\n  - tag2\n  - tag3\n---\n\n");
    });

    it("should handle mixed types", () => {
      const frontmatter = {
        title: "My Document",
        priority: 1,
        archived: true,
        tags: ["tag1", "tag2"],
      };
      const result = MetadataHelpers.buildFileContent(frontmatter);

      expect(result).toBe(
        "---\ntitle: My Document\npriority: 1\narchived: true\ntags:\n  - tag1\n  - tag2\n---\n\n"
      );
    });

    it("should handle empty frontmatter", () => {
      const result = MetadataHelpers.buildFileContent({});

      expect(result).toBe("---\n\n---\n\n");
    });

    it("should handle empty array", () => {
      const frontmatter = {
        tags: [],
      };
      const result = MetadataHelpers.buildFileContent(frontmatter);

      expect(result).toBe("---\ntags:\n\n---\n\n");
    });

    it("should preserve value formatting", () => {
      const frontmatter = {
        link: "[[MyFile]]",
        date: "2025-10-24",
      };
      const result = MetadataHelpers.buildFileContent(frontmatter);

      expect(result).toBe("---\nlink: [[MyFile]]\ndate: 2025-10-24\n---\n\n");
    });

    it("should handle multiline body", () => {
      const frontmatter = {
        title: "Doc",
      };
      const body = "Line 1\nLine 2\nLine 3";
      const result = MetadataHelpers.buildFileContent(frontmatter, body);

      expect(result).toBe("---\ntitle: Doc\n---\n\nLine 1\nLine 2\nLine 3\n");
    });
  });
});