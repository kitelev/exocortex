/**
 * NoticeErrorDisplay Service
 *
 * Displays SHACL validation errors using Obsidian's Notice API.
 * Provides user-visible feedback when UI ontologies fail validation.
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 * @module application/services
 * @since 1.4.0
 */

import { Notice } from "obsidian";
import type { ShaclValidationResult, NoticeConfig, ValidationErrorFormatter } from "exocortex";

/**
 * Interface for error display to allow testing without Obsidian dependency.
 */
export interface IErrorDisplay {
  display(result: ShaclValidationResult): void;
}

/**
 * Displays SHACL validation errors using Obsidian's Notice component.
 *
 * @example
 * ```typescript
 * const display = new NoticeErrorDisplay(formatter);
 * display.display(validationResult);
 * ```
 */
export class NoticeErrorDisplay implements IErrorDisplay {
  constructor(private formatter: ValidationErrorFormatter) {}

  /**
   * Display validation errors as Obsidian notices.
   *
   * - Violations are shown with ❌ and displayed for 10 seconds
   * - Warnings are shown with ⚠️ and displayed for 5 seconds
   * - Info messages are shown with ℹ️ and displayed for 3 seconds
   *
   * @param result - The validation result to display
   */
  display(result: ShaclValidationResult): void {
    if (result.conforms && result.violations.length === 0) {
      return; // Nothing to display for conformant results
    }

    const notices = this.formatter.formatForNotice(result);

    for (const notice of notices) {
      this.showNotice(notice);
    }
  }

  /**
   * Display a single notice.
   * This is a separate method to allow testing/mocking.
   */
  protected showNotice(config: NoticeConfig): void {
    new Notice(config.message, config.duration);
  }

  /**
   * Display a summary notice at the end of validation.
   *
   * @param result - The validation result
   */
  displaySummary(result: ShaclValidationResult): void {
    if (result.conforms && result.violations.length === 0) {
      new Notice("✅ Ontology validation passed", 3000);
    } else {
      const violationCount = result.violations.filter(v => v.severity === "Violation").length;
      const warningCount = result.violations.filter(v => v.severity === "Warning").length;

      const parts: string[] = [];
      if (violationCount > 0) {
        parts.push(`${violationCount} violation${violationCount !== 1 ? "s" : ""}`);
      }
      if (warningCount > 0) {
        parts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
      }

      const message = parts.length > 0 ? `⚠️ Validation: ${parts.join(", ")}` : "⚠️ Validation completed with issues";
      new Notice(message, 5000);
    }
  }
}
