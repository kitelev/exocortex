/**
 * Tests for CriticalityZoneButtonGroupBuilder
 *
 * Issue #2231: Add Criticality Zone buttons to ems__Task layout
 */
import {
  setupButtonGroupsBuilderTest,
  ButtonGroupsBuilderTestContext,
  TFile,
} from "./ButtonGroupsBuilder.fixtures";

describe("CriticalityZoneButtonGroupBuilder", () => {
  let ctx: ButtonGroupsBuilderTestContext;

  beforeEach(() => {
    ctx = setupButtonGroupsBuilderTest();
  });

  describe("visibility", () => {
    it("should show criticality-zone group for ems__Task", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Tasks" },
        basename: "TestTask",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[ems__Task]]",
        ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      };

      ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Task]]",
      );
      ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
        "[[ems__EffortStatusBacklog]]",
      );
      ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
      ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

      const groups = await ctx.builder.build(mockFile);

      const criticalityZoneGroup = groups.find((g) => g.id === "criticality-zone");
      expect(criticalityZoneGroup).toBeDefined();
      expect(criticalityZoneGroup?.title).toBe("Criticality Zone");
    });

    it("should NOT show criticality-zone group for ems__Project", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Projects" },
        basename: "TestProject",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[ems__Project]]",
        ems__Effort_status: "[[ems__EffortStatusToDo]]",
      };

      ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Project]]",
      );
      ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
        "[[ems__EffortStatusToDo]]",
      );
      ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
      ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Projects");

      const groups = await ctx.builder.build(mockFile);

      const criticalityZoneGroup = groups.find((g) => g.id === "criticality-zone");
      expect(criticalityZoneGroup).toBeUndefined();
    });

    it("should NOT show criticality-zone group for archived ems__Task", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Tasks" },
        basename: "TestTask",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[ems__Task]]",
        ems__Effort_status: "[[ems__EffortStatusDone]]",
        exo__Asset_isArchived: true,
      };

      ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Task]]",
      );
      ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
        "[[ems__EffortStatusDone]]",
      );
      ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(true);
      ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

      const groups = await ctx.builder.build(mockFile);

      const criticalityZoneGroup = groups.find((g) => g.id === "criticality-zone");
      // Either no group or all buttons invisible
      if (criticalityZoneGroup) {
        const hasVisibleButtons = criticalityZoneGroup.buttons.some((b) => b.visible);
        expect(hasVisibleButtons).toBe(false);
      }
    });
  });

  describe("buttons", () => {
    it("should have three buttons: Today, This week, Someday", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Tasks" },
        basename: "TestTask",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[ems__Task]]",
        ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      };

      ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Task]]",
      );
      ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
        "[[ems__EffortStatusBacklog]]",
      );
      ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
      ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

      const groups = await ctx.builder.build(mockFile);

      const criticalityZoneGroup = groups.find((g) => g.id === "criticality-zone");
      expect(criticalityZoneGroup).toBeDefined();

      const buttons = criticalityZoneGroup?.buttons || [];

      expect(buttons.some((b) => b.id === "zone-today" && b.visible)).toBe(true);
      expect(buttons.some((b) => b.id === "zone-this-week" && b.visible)).toBe(true);
      expect(buttons.some((b) => b.id === "zone-someday" && b.visible)).toBe(true);
    });

    it("should have correct labels for zone buttons", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Tasks" },
        basename: "TestTask",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[ems__Task]]",
        ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      };

      ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Task]]",
      );
      ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
        "[[ems__EffortStatusBacklog]]",
      );
      ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
      ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

      const groups = await ctx.builder.build(mockFile);

      const criticalityZoneGroup = groups.find((g) => g.id === "criticality-zone");
      const buttons = criticalityZoneGroup?.buttons || [];

      const todayButton = buttons.find((b) => b.id === "zone-today");
      const thisWeekButton = buttons.find((b) => b.id === "zone-this-week");
      const somedayButton = buttons.find((b) => b.id === "zone-someday");

      expect(todayButton?.label).toBe("Today");
      expect(thisWeekButton?.label).toBe("This week");
      expect(somedayButton?.label).toBe("Someday");
    });
  });
});
