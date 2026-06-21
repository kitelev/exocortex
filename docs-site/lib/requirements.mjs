import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseFrontmatter,
  asStringArray,
  parseWikilink,
  parseEnumSuffix,
} from "./frontmatter.mjs";

/**
 * @typedef {Object} RequirementRecord
 * @property {string} uid
 * @property {string} label
 * @property {string} file                       source filename
 * @property {string|null} status                Draft|Approved|Deprecated
 * @property {string|null} priority              P0..P3
 * @property {string[]} bindingClasses           unit|integration|e2e|gui-bdd
 * @property {string[]} covers
 * @property {string[]} verifiedBy
 * @property {string[]} implementedBy
 * @property {string|null} area
 * @property {string|null} author
 * @property {boolean} covered                   ≥1 verifiedBy binding (from-graph coverage)
 * @property {string} body                       markdown after frontmatter
 */

const BINDING_CLASS_MAP = {
  unit: "unit",
  integration: "integration",
  e2e: "e2e",
  guibdd: "gui-bdd",
};

/** Recursively collect `*.md` paths under a directory. */
async function collectMarkdown(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectMarkdown(p)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Build a single requirement record from a parsed asset. An asset is a
 * functional requirement iff it carries `req__Requirement_status` (the same
 * namespace-unambiguous discriminator the CLI's requirements-audit uses — the
 * assetspace anchor and TBox enum assets do not have it). Returns null for
 * non-requirement assets.
 */
export function toRequirementRecord(file, content) {
  const { data, body } = parseFrontmatter(content);
  if (data["req__Requirement_status"] === undefined) return null;

  const uid =
    typeof data["exo__Asset_uid"] === "string"
      ? data["exo__Asset_uid"]
      : file.replace(/^.*\//, "").replace(/\.md$/, "");
  const label =
    typeof data["exo__Asset_label"] === "string" ? data["exo__Asset_label"] : uid;

  const bindingClasses = [];
  for (const raw of asStringArray(data["req__Requirement_bindingClass"])) {
    const m = raw.match(/RequirementBindingClass([A-Za-z0-9]+)/);
    if (!m) continue;
    const t = m[1].toLowerCase();
    bindingClasses.push(BINDING_CLASS_MAP[t] ?? t);
  }

  const verifiedBy = asStringArray(data["req__Requirement_verifiedBy"]);

  return {
    uid,
    label,
    file: file.replace(/^.*\//, ""),
    status: parseEnumSuffix(
      data["req__Requirement_status"],
      /RequirementStatus([A-Za-z]+)/,
    ),
    priority: parseEnumSuffix(
      data["req__Requirement_priority"],
      /RequirementPriority(P[0-3])\b/,
    ),
    bindingClasses,
    covers: asStringArray(data["req__Requirement_covers"]),
    verifiedBy,
    implementedBy: asStringArray(data["req__Requirement_implementedBy"]),
    area: parseWikilink(data["req__Requirement_area"]).label,
    author: parseWikilink(data["req__Requirement_author"]).label,
    covered: verifiedBy.length > 0,
    body,
  };
}

/**
 * Load every `req__Requirement` instance under `reqsPath` (a checked-out, public
 * submodule directory). Sorted by priority (P0 first) then label for stable,
 * reviewable output.
 *
 * @param {string} reqsPath
 * @returns {Promise<RequirementRecord[]>}
 */
export async function loadRequirements(reqsPath) {
  const files = (await collectMarkdown(reqsPath)).sort();
  const records = [];
  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const rec = toRequirementRecord(file, content);
    if (rec) records.push(rec);
  }
  const prio = (p) => (p == null ? 9 : Number(p.slice(1)));
  records.sort(
    (a, b) => prio(a.priority) - prio(b.priority) || a.label.localeCompare(b.label),
  );
  return records;
}

/** Aggregate coverage / status / priority stats over a requirement set. */
export function requirementStats(records) {
  const byStatus = {};
  const byPriority = {};
  let covered = 0;
  for (const r of records) {
    byStatus[r.status ?? "Unknown"] = (byStatus[r.status ?? "Unknown"] ?? 0) + 1;
    byPriority[r.priority ?? "?"] = (byPriority[r.priority ?? "?"] ?? 0) + 1;
    if (r.covered) covered++;
  }
  return {
    total: records.length,
    covered,
    coverage: records.length ? covered / records.length : 1,
    byStatus,
    byPriority,
  };
}
