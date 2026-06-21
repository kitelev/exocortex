import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";

/**
 * @typedef {Object} AdrRecord
 * @property {string} id        e.g. "ARCH-008" (frontmatter id or filename stem)
 * @property {string} title
 * @property {string} domain    architectural domain (architecture|data|quality|…)
 * @property {boolean} rules    whether the ADR is machine-enforced (archgate rule)
 * @property {string} file      source filename
 * @property {string} body      markdown after frontmatter
 */

/**
 * Build a single ADR record from a parsed `.archgate/adrs/*.md` file.
 */
export function toAdrRecord(file, content) {
  const { data, body } = parseFrontmatter(content);
  const stem = file.replace(/^.*\//, "").replace(/\.md$/, "");
  return {
    id: typeof data["id"] === "string" ? data["id"] : stem,
    title: typeof data["title"] === "string" ? data["title"] : stem,
    domain: typeof data["domain"] === "string" ? data["domain"] : "general",
    rules: data["rules"] === true,
    file: file.replace(/^.*\//, ""),
    body,
  };
}

/**
 * Load architectural-decision records from an `.archgate/adrs` directory. Only
 * `*.md` files are read — the companion `*.rules.ts` files (the executable
 * archgate rule bodies) are code, not docs, and are skipped.
 *
 * @param {string} adrsPath  path to `.archgate/adrs`
 * @returns {Promise<AdrRecord[]>}  sorted by id
 */
export async function loadAdrs(adrsPath) {
  let entries;
  try {
    entries = await readdir(adrsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const file = join(adrsPath, e.name);
    const content = await readFile(file, "utf-8");
    records.push(toAdrRecord(file, content));
  }

  // Fail loud on a duplicate ADR id: each `id` becomes a `adrs/<id>.html` page,
  // so two ADRs sharing an id would SILENTLY overwrite one another in the output
  // (and produce two index rows linking to the same page). Surface it as a build
  // error instead of shipping a broken/missing page.
  const byId = new Map();
  for (const r of records) {
    const prev = byId.get(r.id);
    if (prev) {
      throw new Error(
        `Duplicate ADR id "${r.id}": ${prev.file} and ${r.file} both render to adrs/${r.id}.html. Give each ADR a unique id.`,
      );
    }
    byId.set(r.id, r);
  }

  records.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return records;
}
