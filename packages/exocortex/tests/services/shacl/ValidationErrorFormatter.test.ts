/**
 * Tests for ValidationErrorFormatter
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 */

import { ValidationErrorFormatter } from "../../../src/services/shacl/ValidationErrorFormatter";
import type { ValidationResult, ValidationViolation } from "../../../src/services/shacl/ShaclValidator";

describe("ValidationErrorFormatter", () => {
  let formatter: ValidationErrorFormatter;

  beforeEach(() => {
    formatter = new ValidationErrorFormatter();
  });

  describe("formatForConsole", () => {
    it("should format empty result as conformant message", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [],
      };

      const output = formatter.formatForConsole(result);

      expect(output).toContain("Validation Results: 0 violations, 0 warnings");
      expect(output).toContain("✅ All validations passed");
    });

    it("should format single violation", () => {
      const result: ValidationResult = {
        conforms: false,
        violations: [
          {
            focusNode: "ems-ui:MyBrokenButton",
            path: "exo-ui:Button_action",
            message: "Property is required but missing",
            severity: "Violation",
            sourceConstraintComponent: "MinCountConstraintComponent",
          },
        ],
      };

      const output = formatter.formatForConsole(result);

      expect(output).toContain("Validation Results: 1 violation");
      expect(output).toContain("VIOLATION");
      expect(output).toContain("ems-ui:MyBrokenButton");
      expect(output).toContain("exo-ui:Button_action");
      expect(output).toContain("Property is required but missing");
    });

    it("should format multiple violations and warnings", () => {
      const result: ValidationResult = {
        conforms: false,
        violations: [
          {
            focusNode: "ems-ui:MyBrokenButton",
            path: "exo-ui:Button_action",
            message: "Property is required but missing",
            severity: "Violation",
          },
          {
            focusNode: "ems-ui:MyBadAction",
            path: "exo-ui:Action_headless",
            message: "All actions MUST declare headless compatibility",
            severity: "Violation",
          },
          {
            focusNode: "ems-ui:OldButton",
            path: "exo-ui:Button_variant",
            message: "Deprecated variant 'default', use 'secondary'",
            severity: "Warning",
          },
        ],
      };

      const output = formatter.formatForConsole(result);

      expect(output).toContain("2 violations");
      expect(output).toContain("1 warning");
      expect(output).toContain("VIOLATION in ems-ui:MyBrokenButton");
      expect(output).toContain("VIOLATION in ems-ui:MyBadAction");
      expect(output).toContain("WARNING in ems-ui:OldButton");
    });

    it("should format Info severity correctly", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [
          {
            focusNode: "ems-ui:SomeComponent",
            path: "exo-ui:Component_version",
            message: "Consider updating to latest API",
            severity: "Info",
          },
        ],
      };

      const output = formatter.formatForConsole(result);

      expect(output).toContain("INFO in ems-ui:SomeComponent");
    });
  });

  describe("formatAsJson", () => {
    it("should format result as valid JSON", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [],
      };

      const output = formatter.formatAsJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.conforms).toBe(true);
      expect(parsed.violations).toEqual([]);
    });

    it("should include all violation details in JSON", () => {
      const result: ValidationResult = {
        conforms: false,
        violations: [
          {
            focusNode: "ems-ui:MyButton",
            path: "exo-ui:Button_action",
            message: "Property is required",
            severity: "Violation",
            sourceConstraintComponent: "MinCountConstraintComponent",
          },
        ],
      };

      const output = formatter.formatAsJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.conforms).toBe(false);
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].focusNode).toBe("ems-ui:MyButton");
      expect(parsed.violations[0].path).toBe("exo-ui:Button_action");
      expect(parsed.violations[0].message).toBe("Property is required");
      expect(parsed.violations[0].severity).toBe("Violation");
      expect(parsed.violations[0].sourceConstraintComponent).toBe("MinCountConstraintComponent");
    });

    it("should include violation and warning counts in JSON", () => {
      const result: ValidationResult = {
        conforms: false,
        violations: [
          { focusNode: "a", message: "error", severity: "Violation" },
          { focusNode: "b", message: "warning", severity: "Warning" },
          { focusNode: "c", message: "info", severity: "Info" },
        ],
      };

      const output = formatter.formatAsJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.summary.violationCount).toBe(1);
      expect(parsed.summary.warningCount).toBe(1);
      expect(parsed.summary.infoCount).toBe(1);
    });
  });

  describe("formatForNotice", () => {
    it("should return empty array for conformant result", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [],
      };

      const notices = formatter.formatForNotice(result);

      expect(notices).toEqual([]);
    });

    it("should format violations with error emoji", () => {
      const result: ValidationResult = {
        conforms: false,
        violations: [
          {
            focusNode: "ems-ui:MyButton",
            message: "Property is required",
            severity: "Violation",
          },
        ],
      };

      const notices = formatter.formatForNotice(result);

      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain("❌");
      expect(notices[0].message).toContain("ems-ui:MyButton");
      expect(notices[0].message).toContain("Property is required");
      expect(notices[0].duration).toBe(10000);
    });

    it("should format warnings with warning emoji", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [
          {
            focusNode: "ems-ui:OldButton",
            message: "Deprecated variant",
            severity: "Warning",
          },
        ],
      };

      const notices = formatter.formatForNotice(result);

      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain("⚠️");
      expect(notices[0].duration).toBe(5000);
    });

    it("should format info with info emoji", () => {
      const result: ValidationResult = {
        conforms: true,
        violations: [
          {
            focusNode: "ems-ui:Component",
            message: "Consider upgrading",
            severity: "Info",
          },
        ],
      };

      const notices = formatter.formatForNotice(result);

      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain("ℹ️");
      expect(notices[0].duration).toBe(3000);
    });
  });

  describe("groupByFocusNode", () => {
    it("should group violations by focus node", () => {
      const violations: ValidationViolation[] = [
        { focusNode: "nodeA", message: "error1", severity: "Violation" },
        { focusNode: "nodeA", message: "error2", severity: "Violation" },
        { focusNode: "nodeB", message: "error3", severity: "Warning" },
      ];

      const grouped = formatter.groupByFocusNode(violations);

      expect(grouped.get("nodeA")).toHaveLength(2);
      expect(grouped.get("nodeB")).toHaveLength(1);
    });
  });
});
