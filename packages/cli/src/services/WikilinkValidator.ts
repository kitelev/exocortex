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
    properties: Record<string, string | string[]>,
  ): Promise<void> {
    for (const [, value] of Object.entries(properties)) {
      // A multi-value property (repeated --property, issue #3759) is an array;
      // validate every element's wikilinks.
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        await this.validateValue(v);
      }
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
    // ⛔ This used to `return` for every non-UUID reference — the comment said
    // "skip date wikilinks like [[2025-01-01]]", the code said "skip anything
    // that is not a UUID". So a label-form linkpath was NEVER checked, and a
    // typo in it produced a bare literal instead of a file-IRI: the join dies,
    // SHACL stays green (a literal is not a dangling ref), and the defect
    // surfaces much later as "the query returns nothing" (#4068).
    //
    // ⛤ The asymmetry pointed the wrong way. Label-form is the shape a JOINABLE
    // reference requires — a bare UUID emits a symbolic IRI that carries none of
    // the target's predicates — so the only working form was the unvalidated one.
    //
    // Label-form now goes through the same "does the target exist" question,
    // resolved the way Obsidian resolves a linkpath: basename, then label,
    // then aliases. A genuinely forward reference (a daily note not yet
    // created) stays expressible via --skip-wikilink-validation, which `create`
    // already has; enumerating exceptions like "except dates" would be a
    // whitelist that goes stale on the first new naming scheme.
    if (!this.looksLikeUUID(uuid)) {
      const resolved = await this.fsAdapter.findFileByLinkpath(uuid);
      if (!resolved) {
        throw new WikilinkNotFoundError(uuid, label);
      }
      return;
    }

    // Primary: filename-based recursive lookup — the SAME authoritative UID->path
    // discovery used by `exocortex resolve` (findFilesWithUuid). This finds nested
    // UID-canon assets at any depth AND is robust to malformed YAML frontmatter,
    // which the frontmatter scan below cannot read. Without this, `create`
    // rejected a nested UID-wikilink that `resolve` happily found (issue #3701).
    const foundByFilename = await this.fsAdapter.findFileByUidFilename(uuid);
    if (foundByFilename) {
      return;
    }

    // Fallback: frontmatter `exo__Asset_uid` scan — covers assets that are NOT
    // UID-named (e.g. pn__DailyNote `YYYY-MM-DD.md`, period__Week `YYYY-Www.md`)
    // but are referenced by their UID. Keeps validation from regressing for the
    // calendar-plugin whitelist files.
    const foundByUid = await this.fsAdapter.findFileByUID(uuid);
    if (!foundByUid) {
      throw new WikilinkNotFoundError(uuid, label);
    }
  }

  /**
   * Check if a string looks like a UUID (not a date or other reference).
   */
  private looksLikeUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
