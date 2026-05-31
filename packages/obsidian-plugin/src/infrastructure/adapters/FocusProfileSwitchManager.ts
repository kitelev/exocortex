import type { App } from "obsidian";

import { PluginLockManager } from "./PluginLockManager";

/**
 * FocusProfileSwitchManager — coordinates profile switching:
 *   1. acquire persistent lock (B.6)
 *   2. write journal entry «starting»
 *   3. compute effective ontology set (с TS-floor per Vision Lock #17)
 *   4. persist `settings.activeProfileUid` BEFORE filesystem changes (Architect #2)
 *   5. trigger RDF re-index with new filter
 *   6. clear in-progress flag
 *   7. write journal entry «completed»
 *
 * v3 backward-compat scope: NO destroy/pull (Phase C+D deferred). Only RDF
 * graph filter update via re-index. Filesystem state untouched.
 *
 * Recovery: at plugin load, call `recoverIfNeeded()`. If last journal entry
 * shows incomplete switch + `_switchInProgress=true`, idempotently re-trigger
 * the re-index (no destructive rollback needed in v3 — re-index is pure).
 *
 * Per RFC 0a0791c1 §B.4 + Vision Lock #17 + Architect #2.
 */

export const FOCUS_PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/**
 * TS-floor (Vision Lock #17): ontology URIs that are ALWAYS in the effective
 * set, regardless of profile config. Hardcoded — never destroyable.
 * Prevents plugin self-brick если user accidentally removes $exo from a profile.
 */
export const TS_FLOOR_ONTOLOGY_URIS: ReadonlySet<string> = new Set([
  "https://exocortex.my/ontology/exo",
  "https://exocortex.my/ontology/exocmd",
]);

/**
 * Pattern для detecting "shared identities"-style ontologies. Ontology URIs
 * containing `shared-identities` или `shared-` prefix are auto-included
 * in the floor (R15 mitigation — `discoverSharedOntologies`).
 */
export const TS_FLOOR_SHARED_PATTERN = /(?:^|\/)shared-/;

export interface ProfileResolution {
  /** Profile UID. */
  uid: string;
  /** Directly declared `_includes` (ontology URIs). */
  includes: string[];
  /** Parent profile UID (resolves transitive). May be null/undefined. */
  extends?: string | null;
  /** Directly declared `_alwaysOnOverlay` (ontology URIs). */
  alwaysOnOverlay: string[];
  /** Display label (used in user-facing Notice). */
  label?: string;
}

/**
 * Resolves a FocusProfile asset by UID. Production implementation reads via
 * Obsidian metadataCache + vault.adapter; tests provide an in-memory map.
 */
export interface IProfileResolver {
  resolve(profileUid: string): Promise<ProfileResolution | null>;
  /**
   * Optional discovery hook — returns ALL ontology URIs matching the shared
   * identities pattern. Production scans vault triples; tests can return [].
   */
  discoverSharedOntologies(): Promise<string[]>;
}

export interface IRdfIndexer {
  /**
   * Re-index the RDF graph filtering by the given effective ontology set.
   * Implementations (NoteToRDFConverter) skip files whose AssetSpace's
   * ontology is not in `effectiveOntologies`.
   */
  refresh(effectiveOntologies: ReadonlySet<string>): Promise<void>;
}

export interface SwitchSettings {
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

export interface ISettingsStore {
  load(): Promise<SwitchSettings>;
  save(s: SwitchSettings): Promise<void>;
}

export interface SwitchJournalEntry {
  phase: "starting" | "completed" | "failed";
  targetUid: string;
  ts: string; // ISO
  elapsedMs?: number;
  error?: string;
}

export interface FocusProfileSwitchManagerOptions {
  app: App;
  lockMgr: PluginLockManager;
  resolver: IProfileResolver;
  rdfIndexer: IRdfIndexer;
  settingsStore: ISettingsStore;
  /** Journal path relative to vault root. Default `.exocortex/switch-journal.jsonl`. */
  journalPath?: string;
  /** Max `_extends` depth — guards against cycles. Default 5 (per RFC b6ba5595 validation). */
  maxExtendsDepth?: number;
  /** Injectable Date.now для deterministic tests. */
  now?: () => Date;
  /** User-facing notifier (typically `new Notice()`). */
  notify?: (message: string) => void;
}

const DEFAULT_JOURNAL_PATH = ".exocortex/switch-journal.jsonl";
const DEFAULT_MAX_EXTENDS_DEPTH = 5;

export class FocusProfileSwitchManager {
  private readonly app: App;
  private readonly lockMgr: PluginLockManager;
  private readonly resolver: IProfileResolver;
  private readonly rdfIndexer: IRdfIndexer;
  private readonly settingsStore: ISettingsStore;
  private readonly journalPath: string;
  private readonly maxExtendsDepth: number;
  private readonly now: () => Date;
  private readonly notify: (message: string) => void;

  constructor(options: FocusProfileSwitchManagerOptions) {
    this.app = options.app;
    this.lockMgr = options.lockMgr;
    this.resolver = options.resolver;
    this.rdfIndexer = options.rdfIndexer;
    this.settingsStore = options.settingsStore;
    this.journalPath = options.journalPath ?? DEFAULT_JOURNAL_PATH;
    this.maxExtendsDepth = options.maxExtendsDepth ?? DEFAULT_MAX_EXTENDS_DEPTH;
    this.now = options.now ?? (() => new Date());
    this.notify = options.notify ?? (() => undefined);
  }

  /**
   * Switch active focus profile. Lock-guarded, journaled. Idempotent re-index
   * on failure (no destructive rollback in v3).
   */
  async switchProfile(targetProfileUid: string): Promise<void> {
    const acquired = await this.lockMgr.acquireLock(`switch-profile-${targetProfileUid}`);
    if (!acquired) {
      throw new Error(`Another switch is in progress (lock held). Try again shortly.`);
    }

    const startedAt = this.now().getTime();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    try {
      await this.appendJournal({
        phase: "starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });

      heartbeatTimer = setInterval(() => {
        // Best-effort heartbeat — swallow errors, lock manager logs them.
        void this.lockMgr.heartbeat();
      }, 30_000);

      // Resolve effective set ONCE before any settings mutation
      const effective = await this.resolveEffectiveSet(targetProfileUid);

      // Persist BEFORE filesystem changes (Architect #2 — atomicity invariant)
      const settings = await this.settingsStore.load();
      settings.activeProfileUid = targetProfileUid;
      settings._switchInProgress = true;
      await this.settingsStore.save(settings);

      // Trigger RDF re-index
      await this.rdfIndexer.refresh(effective);

      // Clear in-progress flag
      settings._switchInProgress = false;
      await this.settingsStore.save(settings);

      const elapsedMs = this.now().getTime() - startedAt;
      await this.appendJournal({
        phase: "completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs,
      });

      const profileLabel = await this.profileLabel(targetProfileUid);
      this.notify(`Switched to ${profileLabel} (${elapsedMs}ms)`);
    } catch (e) {
      await this.appendJournal({
        phase: "failed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        error: this.redactError(String(e)),
      });
      throw e;
    } finally {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      await this.lockMgr.releaseLock();
    }
  }

  /**
   * Plugin-load recovery: if last journal entry shows an incomplete switch
   * AND settings._switchInProgress=true, re-trigger the re-index идempotently.
   *
   * In v3 backward-compat mode: re-index is pure (no filesystem state to roll
   * back), so we simply call switchProfile again — it's safe.
   *
   * In Phase C+D future: this would need full two-phase rollback (restore
   * staging dir, undo destroy). Deferred.
   */
  async recoverIfNeeded(): Promise<{ recovered: boolean; targetUid: string | null }> {
    const lastEntry = await this.readLastJournalEntry();
    const settings = await this.settingsStore.load();

    if (!lastEntry) return { recovered: false, targetUid: null };
    if (lastEntry.phase === "completed") return { recovered: false, targetUid: null };
    if (!settings._switchInProgress) return { recovered: false, targetUid: null };

    // Incomplete: re-trigger
    this.notify(`Recovering incomplete switch to ${lastEntry.targetUid}...`);
    await this.switchProfile(lastEntry.targetUid);
    return { recovered: true, targetUid: lastEntry.targetUid };
  }

  /**
   * Compute the effective ontology URI set for a given profile.
   *
   * = derived(profile) ∪ TS_FLOOR ∪ discoveredSharedOntologies
   *
   * Where derived = includes ∪ extends*[alwaysOnOverlay] ∪ includes (transitive).
   *
   * TS-floor (Vision Lock #17) — hardcoded `[$exo, $exocmd]` + pattern match
   * для shared-identities — guarantees the plugin keeps functioning regardless
   * of profile config.
   */
  async resolveEffectiveSet(profileUid: string): Promise<Set<string>> {
    const derived = await this.computeDerivedSet(profileUid);
    const sharedDiscovered = await this.resolver.discoverSharedOntologies();
    const result = new Set<string>();
    for (const u of derived) result.add(u);
    for (const u of TS_FLOOR_ONTOLOGY_URIS) result.add(u);
    for (const u of sharedDiscovered) {
      if (TS_FLOOR_SHARED_PATTERN.test(u)) result.add(u);
    }
    return result;
  }

  /**
   * Compute derived ontology set without TS-floor — useful для tests verifying
   * inheritance walk separately from floor enforcement.
   */
  async computeDerivedSet(profileUid: string): Promise<Set<string>> {
    const visited = new Set<string>();
    const result = new Set<string>();
    await this.walkProfileChain(profileUid, visited, result, 0);
    return result;
  }

  // === Helpers ===

  private async walkProfileChain(
    uid: string,
    visited: Set<string>,
    result: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth > this.maxExtendsDepth) {
      throw new Error(
        `FocusProfile chain exceeds max depth ${this.maxExtendsDepth} at ${uid} — possible cycle`,
      );
    }
    if (visited.has(uid)) return; // cycle guard
    visited.add(uid);

    const profile = await this.resolver.resolve(uid);
    if (profile === null) return; // tolerate missing parent — leaf

    for (const u of profile.includes) result.add(u);
    for (const u of profile.alwaysOnOverlay) result.add(u);

    if (typeof profile.extends === "string" && profile.extends.length > 0) {
      await this.walkProfileChain(profile.extends, visited, result, depth + 1);
    }
  }

  private async appendJournal(entry: SwitchJournalEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    let existing = "";
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (exists) existing = await this.app.vault.adapter.read(this.journalPath);
    } catch {
      existing = "";
    }
    await this.app.vault.adapter.write(this.journalPath, existing + line);
  }

  private async readLastJournalEntry(): Promise<SwitchJournalEntry | null> {
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (!exists) return null;
      const text = await this.app.vault.adapter.read(this.journalPath);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]) as SwitchJournalEntry;
    } catch {
      return null;
    }
  }

  private async profileLabel(uid: string): Promise<string> {
    try {
      const p = await this.resolver.resolve(uid);
      return p?.label ?? uid.slice(0, 8);
    } catch {
      return uid.slice(0, 8);
    }
  }

  /**
   * Redact GitHub PAT shapes from error messages — defensive depth (same regex
   * as B.1 GitHubRestClient). Even though this class doesn't directly handle
   * PATs, downstream errors могут carry them through stacktrace.
   */
  private redactError(msg: string): string {
    return msg.replace(
      /(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,})/g,
      "***REDACTED***",
    );
  }
}
