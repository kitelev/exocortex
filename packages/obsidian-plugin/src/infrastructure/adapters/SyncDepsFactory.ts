import type { App, DataAdapter } from "obsidian";
import yaml from "js-yaml";
import {
  CONFLICT_CACHE_STORE_FILENAME,
  FileLocalManifestStore,
  FileMountBaseStore,
  FileWatermarkStore,
  GatedStructuredMerger,
  LOCAL_MANIFEST_STORE_FILENAME,
  LocalConflictCacheStore,
  LocalOutboxStore,
  MOUNT_BASE_STORE_FILENAME,
  OUTBOX_STORE_FILENAME,
  QuarantineResolver,
  SpaceSpecAccumulator,
  StructuredMerger,
  SyncEngine,
  WATERMARK_STORE_FILENAME,
  classifySpaceDeclaration,
  type LocalFilesPort,
  type MaterializationCheckPort,
  type QuarantinePort,
  type Sha1Fn,
  type SyncRepoSpec,
  type WatermarkFileIO,
  type YamlCodec,
} from "exocortex";

import { GitHubRestClient } from "./GitHubRestClient";
import { GitSubmoduleOps } from "./GitSubmoduleOps";
import { LocalSecretsStore } from "./LocalSecretsStore";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";

/**
 * SyncDepsFactory — ExoSync Phase B plugin wiring (RFC 4e4dc453).
 *
 * Composes the platform-free {@link SyncEngine} (Phase A) from Obsidian
 * primitives, with ZERO engine edits (AC#2): the only platform-specific
 * pieces are the injected ports below.
 *
 *  - transport — `GitHubRestClient.restTransport()` (Obsidian `requestUrl`,
 *    iOS-capable, no git binary). The engine wraps it in rate-limit backoff
 *    itself; only the quarantine store needs an explicit wrap.
 *  - sha1 — WebCrypto `crypto.subtle.digest("SHA-1", …)` (available in the
 *    Obsidian renderer on both desktop Electron and mobile Capacitor;
 *    injectable for test environments without WebCrypto).
 *  - watermark store — {@link FileWatermarkStore} over `vault.adapter` at
 *    `<configDir>/plugins/<id>/exosync-watermarks.local.json` (the `.local.`
 *    infix is Obsidian-Sync-excluded AND `isSyncablePath`-refused, D8).
 *  - local files — `vault.adapter` scoped to the repo's mount path
 *    (`assetspaces/<owner>/<repo>`), atomic writes (tmp + remove + rename —
 *    `DataAdapter.rename` fails on an existing target on mobile, so the
 *    target is removed first; same order as `FileLogChannel.rotateIfNeeded`).
 *  - materialization gate (D19, degraded mobile form) — the REST/tarball
 *    mount layer keeps no manifest ("mount-state visibility is folder
 *    exists", `RestAssetSpaceMount`), so the check is: folder exists, is
 *    non-empty, no profile apply in flight (`_switchInProgress`, D11
 *    composition), and no staging dir is allocated for that AssetSpace
 *    (desktop mid-pull signal). Weaker than the CLI's manifest check by
 *    construction — documented in the RFC as the mobile floor.
 *  - merge layer — `GatedStructuredMerger` over js-yaml CORE_SCHEMA
 *    (date-like scalars MUST round-trip as strings per the YamlCodec
 *    contract). The optional SHACL merge-gate is NOT wired in Phase B —
 *    plugin-side ShapeRegistry/ClassHierarchy/triplesFor composition is a
 *    follow-up; unresolvable merges still quarantine (D17).
 *  - quarantine — the device-local `LocalConflictCacheStore` (offline-resolution
 *    foundation) is the SOLE quarantine sink: it persists the 3 versions of every
 *    conflict to a `.local.` (Sync-excluded) file so the resolver works offline.
 *    The synced git-repo quarantine store was retired (offline-resolution program);
 *    the cache is durable on its own (survives restart).
 */

/** Per-repo sync branch — re-exported from the core (ExoSync E1: the
 * constant moved to `spaceSpecCore` so the CLI shares it; see its docstring
 * for the repoKey/watermark-reset caveat). */
export { SYNC_BRANCH } from "exocortex";

/** Result of {@link collectSyncRepoSpecs}. */
export interface SyncSpecCollection {
  specs: SyncRepoSpec[];
  /** AssetSpace ABox uid per repoKey — staging-dir veto input (D19). */
  asUidByRepoKey: Map<string, string>;
  /** Skipped AssetSpaces (unparseable / non-GitHub source). */
  warnings: string[];
}

/**
 * Enumerate the sync unit (VL#4/D7): every AssetSpace ABox in the vault
 * whose derived mount folder (`assetspaces/<owner>/<repo>`) currently exists
 * on disk — i.e. the MATERIALIZED set. Unmounted AssetSpaces are excluded
 * here (not via the D19 gate) so each sync run is not flooded with
 * skipped-not-materialized warnings for spaces the device never mounted.
 *
 * Only `https://github.com/<owner>/<repo>` sources participate (the same
 * allowlist as the REST mount path); other source forms are skipped with a
 * warning.
 *
 * Per-declaration classification + dedupe live in the platform-free core
 * (`classifySpaceDeclaration` / `SpaceSpecAccumulator`, ExoSync E1) shared
 * with the CLI's `exosync-parity` collector — this function only supplies
 * the Obsidian walk (metadataCache frontmatter) and the existence check.
 */
export async function collectSyncRepoSpecs(
  app: App,
): Promise<SyncSpecCollection> {
  const acc = new SpaceSpecAccumulator();

  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) continue;

    const verdict = classifySpaceDeclaration(fm, file.path);
    if (verdict.kind === "not-space") continue;
    if (verdict.warning !== undefined) acc.warnings.push(verdict.warning);
    if (verdict.kind === "skip") continue;

    const spec = acc.offer(verdict.candidate);
    if (spec === null) continue;

    let exists = false;
    try {
      exists = await app.vault.adapter.exists(spec.localPath);
    } catch {
      // adapter error → treat as not materialized (fail-closed, D19 spirit)
    }
    if (!exists) continue;

    acc.commit(verdict.candidate);
  }

  return {
    specs: acc.specs,
    asUidByRepoKey: acc.asUidByRepoKey,
    warnings: acc.warnings,
  };
}

/** Default `Sha1Fn` over WebCrypto (renderer-safe on desktop AND iOS). */
export const webCryptoSha1: Sha1Fn = async (
  bytes: Uint8Array,
): Promise<string> => {
  const digest = await crypto.subtle.digest(
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

/**
 * Atomic write over `vault.adapter`: write to a temp path, remove the
 * target if present, then rename. Target-removal-first mirrors
 * `FileLogChannel.rotateIfNeeded` — `DataAdapter.rename` onto an existing
 * path fails on mobile.
 *
 * The `.local.tmp` suffix keeps a crash-leftover temp file out of the SYNC
 * ENGINE via `isSyncablePath` (non-`.md` suffix AND `.local.` infix — both
 * refused symmetrically). Obsidian Sync's own `.local.` exclusion applies
 * to plugin-dir artifacts (data.local.json convention); inside the vault
 * proper a leftover could replicate depending on the user's file-type sync
 * settings — harmless, since it can never enter the sync cycle.
 */
async function writeAtomic(
  adapter: DataAdapter,
  path: string,
  content: string,
): Promise<void> {
  const tmp = `${path}.local.tmp`;
  await adapter.write(tmp, content);
  if (await adapter.exists(path)) {
    await adapter.remove(path);
  }
  await adapter.rename(tmp, path);
}

/** Parent directory of a vault-relative path; `""` if top-level. */
function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

async function ensureDirChain(
  adapter: DataAdapter,
  dir: string,
): Promise<void> {
  if (dir.length === 0) return;
  if (await adapter.exists(dir)) return;
  const parent = parentDir(dir);
  if (parent.length > 0) await ensureDirChain(adapter, parent);
  await adapter.mkdir(dir);
}

/**
 * `LocalFilesPort` over `vault.adapter`, scoped to one repo mount folder.
 * Paths are repo-relative forward-slash (the engine's contract); the adapter
 * joins them under `rootPath`. Writes are atomic and create parent folders
 * (a pulled remote file may live in a brand-new subfolder).
 */
export function vaultLocalFilesPort(
  adapter: DataAdapter,
  rootPath: string,
): LocalFilesPort {
  const abs = (rel: string): string => `${rootPath}/${rel}`;
  const port: LocalFilesPort = {
    async list(): Promise<string[]> {
      const out: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        const listing = await adapter.list(dir);
        for (const f of listing.files) {
          out.push(f.slice(rootPath.length + 1));
        }
        for (const sub of listing.folders) {
          await walk(sub);
        }
      };
      if (await adapter.exists(rootPath)) {
        await walk(rootPath);
      }
      return out;
    },
    async read(path: string): Promise<string> {
      return adapter.read(abs(path));
    },
    async write(path: string, content: string): Promise<void> {
      const target = abs(path);
      const parent = parentDir(target);
      if (parent.length > 0) await ensureDirChain(adapter, parent);
      await writeAtomic(adapter, target, content);
    },
    async delete(path: string): Promise<void> {
      const target = abs(path);
      if (await adapter.exists(target)) {
        await adapter.remove(target);
      }
    },
    // Phase C byte-exact pair (file-mode repos). `DataAdapter.readBinary/
    // writeBinary` speak ArrayBuffer; the engine speaks Uint8Array.
    async readBinary(path: string): Promise<Uint8Array> {
      return new Uint8Array(await adapter.readBinary(abs(path)));
    },
    async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
      const target = abs(path);
      const parent = parentDir(target);
      if (parent.length > 0) await ensureDirChain(adapter, parent);
      // Same atomic shape as writeAtomic: tmp (.local. infix — refused by
      // both syncable predicates) → remove target → rename.
      const tmp = `${target}.local.tmp`;
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await adapter.writeBinary(tmp, buf);
      if (await adapter.exists(target)) {
        await adapter.remove(target);
      }
      await adapter.rename(tmp, target);
    },
  };
  // mtime-manifest (perf): expose `stat` ONLY when the underlying adapter
  // supports it. Real Obsidian `DataAdapter.stat` is cheap metadata (no content
  // read) and works on desktop AND mobile; an adapter without it (an older
  // host, a partial test double) simply disables the optimisation — the engine
  // falls back to reading+hashing every file (status quo, zero regression),
  // never a crash.
  const rawStat = (
    adapter as {
      stat?: (
        path: string,
      ) => Promise<{ type?: string; mtime: number; size: number } | null>;
    }
  ).stat;
  if (typeof rawStat === "function") {
    port.stat = async (
      path: string,
    ): Promise<{ mtimeMs: number; size: number } | null> => {
      const s = await rawStat.call(adapter, abs(path));
      if (s === null || s === undefined || s.type !== "file") return null;
      return { mtimeMs: s.mtime, size: s.size };
    };
  }
  return port;
}

/** Single-file `WatermarkFileIO` over `vault.adapter` (D8 store). */
export function vaultWatermarkFileIO(
  adapter: DataAdapter,
  filePath: string,
): WatermarkFileIO {
  return {
    async read(): Promise<string | null> {
      if (!(await adapter.exists(filePath))) return null;
      return adapter.read(filePath);
    },
    async writeAtomic(content: string): Promise<void> {
      const parent = parentDir(filePath);
      if (parent.length > 0) await ensureDirChain(adapter, parent);
      await writeAtomic(adapter, filePath, content);
    },
  };
}

export interface MaterializationCheckOptions {
  adapter: DataAdapter;
  /** D11 composition — a profile apply in flight vetoes every repo. */
  isSwitchInProgress: () => boolean;
  /** AssetSpace uids with an allocated staging dir (desktop mid-pull). */
  getStagingAsUids: () => Promise<ReadonlySet<string>>;
  /** From {@link collectSyncRepoSpecs} — repoKey → AssetSpace ABox uid. */
  asUidByRepoKey: ReadonlyMap<string, string>;
}

/**
 * Degraded mobile D19 gate (see module docstring): folder exists + non-empty
 * + no apply in flight + no staging allocation for this AssetSpace. Deletes
 * are never inferred for a vetoed repo — the engine skips it with a warning.
 */
export function vaultMaterializationCheck(
  opts: MaterializationCheckOptions,
): MaterializationCheckPort {
  return {
    async check(spec: SyncRepoSpec) {
      if (opts.isSwitchInProgress()) {
        return {
          fullyMaterialized: false,
          reason: "profile apply in progress (D11) — sync after it finishes",
        };
      }
      const asUid = opts.asUidByRepoKey.get(spec.repoKey);
      if (asUid !== undefined) {
        try {
          const staging = await opts.getStagingAsUids();
          if (staging.has(asUid)) {
            return {
              fullyMaterialized: false,
              reason:
                "a staging dir is allocated for this AssetSpace (mid-pull)",
            };
          }
        } catch {
          // staging registry unreadable → don't veto on it (best-effort)
        }
      }
      let entries = 0;
      try {
        if (!(await opts.adapter.exists(spec.localPath))) {
          return {
            fullyMaterialized: false,
            reason: `mount folder ${spec.localPath} does not exist`,
          };
        }
        const listing = await opts.adapter.list(spec.localPath);
        entries = listing.files.length + listing.folders.length;
      } catch {
        return {
          fullyMaterialized: false,
          reason: `mount folder ${spec.localPath} is not readable`,
        };
      }
      if (entries === 0 && spec.spaceKind !== "file") {
        return {
          fullyMaterialized: false,
          reason: `mount folder ${spec.localPath} is empty (mid-mount?)`,
        };
      }
      // File-mode exception (Phase C, advisor C1): an empty FileSpace
      // folder is a legitimate first-sync state — the remote-wins
      // first-sync layer pulls everything; no delete inference can fire
      // (the synthetic base is empty, so nothing reads as locally deleted).
      return { fullyMaterialized: true };
    },
  };
}

/** js-yaml CORE_SCHEMA codec — date-like scalars round-trip as strings. */
export const coreSchemaYamlCodec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

export interface BuildSyncEngineOptions {
  app: App;
  localDataStore: PluginLocalDataStore;
  /** repoKey → AssetSpace uid map from {@link collectSyncRepoSpecs}. */
  asUidByRepoKey: ReadonlyMap<string, string>;
  /** Test seam — defaults to {@link webCryptoSha1}. */
  sha1?: Sha1Fn;
}

export interface BuiltSyncEngine {
  engine: SyncEngine;
  /** PAT resolved at build time; null ⇒ caller surfaces the R8 prompt. */
  pat: string | null;
  /**
   * #3495 — whether the engine was built with a durable quarantine sink. Now
   * ALWAYS `true`: the device-local conflict cache is wired unconditionally and
   * is itself durable (survives restart), so conflicts are never silently
   * dropped. Retained so the caller's one-shot "no sink" warning stays inert.
   */
  quarantineConfigured: boolean;
}

/**
 * Build a fresh SyncEngine from the CURRENTLY stored PAT (Issue #3382
 * fresh-credential pattern — a PAT configured after onload is honoured
 * without a reload). NOTE: the engine instance is per-invocation, so its
 * internal D11 guard does NOT span invocations — the command handler keeps
 * its own `running` flag for cross-invocation exclusion.
 */
export async function buildSyncEngine(
  opts: BuildSyncEngineOptions,
): Promise<BuiltSyncEngine> {
  const { app, localDataStore } = opts;
  const sha1 = opts.sha1 ?? webCryptoSha1;
  const secretsStore = new LocalSecretsStore({ app });
  const pat = await secretsStore.getSecret("pat");
  const client = new GitHubRestClient({ app, pat: pat ?? "" });
  const transport = client.restTransport();
  const adapter = app.vault.adapter;
  const configDir = app.vault.configDir;
  const watermarkPath = `${configDir}/plugins/exocortex/${WATERMARK_STORE_FILENAME}`;
  // #3590 — first-sync merge base, recorded at apply/mount time by
  // `RestAssetSpaceMount` under the SAME path convention (same vault.adapter,
  // same `.local.`-infix file).
  const mountBasePath = `${configDir}/plugins/exocortex/${MOUNT_BASE_STORE_FILENAME}`;
  // mtime-manifest (perf) — device-local, `.local.`-infix, same store family as
  // the watermark; skips reading+re-hashing unchanged asset files each sync
  // (the dominant iPhone cost on a 14-AS / ~6304-file vault).
  const manifestPath = `${configDir}/plugins/exocortex/${LOCAL_MANIFEST_STORE_FILENAME}`;

  // Device-local conflict cache (offline-resolution foundation) — ALWAYS wired,
  // same `.local.` (Sync-excluded) store family as the watermark. It captures
  // the 3 versions of every conflict on disk so the resolver can work offline
  // (PR-3). It is also a durable sink in its own right (survives restart), so
  // conflicts are NEVER silently dropped — the #3495 degraded-mode is gone.
  const conflictCachePath = `${configDir}/plugins/exocortex/${CONFLICT_CACHE_STORE_FILENAME}`;
  const conflictCache = new LocalConflictCacheStore({
    io: vaultWatermarkFileIO(adapter, conflictCachePath),
  });
  // Deferred-push outbox (PR-3b) — the engine flushes queued offline resolutions
  // on each non-pull sync (TOCTOU-guarded). Same `.local.` store family.
  const outboxPath = `${configDir}/plugins/exocortex/${OUTBOX_STORE_FILENAME}`;
  const outbox = new LocalOutboxStore({
    io: vaultWatermarkFileIO(adapter, outboxPath),
  });

  // The device-local conflict cache is the SOLE quarantine sink (the synced
  // git-repo quarantine store was retired — offline-resolution program). It is
  // durable on its own (survives restart) and feeds the offline resolver.
  const quarantine: QuarantinePort = conflictCache;

  // #3590 FULL fix — base BACKFILL source for AssetSpaces mounted BEFORE the
  // mount layer began recording their base (or by any path that never recorded
  // one): they have no `exosync-mountbase.local.json` entry, so the v16.98.7
  // recording fix could not fire and every first-sync false-conflicted (the
  // work-MacBook trigger). The provider returns the commit the local working
  // tree is based on — read AUTHORITATIVELY from the git submodule's checked-out
  // HEAD on desktop. On mobile (no git binary / no filesystem root → empty
  // basePath) it is simply absent: the engine keeps the conservative
  // full-conflict fallback (no regression). Same engine code path on both
  // platforms — the source degrades to null, no Platform.isMobile branch. The
  // engine verifies the SHA is a genuine ancestor before trusting it (M1-safe).
  let localBaseShaProvider:
    | ((spec: SyncRepoSpec) => Promise<string | null>)
    | undefined;
  const vaultRootPath =
    (adapter as unknown as { basePath?: string }).basePath ?? "";
  if (vaultRootPath.length > 0) {
    try {
      const gitOps = new GitSubmoduleOps({ vaultRootPath });
      localBaseShaProvider = (spec) => gitOps.submoduleHeadSha(spec.localPath);
    } catch {
      // git/node primitives unavailable → no backfill source (conservative).
      localBaseShaProvider = undefined;
    }
  }

  const engine = new SyncEngine({
    transport,
    watermarkStore: new FileWatermarkStore(
      vaultWatermarkFileIO(adapter, watermarkPath),
    ),
    // mtime-manifest local-hash skip (perf) — same vault.adapter IO/store
    // family as the watermark. The port's `stat` (added above) gates it.
    localManifestStore: new FileLocalManifestStore(
      vaultWatermarkFileIO(adapter, manifestPath),
    ),
    mountBaseStore: new FileMountBaseStore(
      vaultWatermarkFileIO(adapter, mountBasePath),
    ),
    ...(localBaseShaProvider !== undefined ? { localBaseShaProvider } : {}),
    materializationCheck: vaultMaterializationCheck({
      adapter,
      isSwitchInProgress: () => localDataStore.isSwitchInProgress(),
      getStagingAsUids: async () => {
        const entries = await localDataStore.readActiveStagingDirs();
        return new Set(entries.map((e) => e.asUid));
      },
      asUidByRepoKey: opts.asUidByRepoKey,
    }),
    localFilesFor: (spec) => vaultLocalFilesPort(adapter, spec.localPath),
    sha1,
    redact: (m) => GitHubRestClient.redactTokens(m),
    // SHACL merge-gate deferred (follow-up): GatedStructuredMerger without
    // a gate still quarantines unresolvable merges (D17).
    mergeLayer: new GatedStructuredMerger(
      new StructuredMerger(coreSchemaYamlCodec),
    ),
    quarantine,
    outbox,
  });

  // A durable quarantine sink is now ALWAYS present (the device-local conflict
  // cache) — conflicts are always saved, so the #3495 "no sink" warning is moot.
  return { engine, pat, quarantineConfigured: true };
}

export interface BuildQuarantineResolverOptions {
  app: App;
  sha1?: Sha1Fn;
}

export interface BuiltQuarantineResolver {
  resolver: QuarantineResolver;
  /** PAT resolved at build time; null ⇒ caller surfaces the R8 prompt. */
  pat: string | null;
}

/**
 * Build a fresh {@link QuarantineResolver} from the CURRENTLY stored PAT
 * (Issue #3382 fresh-credential pattern). The resolver reads the AssetSpace
 * head + commits resolutions over the SAME `restCommit` transport the engine
 * uses, and reads/writes the SAME device-local watermark
 * (`exosync-watermarks.local.json`) — so a resolution the plugin applies is the
 * exact base a subsequent CLI sync sees.
 */
export async function buildQuarantineResolver(
  opts: BuildQuarantineResolverOptions,
): Promise<BuiltQuarantineResolver> {
  const { app } = opts;
  const sha1 = opts.sha1 ?? webCryptoSha1;
  const secretsStore = new LocalSecretsStore({ app });
  const pat = await secretsStore.getSecret("pat");
  const client = new GitHubRestClient({ app, pat: pat ?? "" });
  const transport = client.restTransport();
  const adapter = app.vault.adapter;
  const configDir = app.vault.configDir;
  const watermarkPath = `${configDir}/plugins/exocortex/${WATERMARK_STORE_FILENAME}`;
  // Device-local conflict cache (PR-2) — the resolver's OFFLINE source for a
  // conflict's remote+base versions (same `.local.` store the engine writes).
  const conflictCachePath = `${configDir}/plugins/exocortex/${CONFLICT_CACHE_STORE_FILENAME}`;
  const conflictCache = new LocalConflictCacheStore({
    io: vaultWatermarkFileIO(adapter, conflictCachePath),
  });
  // Deferred-push outbox (PR-3b) — resolve() queues offline resolutions here;
  // the engine flushes them on the next sync.
  const outboxPath = `${configDir}/plugins/exocortex/${OUTBOX_STORE_FILENAME}`;
  const outbox = new LocalOutboxStore({
    io: vaultWatermarkFileIO(adapter, outboxPath),
  });

  const resolver = new QuarantineResolver({
    transport,
    watermarkStore: new FileWatermarkStore(
      vaultWatermarkFileIO(adapter, watermarkPath),
    ),
    localFilesFor: (spec) => vaultLocalFilesPort(adapter, spec.localPath),
    sha1,
    redact: (m) => GitHubRestClient.redactTokens(m),
    conflictCache,
    outbox,
  });
  return { resolver, pat };
}
