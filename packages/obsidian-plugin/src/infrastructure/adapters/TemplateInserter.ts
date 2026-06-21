import type { Editor, TFile } from "obsidian";
import { resolveTemplateBody, stripTemplateFrontmatter } from "@kitelev/exocortex-core";

/**
 * TemplateInserter — logic behind the editor "Insert template" command
 * (homoiconic templating Веха 2, project 17f58ebe / vision 09a3fbec).
 *
 * Unlike the MVP "Insert template token" (a single scalar value), Веха 2 inserts
 * a whole markdown BLOCK — a body template (e.g. "## Полезные ресурсы / ## План
 * / ## Log"). The blocks are NOT hardcoded: they are vault assets of class
 * `exotemplate__Template` (homoiconicity invariant — user-configurable content
 * lives in RDF, not TypeScript). The command enumerates those assets, the user
 * fuzzy-picks one, and its `_body` is inserted at the cursor with `$token`
 * substitution markers resolved via the SAME SubstitutionResolverRegistry that
 * the MVP and the RFC 727572d2 pipeline use (interview Q6 — reuse the existing
 * `exocmd__SubstitutionToken` vocabulary, no new "variable" class).
 */

/** UID of the `exotemplate__Template` TBox class (exoas-public). */
export const EXOTEMPLATE_TEMPLATE_CLASS_UID =
  "8bdf4506-80bf-4999-8fda-1ea0808b4ee5";

/** Symbolic label of the Template class — accepted as an alternate match form. */
export const EXOTEMPLATE_TEMPLATE_CLASS_LABEL = "exotemplate__Template";

/** A single template the user can insert. */
export interface TemplateChoice {
  /** Human-facing label (`exo__Asset_label`, or basename fallback). */
  readonly label: string;
  /** Vault-relative path (stable id / a11y secondary line). */
  readonly path: string;
  /** The underlying file — read on demand to fetch the body. */
  readonly file: TFile;
}

/**
 * Minimal structural slice of the Obsidian `App` this module needs. Declared
 * locally so the enumeration is unit-testable with a fake that mirrors the real
 * contract (test-fixture-realism) without importing the full plugin surface.
 */
export interface TemplateInserterApp {
  readonly vault: {
    getMarkdownFiles(): TFile[];
  };
  readonly metadataCache: {
    getFileCache(file: TFile): {
      frontmatter?: Record<string, unknown>;
    } | null;
  };
}

/** Extract the wikilink target (before any `|alias`) from `"[[target|alias]]"`. */
function wikilinkTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  return m ? m[1].trim() : null;
}

/**
 * True when `exo__Instance_class` (scalar or array) names the Template class —
 * by UID `[[<uid>]]` or by symbolic label `[[exotemplate__Template]]`. Tolerates
 * the alias form `[[<uid>|alias]]` and surrounding YAML quotes.
 */
function isTemplateAsset(fm: Record<string, unknown> | undefined): boolean {
  if (!fm) return false;
  const raw = fm["exo__Instance_class"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.some((v) => {
    const target = wikilinkTarget(v);
    return (
      target === EXOTEMPLATE_TEMPLATE_CLASS_UID ||
      target === EXOTEMPLATE_TEMPLATE_CLASS_LABEL
    );
  });
}

/** Basename without the `.md` extension (label fallback). */
function basename(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.replace(/\.md$/i, "");
}

/**
 * Enumerate all `exotemplate__Template` assets in the vault, sorted by label
 * (case-insensitive) for a stable picker order. Reads only frontmatter (cheap);
 * the body is fetched lazily for the CHOSEN template only.
 */
export function collectTemplateChoices(
  app: TemplateInserterApp,
): TemplateChoice[] {
  const choices: TemplateChoice[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!isTemplateAsset(fm)) continue;
    const labelRaw = fm?.["exo__Asset_label"];
    const label =
      typeof labelRaw === "string" && labelRaw.length > 0
        ? labelRaw
        : basename(file.path);
    choices.push({ label, path: file.path, file });
  }
  choices.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
  return choices;
}

/**
 * Strip the leading YAML frontmatter block, returning the markdown body.
 * Delegates to the core `stripTemplateFrontmatter` (CRLF-aware, consumes the
 * separating newline — distinct from `sparqlBlock.stripFrontmatter`) so the
 * editor inserter, the plugin TemplateLoaderPort, and the CLI TemplateLoaderPort
 * share one strip impl (Веха 3 — no per-consumer regex drift).
 */
export function extractTemplateBody(content: string): string {
  return stripTemplateFrontmatter(content);
}

/**
 * Full insert-time transform for a chosen template's file content: strip the
 * frontmatter, then resolve `$token` markers in the body via the shared
 * registry (Веха 4 — variables in body templates).
 */
export function resolveTemplateForInsert(content: string): string {
  return resolveTemplateBody(extractTemplateBody(content));
}

/**
 * Insert the resolved template body at the cursor (replacing any selection).
 * Returns the inserted text so the caller can surface it and tests can assert
 * exact passthrough.
 */
export function insertTemplate(editor: Editor, resolvedBody: string): string {
  editor.replaceSelection(resolvedBody);
  return resolvedBody;
}
