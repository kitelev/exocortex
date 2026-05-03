import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";


export interface ConceptEntry {
  uid: string;
  label: string;
  aliases: string[];
  filePath: string;
}

export interface BackfillCandidate {
  concept_uid: string;
  concept_label: string;
  concept_file: string;
  confidence: number;
  match_type: MatchType;
}

export type MatchType =
  | "label_exact"
  | "label_substring"
  | "description_exact"
  | "description_substring"
  | "body_exact"
  | "body_substring"
  | "alias_label_exact"
  | "alias_label_substring"
  | "alias_description_substring"
  | "alias_body_substring";

export interface BackfillRecord {
  aiKnow_uid: string;
  aiKnow_label: string;
  aiKnow_file: string;
  candidates: BackfillCandidate[];
  auto_approved: boolean;
  auto_approved_candidate?: BackfillCandidate;
}

export interface BackfillSuggestOptions {
  aiKnowDir: string;
  vault?: string;
  output?: string;
  autoThreshold?: number;
  dryRun?: boolean;
}

export function parseFrontmatterRaw(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const keyMatch = line.match(/^([\w]+):\s*"?([^"]*)"?\s*$/);
    if (keyMatch) result[keyMatch[1]] = keyMatch[2];
  }
  return result;
}

export function extractBodyText(content: string): string {
  const afterFrontmatter = content.replace(/^---[\s\S]*?---\r?\n/, "");
  // Strip markdown headers, wikilinks, code blocks
  return afterFrontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/#+\s/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .toLowerCase();
}

function extractLabel(frontmatter: Record<string, string>, filePath: string): string {
  if (frontmatter["exo__Asset_label"]) return frontmatter["exo__Asset_label"];
  const fileName = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
  return fileName;
}

function extractAliases(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const aliases: string[] = [];
  const lines = match[1].split("\n");
  let inAliases = false;
  for (const line of lines) {
    if (line.match(/^aliases:\s*$/)) {
      inAliases = true;
      continue;
    }
    if (inAliases) {
      const aliasMatch = line.match(/^\s+-\s+"?([^"]*)"?\s*$/);
      if (aliasMatch) {
        aliases.push(aliasMatch[1].trim());
      } else if (!line.startsWith(" ") && !line.startsWith("\t")) {
        // Single-line aliases: `aliases: foo` or `aliases: "foo"`
        inAliases = false;
      }
    }
    // Single-line aliases format: `aliases: "text"` or `aliases: text`
    const singleAlias = line.match(/^aliases:\s+"?([^"\n]+)"?\s*$/);
    if (singleAlias && singleAlias[1].trim()) {
      aliases.push(singleAlias[1].trim());
    }
  }
  return aliases.filter(Boolean);
}

export function isConceptFile(filePath: string, _content: string): boolean {
  return filePath.includes("/concepts/");
}

export function walkMdFiles(dir: string): string[] {
  const result: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...walkMdFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      result.push(fullPath);
    }
  }
  return result;
}

export function loadConcepts(vaultPath: string): ConceptEntry[] {
  const allFiles = walkMdFiles(vaultPath);
  const concepts: ConceptEntry[] = [];

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (!isConceptFile(filePath, content)) continue;

    const fm = parseFrontmatterRaw(content);
    const uid = fm["exo__Asset_uid"] ?? "";
    if (!uid) continue;
    const label = extractLabel(fm, filePath);
    const aliases = extractAliases(content);

    concepts.push({ uid, label, aliases, filePath });
  }
  return concepts;
}

export const MIN_LABEL_FOR_SUBSTRING = 4;

export function scoreMatch(text: string, term: string): number {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  if (!termLower) return 0;

  if (textLower === termLower) return 1.0;
  if (termLower.length >= MIN_LABEL_FOR_SUBSTRING && textLower.includes(termLower)) return 0.85;
  return 0;
}

export function computeCandidates(
  aiKnowLabel: string,
  aiKnowDescription: string,
  aiKnowBody: string,
  concepts: ConceptEntry[],
): BackfillCandidate[] {
  const labelLower = aiKnowLabel.toLowerCase();
  const descLower = aiKnowDescription.toLowerCase();
  const bodyLower = aiKnowBody;

  const scored: BackfillCandidate[] = [];

  for (const concept of concepts) {
    let bestScore = 0;
    let bestType: MatchType = "body_substring";

    const labelScore = scoreMatch(labelLower, concept.label);
    if (labelScore > bestScore) {
      bestScore = labelScore;
      bestType = labelScore === 1.0 ? "label_exact" : "label_substring";
    }

    if (bestScore < 1.0) {
      const descScore = scoreMatch(descLower, concept.label);
      const descAdjusted = descScore === 1.0 ? 0.75 : descScore > 0 ? 0.65 : 0;
      if (descAdjusted > bestScore) {
        bestScore = descAdjusted;
        bestType = descScore === 1.0 ? "description_exact" : "description_substring";
      }

      const bodyScore = scoreMatch(bodyLower, concept.label);
      const bodyAdjusted = bodyScore === 1.0 ? 0.60 : bodyScore > 0 ? 0.50 : 0;
      if (bodyAdjusted > bestScore) {
        bestScore = bodyAdjusted;
        bestType = bodyScore === 1.0 ? "body_exact" : "body_substring";
      }
    }

    // Check aliases (score × 0.9)
    for (const alias of concept.aliases) {
      const aliasLabelScore = scoreMatch(labelLower, alias);
      if (aliasLabelScore > 0) {
        const adjusted = aliasLabelScore * 0.9;
        if (adjusted > bestScore) {
          bestScore = adjusted;
          bestType = aliasLabelScore === 1.0 ? "alias_label_exact" : "alias_label_substring";
        }
      }
      const aliasDescScore = scoreMatch(descLower, alias);
      if (aliasDescScore > 0) {
        const adjusted = aliasDescScore === 1.0 ? 0.675 : aliasDescScore * 0.65 * 0.9;
        if (adjusted > bestScore) {
          bestScore = adjusted;
          bestType = "alias_description_substring";
        }
      }
      const aliasBodyScore = scoreMatch(bodyLower, alias);
      if (aliasBodyScore > 0) {
        const adjusted = aliasBodyScore === 1.0 ? 0.54 : aliasBodyScore * 0.50 * 0.9;
        if (adjusted > bestScore) {
          bestScore = adjusted;
          bestType = "alias_body_substring";
        }
      }
    }

    if (bestScore > 0) {
      scored.push({
        concept_uid: concept.uid,
        concept_label: concept.label,
        concept_file: concept.filePath,
        confidence: Math.round(bestScore * 100) / 100,
        match_type: bestType,
      });
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, 3);
}

export function isAutoApproved(
  candidate: BackfillCandidate,
  threshold: number,
): boolean {
  return (
    candidate.confidence >= threshold &&
    (candidate.match_type === "label_exact" || candidate.match_type === "alias_label_exact")
  );
}

export async function runBackfillSuggest(options: BackfillSuggestOptions): Promise<BackfillRecord[]> {
  const aiKnowDir = resolve(options.aiKnowDir);
  const vaultPath = resolve(options.vault ?? join(aiKnowDir, "..", "..", ".."));
  const threshold = options.autoThreshold ?? 0.8;

  const concepts = loadConcepts(vaultPath);
  const aiKnowFiles = walkMdFiles(aiKnowDir);
  const records: BackfillRecord[] = [];

  for (const filePath of aiKnowFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const fm = parseFrontmatterRaw(content);
    const uid = fm["exo__Asset_uid"] ?? "";
    if (!uid) continue;

    const label = extractLabel(fm, filePath);
    const description = fm["exo__Asset_description"] ?? "";
    const body = extractBodyText(content);

    const candidates = computeCandidates(label, description, body, concepts);
    const topCandidate = candidates[0];
    const autoApproved = topCandidate ? isAutoApproved(topCandidate, threshold) : false;

    records.push({
      aiKnow_uid: uid,
      aiKnow_label: label,
      aiKnow_file: filePath,
      candidates,
      auto_approved: autoApproved,
      ...(autoApproved ? { auto_approved_candidate: topCandidate } : {}),
    });
  }

  return records;
}

export function writeJsonl(records: BackfillRecord[], outputPath: string): void {
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(outputPath, lines, "utf-8");
}

export function backfillSuggestCommand(): Command {
  const defaultOutput = join(homedir(), ".cache", "exocortex", "backfill-candidates.jsonl");

  return new Command("suggest")
    .description("Suggest concept backfill candidates for aiKnow assets")
    .requiredOption("--aiKnow-dir <path>", "Path to aiKnow assets directory")
    .option("--vault <path>", "Path to Obsidian vault (for finding concepts)")
    .option("--output <path>", "Output JSONL path", defaultOutput)
    .option("--auto-threshold <number>", "Auto-approve confidence threshold", "0.8")
    .option("--dry-run", "Dry-run mode: output JSONL but do not write to vault (default)", true)
    .action(async (options: { aiKnowDir: string; vault?: string; output: string; autoThreshold: string; dryRun: boolean }) => {
      const threshold = parseFloat(options.autoThreshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.error("❌ --auto-threshold must be a number between 0 and 1");
        process.exitCode = 1;
        return;
      }

      const aiKnowDir = resolve(options.aiKnowDir);
      if (!existsSync(aiKnowDir)) {
        console.error(`❌ aiKnow directory not found: ${aiKnowDir}`);
        process.exitCode = 1;
        return;
      }

      console.log(`🔍 Loading concepts from vault...`);
      const vaultPath = options.vault ? resolve(options.vault) : undefined;
      const start = Date.now();

      const records = await runBackfillSuggest({
        aiKnowDir,
        vault: vaultPath,
        output: options.output,
        autoThreshold: threshold,
        dryRun: options.dryRun,
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      const autoCount = records.filter((r) => r.auto_approved).length;
      const withCandidates = records.filter((r) => r.candidates.length > 0).length;

      writeJsonl(records, options.output);

      console.log(`✅ Processed ${records.length} aiKnow assets in ${elapsed}s`);
      console.log(`   ${withCandidates} assets have concept candidates`);
      console.log(`   ${autoCount} assets auto-approved (confidence ≥ ${threshold})`);
      console.log(`📝 Output: ${options.output}`);
      if (options.dryRun) {
        console.log(`ℹ️  Dry-run mode: no writes to vault`);
      }
    });
}
