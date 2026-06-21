import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, asStringArray, parseWikilink } from "./frontmatter.mjs";

/**
 * Metaclass UIDs that discriminate ontology entities (from the verify-before-assert
 * TBox-metaclass reference). An asset is a *class* / *property* by the metaclass
 * its `exo__Instance_class` points at — not by its own label.
 */
const CLASS_META = new Set(["8619c4fc-64f1-4869-b17e-e34186cacca9"]); // exo__Class
const PROPERTY_META = new Set([
  "38277bfa-d7f9-4a75-b856-b23276ab0db3", // exo__Property
  "9a1cf31c-9d41-4ef3-9023-584a8d087d16", // exo__ObjectProperty
  "ae56ca4c-b610-42a4-a25d-058c23673296", // exo__DatatypeProperty
]);

/** Collect the set of metaclass UIDs referenced by an `exo__Instance_class` value. */
function instanceClassUids(value) {
  const out = new Set();
  for (const raw of asStringArray(value)) {
    const m = raw.match(/\[\[([0-9a-fA-F-]{36})/);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

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
    if (e.isDirectory()) out.push(...(await collectMarkdown(p)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * Load a minimal, browsable class/property reference from a checked-out ontology
 * submodule (e.g. `packages/exoas-exo`). Returns `{ classes, properties }`, each
 * sorted by label. Enum/anchor/other TBox assets are excluded (kept minimal —
 * RFC 0004 MVP scope). Returns empty arrays when the path is absent.
 *
 * @param {string} ontologyPath
 */
export async function loadOntology(ontologyPath) {
  const classes = [];
  const properties = [];
  if (!ontologyPath) return { classes, properties };
  const files = (await collectMarkdown(ontologyPath)).sort();
  for (const file of files) {
    let content;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const { data } = parseFrontmatter(content);
    const label =
      typeof data["exo__Asset_label"] === "string" ? data["exo__Asset_label"] : null;
    if (!label) continue;
    const metas = instanceClassUids(data["exo__Instance_class"]);
    const isClass = [...metas].some((u) => CLASS_META.has(u));
    const isProp = [...metas].some((u) => PROPERTY_META.has(u));
    const uid =
      typeof data["exo__Asset_uid"] === "string"
        ? data["exo__Asset_uid"]
        : file.replace(/^.*\//, "").replace(/\.md$/, "");
    if (isClass) {
      classes.push({ uid, label });
    } else if (isProp) {
      properties.push({
        uid,
        label,
        domain: parseWikilink(data["exo__Property_domain"]).label,
        range: parseWikilink(data["exo__Property_range"]).label,
      });
    }
  }
  classes.sort((a, b) => a.label.localeCompare(b.label));
  properties.sort((a, b) => a.label.localeCompare(b.label));
  return { classes, properties };
}
