/**
 * ValidationErrorFormatter Service
 *
 * Formats SHACL validation results for display in different environments:
 * - Console/CLI output (text table and JSON)
 * - Obsidian Notice messages
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 * @module services/shacl
 * @since 1.4.0
 */

import type { ValidationResult, ValidationViolation } from "./ShaclValidator";

/**
 * Configuration for a notice message
 */
export interface NoticeConfig {
  /** The message to display */
  message: string;
  /** Duration to show the notice in milliseconds */
  duration: number;
}

/**
 * Formats SHACL validation results for different output environments.
 *
 * @example
 * ```typescript
 * const formatter = new ValidationErrorFormatter();
 *
 * // Console output
 * console.log(formatter.formatForConsole(result));
 *
 * // JSON output
 * console.log(formatter.formatAsJson(result));
 *
 * // Obsidian notices
 * const notices = formatter.formatForNotice(result);
 * notices.forEach(n => new Notice(n.message, n.duration));
 * ```
 */
export class ValidationErrorFormatter {
  /**
   * Format validation result for console/CLI output.
   *
   * @param result - The validation result to format
   * @returns Formatted string for console output
   */
  formatForConsole(result: ValidationResult): string {
    const { violationCount, warningCount, infoCount } = this.countBySeverity(result.violations);
    const lines: string[] = [];

    // Header with summary
    const parts: string[] = [];
    if (violationCount > 0) {
      parts.push(`${violationCount} violation${violationCount !== 1 ? "s" : ""}`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
    }
    if (infoCount > 0) {
      parts.push(`${infoCount} info${infoCount !== 1 ? "s" : ""}`);
    }

    if (parts.length === 0) {
      lines.push("Validation Results: 0 violations, 0 warnings");
      lines.push("");
      lines.push("✅ All validations passed");
    } else {
      lines.push(`Validation Results: ${parts.join(", ")}`);
      lines.push("");

      // Group by focus node for better readability
      const grouped = this.groupByFocusNode(result.violations);

      for (const [focusNode, violations] of grouped) {
        for (const violation of violations) {
          const severityLabel = this.getSeverityLabel(violation.severity);
          lines.push(`${severityLabel} in ${focusNode}`);
          if (violation.path) {
            lines.push(`  Path: ${violation.path}`);
          }
          lines.push(`  Message: ${violation.message}`);
          lines.push("");
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Format validation result as JSON.
   *
   * @param result - The validation result to format
   * @returns JSON string representation of the result
   */
  formatAsJson(result: ValidationResult): string {
    const { violationCount, warningCount, infoCount } = this.countBySeverity(result.violations);

    const output = {
      conforms: result.conforms,
      summary: {
        violationCount,
        warningCount,
        infoCount,
        total: result.violations.length,
      },
      violations: result.violations.map((v) => ({
        focusNode: v.focusNode,
        path: v.path,
        message: v.message,
        severity: v.severity,
        sourceConstraintComponent: v.sourceConstraintComponent,
      })),
    };

    return JSON.stringify(output, null, 2);
  }

  /**
   * Format validation result for Obsidian Notice display.
   *
   * @param result - The validation result to format
   * @returns Array of notice configurations
   */
  formatForNotice(result: ValidationResult): NoticeConfig[] {
    if (result.violations.length === 0) {
      return [];
    }

    return result.violations.map((violation) => ({
      message: this.formatNoticeMessage(violation),
      duration: this.getNoticeDuration(violation.severity),
    }));
  }

  /**
   * Group violations by focus node.
   *
   * @param violations - Array of validation violations
   * @returns Map of focus node to violations
   */
  groupByFocusNode(violations: ValidationViolation[]): Map<string, ValidationViolation[]> {
    const grouped = new Map<string, ValidationViolation[]>();

    for (const violation of violations) {
      const existing = grouped.get(violation.focusNode) || [];
      existing.push(violation);
      grouped.set(violation.focusNode, existing);
    }

    return grouped;
  }

  /**
   * Count violations by severity level.
   */
  private countBySeverity(violations: ValidationViolation[]): {
    violationCount: number;
    warningCount: number;
    infoCount: number;
  } {
    let violationCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const v of violations) {
      switch (v.severity) {
        case "Violation":
          violationCount++;
          break;
        case "Warning":
          warningCount++;
          break;
        case "Info":
          infoCount++;
          break;
      }
    }

    return { violationCount, warningCount, infoCount };
  }

  /**
   * Get the display label for a severity level.
   */
  private getSeverityLabel(severity: ValidationViolation["severity"]): string {
    switch (severity) {
      case "Violation":
        return "VIOLATION";
      case "Warning":
        return "WARNING";
      case "Info":
        return "INFO";
      default:
        return "UNKNOWN";
    }
  }

  /**
   * Format a single violation as a notice message.
   */
  private formatNoticeMessage(violation: ValidationViolation): string {
    const emoji = this.getSeverityEmoji(violation.severity);
    return `${emoji} ${violation.focusNode}: ${violation.message}`;
  }

  /**
   * Get the emoji for a severity level.
   */
  private getSeverityEmoji(severity: ValidationViolation["severity"]): string {
    switch (severity) {
      case "Violation":
        return "❌";
      case "Warning":
        return "⚠️";
      case "Info":
        return "ℹ️";
      default:
        return "❓";
    }
  }

  /**
   * Get the notice duration based on severity.
   * - Violations: 10 seconds (important, needs attention)
   * - Warnings: 5 seconds
   * - Info: 3 seconds
   */
  private getNoticeDuration(severity: ValidationViolation["severity"]): number {
    switch (severity) {
      case "Violation":
        return 10000;
      case "Warning":
        return 5000;
      case "Info":
        return 3000;
      default:
        return 5000;
    }
  }
}
