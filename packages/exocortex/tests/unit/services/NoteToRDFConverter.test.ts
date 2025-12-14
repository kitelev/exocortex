import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("NoteToRDFConverter", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    converter = new NoteToRDFConverter(mockVault);
  });

  describe("convertNote", () => {
    it("should convert frontmatter properties to RDF triples", async () => {
      const file: IFile = {
        path: "test-note.md",
        basename: "test-note",
        name: "test-note.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "Test Task",
        exo__Instance_class: "ems__Task",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      expect(triples.length).toBeGreaterThan(0);
      expect(mockVault.getFrontmatter).toHaveBeenCalledWith(file);
    });

    it("should return empty array if frontmatter is null", async () => {
      const file: IFile = {
        path: "test-note.md",
        basename: "test-note",
        name: "test-note.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      expect(triples).toEqual([]);
    });

    it("should create obsidian:// IRI for note subject", async () => {
      const file: IFile = {
        path: "path/to/My Task.md",
        basename: "My Task",
        name: "My Task.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "Test",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const subject = triples[0].subject;
      expect(subject).toBeInstanceOf(IRI);
      expect((subject as IRI).value).toContain("obsidian://vault/");
    });

    it("should convert exo__ properties to RDF triples", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "My Label",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const labelTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_label")
      );

      expect(labelTriple).toBeDefined();
      expect((labelTriple!.object as Literal).value).toBe("My Label");
    });

    it("should convert ems__ properties to RDF triples", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        ems__Effort_status: "ToDo",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const statusTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_status")
      );

      expect(statusTriple).toBeDefined();
      expect((statusTriple!.object as Literal).value).toBe("ToDo");
    });

    it("should convert wikilinks to IRI references", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        ems__Effort_area: "[[Development]]",
      };

      const targetFile: IFile = {
        path: "Development.md",
        basename: "Development",
        name: "Development.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(file);

      const areaTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_area")
      );

      expect(areaTriple).toBeDefined();
      expect(areaTriple!.object).toBeInstanceOf(IRI);
      expect((areaTriple!.object as IRI).value).toContain("obsidian://vault/Development.md");
    });

    it("should handle array values by creating multiple triples", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Instance_class: ["ems__Task", "ems__Effort"],
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const classTriples = triples.filter((t) =>
        (t.predicate as IRI).value.includes("Instance_class")
      );

      expect(classTriples.length).toBe(2);
    });

    it("should convert Asset class to rdf:type triple", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Instance_class: "ems__Task",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const typeTriple = triples.find((t) =>
        (t.predicate as IRI).value === Namespace.RDF.term("type").value
      );

      expect(typeTriple).toBeDefined();
      expect((typeTriple!.object as IRI).value).toContain("Task");
    });

    it("should handle archived notes with exo__Asset_isArchived", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_isArchived: true,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const archivedTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_isArchived")
      );

      expect(archivedTriple).toBeDefined();
      expect((archivedTriple!.object as Literal).value).toBe("true");
    });

    // Issue #666: Add Asset_fileName predicate for all assets
    describe("Asset_fileName predicate (Issue #666)", () => {
      it("should add Asset_fileName triple with file basename (without .md)", async () => {
        const file: IFile = {
          path: "03 Knowledge/ems/ems__Meeting.md",
          basename: "ems__Meeting",
          name: "ems__Meeting.md",
          parent: null,
        };

        const frontmatter: IFrontmatter = {
          exo__Asset_label: "Meeting",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const fileNameTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Asset_fileName")
        );

        expect(fileNameTriple).toBeDefined();
        expect(fileNameTriple!.predicate).toBeInstanceOf(IRI);
        expect((fileNameTriple!.predicate as IRI).value).toBe(
          Namespace.EXO.term("Asset_fileName").value
        );
        expect(fileNameTriple!.object).toBeInstanceOf(Literal);
        expect((fileNameTriple!.object as Literal).value).toBe("ems__Meeting");
      });

      it("should add Asset_fileName for files with spaces in path", async () => {
        const file: IFile = {
          path: "My Folder/My Task.md",
          basename: "My Task",
          name: "My Task.md",
          parent: null,
        };

        const frontmatter: IFrontmatter = {
          exo__Instance_class: "ems__Task",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const fileNameTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Asset_fileName")
        );

        expect(fileNameTriple).toBeDefined();
        expect((fileNameTriple!.object as Literal).value).toBe("My Task");
      });

      it("should use correct subject IRI for Asset_fileName triple", async () => {
        const file: IFile = {
          path: "03 Knowledge/ems/ems__Task.md",
          basename: "ems__Task",
          name: "ems__Task.md",
          parent: null,
        };

        const frontmatter: IFrontmatter = {
          exo__Asset_label: "Task",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const fileNameTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Asset_fileName")
        );

        expect(fileNameTriple).toBeDefined();
        expect(fileNameTriple!.subject).toBeInstanceOf(IRI);
        expect((fileNameTriple!.subject as IRI).value).toBe(
          "obsidian://vault/03%20Knowledge/ems/ems__Task.md"
        );
      });

      it("should add Asset_fileName even if no other exo/ems properties exist", async () => {
        const file: IFile = {
          path: "Notes/My Note.md",
          basename: "My Note",
          name: "My Note.md",
          parent: null,
        };

        const frontmatter: IFrontmatter = {
          tags: ["tag1", "tag2"],
          customProperty: "value",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        // Should only have Asset_fileName triple (no exo/ems properties)
        expect(triples.length).toBe(1);
        expect((triples[0].predicate as IRI).value).toContain("Asset_fileName");
        expect((triples[0].object as Literal).value).toBe("My Note");
      });
    });

    it("should skip non-exo and non-ems properties", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        someOtherProperty: "value",
        tags: ["tag1", "tag2"],
        exo__Asset_label: "Test",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const nonExoEmsTriples = triples.filter((t) => {
        const pred = (t.predicate as IRI).value;
        // Namespace uses exocortex.my not exocortex.org
        return !pred.includes("exocortex.my");
      });

      expect(nonExoEmsTriples.length).toBe(0);
    });

    it("should handle quoted wikilinks", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        ems__Effort_area: '"[[Development]]"',
      };

      const targetFile: IFile = {
        path: "Development.md",
        basename: "Development",
        name: "Development.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(file);

      const areaTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_area")
      );

      expect(areaTriple).toBeDefined();
      expect(areaTriple!.object).toBeInstanceOf(IRI);
    });

    // Issue #667, #668: Normalize Instance_class/Property_domain from wiki-link literal to URI
    describe("wiki-link class reference normalization (Issue #667, #668)", () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      it("should expand wiki-link to ems__ class as namespace URI when file not found", async () => {
        const frontmatter: IFrontmatter = {
          exo__Property_domain: "[[ems__Effort]]",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found

        const triples = await converter.convertNote(file);

        const domainTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Property_domain")
        );

        expect(domainTriple).toBeDefined();
        expect(domainTriple!.object).toBeInstanceOf(IRI);
        expect((domainTriple!.object as IRI).value).toBe(Namespace.EMS.term("Effort").value);
      });

      it("should expand wiki-link to exo__ class as namespace URI when file not found", async () => {
        const frontmatter: IFrontmatter = {
          exo__Property_domain: "[[exo__ObjectProperty]]",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found

        const triples = await converter.convertNote(file);

        const domainTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Property_domain")
        );

        expect(domainTriple).toBeDefined();
        expect(domainTriple!.object).toBeInstanceOf(IRI);
        expect((domainTriple!.object as IRI).value).toBe(Namespace.EXO.term("ObjectProperty").value);
      });

      it("should expand Instance_class wiki-link as namespace URI when file not found", async () => {
        const frontmatter: IFrontmatter = {
          exo__Instance_class: "[[ems__Task]]",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found

        const triples = await converter.convertNote(file);

        const classTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Instance_class")
        );

        expect(classTriple).toBeDefined();
        expect(classTriple!.object).toBeInstanceOf(IRI);
        expect((classTriple!.object as IRI).value).toBe(Namespace.EMS.term("Task").value);
      });

      // Issue #663: Instance_class should ALWAYS use namespace URIs for proper SPARQL JOINs
      it("should use namespace URI for Instance_class even when file exists (Issue #663)", async () => {
        const frontmatter: IFrontmatter = {
          exo__Instance_class: "[[ems__Task]]",
        };

        const targetFile: IFile = {
          path: "03 Knowledge/ems/ems__Task.md",
          basename: "ems__Task",
          name: "ems__Task.md",
          parent: null,
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(targetFile); // File EXISTS

        const triples = await converter.convertNote(file);

        const classTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Instance_class")
        );

        // Should use namespace URI, NOT file URI
        expect(classTriple).toBeDefined();
        expect(classTriple!.object).toBeInstanceOf(IRI);
        expect((classTriple!.object as IRI).value).toBe(Namespace.EMS.term("Task").value);
        // Explicitly verify it's NOT a file URI
        expect((classTriple!.object as IRI).value).not.toContain("obsidian://vault/");
      });

      it("should use namespace URI for Instance_class with bare class name (no wikilink)", async () => {
        const frontmatter: IFrontmatter = {
          exo__Instance_class: "ems__Task",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const classTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Instance_class")
        );

        expect(classTriple).toBeDefined();
        expect(classTriple!.object).toBeInstanceOf(IRI);
        expect((classTriple!.object as IRI).value).toBe(Namespace.EMS.term("Task").value);
      });

      it("should use namespace URI for Instance_class with quoted wikilink", async () => {
        const frontmatter: IFrontmatter = {
          exo__Instance_class: '"[[exo__ObjectProperty]]"',
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const classTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Instance_class")
        );

        expect(classTriple).toBeDefined();
        expect(classTriple!.object).toBeInstanceOf(IRI);
        expect((classTriple!.object as IRI).value).toBe(Namespace.EXO.term("ObjectProperty").value);
      });

      it("should handle multiple Instance_class values with namespace URIs", async () => {
        const frontmatter: IFrontmatter = {
          exo__Instance_class: ["[[ems__Task]]", "[[ems__Effort]]"],
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);

        const triples = await converter.convertNote(file);

        const classTriples = triples.filter((t) =>
          (t.predicate as IRI).value.includes("Instance_class")
        );

        expect(classTriples.length).toBe(2);
        expect(classTriples.every((t) => t.object instanceof IRI)).toBe(true);

        const values = classTriples.map((t) => (t.object as IRI).value);
        expect(values).toContain(Namespace.EMS.term("Task").value);
        expect(values).toContain(Namespace.EMS.term("Effort").value);
      });

      it("should still use file URI when wiki-link target file exists", async () => {
        const frontmatter: IFrontmatter = {
          exo__Property_domain: "[[ems__Effort]]",
        };

        const targetFile: IFile = {
          path: "03 Knowledge/exo/ems__Effort.md",
          basename: "ems__Effort",
          name: "ems__Effort.md",
          parent: null,
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

        const triples = await converter.convertNote(file);

        const domainTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Property_domain")
        );

        expect(domainTriple).toBeDefined();
        expect(domainTriple!.object).toBeInstanceOf(IRI);
        expect((domainTriple!.object as IRI).value).toContain("obsidian://vault/");
        expect((domainTriple!.object as IRI).value).toContain("ems__Effort.md");
      });

      it("should return literal for wiki-link to non-class file when not found", async () => {
        const frontmatter: IFrontmatter = {
          ems__Effort_area: "[[Development]]",
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found

        const triples = await converter.convertNote(file);

        const areaTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Effort_area")
        );

        expect(areaTriple).toBeDefined();
        expect(areaTriple!.object).toBeInstanceOf(Literal);
        expect((areaTriple!.object as Literal).value).toBe("[[Development]]");
      });

      it("should handle quoted wiki-link to class when file not found", async () => {
        const frontmatter: IFrontmatter = {
          exo__Property_domain: '"[[ems__Effort]]"',
        };

        mockVault.getFrontmatter.mockReturnValue(frontmatter);
        mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found

        const triples = await converter.convertNote(file);

        const domainTriple = triples.find((t) =>
          (t.predicate as IRI).value.includes("Property_domain")
        );

        expect(domainTriple).toBeDefined();
        expect(domainTriple!.object).toBeInstanceOf(IRI);
        expect((domainTriple!.object as IRI).value).toBe(Namespace.EMS.term("Effort").value);
      });
    });
  });

  // Issue #666: Asset_fileName predicate for SPARQL queries by filename
  describe("Asset_fileName predicate (Issue #666)", () => {
    it("should add Asset_fileName triple for every file with frontmatter", async () => {
      const file: IFile = {
        path: "03 Knowledge/ems/ems__Meeting.md",
        basename: "ems__Meeting",
        name: "ems__Meeting.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Instance_class: "ems__Class",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const fileNameTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_fileName")
      );

      expect(fileNameTriple).toBeDefined();
      expect(fileNameTriple!.object).toBeInstanceOf(Literal);
      expect((fileNameTriple!.object as Literal).value).toBe("ems__Meeting");
    });

    it("should use exo namespace for Asset_fileName predicate", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "Test",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const fileNameTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_fileName")
      );

      expect(fileNameTriple).toBeDefined();
      expect((fileNameTriple!.predicate as IRI).value).toBe(
        Namespace.EXO.term("Asset_fileName").value
      );
    });

    it("should use file basename without .md extension", async () => {
      const file: IFile = {
        path: "folder/My Note.md",
        basename: "My Note", // basename is already without extension
        name: "My Note.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "Test",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const fileNameTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_fileName")
      );

      expect(fileNameTriple).toBeDefined();
      expect((fileNameTriple!.object as Literal).value).toBe("My Note");
      expect((fileNameTriple!.object as Literal).value).not.toContain(".md");
    });

    it("should handle UUID-based filenames", async () => {
      const file: IFile = {
        path: "03 Knowledge/kitelev/f2dccb6a-802d-48d3-8e8a-2c4264197692.md",
        basename: "f2dccb6a-802d-48d3-8e8a-2c4264197692",
        name: "f2dccb6a-802d-48d3-8e8a-2c4264197692.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Asset_label: "My Task",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const fileNameTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_fileName")
      );

      expect(fileNameTriple).toBeDefined();
      expect((fileNameTriple!.object as Literal).value).toBe(
        "f2dccb6a-802d-48d3-8e8a-2c4264197692"
      );
    });

    it("should NOT add Asset_fileName for files without frontmatter", async () => {
      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      expect(triples).toEqual([]);
      const fileNameTriple = triples.find((t) =>
        (t.predicate as IRI).value?.includes("Asset_fileName")
      );
      expect(fileNameTriple).toBeUndefined();
    });

    it("should add Asset_fileName for all files in convertVault", async () => {
      const file1: IFile = {
        path: "note1.md",
        basename: "note1",
        name: "note1.md",
        parent: null,
      };

      const file2: IFile = {
        path: "note2.md",
        basename: "note2",
        name: "note2.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([file1, file2]);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_label: "Test",
      });

      const triples = await converter.convertVault();

      const fileNameTriples = triples.filter((t) =>
        (t.predicate as IRI).value.includes("Asset_fileName")
      );

      expect(fileNameTriples.length).toBe(2);
      expect((fileNameTriples[0].object as Literal).value).toBe("note1");
      expect((fileNameTriples[1].object as Literal).value).toBe("note2");
    });
  });

  describe("xsd:dateTime typed literals", () => {
    const file: IFile = {
      path: "test.md",
      basename: "test",
      name: "test.md",
      parent: null,
    };

    it("should convert ISO 8601 UTC timestamp to xsd:dateTime literal", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: "2025-10-24T14:30:45Z",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      expect(timestampTriple!.object).toBeInstanceOf(Literal);
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45Z");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should convert ISO 8601 local timestamp (no timezone) to xsd:dateTime literal", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_endTimestamp: "2025-10-24T14:30:45",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_endTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should convert ISO 8601 timestamp with milliseconds to xsd:dateTime literal", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_createdAt: "2025-10-24T14:30:45.123Z",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_createdAt")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45.123Z");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should convert ISO 8601 timestamp with positive timezone offset to xsd:dateTime literal", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: "2025-10-24T14:30:45+08:00",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45+08:00");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should convert ISO 8601 timestamp with negative timezone offset to xsd:dateTime literal", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_endTimestamp: "2025-10-24T14:30:45-05:00",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_endTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45-05:00");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should NOT apply xsd:dateTime to plain text strings", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_label: "My Task Label",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const labelTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_label")
      );

      expect(labelTriple).toBeDefined();
      const literal = labelTriple!.object as Literal;
      expect(literal.value).toBe("My Task Label");
      expect(literal.datatype).toBeUndefined();
    });

    it("should NOT apply xsd:dateTime to date-only strings (YYYY-MM-DD)", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_label: "2025-10-24",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const labelTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_label")
      );

      expect(labelTriple).toBeDefined();
      const literal = labelTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24");
      expect(literal.datatype).toBeUndefined();
    });

    it("should handle multiple timestamp properties in same note", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: "2025-10-24T09:00:00Z",
        ems__Effort_endTimestamp: "2025-10-24T17:30:00Z",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const startTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );
      const endTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_endTimestamp")
      );

      expect(startTriple).toBeDefined();
      expect(endTriple).toBeDefined();

      const startLiteral = startTriple!.object as Literal;
      const endLiteral = endTriple!.object as Literal;

      expect(startLiteral.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
      expect(endLiteral.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should serialize xsd:dateTime literal correctly via toString()", async () => {
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: "2025-10-24T14:30:45Z",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );

      const literal = timestampTriple!.object as Literal;
      expect(literal.toString()).toBe(
        '"2025-10-24T14:30:45Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>'
      );
    });

    it("should convert JavaScript Date object to xsd:dateTime literal (js-yaml auto-parsing)", async () => {
      // js-yaml automatically parses ISO 8601 strings to Date objects
      const dateValue = new Date("2025-10-24T14:30:45Z");
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: dateValue,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      expect(literal.value).toBe("2025-10-24T14:30:45.000Z");
      expect(literal.datatype).toBeDefined();
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });

    it("should handle Date object without milliseconds (local timezone)", async () => {
      // Simulate a Date object parsed from "2025-11-03T10:39:54"
      const dateValue = new Date("2025-11-03T10:39:54");
      const frontmatter: IFrontmatter = {
        ems__Effort_startTimestamp: dateValue,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const timestampTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Effort_startTimestamp")
      );

      expect(timestampTriple).toBeDefined();
      const literal = timestampTriple!.object as Literal;
      // Date.toISOString() always returns UTC with Z suffix
      expect(literal.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      expect(literal.datatype!.value).toBe(Namespace.XSD.term("dateTime").value);
    });
  });

  describe("convertVault", () => {
    it("should convert all files in vault", async () => {
      const file1: IFile = {
        path: "note1.md",
        basename: "note1",
        name: "note1.md",
        parent: null,
      };

      const file2: IFile = {
        path: "note2.md",
        basename: "note2",
        name: "note2.md",
        parent: null,
      };

      const frontmatter1: IFrontmatter = {
        exo__Asset_label: "Note 1",
      };

      const frontmatter2: IFrontmatter = {
        exo__Asset_label: "Note 2",
      };

      mockVault.getAllFiles.mockReturnValue([file1, file2]);
      mockVault.getFrontmatter.mockImplementation((file) => {
        if (file.path === "note1.md") return frontmatter1;
        if (file.path === "note2.md") return frontmatter2;
        return null;
      });

      const triples = await converter.convertVault();

      expect(triples.length).toBeGreaterThan(0);
      expect(mockVault.getAllFiles).toHaveBeenCalled();
    });

    it("should complete within performance budget for 100 notes", async () => {
      const files: IFile[] = [];
      for (let i = 0; i < 100; i++) {
        files.push({
          path: `note${i}.md`,
          basename: `note${i}`,
          name: `note${i}.md`,
          parent: null,
        });
      }

      mockVault.getAllFiles.mockReturnValue(files);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_label: "Test",
      });

      const start = Date.now();
      await converter.convertVault();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    // Issue #684: Graceful degradation - skip files with invalid IRIs instead of crashing
    describe("graceful degradation (Issue #684)", () => {
      it("should skip files that cause errors and continue processing", async () => {
        const validFile: IFile = {
          path: "valid-note.md",
          basename: "valid-note",
          name: "valid-note.md",
          parent: null,
        };

        const validFile2: IFile = {
          path: "valid-note-2.md",
          basename: "valid-note-2",
          name: "valid-note-2.md",
          parent: null,
        };

        mockVault.getAllFiles.mockReturnValue([validFile, validFile2]);

        // First file succeeds, second file succeeds
        mockVault.getFrontmatter.mockImplementation((file) => {
          if (file.path === "valid-note.md") return { exo__Asset_label: "Valid Note 1" };
          if (file.path === "valid-note-2.md") return { exo__Asset_label: "Valid Note 2" };
          return null;
        });

        // Spy on console.warn to verify warning is emitted
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const triples = await converter.convertVault();

        // Should have triples from both valid files
        expect(triples.length).toBeGreaterThan(0);

        // Verify file name triples from both files
        const fileNameTriples = triples.filter((t) =>
          (t.predicate as IRI).value.includes("Asset_fileName")
        );
        expect(fileNameTriples.length).toBe(2);

        warnSpy.mockRestore();
      });

      it("should emit warning for files that throw errors during conversion", async () => {
        // Create a mock that will cause IRI constructor to throw
        const validFile: IFile = {
          path: "valid-note.md",
          basename: "valid-note",
          name: "valid-note.md",
          parent: null,
        };

        mockVault.getAllFiles.mockReturnValue([validFile]);

        // Mock getFrontmatter to throw an error (simulating problematic frontmatter)
        mockVault.getFrontmatter.mockImplementation(() => {
          throw new Error("Test error: Invalid frontmatter");
        });

        // Spy on console.warn
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const triples = await converter.convertVault();

        // Should return empty array (file was skipped)
        expect(triples).toEqual([]);

        // Should have called console.warn with skip message
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Skipping file with invalid IRI")
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Test error: Invalid frontmatter")
        );

        warnSpy.mockRestore();
      });

      it("should continue processing after skipping problematic file", async () => {
        const validFile1: IFile = {
          path: "note1.md",
          basename: "note1",
          name: "note1.md",
          parent: null,
        };

        const problematicFile: IFile = {
          path: "problematic.md",
          basename: "problematic",
          name: "problematic.md",
          parent: null,
        };

        const validFile2: IFile = {
          path: "note2.md",
          basename: "note2",
          name: "note2.md",
          parent: null,
        };

        mockVault.getAllFiles.mockReturnValue([validFile1, problematicFile, validFile2]);

        mockVault.getFrontmatter.mockImplementation((file) => {
          if (file.path === "note1.md") return { exo__Asset_label: "Note 1" };
          if (file.path === "problematic.md") throw new Error("Simulated IRI error");
          if (file.path === "note2.md") return { exo__Asset_label: "Note 2" };
          return null;
        });

        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const triples = await converter.convertVault();

        // Should have triples from valid files only
        const labelTriples = triples.filter((t) =>
          (t.predicate as IRI).value.includes("Asset_label")
        );
        expect(labelTriples.length).toBe(2);

        const labels = labelTriples.map((t) => (t.object as Literal).value);
        expect(labels).toContain("Note 1");
        expect(labels).toContain("Note 2");

        // Should have warned about problematic file
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("problematic.md")
        );

        warnSpy.mockRestore();
      });

      it("should not crash when all files are problematic", async () => {
        const file1: IFile = {
          path: "bad1.md",
          basename: "bad1",
          name: "bad1.md",
          parent: null,
        };

        const file2: IFile = {
          path: "bad2.md",
          basename: "bad2",
          name: "bad2.md",
          parent: null,
        };

        mockVault.getAllFiles.mockReturnValue([file1, file2]);
        mockVault.getFrontmatter.mockImplementation(() => {
          throw new Error("All files are problematic");
        });

        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        // Should NOT throw - instead returns empty array
        const triples = await converter.convertVault();

        expect(triples).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(4); // 2 files × 2 warnings each

        warnSpy.mockRestore();
      });
    });
  });

  // Issue #871: Generate RDFS vocabulary triples for mapped properties
  describe("RDFS vocabulary mapping (Issue #871)", () => {
    const file: IFile = {
      path: "03 Knowledge/exo/exo__Effort_status.md",
      basename: "exo__Effort_status",
      name: "exo__Effort_status.md",
      parent: null,
    };

    it("should generate rdfs:domain triple for exo__Property_domain property", async () => {
      const frontmatter: IFrontmatter = {
        exo__Property_domain: "[[ems__Effort]]",
      };

      const targetFile: IFile = {
        path: "03 Knowledge/ems/ems__Effort.md",
        basename: "ems__Effort",
        name: "ems__Effort.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(file);

      // Should have the original exo:Property_domain triple
      const exoTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Property_domain")
      );
      expect(exoTriple).toBeDefined();

      // Should ALSO have the mapped rdfs:domain triple
      const rdfsTriple = triples.find((t) =>
        (t.predicate as IRI).value === "http://www.w3.org/2000/01/rdf-schema#domain"
      );
      expect(rdfsTriple).toBeDefined();
      expect(rdfsTriple!.object).toBeInstanceOf(IRI);
    });

    it("should generate rdfs:range triple for exo__Property_range property", async () => {
      const frontmatter: IFrontmatter = {
        exo__Property_range: "[[exo__Asset]]",
      };

      const targetFile: IFile = {
        path: "03 Knowledge/exo/exo__Asset.md",
        basename: "exo__Asset",
        name: "exo__Asset.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(file);

      const rdfsTriple = triples.find((t) =>
        (t.predicate as IRI).value === "http://www.w3.org/2000/01/rdf-schema#range"
      );
      expect(rdfsTriple).toBeDefined();
      expect(rdfsTriple!.object).toBeInstanceOf(IRI);
    });

    it("should generate rdfs:subClassOf triple for exo__Class_superClass property", async () => {
      const classFile: IFile = {
        path: "03 Knowledge/ems/ems__Task.md",
        basename: "ems__Task",
        name: "ems__Task.md",
        parent: null,
      };

      const frontmatter: IFrontmatter = {
        exo__Class_superClass: "[[exo__Asset]]",
      };

      const targetFile: IFile = {
        path: "03 Knowledge/exo/exo__Asset.md",
        basename: "exo__Asset",
        name: "exo__Asset.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(classFile);

      const rdfsTriple = triples.find((t) =>
        (t.predicate as IRI).value === "http://www.w3.org/2000/01/rdf-schema#subClassOf"
      );
      expect(rdfsTriple).toBeDefined();
      expect(rdfsTriple!.object).toBeInstanceOf(IRI);
    });

    it("should NOT generate vocabulary triple for properties without mappings", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_label: "Test Label",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      // Should have the original exo:Asset_label triple
      const labelTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Asset_label")
      );
      expect(labelTriple).toBeDefined();

      // Should NOT have any rdfs:* triples (except what's naturally generated)
      const rdfsTriples = triples.filter((t) =>
        (t.predicate as IRI).value.startsWith("http://www.w3.org/2000/01/rdf-schema#")
      );
      expect(rdfsTriples.length).toBe(0);
    });

    it("should NOT generate vocabulary triple for Literal values (only IRI)", async () => {
      const frontmatter: IFrontmatter = {
        exo__Property_domain: "Some plain text", // Not a wiki-link, will be Literal
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      // Should have the original exo:Property_domain triple with Literal value
      const exoTriple = triples.find((t) =>
        (t.predicate as IRI).value.includes("Property_domain")
      );
      expect(exoTriple).toBeDefined();
      expect(exoTriple!.object).toBeInstanceOf(Literal);

      // Should NOT have rdfs:domain triple (mapping only applies to IRI values)
      const rdfsTriple = triples.filter((t) =>
        (t.predicate as IRI).value === "http://www.w3.org/2000/01/rdf-schema#domain"
      );
      expect(rdfsTriple.length).toBe(0);
    });

    it("should generate both original and RDFS triple when target file exists", async () => {
      const frontmatter: IFrontmatter = {
        exo__Property_domain: "[[ems__Task]]",
      };

      const targetFile: IFile = {
        path: "03 Knowledge/ems/ems__Task.md",
        basename: "ems__Task",
        name: "ems__Task.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(targetFile);

      const triples = await converter.convertNote(file);

      // Count domain-related triples
      const domainTriples = triples.filter((t) => {
        const predValue = (t.predicate as IRI).value;
        return predValue.includes("Property_domain") ||
               predValue === "http://www.w3.org/2000/01/rdf-schema#domain";
      });

      // Should have BOTH the exo:Property_domain and rdfs:domain triples
      expect(domainTriples.length).toBe(2);
    });

    it("should work with class reference that gets expanded to namespace URI", async () => {
      const frontmatter: IFrontmatter = {
        exo__Property_domain: "[[ems__Effort]]",
      };

      mockVault.getFrontmatter.mockReturnValue(frontmatter);
      mockVault.getFirstLinkpathDest.mockReturnValue(null); // File not found, will expand to namespace URI

      const triples = await converter.convertNote(file);

      // Should have rdfs:domain triple pointing to namespace URI
      const rdfsTriple = triples.find((t) =>
        (t.predicate as IRI).value === "http://www.w3.org/2000/01/rdf-schema#domain"
      );
      expect(rdfsTriple).toBeDefined();
      expect(rdfsTriple!.object).toBeInstanceOf(IRI);
      expect((rdfsTriple!.object as IRI).value).toBe(Namespace.EMS.term("Effort").value);
    });
  });

  describe("notePathToIRI", () => {
    it("should convert note path to obsidian:// IRI", () => {
      const iri = converter.notePathToIRI("path/to/note.md");
      expect(iri.value).toBe("obsidian://vault/path/to/note.md");
    });

    it("should handle spaces in path", () => {
      const iri = converter.notePathToIRI("My Folder/My Note.md");
      expect(iri.value).toBe("obsidian://vault/My%20Folder/My%20Note.md");
    });

    // Issue #621: Ensure consistent URI normalization for SPARQL exact matches
    describe("URI normalization for SPARQL queries (Issue #621)", () => {
      it("should preserve forward slashes in path (not encode to %2F)", () => {
        const iri = converter.notePathToIRI("03 Knowledge/kitelev/f2dccb6a-802d-48d3-8e8a-2c4264197692.md");
        // Should preserve / but encode space
        expect(iri.value).toBe("obsidian://vault/03%20Knowledge/kitelev/f2dccb6a-802d-48d3-8e8a-2c4264197692.md");
        // Critical: should NOT contain %2F
        expect(iri.value).not.toContain("%2F");
      });

      it("should encode special characters that are not valid in URI paths", () => {
        const iri = converter.notePathToIRI("Tasks/Review PR #123.md");
        // # should be encoded
        expect(iri.value).toBe("obsidian://vault/Tasks/Review%20PR%20#123.md");
      });

      it("should handle nested folders with spaces", () => {
        const iri = converter.notePathToIRI("01 Areas/02 Projects/My Project.md");
        expect(iri.value).toBe("obsidian://vault/01%20Areas/02%20Projects/My%20Project.md");
        expect(iri.value).not.toContain("%2F");
      });

      it("should handle UUID-based filenames (prototype pattern)", () => {
        const iri = converter.notePathToIRI("03 Knowledge/kitelev/2d369bb0-159f-4639-911d-ec2c585e8d00.md");
        expect(iri.value).toBe("obsidian://vault/03%20Knowledge/kitelev/2d369bb0-159f-4639-911d-ec2c585e8d00.md");
      });

      it("should produce consistent IRIs for same path (idempotent)", () => {
        const path = "My Folder/Sub Folder/Note.md";
        const iri1 = converter.notePathToIRI(path);
        const iri2 = converter.notePathToIRI(path);
        expect(iri1.value).toBe(iri2.value);
      });

      it("should handle paths with Cyrillic characters", () => {
        const iri = converter.notePathToIRI("Заметки/Мой файл.md");
        // Cyrillic characters should be encoded
        expect(iri.value).toBe("obsidian://vault/%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/%D0%9C%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.md");
        // But slashes should remain (obsidian:// has 2, vault/ has 1, folder/ has 1)
        expect(iri.value.split("/").length).toBe(5);
      });

      it("should handle paths with special characters (parentheses, brackets)", () => {
        const iri = converter.notePathToIRI("Notes/My (Important) Note [v2].md");
        // encodeURI encodes brackets to %5B and %5D
        expect(iri.value).toBe("obsidian://vault/Notes/My%20(Important)%20Note%20%5Bv2%5D.md");
      });

      it("should handle deep nested paths", () => {
        const iri = converter.notePathToIRI("a/b/c/d/e/f/file.md");
        expect(iri.value).toBe("obsidian://vault/a/b/c/d/e/f/file.md");
        // All 6 slashes should be preserved plus obsidian://vault/ (3 more)
        expect((iri.value.match(/\//g) || []).length).toBe(9);
      });
    });

    // Issue #682: Ensure angle brackets in filenames are properly encoded
    describe("angle bracket encoding (Issue #682)", () => {
      it("should encode angle brackets in filename to %3C and %3E", () => {
        const iri = converter.notePathToIRI("Notes/File<test>.md");
        expect(iri.value).toBe("obsidian://vault/Notes/File%3Ctest%3E.md");
        // Verify angle brackets are NOT present unencoded
        expect(iri.value).not.toContain("<");
        expect(iri.value).not.toContain(">");
      });

      it("should handle generic type syntax in filenames (common ontology pattern)", () => {
        const iri = converter.notePathToIRI("01 Inbox/GetAreaChain (exo__Query<ems__Area>).md");
        expect(iri.value).toBe(
          "obsidian://vault/01%20Inbox/GetAreaChain%20(exo__Query%3Cems__Area%3E).md"
        );
        // Verify spaces, angle brackets are encoded but slashes preserved
        expect(iri.value).not.toContain(" ");
        expect(iri.value).not.toContain("<");
        expect(iri.value).not.toContain(">");
        expect(iri.value).not.toContain("%2F");
      });

      it("should handle multiple angle bracket pairs in filename", () => {
        const iri = converter.notePathToIRI("Types/Map<K, V> extends Collection<T>.md");
        expect(iri.value).toBe(
          "obsidian://vault/Types/Map%3CK,%20V%3E%20extends%20Collection%3CT%3E.md"
        );
      });

      it("should handle angle brackets in folder path", () => {
        const iri = converter.notePathToIRI("Generic<Types>/SpecificType.md");
        expect(iri.value).toBe("obsidian://vault/Generic%3CTypes%3E/SpecificType.md");
      });

      it("should encode nested generic types", () => {
        const iri = converter.notePathToIRI("Query<List<Item>>.md");
        expect(iri.value).toBe("obsidian://vault/Query%3CList%3CItem%3E%3E.md");
      });
    });
  });
});
