import { parse as parseYaml } from "yaml";

/**
 * Split a markdown document into its YAML frontmatter (the `---`-fenced block at
 * the top) and the remaining body. Mirrors the gray-matter contract on the small
 * subset this generator needs, with zero dependency on @kitelev/exocortex-cli.
 *
 * @param {string} content raw file content
 * @returns {{ data: Record<string, unknown>, body: string }}
 *   `data` is the parsed frontmatter ({} when absent/unparseable), `body` is the
 *   markdown after the closing fence (or the whole content when no frontmatter).
 */
export function parseFrontmatter(content) {
  const text = content.replace(/^﻿/, ""); // strip BOM
  // Frontmatter must start at the very first line.
  if (!text.startsWith("---")) {
    return { data: {}, body: text };
  }
  // Match: --- \n <yaml> \n --- \n <body>
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { data: {}, body: text };
  }
  let data = {};
  try {
    const loaded = parseYaml(m[1]);
    if (loaded && typeof loaded === "object") data = loaded;
  } catch {
    // Fail-open: an unparseable frontmatter yields an empty data object rather
    // than crashing the whole build over one malformed asset.
    data = {};
  }
  return { data, body: m[2] ?? "" };
}

/**
 * Normalize a frontmatter value that may be a scalar or a list into a string[].
 * (Same contract as the CLI's requirements-audit `asStringArray`, reimplemented
 * locally to keep this generator self-contained.)
 */
export function asStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Extract the display label and uid from a wikilink-ish value.
 * `"[[uid|Some Label]]"` → `{ uid: "uid", label: "Some Label" }`;
 * `"[[uid]]"` → `{ uid, label: uid }`; a bare string → `{ uid: null, label: str }`.
 */
export function parseWikilink(value) {
  const raw = asStringArray(value)[0];
  if (!raw) return { uid: null, label: null };
  const m = raw.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!m) return { uid: null, label: raw };
  return { uid: m[1].trim(), label: (m[2] ?? m[1]).trim() };
}

/**
 * Parse an enum local-name suffix out of a wikilink value via a capture regex.
 * e.g. parseEnumSuffix(value, /RequirementStatus([A-Za-z]+)/) over
 * `"[[uid|req__RequirementStatusApproved]]"` → `"Approved"`. Returns null when
 * no match (fail-open).
 */
export function parseEnumSuffix(value, re) {
  for (const raw of asStringArray(value)) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}
