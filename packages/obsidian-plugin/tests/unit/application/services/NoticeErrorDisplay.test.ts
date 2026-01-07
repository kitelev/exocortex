/**
 * Tests for NoticeErrorDisplay
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 */

import { NoticeErrorDisplay } from "@plugin/application/services/NoticeErrorDisplay";
import type { ShaclValidationResult, NoticeConfig, ValidationErrorFormatter } from "exocortex";

// Mock Obsidian's Notice
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

describe("NoticeErrorDisplay", () => {
  let mockFormatter: ValidationErrorFormatter;
  let display: NoticeErrorDisplay;
  let shownNotices: NoticeConfig[];

  beforeEach(() => {
    jest.clearAllMocks();
    shownNotices = [];

    mockFormatter = {
      formatForConsole: jest.fn(),
      formatAsJson: jest.fn(),
      formatForNotice: jest.fn(),
      groupByFocusNode: jest.fn(),
    } as unknown as ValidationErrorFormatter;

    // Create a testable subclass that captures notices
    class TestableNoticeErrorDisplay extends NoticeErrorDisplay {
      protected override showNotice(config: NoticeConfig): void {
        shownNotices.push(config);
      }
    }

    display = new TestableNoticeErrorDisplay(mockFormatter);
  });

  describe("display", () => {
    it("should not display anything for conformant results with no violations", () => {
      const result: ShaclValidationResult = {
        conforms: true,
        violations: [],
      };

      (mockFormatter.formatForNotice as jest.Mock).mockReturnValue([]);

      display.display(result);

      expect(shownNotices).toHaveLength(0);
    });

    it("should display notices for each violation", () => {
      const result: ShaclValidationResult = {
        conforms: false,
        violations: [
          { focusNode: "node1", message: "error1", severity: "Violation" },
          { focusNode: "node2", message: "error2", severity: "Warning" },
        ],
      };

      const notices: NoticeConfig[] = [
        { message: "❌ node1: error1", duration: 10000 },
        { message: "⚠️ node2: error2", duration: 5000 },
      ];

      (mockFormatter.formatForNotice as jest.Mock).mockReturnValue(notices);

      display.display(result);

      expect(shownNotices).toHaveLength(2);
      expect(shownNotices[0].message).toContain("❌");
      expect(shownNotices[0].duration).toBe(10000);
      expect(shownNotices[1].message).toContain("⚠️");
      expect(shownNotices[1].duration).toBe(5000);
    });

    it("should call formatter.formatForNotice", () => {
      const result: ShaclValidationResult = {
        conforms: false,
        violations: [{ focusNode: "test", message: "error", severity: "Violation" }],
      };

      (mockFormatter.formatForNotice as jest.Mock).mockReturnValue([]);

      display.display(result);

      expect(mockFormatter.formatForNotice).toHaveBeenCalledWith(result);
    });
  });

  describe("displaySummary", () => {
    it("should show success notice for conformant results", () => {
      const result: ShaclValidationResult = {
        conforms: true,
        violations: [],
      };

      // Use real Notice mock for displaySummary
      const { Notice } = require("obsidian");
      display.displaySummary(result);

      expect(Notice).toHaveBeenCalledWith("✅ Ontology validation passed", 3000);
    });

    it("should show summary with violation count", () => {
      const result: ShaclValidationResult = {
        conforms: false,
        violations: [
          { focusNode: "n1", message: "e1", severity: "Violation" },
          { focusNode: "n2", message: "e2", severity: "Violation" },
          { focusNode: "n3", message: "w1", severity: "Warning" },
        ],
      };

      const { Notice } = require("obsidian");
      display.displaySummary(result);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("2 violations"),
        5000
      );
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("1 warning"),
        5000
      );
    });

    it("should handle singular violation correctly", () => {
      const result: ShaclValidationResult = {
        conforms: false,
        violations: [{ focusNode: "n1", message: "e1", severity: "Violation" }],
      };

      const { Notice } = require("obsidian");
      display.displaySummary(result);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("1 violation"),
        5000
      );
    });
  });
});
