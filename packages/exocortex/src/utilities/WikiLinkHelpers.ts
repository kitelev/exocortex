export class WikiLinkHelpers {
  private static readonly WIKI_LINK_PATTERN = /\[\[|\]\]/g;

  static normalize(value: string | null | undefined): string {
    if (!value) return "";
    return value.replace(this.WIKI_LINK_PATTERN, "").trim();
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
