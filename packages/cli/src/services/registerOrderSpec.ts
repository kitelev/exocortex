import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  registerOrderSpecLoader,
  type FrontmatterOrderSpec,
} from "@kitelev/exocortex-core";

/**
 * Scan vault for `exo__FrontmatterOrderSpec` assets (class UID
 * `15270ad1-d29d-4677-bd52-23078983cae8`) and register a loader that returns
 * the one with `exo__FrontmatterOrderSpec_default: true`.
 *
 * Called by mutating CLI commands (apply, create, etc.) so that asset
 * creation honors the canonical ordering defined in the vault.
 *
 * RFC 27a7a877.
 */
export function registerOrderSpecFromVault(vaultRoot: string): void {
  registerOrderSpecLoader(() => {
    const candidates = collectCandidateDirs(vaultRoot);
    for (const dir of candidates) {
      const spec = scanDirForDefault(dir);
      if (spec) return spec;
    }
    return null;
  });
}

function collectCandidateDirs(vaultRoot: string): string[] {
  return [
    join(vaultRoot, "assetspaces", "exo"),
  ];
}

function scanDirForDefault(dir: string): FrontmatterOrderSpec | null {
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const full = join(dir, f);
    let content: string;
    try {
      content = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const fm = extractFrontmatter(content);
    if (!fm) continue;
    if (!/^exo__FrontmatterOrderSpec_default:\s*true\b/m.test(fm)) continue;
    return {
      head: extractList(fm, "exo__FrontmatterOrderSpec_head"),
      tail: extractList(fm, "exo__FrontmatterOrderSpec_tail"),
      middleStrategy: extractScalar(fm, "exo__FrontmatterOrderSpec_middleStrategy") ?? "alphabetical",
    };
  }
  return null;
}

function extractFrontmatter(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

function extractScalar(fm: string, key: string): string | null {
  const re = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m");
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

function extractList(fm: string, key: string): string[] {
  const re = new RegExp(`^${escapeRegex(key)}:\\s*\\n((?:  -.*\\n?)+)`, "m");
  const m = fm.match(re);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
