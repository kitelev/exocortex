/**
 * Unit tests for TaskCreationService
 * Tests frontmatter generation, file naming, and UUID/timestamp formats
 */

import "reflect-metadata";
import { container } from "tsyringe";
import {
  TaskCreationService,
  MetadataHelpers,
  IVaultAdapter,
  TaskFrontmatterGenerator,
  AlgorithmExtractor,
  DI_TOKENS,
} from "exocortex";

describe("TaskCreationService", () => {
  let service: TaskCreationService;
  let mockVault: any;

  beforeEach(() => {
    container.clearInstances();

    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
    };

    container.registerInstance<IVaultAdapter>(DI_TOKENS.IVaultAdapter, mockVault);
    container.register(TaskFrontmatterGenerator, { useClass: TaskFrontmatterGenerator });
    container.register(AlgorithmExtractor, { useClass: AlgorithmExtractor });
    container.register(TaskCreationService, { useClass: TaskCreationService });

    service = container.resolve(TaskCreationService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe("generateTaskFrontmatter", () => {
    it("should generate frontmatter with all required properties for Area", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Ontology/EMS]]"');
      expect(frontmatter.ems__Effort_area).toBe('"[[My Area]]"');
      expect(frontmatter.exo__Asset_uid).toBeDefined();
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
    });

    it("should generate frontmatter with all required properties for Project", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Project",
        "ems__Project",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Ontology/EMS]]"');
      expect(frontmatter.ems__Effort_parent).toBe('"[[My Project]]"');
      expect(frontmatter.exo__Asset_uid).toBeDefined();
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
    });

    it("should use provided UUID for exo__Asset_uid", () => {
      const testUid = "12345678-1234-4123-8123-123456789abc";
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Test Area",
        "ems__Area",
        undefined,
        testUid,
      );

      expect(frontmatter.exo__Asset_uid).toBe(testUid);
    });

    it("should generate valid UUIDv4 when no UUID provided", () => {
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Test Area",
        "ems__Area",
      );

      // UUIDv4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      // where x is any hex digit, y is one of [89ab]
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(frontmatter.exo__Asset_uid).toMatch(uuidPattern);
    });

    it("should generate ISO 8601 timestamp for exo__Asset_createdAt", () => {
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Test Area",
        "ems__Area",
      );

      // ISO 8601 format without milliseconds: YYYY-MM-DDTHH:MM:SS
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
      expect(frontmatter.exo__Asset_createdAt).toMatch(isoPattern);
    });

    it("should copy exo__Asset_isDefinedBy from source metadata", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Custom/Ontology]]"');
    });

    it("should handle array format for exo__Asset_isDefinedBy", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: ['"[[!toos]]"'],
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!toos]]"');
    });

    it("should add quotes to exo__Asset_isDefinedBy when missing", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: "[[!toos]]", // Without quotes
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!toos]]"');
    });

    it("should add quotes to array exo__Asset_isDefinedBy when missing", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: ["[[!toos]]"], // Array without quotes
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!toos]]"');
    });

    it("should default to empty quotes when exo__Asset_isDefinedBy is missing", () => {
      const sourceMetadata = {}; // No exo__Asset_isDefinedBy

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('""');
    });

    it("should create quoted wiki-link to source Area in ems__Effort_area", () => {
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Sprint Planning",
        "ems__Area",
      );

      expect(frontmatter.ems__Effort_area).toBe('"[[Sprint Planning]]"');
    });

    it("should create quoted wiki-link to source Project in ems__Effort_parent", () => {
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Website Redesign",
        "ems__Project",
      );

      expect(frontmatter.ems__Effort_parent).toBe('"[[Website Redesign]]"');
    });

    it("should handle Area names with parentheses", () => {
      const frontmatter = service.generateTaskFrontmatter(
        { exo__Asset_isDefinedBy: '"[[!toos]]"' },
        "Sales Offering People Management (Area)",
        "ems__Area",
      );

      expect(frontmatter.ems__Effort_area).toBe(
        '"[[Sales Offering People Management (Area)]]"',
      );
    });

    it("should handle Project names with parentheses", () => {
      const frontmatter = service.generateTaskFrontmatter(
        { exo__Asset_isDefinedBy: '"[[!toos]]"' },
        "Q4 2025 Planning (Project)",
        "ems__Project",
      );

      expect(frontmatter.ems__Effort_parent).toBe(
        '"[[Q4 2025 Planning (Project)]]"',
      );
    });

    it("should handle wiki-link formatted source class", () => {
      const frontmatter = service.generateTaskFrontmatter(
        {},
        "Test",
        "[[ems__Project]]",
      );

      expect(frontmatter.ems__Effort_parent).toBe('"[[Test]]"');
    });

    it("should maintain property order: isDefinedBy, uid, createdAt, Instance_class, effort property", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Test Project",
        "ems__Project",
      );

      const keys = Object.keys(frontmatter);
      expect(keys).toEqual([
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        "exo__Asset_createdAt",
        "exo__Instance_class",
        "ems__Effort_status",
        "ems__Effort_parent",
      ]);
    });

    it("should include exo__Asset_label when label parameter is provided", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "Test Label",
      );

      expect(frontmatter.exo__Asset_label).toBe("Test Label");
    });

    it("should NOT include exo__Asset_label when label parameter is empty string", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
    });

    it("should NOT include exo__Asset_label when label parameter is undefined", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
    });

    it("should trim whitespace from label parameter", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "  Test Label  ",
      );

      expect(frontmatter.exo__Asset_label).toBe("Test Label");
    });

    it("should NOT include exo__Asset_label when label is only whitespace", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "   ",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
    });

    it("should create ems__Task instance from TaskPrototype with exo__Asset_prototype", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Code Review Template",
        "ems__TaskPrototype",
        "Review PR #123",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_prototype).toBe(
        '"[[Code Review Template]]"',
      );
      expect(frontmatter.exo__Asset_label).toBe("Review PR #123");
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
    });

    it("should create ems__Meeting instance from MeetingPrototype with exo__Asset_prototype", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Daily Standup Template",
        "ems__MeetingPrototype",
        "Standup 2025-10-19",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Meeting]]"']);
      expect(frontmatter.exo__Asset_prototype).toBe(
        '"[[Daily Standup Template]]"',
      );
      expect(frontmatter.exo__Asset_label).toBe("Standup 2025-10-19");
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
    });

    it("should create ems__Project instance from ProjectPrototype with exo__Asset_prototype", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Sprint Template",
        "ems__ProjectPrototype",
        "Sprint Q1 2025",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Project]]"']);
      expect(frontmatter.exo__Asset_prototype).toBe('"[[Sprint Template]]"');
      expect(frontmatter.exo__Asset_label).toBe("Sprint Q1 2025");
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
    });

    it("should auto-generate label from exo__Asset_label + date for ems__Meeting when no label provided", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
        exo__Asset_label: "Weekly Team Sync",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Team Meeting Template",
        "ems__MeetingPrototype",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Meeting]]"']);
      expect(frontmatter.exo__Asset_label).toMatch(
        /^Weekly Team Sync \d{4}-\d{2}-\d{2}$/,
      );
    });

    it("should auto-generate label from sourceName + date for ems__Meeting when no label and no exo__Asset_label", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Sprint Planning Template",
        "ems__MeetingPrototype",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Meeting]]"']);
      expect(frontmatter.exo__Asset_label).toMatch(
        /^Sprint Planning Template \d{4}-\d{2}-\d{2}$/,
      );
    });

    it("should prefer explicit label over auto-generated one for ems__Meeting", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
        exo__Asset_label: "Weekly Team Sync",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Team Meeting Template",
        "ems__MeetingPrototype",
        "Custom Meeting Label",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Meeting]]"']);
      expect(frontmatter.exo__Asset_label).toBe("Custom Meeting Label");
    });

    it("should not auto-generate label for ems__Task instances", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
        exo__Asset_label: "Sales Area",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Sales Offering",
        "ems__Area",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_label).toBeUndefined();
    });

    it("should NOT set ems__Effort_area when creating task from pn__DailyNote", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
        pn__DailyNote_day: "2025-11-12",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "2025-11-12",
        "pn__DailyNote",
        "Morning planning",
        undefined,
        null,
        "1730937600000",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
      expect(frontmatter.exo__Asset_label).toBe("Morning planning");
      expect(frontmatter.ems__Effort_plannedStartTimestamp).toBe(
        "1730937600000",
      );
      expect(frontmatter.ems__Effort_area).toBeUndefined();
      expect(frontmatter.ems__Effort_parent).toBeUndefined();
      expect(frontmatter.exo__Asset_prototype).toBeUndefined();
    });

    it("should create instance from custom prototype class with exo__Asset_prototype", () => {
      // Custom prototype class that inherits from exo__Prototype
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!custom]]"',
        exo__Class_superClass: "[[exo__Prototype]]",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Morning Routine",
        "exo__Class", // Custom prototype has exo__Instance_class: [[exo__Class]]
        "Morning Routine 2025-12-07",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_prototype).toBe('"[[Morning Routine]]"');
      expect(frontmatter.exo__Asset_label).toBe("Morning Routine 2025-12-07");
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
    });

    it("should create instance from custom prototype class with transitive inheritance", () => {
      // Custom prototype class that inherits from exo__Prototype transitively
      // e.g., custom__WorkoutPrototype → custom__RoutinePrototype → exo__Prototype
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!custom]]"',
        exo__Class_superClass: "[[custom__RoutinePrototype]]",
        "custom__RoutinePrototype__exo__Class_superClass": "[[exo__Prototype]]",
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Gym Workout Template",
        "exo__Class",
        "Leg Day 2025-12-07",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_prototype).toBe(
        '"[[Gym Workout Template]]"',
      );
      expect(frontmatter.exo__Asset_label).toBe("Leg Day 2025-12-07");
    });

    it("should NOT set exo__Asset_prototype for non-prototype class definitions", () => {
      // A class that does NOT inherit from exo__Prototype
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!custom]]"',
        exo__Class_superClass: "[[exo__Asset]]", // Inherits from exo__Asset, not exo__Prototype
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Custom Class Definition",
        "exo__Class",
        "Instance Label",
      );

      // Should NOT have exo__Asset_prototype since it's not a prototype class
      expect(frontmatter.exo__Asset_prototype).toBeUndefined();
      expect(frontmatter.ems__Effort_area).toBeUndefined();
      expect(frontmatter.ems__Effort_parent).toBeUndefined();
    });
  });

  describe("buildFileContent", () => {
    it("should generate correct YAML format with array for exo__Instance_class (Area)", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Sales Offering People Management (Area)",
        "ems__Area",
      );

      // Use MetadataHelpers utility
      const content = MetadataHelpers.buildFileContent(frontmatter);

      // Should contain YAML array format with bullet
      expect(content).toContain('exo__Instance_class:\n  - "[[ems__Task]]"');
      // Should contain quoted wiki-links
      expect(content).toContain('exo__Asset_isDefinedBy: "[[!toos]]"');
      expect(content).toContain(
        'ems__Effort_area: "[[Sales Offering People Management (Area)]]"',
      );
      // Should have frontmatter delimiters
      expect(content).toMatch(/^---\n[\s\S]+\n---\n\n$/);
    });

    it("should generate correct YAML format for Project with ems__Effort_parent", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "Website Redesign (Project)",
        "ems__Project",
      );

      const content = MetadataHelpers.buildFileContent(frontmatter);

      expect(content).toContain('exo__Instance_class:\n  - "[[ems__Task]]"');
      expect(content).toContain('exo__Asset_isDefinedBy: "[[!toos]]"');
      expect(content).toContain(
        'ems__Effort_parent: "[[Website Redesign (Project)]]"',
      );
      expect(content).toMatch(/^---\n[\s\S]+\n---\n\n$/);
    });

    it("should handle multiple array items correctly", () => {
      const frontmatter = {
        exo__Instance_class: ['"[[ems__Task]]"', '"[[ems__Effort]]"'],
        exo__Asset_uid: "test-uuid",
      };

      const content = MetadataHelpers.buildFileContent(frontmatter);

      expect(content).toContain(
        'exo__Instance_class:\n  - "[[ems__Task]]"\n  - "[[ems__Effort]]"',
      );
    });
  });

  describe("createTask", () => {
    it("should create file with UUID-based filename", async () => {
      const mockSourceFile = {
        basename: "Test Area",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createTask(mockSourceFile, sourceMetadata, "ems__Area");

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const [filePath] = mockVault.create.mock.calls[0];

      // Should match: 03 Knowledge/user/{uuid}.md
      expect(filePath).toMatch(
        /^03 Knowledge\/user\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/,
      );
    });

    it("should use same UUID for filename and exo__Asset_uid", async () => {
      const mockSourceFile = {
        basename: "Test Area",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createTask(mockSourceFile, sourceMetadata, "ems__Area");

      const [filePath, content] = mockVault.create.mock.calls[0];

      // Extract UUID from filepath
      const filenameMatch = filePath.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/,
      );
      expect(filenameMatch).not.toBeNull();
      const filenameUid = filenameMatch![1];

      // Extract UUID from frontmatter
      const uidMatch = content.match(/exo__Asset_uid: ([0-9a-f-]+)/);
      expect(uidMatch).not.toBeNull();
      const frontmatterUid = uidMatch![1];

      // They should match
      expect(filenameUid).toBe(frontmatterUid);
    });

    it("should copy Algorithm section when creating from TaskPrototype", async () => {
      const prototypeContent = `---
exo__Asset_isDefinedBy: "[[!toos]]"
---

## Description

Task prototype description here.

## Algorithm

Step 1: Do something
Step 2: Do something else
Step 3: Finish

## Notes

Some additional notes.`;

      mockVault.read = jest.fn().mockResolvedValue(prototypeContent);

      const mockSourceFile = {
        basename: "Test Prototype",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      await service.createTask(
        mockSourceFile,
        sourceMetadata,
        "ems__TaskPrototype",
      );

      const [, content] = mockVault.create.mock.calls[0];

      // Should contain Algorithm section
      expect(content).toContain("## Algorithm");
      expect(content).toContain("Step 1: Do something");
      expect(content).toContain("Step 2: Do something else");
      expect(content).toContain("Step 3: Finish");
      // Should NOT contain Description or Notes sections
      expect(content).not.toContain("## Description");
      expect(content).not.toContain("## Notes");
    });

    it("should NOT copy Algorithm section when creating from Area", async () => {
      const mockSourceFile = {
        basename: "Test Area",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createTask(mockSourceFile, sourceMetadata, "ems__Area");

      const [, content] = mockVault.create.mock.calls[0];

      // Should NOT contain Algorithm section
      expect(content).not.toContain("## Algorithm");
      // Should end with empty line after frontmatter
      expect(content).toMatch(/---\n\n$/);
    });

    it("should handle TaskPrototype without Algorithm section gracefully", async () => {
      const prototypeContent = `---
exo__Asset_isDefinedBy: "[[!toos]]"
---

## Description

Task prototype without algorithm.`;

      mockVault.read = jest.fn().mockResolvedValue(prototypeContent);

      const mockSourceFile = {
        basename: "Test Prototype",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!toos]]"',
      };

      await service.createTask(
        mockSourceFile,
        sourceMetadata,
        "ems__TaskPrototype",
      );

      const [, content] = mockVault.create.mock.calls[0];

      // Should NOT contain Algorithm section since source doesn't have it
      expect(content).not.toContain("## Algorithm");
      expect(content).toMatch(/---\n\n$/);
    });
  });

  describe("extractH2Section", () => {
    it("should extract content between H2 headings", () => {
      const markdown = `## First Section

Content of first section.

## Second Section

Content of second section.
Multiple lines here.

## Third Section

Content of third section.`;

      const result = (service as any).extractH2Section(
        markdown,
        "Second Section",
      );

      expect(result).toBe("Content of second section.\nMultiple lines here.");
    });

    it("should extract content when H2 is followed by H1", () => {
      const markdown = `## Algorithm

Step 1: First step
Step 2: Second step

# Main Heading

Other content.`;

      const result = (service as any).extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Step 1: First step\nStep 2: Second step");
    });

    it("should return null when section not found", () => {
      const markdown = `## First Section

Content here.

## Second Section

More content.`;

      const result = (service as any).extractH2Section(
        markdown,
        "Missing Section",
      );

      expect(result).toBeNull();
    });

    it("should return null when section is empty", () => {
      const markdown = `## Algorithm

## Next Section

Content here.`;

      const result = (service as any).extractH2Section(markdown, "Algorithm");

      expect(result).toBeNull();
    });

    it("should handle section at end of document", () => {
      const markdown = `## First Section

Some content.

## Algorithm

Final step 1
Final step 2`;

      const result = (service as any).extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Final step 1\nFinal step 2");
    });

    it("should trim whitespace from extracted content", () => {
      const markdown = `## Algorithm



Step with spaces


## Next Section`;

      const result = (service as any).extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Step with spaces");
    });
  });

  describe("createRelatedTask", () => {
    beforeEach(() => {
      mockVault.read = jest
        .fn()
        .mockResolvedValue("---\nexo__Asset_uid: source-uuid\n---\n\n");
      mockVault.modify = jest.fn().mockResolvedValue(undefined);
    });

    it("should create related task with exo__Asset_relates link", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(mockSourceFile, sourceMetadata);

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockVault.create.mock.calls[0];

      expect(filePath).toMatch(
        /^03 Knowledge\/user\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/,
      );
      expect(content).toContain("exo__Asset_relates:");
      expect(content).toContain('- "[[Source Task]]"');
      expect(content).toContain('"[[ems__Task]]"');
    });

    it("should create related task with label", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(
        mockSourceFile,
        sourceMetadata,
        "Related Task Label",
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain("exo__Asset_label: Related Task Label");
      expect(content).toContain("aliases:");
      expect(content).toContain("  - Related Task Label");
    });

    it("should create related task with taskSize", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(
        mockSourceFile,
        sourceMetadata,
        undefined,
        '"[[ems__TaskSize_M]]"',
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain('ems__Task_size: "[[ems__TaskSize_M]]"');
    });

    it("should update source file with bidirectional link", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(mockSourceFile, sourceMetadata);

      expect(mockVault.read).toHaveBeenCalledWith(mockSourceFile);
      expect(mockVault.modify).toHaveBeenCalledTimes(1);
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockSourceFile,
        expect.stringContaining("exo__Asset_relates:"),
      );
    });

    it("should use same UUID for filename and exo__Asset_uid in related task", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(mockSourceFile, sourceMetadata);

      const [filePath, content] = mockVault.create.mock.calls[0];

      const filenameMatch = filePath.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/,
      );
      expect(filenameMatch).not.toBeNull();
      const filenameUid = filenameMatch![1];

      const uidMatch = content.match(/exo__Asset_uid: ([0-9a-f-]+)/);
      expect(uidMatch).not.toBeNull();
      const frontmatterUid = uidMatch![1];

      expect(filenameUid).toBe(frontmatterUid);
    });

    it("should create file in same folder as source when parent exists", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: { path: "03 Knowledge/user/tasks" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(mockSourceFile, sourceMetadata);

      const [filePath] = mockVault.create.mock.calls[0];
      expect(filePath).toMatch(/^03 Knowledge\/user\/tasks\//);
    });

    it("should create file in root when source has no parent", async () => {
      const mockSourceFile = {
        basename: "Source Task",
        parent: null,
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createRelatedTask(mockSourceFile, sourceMetadata);

      const [filePath] = mockVault.create.mock.calls[0];
      expect(filePath).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/,
      );
      expect(filePath).not.toContain("/");
    });
  });

  describe("generateRelatedTaskFrontmatter", () => {
    it("should generate frontmatter with exo__Asset_relates", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        sourceMetadata,
        "Source Task",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Task]]"']);
      expect(frontmatter.exo__Asset_relates).toEqual(['"[[Source Task]]"']);
      expect(frontmatter.ems__Effort_status).toBe(
        '"[[ems__EffortStatusDraft]]"',
      );
    });

    it("should include label and aliases when provided", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        "Related Label",
      );

      expect(frontmatter.exo__Asset_label).toBe("Related Label");
      expect(frontmatter.aliases).toEqual(["Related Label"]);
    });

    it("should trim whitespace from label", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        "  Trimmed Label  ",
      );

      expect(frontmatter.exo__Asset_label).toBe("Trimmed Label");
      expect(frontmatter.aliases).toEqual(["Trimmed Label"]);
    });

    it("should not include label when empty string", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        "",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
      expect(frontmatter.aliases).toBeUndefined();
    });

    it("should not include label when only whitespace", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        "   ",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
      expect(frontmatter.aliases).toBeUndefined();
    });

    it("should include task size when provided", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        undefined,
        undefined,
        '"[[ems__TaskSize_L]]"',
      );

      expect(frontmatter.ems__Task_size).toBe('"[[ems__TaskSize_L]]"');
    });

    it("should not include task size when null", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        undefined,
        undefined,
        null,
      );

      expect(frontmatter.ems__Task_size).toBeUndefined();
    });

    it("should use provided UUID", () => {
      const testUid = "test-uuid-12345";
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
        undefined,
        testUid,
      );

      expect(frontmatter.exo__Asset_uid).toBe(testUid);
    });

    it("should generate UUID when not provided", () => {
      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        {},
        "Source Task",
      );

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(frontmatter.exo__Asset_uid).toMatch(uuidPattern);
    });

    it("should inherit exo__Asset_isDefinedBy from source", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Custom Ontology]]"',
      };

      const frontmatter = (service as any).generateRelatedTaskFrontmatter(
        sourceMetadata,
        "Source Task",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Custom Ontology]]"');
    });
  });

  describe("addRelationToFrontmatter", () => {
    it("should create frontmatter when none exists", () => {
      const content = "Just some content";
      const result = (service as any).addRelationToFrontmatter(
        content,
        "new-uuid",
      );

      expect(result).toContain("---");
      expect(result).toContain("exo__Asset_relates:");
      expect(result).toContain('- "[[new-uuid]]"');
      expect(result).toContain("Just some content");
    });

    it("should add exo__Asset_relates to existing frontmatter without it", () => {
      const content = `---
exo__Asset_uid: existing-uuid
exo__Asset_label: Test Task
---

Content here`;

      const result = (service as any).addRelationToFrontmatter(
        content,
        "related-uuid",
      );

      expect(result).toContain("exo__Asset_uid: existing-uuid");
      expect(result).toContain("exo__Asset_label: Test Task");
      expect(result).toContain("exo__Asset_relates:");
      expect(result).toContain('- "[[related-uuid]]"');
      expect(result).toContain("Content here");
    });

    it("should append to existing exo__Asset_relates array", () => {
      const content = `---
exo__Asset_uid: existing-uuid
exo__Asset_relates:
  - "[[first-related]]"
  - "[[second-related]]"
---

Content`;

      const result = (service as any).addRelationToFrontmatter(
        content,
        "third-related",
      );

      expect(result).toContain('- "[[first-related]]"');
      expect(result).toContain('- "[[second-related]]"');
      expect(result).toContain('- "[[third-related]]"');
    });

    it("should preserve line ending style (LF)", () => {
      const content = `---\nexo__Asset_uid: test\n---\n\nContent`;
      const result = (service as any).addRelationToFrontmatter(
        content,
        "new-uuid",
      );

      expect(result).not.toContain("\r\n");
      expect(result).toContain(
        '---\nexo__Asset_uid: test\nexo__Asset_relates:\n  - "[[new-uuid]]"\n---',
      );
    });

    it("should preserve line ending style (CRLF)", () => {
      const content = `---\r\nexo__Asset_uid: test\r\n---\r\n\r\nContent`;
      const result = (service as any).addRelationToFrontmatter(
        content,
        "new-uuid",
      );

      expect(result).toContain("\r\n");
      expect(result).toContain(
        '---\r\nexo__Asset_uid: test\r\nexo__Asset_relates:\r\n  - "[[new-uuid]]"\r\n---',
      );
    });

    it("should handle empty frontmatter", () => {
      const content = `---
---

Content`;

      const result = (service as any).addRelationToFrontmatter(
        content,
        "new-uuid",
      );

      expect(result).toContain("exo__Asset_relates:");
      expect(result).toContain('- "[[new-uuid]]"');
    });

    it("should handle frontmatter with only exo__Asset_relates", () => {
      const content = `---
exo__Asset_relates:
  - "[[first]]"
---

Content`;

      const result = (service as any).addRelationToFrontmatter(
        content,
        "second",
      );

      expect(result).toContain('- "[[first]]"');
      expect(result).toContain('- "[[second]]"');
    });

    it("should preserve other frontmatter properties", () => {
      const content = `---
exo__Asset_uid: test-uid
exo__Asset_label: Test
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
---

Content`;

      const result = (service as any).addRelationToFrontmatter(
        content,
        "related",
      );

      expect(result).toContain("exo__Asset_uid: test-uid");
      expect(result).toContain("exo__Asset_label: Test");
      expect(result).toContain("exo__Instance_class:");
      expect(result).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      );
      expect(result).toContain("exo__Asset_relates:");
      expect(result).toContain('- "[[related]]"');
    });
  });

  describe("task size parameter", () => {
    it("should include ems__Task_size when taskSize is provided", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        undefined,
        undefined,
        '"[[ems__TaskSize_M]]"',
      );

      expect(frontmatter.ems__Task_size).toBe('"[[ems__TaskSize_M]]"');
    });

    it("should NOT include ems__Task_size when taskSize is null", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        undefined,
        undefined,
        null,
      );

      expect(frontmatter.ems__Task_size).toBeUndefined();
    });

    it("should NOT include ems__Task_size when taskSize is not provided", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
      );

      expect(frontmatter.ems__Task_size).toBeUndefined();
    });

    it("should handle different task size values", () => {
      const testCases = [
        '"[[ems__TaskSize_XXS]]"',
        '"[[ems__TaskSize_XS]]"',
        '"[[ems__TaskSize_S]]"',
        '"[[ems__TaskSize_M]]"',
      ];

      testCases.forEach((taskSize) => {
        const frontmatter = service.generateTaskFrontmatter(
          {},
          "Test Area",
          "ems__Area",
          undefined,
          undefined,
          taskSize,
        );

        expect(frontmatter.ems__Task_size).toBe(taskSize);
      });
    });

    it("should work with label and taskSize together", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateTaskFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "Test Label",
        undefined,
        '"[[ems__TaskSize_S]]"',
      );

      expect(frontmatter.exo__Asset_label).toBe("Test Label");
      expect(frontmatter.ems__Task_size).toBe('"[[ems__TaskSize_S]]"');
    });
  });
});
