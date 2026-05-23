import fs from "fs-extra";
import path from "path";
import * as glob from "glob";

export interface RewriteOptions {
  dryRun?: boolean;
  /** Relative-to-root path of the file being renamed (skipped during scan). */
  excludeRelPath?: string;
}

export interface RewriteResult {
  filesScanned: number;
  filesModified: number;
  replacements: number;
  modifiedFiles: string[];
}

/**
 * Rewrites inbound wikilinks pointing to `oldBasename` so the link target
 * becomes `newBasename`. Display label (`|Alias`) is stripped — Obsidian
 * renders the target's `exo__Asset_label` at view time. Anchors (`#Heading`
 * and `^block`) are PRESERVED per RFC 1ce2a226 Phase 3c — they identify a
 * navigation point inside the target document, not its display name.
 *
 * Shapes handled:
 *   [[OldName]]                 -> [[NewBase]]
 *   [[OldName|Display]]         -> [[NewBase]]
 *   [[OldName#Heading]]         -> [[NewBase#Heading]]
 *   [[OldName#Heading|Display]] -> [[NewBase#Heading]]
 *   [[OldName^block]]           -> [[NewBase^block]]
 *   [[OldName^block|Display]]   -> [[NewBase^block]]
 *
 * Skips fenced code blocks (``` … ```), inline code (` … `), and embeds (`![[…]]`).
 * Skips the renamed file itself via `excludeRelPath`.
 */
export async function rewriteInboundWikilinks(
  rootPath: string,
  oldBasename: string,
  newBasename: string,
  opts: RewriteOptions = {},
): Promise<RewriteResult> {
  const { dryRun = false, excludeRelPath } = opts;
  const pattern = path.join(rootPath, "**/*.md");
  const files = await glob.glob(pattern, {
    nodir: true,
    ignore: [
      path.join(rootPath, ".obsidian/**"),
      path.join(rootPath, ".trash/**"),
      path.join(rootPath, "**/.obsidian/**"),
      path.join(rootPath, "**/.trash/**"),
    ],
  });

  const result: RewriteResult = {
    filesScanned: 0,
    filesModified: 0,
    replacements: 0,
    modifiedFiles: [],
  };

  for (const absPath of files) {
    const relPath = path.relative(rootPath, absPath);
    if (excludeRelPath && relPath === excludeRelPath) continue;
    result.filesScanned += 1;

    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    const { updated, replacements } = rewriteContent(
      content,
      oldBasename,
      newBasename,
    );

    if (replacements > 0) {
      result.filesModified += 1;
      result.replacements += replacements;
      result.modifiedFiles.push(relPath);
      if (!dryRun) {
        await fs.writeFile(absPath, updated, "utf-8");
      }
    }
  }

  return result;
}

/**
 * Pure function: rewrite wikilinks inside a single string, skipping fenced
 * code blocks, inline code spans, and embed `![[...]]` references.
 */
export function rewriteContent(
  content: string,
  oldBasename: string,
  newBasename: string,
): { updated: string; replacements: number } {
  // Split content by fenced code blocks (```...```), preserving fences.
  // Even-indexed segments are prose; odd-indexed are code.
  const fenceParts = content.split(/(^```[\s\S]*?^```)/m);
  let replacements = 0;

  for (let i = 0; i < fenceParts.length; i++) {
    if (i % 2 === 1) continue; // code block — keep as-is
    const segment = fenceParts[i];
    const out = rewriteProseSegment(segment, oldBasename, newBasename);
    replacements += out.replacements;
    fenceParts[i] = out.updated;
  }

  return { updated: fenceParts.join(""), replacements };
}

function rewriteProseSegment(
  segment: string,
  oldBasename: string,
  newBasename: string,
): { updated: string; replacements: number } {
  // Split by inline code spans (`...`). Preserve them.
  const inlineParts = segment.split(/(`[^`\n]*`)/);
  let replacements = 0;

  for (let i = 0; i < inlineParts.length; i++) {
    if (i % 2 === 1) continue; // inline code — keep as-is
    const out = replaceWikilinks(inlineParts[i], oldBasename, newBasename);
    replacements += out.replacements;
    inlineParts[i] = out.updated;
  }

  return { updated: inlineParts.join(""), replacements };
}

function replaceWikilinks(
  text: string,
  oldBasename: string,
  newBasename: string,
): { updated: string; replacements: number } {
  // (?<!!) — exclude embeds ![[...]]
  // Group 1: link target (no |, #, ^, ], [, newline)
  // Group 2: optional anchor (#heading or ^block) including the leading
  //          sigil; PRESERVED in the output per RFC 1ce2a226 Phase 3c.
  // Optional non-capturing |alias — dropped (strip-canon policy).
  const regex =
    /(?<!!)\[\[([^\[\]\n|#^]+)((?:[#^][^\[\]\n|]*)?)(?:\|[^\[\]\n]*)?\]\]/g;
  let replacements = 0;

  const updated = text.replace(regex, (_match, target, anchor) => {
    const trimmedTarget = target.trim();
    if (trimmedTarget !== oldBasename) return _match;
    replacements += 1;
    return `[[${newBasename}${anchor}]]`;
  });

  return { updated, replacements };
}
