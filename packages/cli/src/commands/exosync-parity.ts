/**
 * `exocortex exosync-parity` — ExoSync M1/M2 parity report from the CLI
 * (RFC 4e4dc453 Phase E / E1 — parallel-run validation harness).
 *
 * Read-only desktop probe over the SAME platform-free `ParityValidator`
 * the plugin runs after every sync round: compares the vault's
 * materialized sync units against their remote heads (cross-device parity
 * by rendezvous transitivity — see the validator docstring).
 *
 * Strictly read-only by construction:
 *  - the watermark file (`exosync-watermarks.local.json`, written by the
 *    LIVE plugin whose write chain serialises in-process only) is opened
 *    through an IO whose write path THROWS;
 *  - the local-files port refuses write/delete;
 *  - no parity journal is written (the plugin owns the JSONL journal) —
 *    the CLI prints the round instead.
 *
 * Exit codes: 0 = M1=0 AND M2=∅; 1 = violations/diffs found;
 * 2 = VACUOUS (nothing was actually checked — all repos errored or never
 * synced on this device; a green exit here would be a false certificate).
 */

import { Command } from "commander";
import { promises as fsp, existsSync } from "node:fs";
import { webcrypto } from "node:crypto";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  FileWatermarkStore,
  ParityValidator,
  SpaceSpecAccumulator,
  WATERMARK_STORE_FILENAME,
  classifySpaceDeclaration,
  summarizeParityRound,
  type LocalFilesPort,
  type ParityRoundRecord,
  type RestCommitTransport,
  type Sha1Fn,
  type SyncRepoSpec,
  type YamlCodec,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { RestPushService } from "../services/RestPushService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";

export interface ExosyncParityOptions {
  vault: string;
  /** Obsidian config dir NAME (it is configurable per vault). */
  configDir?: string;
  json?: boolean;
  token?: string;
  tokenFromGh?: boolean;
  apiBase?: string;
}

/** Injectable dependencies (tests). */
export interface ExosyncParityDeps {
  transportFactory?: (token: string, apiBase?: string) => RestCommitTransport;
  ghTokenRunner?: () => string;
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
}

/**
 * Git blob content addressing (NOT a security context): the remote IS git,
 * which addresses blobs by SHA-1 — parity with `GET git/trees` requires the
 * same digest. WebCrypto via `node:crypto`, mirroring the plugin's
 * `webCryptoSha1` (same injected `Sha1Fn` seam the engine uses).
 */
const nodeSha1: Sha1Fn = async (bytes) => {
  const digest = await webcrypto.subtle.digest(
    "SHA-1",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const coreSchemaYaml: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

/** Token precedence mirrors `exosync`. Read-only API calls
 * still need auth: the sync units are private repos (404-hidden without a
 * PAT — the documented fine-grained blind spot). */
function resolveToken(
  opts: ExosyncParityOptions,
  deps: ExosyncParityDeps,
): string {
  if (opts.tokenFromGh === true) {
    return RestPushService.resolveGhToken(deps.ghTokenRunner);
  }
  const env = deps.env ?? process.env;
  const token = opts.token || env.GITHUB_TOKEN || env.GH_TOKEN || "";
  if (token.length === 0) {
    throw new Error(
      "A GitHub token is required (private sync units read as 404 without one). Use --token-from-gh, --token <pat>, or set GITHUB_TOKEN / GH_TOKEN.",
    );
  }
  return token;
}

/** Read-only LocalFilesPort over the node fs, scoped to one mount folder. */
function nodeLocalFilesPort(root: string): LocalFilesPort {
  const abs = (rel: string): string => path.join(root, rel);
  const walk = async (dir: string, out: string[]): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fsp.readdir>>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue; // submodule plumbing, never sync content
        await walk(full, out);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  return {
    async list(): Promise<string[]> {
      const out: string[] = [];
      if (existsSync(root)) await walk(root, out);
      return out;
    },
    read: (rel) => fsp.readFile(abs(rel), "utf-8"),
    async readBinary(rel): Promise<Uint8Array> {
      return new Uint8Array(await fsp.readFile(abs(rel)));
    },
    async write(): Promise<void> {
      throw new Error("exosync-parity is read-only — write refused");
    },
    async delete(): Promise<void> {
      throw new Error("exosync-parity is read-only — delete refused");
    },
  };
}

interface CollectedSpecs {
  specs: SyncRepoSpec[];
  warnings: string[];
}

/**
 * Enumerate the vault's materialized sync units — the SAME platform-free
 * classification core the plugin's `collectSyncRepoSpecs` delegates to
 * (one parser, no drift); only the walk (node fs) and the existence check
 * differ.
 */
export function collectVaultSpecs(vaultPath: string): CollectedSpecs {
  const adapter = new FileSystemVaultAdapter(vaultPath);
  const acc = new SpaceSpecAccumulator();
  for (const file of adapter.getAllFiles()) {
    const fm = adapter.getFrontmatter(file) as Record<string, unknown> | null;
    if (!fm) continue;
    const verdict = classifySpaceDeclaration(fm, file.path);
    if (verdict.kind === "not-space") continue;
    if (verdict.warning !== undefined) acc.warnings.push(verdict.warning);
    if (verdict.kind === "skip") continue;
    const spec = acc.offer(verdict.candidate);
    if (spec === null) continue;
    if (!existsSync(path.join(vaultPath, spec.localPath))) continue;
    acc.commit(verdict.candidate);
  }
  return { specs: acc.specs, warnings: acc.warnings };
}

function printHumanReport(
  record: ParityRoundRecord,
  out: (line: string) => void,
): void {
  for (const repo of record.repos) {
    const head = repo.headSha !== undefined ? ` @${repo.headSha.slice(0, 7)}` : "";
    out(
      `${repo.repoKey}${head}: ${repo.status} — ${repo.inParity}/${repo.filesChecked} in parity, M2 diffs ${repo.m2SemanticDiffs}, accounted ${repo.accountedCount}, M1 violations ${repo.m1Violations.length}${repo.attachmentHashSetIdentical !== undefined ? `, attachment hash-set ${repo.attachmentHashSetIdentical ? "identical" : "DIFFERS"}` : ""}`,
    );
    if (repo.detail !== undefined) out(`  ${repo.detail}`);
    for (const w of repo.warnings) out(`  warn: ${w}`);
    for (const d of repo.discrepancies) {
      out(`  ${d.cls}: ${d.path}${d.detail !== undefined ? ` (${d.detail})` : ""}`);
    }
    for (const v of repo.m1Violations) {
      out(`  M1 VIOLATION: ${v.path} — ${v.detail}`);
    }
  }
  out(summarizeParityRound(record));
}

/** Core flow, exported for tests. Returns the intended exit code. */
export async function runExosyncParity(
  opts: ExosyncParityOptions,
  deps: ExosyncParityDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string): void => console.log(line));
  const vaultPath = path.resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const token = resolveToken(opts, deps);
  const pushService = new RestPushService({
    token,
    ...(opts.apiBase !== undefined ? { apiBase: opts.apiBase } : {}),
  });
  const transport =
    deps.transportFactory?.(token, opts.apiBase) ?? pushService.transport();

  const { specs, warnings } = collectVaultSpecs(vaultPath);
  for (const w of warnings) out(`warn: ${w}`);
  if (specs.length === 0) {
    out(
      "Nothing to check — no materialized AssetSpaces with a GitHub source found in this vault.",
    );
    return 2;
  }

  const configDir = opts.configDir ?? ".obsidian";
  const watermarkPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    WATERMARK_STORE_FILENAME,
  );
  // READ-ONLY watermark IO: the live plugin's write chain serialises
  // in-process only — a concurrent CLI write could lose its update.
  const watermarks = new FileWatermarkStore({
    read: async () => {
      try {
        return await fsp.readFile(watermarkPath, "utf-8");
      } catch {
        return null;
      }
    },
    writeAtomic: async () => {
      throw new Error("exosync-parity: watermark access is read-only by contract");
    },
  });

  const validator = new ParityValidator({
    transport,
    sha1: nodeSha1,
    localFilesFor: (spec) =>
      nodeLocalFilesPort(path.join(vaultPath, spec.localPath)),
    watermarks: { get: (repoKey) => watermarks.get(repoKey) },
    yaml: coreSchemaYaml,
    // Defence-in-depth: the transport already redacts its own error
    // strings, but validator warnings land in the report/--json output too.
    redact: (m) => pushService.redact(m),
    ...(opts.apiBase !== undefined ? { baseURL: opts.apiBase } : {}),
  });

  out(`ExoSync parity check: ${specs.length} repo(s), vault ${vaultPath}`);
  const record = await validator.runRound(specs, { trigger: "standalone" });

  if (opts.json === true) {
    out(JSON.stringify(record, null, 2));
  } else {
    printHumanReport(record, out);
  }

  if (record.vacuous) return 2;
  return record.ok ? 0 : 1;
}

export function exosyncParityCommand(): Command {
  return new Command("exosync-parity")
    .description(
      "ExoSync M1/M2 parity report: compare materialized sync units against their remote heads (read-only; RFC 4e4dc453 Phase E)",
    )
    .requiredOption("--vault <path>", "Vault root path")
    .option(
      "--config-dir <name>",
      "Obsidian config dir name (watermark location)",
      ".obsidian",
    )
    .option("--json", "Print the full round record as JSON")
    .option(
      "--token <pat>",
      "GitHub PAT (or env GITHUB_TOKEN / GH_TOKEN). Prefer --token-from-gh.",
    )
    .option("--token-from-gh", "Resolve the PAT via `gh auth token`")
    .option("--api-base <url>", "GitHub API base (testing)")
    .action(async (options: ExosyncParityOptions) => {
      try {
        process.exitCode = await runExosyncParity(options);
      } catch (error) {
        ErrorHandler.handle(error, { command: "exosync-parity" });
        process.exitCode = 1;
      }
    });
}
