import { Command } from "commander";
import { resolve, relative, isAbsolute, sep as pathSep } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

interface RepairFrontmatterOptions {
  vault: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** One deduplicated key + how many earlier occurrences were dropped. */
export interface RemovedKey {
  key: string;
  removedOccurrences: number;
}

export interface DedupeResult {
  changed: boolean;
  content: string;
  removed: RemovedKey[];
}

/**
 * A raw frontmatter "segment": a top-level key line plus every following
 * indented / blank / comment / array-item line that belongs to it, so a
 * multi-line value (array, block scalar) is kept as one unit.
 */
interface Segment {
  key: string | null;
  lines: string[];
}

// A NEW top-level key starts a segment: a line that begins with a non-space,
// non-`#` character and has a `:` (either `key:` or `key: value`). Everything
// else (indented lines, blank lines, comments, `  - array` items) attaches to
// the current segment.
const TOP_LEVEL_KEY = /^([^\s#][^:]*):(?:\s.*)?$/;

/**
 * Remove duplicated top-level frontmatter keys, keeping the LAST occurrence of
 * each. Last-wins matches js-yaml's `{ json: true }` tolerant parse (#3800) and
 * `FrontmatterService.parseObject`'s line parser, so the on-disk file after
 * repair reads identically to how the tolerant parser already read it.
 *
 * Operates purely on raw text — it does NOT require the file to parse — so it
 * is the dogfood-clean repair for the invisible/unrepairable duplicate-key
 * class: the CLI can fix a file it could not itself parse.
 *
 * A no-op (returns `changed: false`, original content) when there is no
 * frontmatter block or no duplicated top-level key.
 */
export function dedupeFrontmatterKeys(content: string): DedupeResult {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!match) {
    return { changed: false, content, removed: [] };
  }
  const [, open, block, close] = match;
  const eol = open.includes("\r\n") ? "\r\n" : "\n";
  const lines = block.split(/\r?\n/);

  const segments: Segment[] = [];
  for (const line of lines) {
    const keyMatch = TOP_LEVEL_KEY.exec(line);
    if (keyMatch) {
      segments.push({ key: keyMatch[1], lines: [line] });
    } else if (segments.length > 0) {
      segments[segments.length - 1].lines.push(line);
    } else {
      // Leading line(s) before the first key (e.g. a blank line) — keyless.
      segments.push({ key: null, lines: [line] });
    }
  }

  // Count occurrences and the last index of each key.
  const counts = new Map<string, number>();
  const lastIndex = new Map<string, number>();
  segments.forEach((seg, i) => {
    if (seg.key !== null) {
      counts.set(seg.key, (counts.get(seg.key) ?? 0) + 1);
      lastIndex.set(seg.key, i);
    }
  });

  const removed = new Map<string, number>();
  const kept = segments.filter((seg, i) => {
    if (seg.key === null || (counts.get(seg.key) ?? 0) <= 1) return true;
    if (i === lastIndex.get(seg.key)) return true; // keep the last occurrence
    removed.set(seg.key, (removed.get(seg.key) ?? 0) + 1);
    return false;
  });

  if (removed.size === 0) {
    return { changed: false, content, removed: [] };
  }

  const newBlock = kept.map((s) => s.lines.join(eol)).join(eol);
  // Splice by index rather than `content.replace(match[0], replacement)` — a
  // string replacement interprets `$$` / `$&` / `$1` / `` $` `` in the frontmatter
  // VALUES as special patterns and would silently corrupt them (a repair tool
  // must never mangle content; same class as #3795 H1). The block is `^`-anchored
  // so it always sits at index 0; the rest of the file follows it verbatim.
  const newContent =
    `${open}${newBlock}${close}` + content.slice(match[0].length);
  return {
    changed: true,
    content: newContent,
    removed: [...removed.entries()].map(([key, removedOccurrences]) => ({
      key,
      removedOccurrences,
    })),
  };
}

export function repairFrontmatterCommand(): Command {
  return new Command("repair-frontmatter")
    .description(
      "Remove duplicated top-level YAML frontmatter keys (keep-last) — the dogfood-clean repair for the invisible/unrepairable duplicate-key class (#3800). Operates on raw text, so it fixes a file the parser itself cannot read.",
    )
    .argument("<path>", "Vault-relative path to the target asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--dry-run", "Preview the dedupe diff without writing")
    .option(
      "--yes",
      "Accepted for symmetry with the apply/create subcommands (repair-frontmatter is non-interactive; no-op)",
    )
    .action(async (pathArg: string, options: RepairFrontmatterOptions) => {
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve + guard the target path (must be inside the vault). Mirrors
        // set-property / apply's vault-relative canonicalisation (#3788). This is
        // a pure path computation (no filesystem poll), so it does not create a
        // check-then-use TOCTOU race (js/file-system-race).
        const targetPath = resolve(vaultPath, pathArg);
        const vaultRelative = relative(vaultPath, targetPath);
        if (
          vaultRelative === ".." ||
          vaultRelative.startsWith(`..${pathSep}`) ||
          isAbsolute(vaultRelative)
        ) {
          throw new Error(
            `Target is outside the vault: ${pathArg} (vault: ${vaultPath})`,
          );
        }

        // Read directly and surface a friendly not-found on ENOENT — avoids an
        // `existsSync` check-then-read/write pair (js/file-system-race).
        let original: string;
        try {
          original = readFileSync(targetPath, "utf-8");
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Target file not found: ${pathArg}`);
          }
          throw readError;
        }
        const result = dedupeFrontmatterKeys(original);

        if (!result.changed) {
          process.stdout.write(
            JSON.stringify({
              path: vaultRelative,
              changed: false,
              dryRun: Boolean(options.dryRun),
              removed: [],
            }) + "\n",
          );
          return;
        }

        if (!options.dryRun) {
          writeFileSync(targetPath, result.content, "utf-8");
        }

        process.stdout.write(
          JSON.stringify({
            path: vaultRelative,
            changed: true,
            dryRun: Boolean(options.dryRun),
            removed: result.removed,
          }) + "\n",
        );
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
