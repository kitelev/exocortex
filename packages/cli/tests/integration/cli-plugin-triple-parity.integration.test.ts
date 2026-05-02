/**
 * RFC-027 Phase 3 (T3.2) — Diff-test CLI sparql vs plugin getTripleStore.
 *
 * Verifies that `NoteToRDFConverter` driven by the CLI-side
 * `FileSystemVaultAdapter` (post-T3.1 alias-aware) produces the same set of
 * triples that the plugin's `VaultRDFIndexer.getTripleStore()` produces on
 * the same vault content. The plugin path is exercised via an independent
 * "oracle" `IVaultAdapter` implementation that re-encodes Obsidian's
 * documented `metadataCache.getFirstLinkpathDest` resolution algorithm
 * (relative-path → basename → frontmatter alias). Diff against the
 * production adapter must be 0 for all five reference vaults.
 *
 * The five reference vaults intentionally exercise the resolution paths
 * that diverged before T3.1 (aiKnow b4a956fc):
 *
 *   1. `basename`         — wikilink resolves via filename match
 *   2. `alias`            — wikilink resolves via frontmatter aliases
 *   3. `uuid`             — wikilink resolves via UUID-named file
 *   4. `relative-path`    — wikilink resolves via folder-relative path
 *   5. `mixed`            — combines all of the above plus class-IRI
 *                           wikilinks that must collapse to namespace IRIs
 *
 * If the production adapter ever drifts from the plugin algorithm again,
 * one or more of these vaults will surface a non-zero diff.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import {
  NoteToRDFConverter,
  InMemoryTripleStore,
  type IVaultAdapter,
  type IFile,
  type IFolder,
  type IFrontmatter,
  type Triple,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

/**
 * Independent reference implementation of Obsidian's
 * `metadataCache.getFirstLinkpathDest` resolution algorithm. Mirrors what
 * the plugin's `ObsidianVaultAdapter` ultimately delegates to — encoded
 * separately from `FileSystemVaultAdapter` so that the parity test is not
 * a tautology.
 */
class OracleVaultAdapter implements IVaultAdapter {
  private fileList: string[] = [];
  private basenameMap = new Map<string, string>();
  private aliasMap = new Map<string, string>();

  constructor(private rootPath: string) {
    this.indexVault();
  }

  private indexVault(): void {
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && full.endsWith(".md")) {
          const rel = path.relative(this.rootPath, full);
          this.fileList.push(rel);
          const basename = path.basename(rel, ".md").toLowerCase();
          if (!this.basenameMap.has(basename)) {
            this.basenameMap.set(basename, rel);
          }
          const fm = this.parseFrontmatter(fs.readFileSync(full, "utf-8"));
          const aliases = fm?.aliases;
          const list = Array.isArray(aliases)
            ? aliases
            : typeof aliases === "string"
              ? [aliases]
              : [];
          for (const a of list) {
            if (typeof a !== "string") continue;
            const key = a.trim().toLowerCase();
            if (!key) continue;
            if (!this.aliasMap.has(key)) this.aliasMap.set(key, rel);
          }
        }
      }
    };
    walk(this.rootPath);
  }

  private parseFrontmatter(content: string): IFrontmatter | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as IFrontmatter)
        : null;
    } catch {
      return null;
    }
  }

  private toFile(rel: string): IFile {
    const name = path.basename(rel);
    const basename = path.basename(rel, path.extname(rel));
    const parentDir = path.dirname(rel);
    return {
      path: rel,
      basename,
      name,
      parent:
        parentDir !== "."
          ? { path: parentDir, name: path.basename(parentDir) }
          : null,
    };
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null {
    const clean = linkpath.split("|")[0].trim();
    if (!clean) return null;

    // 1. Relative-path resolution (mirrors plugin behaviour for explicit paths).
    const sourceDir = path.dirname(sourcePath);
    let candidate = path.isAbsolute(clean)
      ? clean
      : path.normalize(path.join(sourceDir, clean));
    if (!candidate.endsWith(".md")) candidate += ".md";
    const candidateAbs = path.resolve(this.rootPath, candidate);
    if (
      candidateAbs.startsWith(this.rootPath) &&
      fs.existsSync(candidateAbs) &&
      fs.statSync(candidateAbs).isFile()
    ) {
      return this.toFile(path.relative(this.rootPath, candidateAbs));
    }

    // 2. Basename match.
    const key = clean.toLowerCase();
    const byBasename = this.basenameMap.get(key);
    if (byBasename) return this.toFile(byBasename);

    // 3. Frontmatter alias match.
    const byAlias = this.aliasMap.get(key);
    if (byAlias) return this.toFile(byAlias);

    return null;
  }

  getAllFiles(): IFile[] {
    return this.fileList.map((rel) => this.toFile(rel));
  }

  getFrontmatter(file: IFile): IFrontmatter | null {
    try {
      const raw = fs.readFileSync(path.join(this.rootPath, file.path), "utf-8");
      return this.parseFrontmatter(raw);
    } catch {
      return null;
    }
  }

  // The conversion path only consumes the read-side surface above; the rest
  // of IVaultAdapter is unused but must satisfy the type contract.
  async read(file: IFile): Promise<string> {
    return fs.readFile(path.join(this.rootPath, file.path), "utf-8");
  }
  async create(): Promise<IFile> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async modify(): Promise<void> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async delete(): Promise<void> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async exists(filePath: string): Promise<boolean> {
    return fs.pathExists(path.join(this.rootPath, filePath));
  }
  getAbstractFileByPath(filePath: string): IFile | IFolder | null {
    const abs = path.join(this.rootPath, filePath);
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) return this.toFile(filePath);
      if (st.isDirectory())
        return { path: filePath, name: path.basename(filePath) };
    } catch {
      return null;
    }
    return null;
  }
  async updateFrontmatter(): Promise<void> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async rename(): Promise<void> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async createFolder(): Promise<void> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  async process(): Promise<string> {
    throw new Error("OracleVaultAdapter is read-only");
  }
  getDefaultNewFileParent(): IFolder | null {
    return { path: "", name: "" };
  }
  async updateLinks(): Promise<void> {
    return Promise.resolve();
  }
}

interface VaultFile {
  path: string;
  body: string;
}

interface ReferenceVault {
  name: string;
  files: VaultFile[];
}

/**
 * Required props per `NoteToRDFConverter.validateExocortexAsset`. Files
 * lacking these are skipped before triple emission, so every fixture file
 * supplies them. Tests above target wikilink-resolution semantics, not
 * the asset-shape validator.
 */
const REQUIRED = (
  uid: string,
  label: string,
  cls = "[[ems__Task]]",
): string => `exo__Asset_uid: ${uid}
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "${label}"
exo__Instance_class:
  - "${cls}"`;

const REFERENCE_VAULTS: ReferenceVault[] = [
  {
    name: "basename",
    files: [
      {
        path: "source.md",
        body: `---
${REQUIRED("11111111-1111-4111-8111-111111111111", "Basename Source")}
ems__Effort_relates: "[[target-doc]]"
---
`,
      },
      {
        path: "target-doc.md",
        body: `---
${REQUIRED("22222222-2222-4222-8222-222222222222", "Basename Target")}
---
`,
      },
    ],
  },
  {
    name: "alias",
    files: [
      {
        path: "source.md",
        body: `---
${REQUIRED("33333333-3333-4333-8333-333333333333", "Alias Source")}
ems__Effort_relates: "[[some-alias]]"
---
`,
      },
      {
        path: "44444444-4444-4444-8444-444444444444.md",
        body: `---
${REQUIRED("44444444-4444-4444-8444-444444444444", "Alias Target")}
aliases:
  - some-alias
  - other-alias
---
`,
      },
    ],
  },
  {
    name: "uuid",
    files: [
      {
        path: "source.md",
        body: `---
${REQUIRED("55555555-5555-4555-8555-555555555555", "UUID Source")}
ems__Effort_relates: "[[66666666-6666-4666-8666-666666666666|Some Label]]"
---
`,
      },
      {
        path: "66666666-6666-4666-8666-666666666666.md",
        body: `---
${REQUIRED("66666666-6666-4666-8666-666666666666", "UUID Target")}
---
`,
      },
    ],
  },
  {
    name: "relative-path",
    files: [
      {
        path: "folder-a/source.md",
        body: `---
${REQUIRED("77777777-7777-4777-8777-777777777777", "Relative Source")}
ems__Effort_relates: "[[../folder-b/target]]"
---
`,
      },
      {
        path: "folder-b/target.md",
        body: `---
${REQUIRED("88888888-8888-4888-8888-888888888888", "Relative Target")}
---
`,
      },
    ],
  },
  {
    name: "mixed",
    files: [
      {
        path: "source.md",
        body: `---
${REQUIRED("99999999-9999-4999-8999-999999999999", "Mixed Source")}
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_relates:
  - "[[basename-target]]"
  - "[[aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|UUID Target]]"
  - "[[../sibling/relative-target]]"
  - "[[a-frontmatter-alias]]"
---
`,
      },
      {
        path: "ems/ems__EffortStatusBacklog.md",
        body: `---
${REQUIRED(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "ems__EffortStatusBacklog",
  "[[ems__EffortStatus]]",
)}
---
`,
      },
      {
        path: "basename-target.md",
        body: `---
${REQUIRED("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Basename Mixed Target")}
---
`,
      },
      {
        path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md",
        body: `---
${REQUIRED("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Mixed UUID Target")}
---
`,
      },
      {
        path: "sibling/relative-target.md",
        body: `---
${REQUIRED("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Relative Mixed Target")}
---
`,
      },
      {
        path: "alias-host.md",
        body: `---
${REQUIRED("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Alias Mixed Host")}
aliases:
  - a-frontmatter-alias
---
`,
      },
    ],
  },
];

async function materializeVault(
  vault: ReferenceVault,
  parentDir: string,
): Promise<string> {
  const root = path.join(parentDir, vault.name);
  await fs.ensureDir(root);
  for (const file of vault.files) {
    const full = path.join(root, file.path);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, file.body, "utf-8");
  }
  return root;
}

async function buildTripleSet(
  vaultRoot: string,
  adapter: IVaultAdapter,
): Promise<Set<string>> {
  const converter = new NoteToRDFConverter(adapter);
  const triples: Triple[] = await converter.convertVault();
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  // Materialise via the same in-memory store the plugin uses, then read
  // back through `match()` so that any dedup/ordering performed by the
  // store is applied identically on both sides.
  const stored = await store.match();
  return new Set(stored.map((t) => t.toString()));
}

function setDiff(a: Set<string>, b: Set<string>): { onlyA: string[]; onlyB: string[] } {
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const v of a) if (!b.has(v)) onlyA.push(v);
  for (const v of b) if (!a.has(v)) onlyB.push(v);
  onlyA.sort();
  onlyB.sort();
  return { onlyA, onlyB };
}

describe("CLI ↔ plugin triple parity (RFC-027 Phase 3 / T3.2)", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-plugin-parity-"));
  });

  afterAll(async () => {
    if (workDir) {
      await fs.remove(workDir);
    }
  });

  for (const vault of REFERENCE_VAULTS) {
    it(`reference vault "${vault.name}" produces identical triples between CLI and plugin paths`, async () => {
      const root = await materializeVault(vault, workDir);

      const cliAdapter = new FileSystemVaultAdapter(root);
      const oracleAdapter = new OracleVaultAdapter(root);

      const cliTriples = await buildTripleSet(root, cliAdapter);
      const pluginTriples = await buildTripleSet(root, oracleAdapter);

      const diff = setDiff(cliTriples, pluginTriples);

      // Diagnostic-friendly assertions: when parity breaks, surface the
      // exact triples that diverged rather than just a numeric mismatch.
      expect(diff.onlyA).toEqual([]);
      expect(diff.onlyB).toEqual([]);
      expect(cliTriples.size).toBeGreaterThan(0);
      expect(cliTriples.size).toBe(pluginTriples.size);
    });
  }
});
