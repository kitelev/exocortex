import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface VaultFileSnapshot {
  relPath: string;
  sha256: string;
  size: number;
}

export interface VaultSnapshot {
  takenAt: string;
  vaultPath: string;
  files: VaultFileSnapshot[];
}

export interface VaultDrift {
  added: string[];
  removed: string[];
  modified: string[];
  totalChanged: number;
}

const DEFAULT_IGNORED_SEGMENTS = new Set<string>([
  ".obsidian",
  ".trash",
  ".git",
]);

function collectFiles(
  root: string,
  ignored: Set<string>,
  current: string,
  out: string[],
): void {
  const entries = fs.readdirSync(path.join(root, current), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const rel = current ? path.posix.join(current, entry.name) : entry.name;
    if (entry.isDirectory()) {
      collectFiles(root, ignored, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

export function snapshotVault(
  vaultPath: string,
  ignored: Set<string> = DEFAULT_IGNORED_SEGMENTS,
): VaultSnapshot {
  const files: VaultFileSnapshot[] = [];
  const relPaths: string[] = [];
  collectFiles(vaultPath, ignored, "", relPaths);
  relPaths.sort();
  for (const relPath of relPaths) {
    const abs = path.join(vaultPath, relPath);
    const stat = fs.statSync(abs);
    const buf = fs.readFileSync(abs);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    files.push({ relPath, sha256, size: stat.size });
  }
  return {
    takenAt: new Date().toISOString(),
    vaultPath,
    files,
  };
}

export function diffSnapshots(
  before: VaultSnapshot,
  after: VaultSnapshot,
): VaultDrift {
  const beforeMap = new Map(before.files.map((f) => [f.relPath, f.sha256]));
  const afterMap = new Map(after.files.map((f) => [f.relPath, f.sha256]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [rel, sha] of afterMap) {
    const prev = beforeMap.get(rel);
    if (prev === undefined) {
      added.push(rel);
    } else if (prev !== sha) {
      modified.push(rel);
    }
  }
  for (const rel of beforeMap.keys()) {
    if (!afterMap.has(rel)) {
      removed.push(rel);
    }
  }
  added.sort();
  removed.sort();
  modified.sort();
  return {
    added,
    removed,
    modified,
    totalChanged: added.length + removed.length + modified.length,
  };
}
