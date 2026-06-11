/**
 * ExoSyncParityFactory — plugin wiring of the E1 parity harness
 * (RFC 4e4dc453 Phase E: parallel-run validation, metrics M1/M2).
 *
 * Composes the platform-free {@link ParityValidator} from Obsidian
 * primitives, mirroring `SyncDepsFactory.buildSyncEngine` (fresh-PAT
 * pattern, Issue #3382) with two deliberate differences:
 *
 *  - the watermark store is wrapped READ-ONLY (advisor CRITICAL: the live
 *    plugin watermark file serialises writes in-process only — the harness
 *    must be structurally unable to write it);
 *  - per-round results journal into a `.local.` JSONL (Sync-excluded,
 *    `isSyncablePath`-refused) — the 14-day parallel-run window evidence
 *    (E2 decommission gate) and the previous-round input of the
 *    persistent-divergence M1 detector.
 *
 * No settings flag: validation is constitutive of a parallel-run sync
 * round, and a user-visible off-switch would undermine the evidence
 * window. Escape hatch if one is ever needed: a per-device key in
 * `PluginLocalDataStore` (data.local.json) — never a vault setting.
 */

import type { App, DataAdapter } from "obsidian";
import yaml from "js-yaml";
import {
  FileWatermarkStore,
  ParityValidator,
  WATERMARK_STORE_FILENAME,
  summarizeParityRound,
  type ConservationSnapshot,
  type ParityRoundRecord,
  type RepoSyncResult,
  type SyncRepoSpec,
  type YamlCodec,
} from "exocortex";

import { GitHubRestClient } from "./GitHubRestClient";
import { LocalSecretsStore } from "./LocalSecretsStore";
import { vaultLocalFilesPort, webCryptoSha1 } from "./SyncDepsFactory";

export const PARITY_LOG_FILENAME = "exosync-parity-log.local.jsonl";

/** Single-generation rotation cap — same policy as FileLogChannel. */
const MAX_PARITY_LOG_BYTES = 1024 * 1024;

const parityYamlCodec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

/**
 * Tri-state Obsidian Sync probe. `internalPlugins` is NOT public API — the
 * access is fully guarded and shape changes degrade to `"unknown"`, never
 * gate behaviour (the value is evidence metadata: the parallel-run window
 * must show parity held WHILE Obsidian Sync was active — R2).
 */
export function detectObsidianSyncState(
  app: App,
): "enabled" | "disabled" | "unknown" {
  try {
    const internal = (
      app as unknown as {
        internalPlugins?: {
          plugins?: Record<string, { enabled?: unknown } | undefined>;
        };
      }
    ).internalPlugins;
    const sync = internal?.plugins?.["sync"];
    if (sync === undefined || typeof sync.enabled !== "boolean") {
      return "unknown";
    }
    return sync.enabled ? "enabled" : "disabled";
  } catch {
    return "unknown";
  }
}

/**
 * Append-only JSONL journal of parity rounds with single-generation
 * rotation. Tolerant reader: a torn final line (append is not atomic) is
 * skipped, never thrown on.
 */
export class ParityLogStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly path: string,
  ) {}

  async append(record: ParityRoundRecord): Promise<void> {
    await this.rotateIfNeeded();
    const line = `${JSON.stringify(record)}\n`;
    if (await this.adapter.exists(this.path)) {
      await this.adapter.append(this.path, line);
    } else {
      await this.adapter.write(this.path, line);
    }
  }

  /** Latest parseable round, or null (fresh install / rotated away). */
  async readLast(): Promise<ParityRoundRecord | null> {
    let text: string;
    try {
      if (!(await this.adapter.exists(this.path))) return null;
      text = await this.adapter.read(this.path);
    } catch {
      return null;
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      try {
        const parsed = JSON.parse(line) as ParityRoundRecord;
        if (parsed.version === 1 && Array.isArray(parsed.repos)) return parsed;
      } catch {
        // torn/corrupt line — keep walking up
      }
    }
    return null;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await this.adapter.stat(this.path);
      if (!stat || stat.size <= MAX_PARITY_LOG_BYTES) return;
      const rotated = `${this.path}.1`;
      if (await this.adapter.exists(rotated)) {
        await this.adapter.remove(rotated);
      }
      await this.adapter.rename(this.path, rotated);
    } catch {
      // Best-effort — if stat/rename fails, continue appending.
    }
  }
}

/** The seam `SyncCommands` consumes (pre-snapshot + post-sync + standalone). */
export interface ParityCheck {
  /** Pre-sync dirty snapshot (conservation detector input). Never throws. */
  captureSnapshot(specs: SyncRepoSpec[]): Promise<ConservationSnapshot | undefined>;
  /** Post-sync round: journal + one-line summary for the Notice. */
  runAfterSync(
    specs: SyncRepoSpec[],
    syncResults: RepoSyncResult[],
    snapshot: ConservationSnapshot | undefined,
  ): Promise<string>;
  /** Standalone round (palette command) — journals with its own trigger. */
  runStandalone(specs: SyncRepoSpec[]): Promise<string>;
}

export interface BuildParityCheckOptions {
  app: App;
  /** Diagnostic sink for per-repo details (default console.warn). */
  log?: (message: string) => void;
  /** Test seams. */
  sha1?: typeof webCryptoSha1;
  nowIso?: () => string;
}

/**
 * Compose a {@link ParityCheck} over the CURRENTLY stored PAT. Like the
 * engine, the validator is built fresh per invocation so a PAT configured
 * after onload is honoured without a reload.
 */
export function buildParityCheck(opts: BuildParityCheckOptions): ParityCheck {
  const { app } = opts;
  const adapter = app.vault.adapter;
  const configDir = app.vault.configDir;
  const log =
    opts.log ?? ((m: string): void => console.warn(m));
  const logStore = new ParityLogStore(
    adapter,
    `${configDir}/plugins/exocortex/${PARITY_LOG_FILENAME}`,
  );

  const buildValidator = async (): Promise<ParityValidator> => {
    const secretsStore = new LocalSecretsStore({ app });
    const pat = (await secretsStore.getSecret("pat")) ?? "";
    const client = new GitHubRestClient({ app, pat });
    const watermarkPath = `${configDir}/plugins/exocortex/${WATERMARK_STORE_FILENAME}`;
    // READ-ONLY watermark access: the read path reuses the production
    // store's tolerant parser; the write path is structurally absent.
    const readonlyStore = new FileWatermarkStore({
      read: async () => {
        if (!(await adapter.exists(watermarkPath))) return null;
        return adapter.read(watermarkPath);
      },
      writeAtomic: async () => {
        throw new Error(
          "ExoSync parity: watermark access is read-only by contract",
        );
      },
    });
    return new ParityValidator({
      transport: client.restTransport(),
      sha1: opts.sha1 ?? webCryptoSha1,
      localFilesFor: (spec) => vaultLocalFilesPort(adapter, spec.localPath),
      watermarks: { get: (repoKey) => readonlyStore.get(repoKey) },
      yaml: parityYamlCodec,
      redact: (m) => GitHubRestClient.redactTokens(m),
      ...(opts.nowIso !== undefined ? { now: opts.nowIso } : {}),
    });
  };

  const logRound = (record: ParityRoundRecord): void => {
    for (const repo of record.repos) {
      for (const w of repo.warnings) log(`[ExoSync parity] ${repo.repoKey}: ${w}`);
      if (repo.status !== "checked") {
        log(
          `[ExoSync parity] ${repo.repoKey}: ${repo.status}${repo.detail !== undefined ? ` — ${repo.detail}` : ""}`,
        );
        continue;
      }
      for (const d of repo.discrepancies) {
        log(
          `[ExoSync parity] ${repo.repoKey}: ${d.cls} ${d.path}${d.detail !== undefined ? ` (${d.detail})` : ""}`,
        );
      }
      for (const v of repo.m1Violations) {
        log(`[ExoSync parity] M1 VIOLATION ${v.repoKey}: ${v.path} — ${v.detail}`);
      }
    }
    log(
      `[ExoSync parity] round: trigger=${record.trigger} obsidianSync=${record.obsidianSync ?? "unknown"} checked=${record.checkedRepos}/${record.repos.length} M1=${record.m1Total} M2=${record.m2Total}`,
    );
  };

  const runRound = async (
    specs: SyncRepoSpec[],
    trigger: "post-sync" | "standalone",
    syncResults?: RepoSyncResult[],
    snapshot?: ConservationSnapshot,
  ): Promise<string> => {
    const validator = await buildValidator();
    // Escalation input only makes sense for post-sync rounds (the core
    // gates on trigger too — belt and braces).
    const previousRound =
      trigger === "post-sync" ? await logStore.readLast() : null;
    const record = await validator.runRound(specs, {
      trigger,
      ...(snapshot !== undefined ? { snapshot } : {}),
      ...(syncResults !== undefined ? { syncResults } : {}),
      previousRound,
    });
    record.obsidianSync = detectObsidianSyncState(app);
    logRound(record);
    try {
      await logStore.append(record);
    } catch (err) {
      log(
        `[ExoSync parity] journal append failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return summarizeParityRound(record);
  };

  return {
    async captureSnapshot(specs) {
      try {
        const validator = await buildValidator();
        const snapshot = await validator.captureSnapshot(specs);
        for (const w of snapshot.warnings) log(`[ExoSync parity] ${w}`);
        return snapshot;
      } catch (err) {
        log(
          `[ExoSync parity] pre-sync snapshot failed (conservation coverage lost this round): ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      }
    },
    runAfterSync: (specs, syncResults, snapshot) =>
      runRound(specs, "post-sync", syncResults, snapshot),
    runStandalone: (specs) => runRound(specs, "standalone"),
  };
}
