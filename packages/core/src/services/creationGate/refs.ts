/**
 * Reference parsing shared by the creation-gate modules.
 *
 * A frontmatter reference arrives in any of the forms the vault holds:
 * `[[uid]]`, `[[uid|label]]`, `[[label]]`, `[[target#anchor]]`, a bare
 * `label`, each possibly wrapped in YAML quotes the parser left in place.
 */

export interface ParsedRef {
  /** The link target — a UID, a label or a basename. */
  readonly target: string;
  /** The display alias after `|`, if any. */
  readonly alias: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Parse one frontmatter value into a reference, or `null` if it is not one. */
export function parseRef(value: unknown): ParsedRef | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  const wrapped = /^\[\[([\s\S]*)\]\]$/.exec(text);
  let inner = wrapped ? wrapped[1] : text;
  let alias: string | null = null;
  const pipe = inner.indexOf("|");
  if (pipe >= 0) {
    const tail = inner.slice(pipe + 1).trim();
    alias = tail.length > 0 ? tail : null;
    inner = inner.slice(0, pipe);
  }
  const hash = inner.indexOf("#");
  if (hash >= 0) inner = inner.slice(0, hash);
  const target = inner.trim();
  if (target.length === 0) return null;
  return { target, alias };
}

/** A frontmatter value as a list: arrays as-is, a scalar as one item, absence as none. */
export function valuesOf(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Every reference a frontmatter value holds, in order. */
export function refsOf(value: unknown): ParsedRef[] {
  const refs: ParsedRef[] = [];
  for (const item of valuesOf(value)) {
    const ref = parseRef(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** A frontmatter scalar as trimmed text (quotes removed), or `null`. */
export function textOf(value: unknown): string | null {
  const first = valuesOf(value)[0];
  if (first === undefined || first === null) return null;
  if (typeof first !== "string" && typeof first !== "number") return null;
  let text = String(first).trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.length > 0 ? text : null;
}
