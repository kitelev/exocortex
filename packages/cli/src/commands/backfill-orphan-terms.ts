import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  walkMdFiles,
  loadConcepts,
  parseFrontmatterRaw,
  extractBodyText,
} from "./backfill-suggest.js";

export interface OrphanTermEntry {
  term: string;
  frequency: number;
  sample_uids: string[];
}

// Common English stop words to filter out
const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "also", "always", "another",
  "around", "back", "been", "before", "being", "below", "between", "both",
  "came", "change", "could", "data", "does", "done", "down", "each",
  "every", "file", "first", "fixed", "from", "full", "func", "given",
  "have", "help", "here", "high", "hook", "html", "http", "https",
  "info", "into", "issue", "just", "keep", "know", "last", "like",
  "line", "list", "load", "look", "made", "make", "many", "more",
  "most", "much", "must", "need", "next", "none", "note", "null",
  "only", "open", "over", "page", "part", "pass", "path", "plan",
  "plus", "port", "post", "prev", "prop", "push", "read", "real",
  "repo", "rest", "return", "rule", "runs", "same", "save", "self",
  "send", "sets", "show", "side", "size", "slow", "some", "sort",
  "step", "such", "sure", "take", "than", "that", "them", "then",
  "there", "these", "they", "this", "time", "todo", "true", "type",
  "under", "used", "user", "uses", "using", "uuid", "very", "view",
  "wait", "want", "ways", "well", "were", "what", "when", "where",
  "which", "while", "will", "with", "work", "your", "zero",
  // Russian common words (transliterated)
  "eto", "eto", "pri", "kak", "tak", "vse", "dlya", "pro",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((tok) => tok.length >= 4 && !STOP_WORDS.has(tok) && /[a-z]/.test(tok));
}

export function buildConceptTermSet(concepts: { label: string; aliases: string[] }[]): Set<string> {
  const terms = new Set<string>();
  for (const c of concepts) {
    terms.add(c.label.toLowerCase());
    for (const alias of c.aliases) {
      terms.add(alias.toLowerCase());
    }
  }
  return terms;
}

export function extractOrphanTerms(
  aiKnowDir: string,
  conceptTermSet: Set<string>,
  topN: number,
): OrphanTermEntry[] {
  const files = walkMdFiles(aiKnowDir);
  const freqMap = new Map<string, { count: number; uids: string[] }>();

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatterRaw(content);
    const uid = fm["exo__Asset_uid"] ?? "";
    if (!uid) continue;

    const bodyText = extractBodyText(content);
    const tokens = tokenize(bodyText);
    const seen = new Set<string>();

    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);

      if (conceptTermSet.has(token)) continue;

      const entry = freqMap.get(token) ?? { count: 0, uids: [] };
      entry.count++;
      if (entry.uids.length < 3) entry.uids.push(uid);
      freqMap.set(token, entry);
    }
  }

  return Array.from(freqMap.entries())
    .map(([term, { count, uids }]) => ({ term, frequency: count, sample_uids: uids }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, topN);
}

export function backfillOrphanTermsCommand(): Command {
  return new Command("orphan-terms")
    .description("Extract high-frequency terms from aiKnow assets that have no matching ims__Concept")
    .requiredOption("--aiKnow-dir <path>", "Path to aiKnow assets directory")
    .option("--vault <path>", "Path to Obsidian vault (for finding concepts)")
    .option("--top <number>", "Number of top orphan terms to return", "20")
    .action((options: { aiKnowDir: string; vault?: string; top: string }) => {
      const topN = parseInt(options.top, 10);
      if (isNaN(topN) || topN < 1) {
        console.error("❌ --top must be a positive integer");
        process.exitCode = 1;
        return;
      }

      const aiKnowDir = resolve(options.aiKnowDir);
      if (!existsSync(aiKnowDir)) {
        console.error(`❌ aiKnow directory not found: ${aiKnowDir}`);
        process.exitCode = 1;
        return;
      }

      const vaultPath = options.vault ? resolve(options.vault) : resolve(aiKnowDir, "..", "..", "..");

      console.log("🔍 Loading concepts from vault...");
      const concepts = loadConcepts(vaultPath);
      const conceptTermSet = buildConceptTermSet(concepts);
      console.log(`   ${concepts.length} concepts loaded (${conceptTermSet.size} unique terms/aliases)`);

      console.log("📖 Scanning aiKnow assets for orphan terms...");
      const start = Date.now();
      const orphans = extractOrphanTerms(aiKnowDir, conceptTermSet, topN);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);

      console.log(`\n✅ Top ${orphans.length} orphan terms (${elapsed}s):\n`);
      console.log(`${"Rank".padEnd(6)}${"Term".padEnd(30)}${"Freq".padEnd(8)}Sample UIDs`);
      console.log("-".repeat(90));
      orphans.forEach((entry, i) => {
        const rank = `#${i + 1}`.padEnd(6);
        const term = entry.term.padEnd(30);
        const freq = String(entry.frequency).padEnd(8);
        const uids = entry.sample_uids.join(", ");
        console.log(`${rank}${term}${freq}${uids}`);
      });
    });
}
