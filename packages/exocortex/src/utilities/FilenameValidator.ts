/**
 * FilenameValidator provides validation and sanitization for filenames.
 *
 * This utility ensures filenames are safe for use across different operating systems
 * (Windows, macOS, Linux) and prevents potential security issues like path traversal.
 *
 * Invalid characters:
 * - / (forward slash) - path separator on Unix
 * - \ (backslash) - path separator on Windows
 * - : (colon) - drive separator on Windows
 * - | (pipe) - reserved on Windows
 * - ? (question mark) - wildcard on Windows
 * - * (asterisk) - wildcard
 * - " (double quotes) - reserved on Windows
 * - < > (angle brackets) - reserved on Windows
 * - \0 (null character) - string terminator
 * - Control characters (0x00-0x1F)
 */

export interface FilenameValidationResult {
  /** Whether the filename is valid */
  valid: boolean;
  /** Sanitized version of the filename with invalid characters replaced */
  sanitized: string;
  /** List of validation errors found */
  errors: string[];
}

export interface FilenameValidationOptions {
  /** Maximum length for filename (default: 200) */
  maxLength?: number;
  /** Character to use for replacing invalid characters (default: '_') */
  replacementChar?: string;
  /** Whether to allow empty filenames (default: false) */
  allowEmpty?: boolean;
}

export class FilenameValidator {
  /** Pattern matching invalid filename characters */
  private static readonly INVALID_CHARS_PATTERN = /[/\\:*?"<>|\x00-\x1F]/g;

  /** Reserved Windows filenames (case-insensitive) */
  private static readonly RESERVED_NAMES = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ]);

  /** Default maximum filename length */
  private static readonly DEFAULT_MAX_LENGTH = 200;

  /** Default replacement character */
  private static readonly DEFAULT_REPLACEMENT = "_";

  /**
   * Validates a filename and returns validation result with errors and sanitized version.
   *
   * @param name - The filename to validate
   * @param options - Validation options
   * @returns Validation result containing validity status, sanitized name, and errors
   */
  static validate(
    name: string,
    options: FilenameValidationOptions = {},
  ): FilenameValidationResult {
    const {
      maxLength = this.DEFAULT_MAX_LENGTH,
      replacementChar = this.DEFAULT_REPLACEMENT,
      allowEmpty = false,
    } = options;

    const errors: string[] = [];
    let sanitized = name;

    // Check for empty/whitespace-only
    if (!name || name.trim().length === 0) {
      if (!allowEmpty) {
        errors.push("Filename cannot be empty");
      }
      return { valid: errors.length === 0, sanitized: "", errors };
    }

    // Check for trailing space BEFORE trimming (problematic on Windows)
    if (name.endsWith(" ")) {
      errors.push("Filename should not end with a space");
    }

    // Trim whitespace for further checks
    sanitized = name.trim();

    // Check for invalid characters
    if (this.INVALID_CHARS_PATTERN.test(sanitized)) {
      errors.push("Filename contains invalid characters: / \\ : * ? \" < > |");
    }

    // Check for reserved Windows names
    const baseName = this.getBaseName(sanitized);
    if (this.RESERVED_NAMES.has(baseName.toUpperCase())) {
      errors.push(`"${baseName}" is a reserved filename on Windows`);
    }

    // Check for length
    if (sanitized.length > maxLength) {
      errors.push(`Filename exceeds maximum length of ${maxLength} characters`);
    }

    // Check for leading/trailing dots (problematic on Windows)
    if (sanitized.startsWith(".")) {
      errors.push("Filename should not start with a dot");
    }
    if (sanitized.endsWith(".")) {
      errors.push("Filename should not end with a dot");
    }

    // Create sanitized version
    sanitized = this.sanitize(name, { maxLength, replacementChar });

    return {
      valid: errors.length === 0,
      sanitized,
      errors,
    };
  }

  /**
   * Sanitizes a filename by replacing invalid characters.
   *
   * @param name - The filename to sanitize
   * @param options - Sanitization options
   * @returns Sanitized filename safe for use on all platforms
   */
  static sanitize(
    name: string,
    options: FilenameValidationOptions = {},
  ): string {
    const {
      maxLength = this.DEFAULT_MAX_LENGTH,
      replacementChar = this.DEFAULT_REPLACEMENT,
    } = options;

    if (!name || name.trim().length === 0) {
      return "";
    }

    let result = name.trim();

    // Replace invalid characters
    result = result.replace(this.INVALID_CHARS_PATTERN, replacementChar);

    // Remove leading dots (but preserve the rest)
    while (result.startsWith(".") && result.length > 1) {
      result = result.substring(1);
    }

    // Remove trailing dots and spaces
    result = result.replace(/[. ]+$/, "");

    // Collapse multiple replacement characters
    const escapedReplacementChar = replacementChar.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    result = result.replace(
      new RegExp(`${escapedReplacementChar}+`, "g"),
      replacementChar,
    );

    // Remove leading/trailing replacement characters
    result = result.replace(
      new RegExp(`^${escapedReplacementChar}+|${escapedReplacementChar}+$`, "g"),
      "",
    );

    // Handle reserved names by appending replacement char (AFTER cleanup)
    const baseName = this.getBaseName(result);
    if (this.RESERVED_NAMES.has(baseName.toUpperCase())) {
      const ext = this.getExtension(result);
      result = baseName + replacementChar + ext;
    }

    // Truncate to max length
    if (result.length > maxLength) {
      result = result.slice(0, maxLength);
      // Clean up any trailing replacement char from truncation
      result = result.replace(
        new RegExp(`${escapedReplacementChar}+$`, "g"),
        "",
      );
    }

    return result;
  }

  /**
   * Checks if a filename contains any invalid characters.
   *
   * @param name - The filename to check
   * @returns true if the filename contains invalid characters
   */
  static hasInvalidChars(name: string): boolean {
    return this.INVALID_CHARS_PATTERN.test(name);
  }

  /**
   * Gets the list of invalid characters found in a filename.
   *
   * @param name - The filename to check
   * @returns Array of invalid characters found
   */
  static getInvalidChars(name: string): string[] {
    const matches = name.match(this.INVALID_CHARS_PATTERN);
    if (!matches) return [];
    return [...new Set(matches)];
  }

  /**
   * Gets the base name (without extension) from a filename.
   */
  private static getBaseName(filename: string): string {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1 || lastDot === 0) return filename;
    return filename.substring(0, lastDot);
  }

  /**
   * Gets the extension (including dot) from a filename.
   */
  private static getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1 || lastDot === 0) return "";
    return filename.substring(lastDot);
  }
}
