export class WikiLinkHelpers {
  private static readonly WIKI_LINK_PATTERN = /\[\[|\]\]/g;
  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Normalize a wikilink value to its canonical identifier.
   *
   * Handles three frontmatter forms:
   * - `"[[ems__Area]]"` → `"ems__Area"` (plain wikilink, target is canonical)
   * - `"[[UUID|ems__Area]]"` → `"ems__Area"` (UUID-alias: target is an opaque
   *   pointer, alias carries the canonical class/label name — see issue #2764)
   * - `"[[Some Note|Display]]"` → `"Some Note"` (non-UUID target: target is
   *   the canonical file basename, display alias is ignored)
   */
  static normalize(value: string | null | undefined): string {
    if (!value) return "";
    const stripped = value.replace(this.WIKI_LINK_PATTERN, "").trim();
    if (!stripped) return "";

    const pipeIndex = stripped.indexOf("|");
    if (pipeIndex === -1) return stripped;

    const target = stripped.substring(0, pipeIndex).trim();
    const alias = stripped.substring(pipeIndex + 1).trim();

    if (this.UUID_PATTERN.test(target)) {
      return alias || target;
    }

    return target;
  }

  static normalizeArray(
    values: string[] | string | null | undefined,
  ): string[] {
    if (!values) return [];
    const arr = Array.isArray(values) ? values : [values];
    return arr.map((v) => this.normalize(v)).filter((v) => v.length > 0);
  }

  static equals(
    a: string | null | undefined,
    b: string | null | undefined,
  ): boolean {
    return this.normalize(a) === this.normalize(b);
  }

  static includes(
    array: string[] | string | null | undefined,
    value: string,
  ): boolean {
    const normalized = this.normalizeArray(array);
    const target = this.normalize(value);
    return normalized.includes(target);
  }
}
