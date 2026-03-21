import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Error thrown when a wikilink references a UUID that does not exist in the vault.
 */
export class WikilinkNotFoundError extends Error {
  constructor(uuid: string, label?: string) {
    const displayLabel = label ? `|${label}` : "";
    super(`Wikilink [[${uuid}${displayLabel}]] \u2014 file not found in vault`);
    this.name = "WikilinkNotFoundError";
  }
}

/**
 * Validates that wikilinks in property values reference existing files in the vault.
 *
 * Wikilink format: `[[uuid|label]]` or `[[uuid]]`
 *
 * For each wikilink found, checks that a file named `uuid.md` exists in the vault.
 *
 * @example
 * ```typescript
 * const validator = new WikilinkValidator(fsAdapter);
 * await validator.validatePropertyValues(
 *   { "ztlk__Note_developedFrom": "[[abc-123|Label1]],[[def-456|Label2]]" },
 * );
 * ```
 */
export class WikilinkValidator {
  /** Pattern to extract wikilinks: [[uuid|label]] or [[uuid]] */
  private static readonly WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]*)?]]/g;

  constructor(private readonly fsAdapter: NodeFsAdapter) {}

  /**
   * Validate all wikilinks found in property values.
   *
   * @param properties - Key-value map of properties to validate
   * @throws WikilinkNotFoundError if any wikilink references a non-existent file
   */
  async validatePropertyValues(
    properties: Record<string, string>,
  ): Promise<void> {
    for (const [, value] of Object.entries(properties)) {
      await this.validateValue(value);
    }
  }

  /**
   * Validate all wikilinks in a single value string.
   *
   * @param value - Property value that may contain wikilinks
   * @throws WikilinkNotFoundError if any wikilink references a non-existent file
   */
  async validateValue(value: string): Promise<void> {
    const wikilinks = this.extractWikilinks(value);

    for (const wikilink of wikilinks) {
      await this.validateWikilink(wikilink.uuid, wikilink.label);
    }
  }

  /**
   * Extract all wikilinks from a string value.
   *
   * @param value - String that may contain wikilinks
   * @returns Array of { uuid, label } objects
   */
  extractWikilinks(value: string): Array<{ uuid: string; label?: string }> {
    const results: Array<{ uuid: string; label?: string }> = [];
    const fullPattern = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
    let match: RegExpExecArray | null;

    while ((match = fullPattern.exec(value)) !== null) {
      results.push({
        uuid: match[1].trim(),
        label: match[2]?.trim(),
      });
    }

    return results;
  }

  /**
   * Validate that a single wikilink UUID exists in the vault.
   *
   * @param uuid - UUID or file reference to check
   * @param label - Optional label for error messages
   * @throws WikilinkNotFoundError if file not found
   */
  private async validateWikilink(uuid: string, label?: string): Promise<void> {
    // Skip non-UUID references (e.g., date wikilinks like [[2025-01-01]])
    if (!this.looksLikeUUID(uuid)) {
      return;
    }

    const exists = await this.fsAdapter.fileExists(`${uuid}.md`);

    if (!exists) {
      // Also try finding by UID in metadata
      const foundByUid = await this.fsAdapter.findFileByUID(uuid);

      if (!foundByUid) {
        throw new WikilinkNotFoundError(uuid, label);
      }
    }
  }

  /**
   * Check if a string looks like a UUID (not a date or other reference).
   */
  private looksLikeUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
