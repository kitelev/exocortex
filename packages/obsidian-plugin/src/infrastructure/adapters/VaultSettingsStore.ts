import type { App, TFile } from "obsidian";
import { normaliseExcludedFolders } from "@kitelev/exocortex-core";
import type { ILogger } from "@plugin/adapters/logging/ILogger";
import { DEFAULT_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import {
  DEFAULT_SETTINGS_FOLDER,
  NON_HOMOICONIZABLE_FIELDS,
  SETTING_CLASS_UID,
  SETTING_KEY_PROP,
  SETTING_VALUE_PROP,
  VAULT_SETTINGS_REGISTRY,
  descriptorByKeyRef,
  type VaultSettingDescriptor,
} from "@plugin/domain/settings/VaultSettingsRegistry";

/**
 * VaultSettingsStore — reads/writes `exo__Setting` vault assets
 * (onto-RFC 981b6070 Phase 5 / ExoSync Phase D, task D2).
 *
 * DEPRECATED — RFC f402002b M2.3 — the bidirectional **live-mirror** is being
 * replaced by the explicit Settings-Distribution Export/Import engine (M2.1).
 * As of M2.3 the store is a **READ-ONLY transitional watcher**: the continuous
 * UI→asset auto-write ({@link pushChangedFields}, gated by
 * {@link VaultSettingsStoreOptions.outboundWriteEnabled}, default false) is
 * disabled and logs a one-time deprecation notice; the asset→UI inbound watcher
 * + load-overlay + one-shot migrate remain. **Canonical authority = the RDF
 * asset; data.json = derived runtime cache.** UI changes are persisted to assets
 * only via «Exocortex: Export settings». The whole store is scheduled for removal
 * ≥1 release after this deprecation window (RFC §6 R2).
 *
 * Architecture: data.json stays a write-through mirror (instant boot
 * baseline + fallback for non-homoiconized keys); the vault asset is the
 * source of truth once it exists. Discovery is class-based and
 * location-independent — users may move Setting assets into a
 * materialized AssetSpace mount so ExoSync Phase A syncs them with zero
 * extra sync code.
 *
 * Concurrency discipline (advisor round-1):
 *  - All vault writes flow through ONE sequential promise chain
 *    (`writeChain`) with a per-field trailing debounce — no interleaved
 *    `processFrontMatter` calls, no per-keystroke write storms (F1/F10).
 *  - `pendingWrites` records the value each in-flight write is expected
 *    to land; `metadataCache.changed` echoes are swallowed while a
 *    pending entry exists (stale intermediate reads can NEVER roll a
 *    newer UI action back — F1). Entries expire after
 *    {@link PENDING_TTL_MS} so a failed write cannot mute remote changes
 *    forever.
 *  - `writeValue` never creates missing assets (F2): transient
 *    disappearance is normal here (ExoSync writeAtomic delete+rename
 *    window, profile-apply unmounts, Obsidian Sync lag). Creation happens
 *    only in the explicit {@link migrateMissing} route, which the caller
 *    gates on a completed full scan + `_switchInProgress === false`.
 *  - Comparisons run on canonicalized values (F4): `excludedFolders`
 *    via `normaliseExcludedFolders`, `lazyBootstrapFolders` via
 *    trim/trailing-slash — a hand-edited un-canonical asset does not
 *    cause a rewrite war; write-back happens only on real UI changes.
 *  - `lazyBootstrapFolders` applies as `union(defaults, assetValue)`
 *    WITHOUT write-back (F8) so a stale vault asset cannot shadow
 *    defaults added by future releases (anti-regression #3279).
 *
 * Deterministic identity (F7): each Setting instance has a fixed
 * `exo__Asset_uid` + basename from the registry, so two devices that
 * migrate independently produce byte-identical paths and file-level sync
 * converges instead of duplicating.
 */

const PENDING_TTL_MS = 10_000;

export interface VaultSettingsStoreOptions {
  app: App;
  logger: ILogger;
  /** Live settings accessor (post-`loadSettings` object on the plugin). */
  getSettings: () => Record<string, unknown>;
  /**
   * Snapshot of registry-field values taken right after `loadSettings()`
   * (data.json baseline). Used for cold-start dirty-field detection
   * (F12): a field the user changed between onload and the first scan is
   * pushed to the vault instead of being overlaid by a stale asset value.
   */
  baseline: Record<string, unknown>;
  /**
   * Applies a remote (vault-originated) change: mutate plugin settings,
   * run the field's side-effect hook, mirror to data.json via saveData
   * (NOT saveSettings — avoids the push-back loop).
   */
  applyRemote: (field: string, value: unknown) => Promise<void>;
  /** Trailing debounce for vault writes. Default 1000 ms; 0 in tests. */
  writeDebounceMs?: number;
  /** Folder where migrateMissing materialises assets. */
  settingsFolder?: string;
  /**
   * Continuous UI→asset auto-write (the "live-mirror" outbound half).
   * DEPRECATED — RFC f402002b M2.3 — the live-mirror is being replaced by the
   * explicit Export/Import engine. Default **false**: the store is a
   * READ-ONLY transitional watcher (asset→UI inbound + load-overlay +
   * one-shot migrate still work; UI changes are persisted to assets only via
   * «Exocortex: Export settings»). Canonical authority = the RDF asset;
   * data.json = derived runtime cache. The whole store is scheduled for
   * removal ≥1 release after this deprecation window. Pass `true` only to
   * exercise the legacy outbound path (tests / the deprecation window).
   */
  outboundWriteEnabled?: boolean;
}

interface ScanEntry {
  descriptor: VaultSettingDescriptor;
  path: string;
  /** Coerced (NOT yet merged) asset value; undefined = invalid/uncoercible. */
  assetValue: unknown;
}

export interface ScanResult {
  /** field → winning entry. */
  entries: Map<string, ScanEntry>;
  /** Registry fields with no asset found. */
  missing: VaultSettingDescriptor[];
}

interface PendingWrite {
  /** Canonical JSON of the value the in-flight write should land. */
  canonical: string;
  ts: number;
}

export class VaultSettingsStore {
  private readonly app: App;
  private readonly logger: ILogger;
  private readonly getSettings: () => Record<string, unknown>;
  private readonly baseline: Record<string, unknown>;
  private readonly applyRemote: (
    field: string,
    value: unknown,
  ) => Promise<void>;
  private readonly writeDebounceMs: number;
  private readonly settingsFolder: string;
  /** DEPRECATED — RFC f402002b M2.3 — see {@link VaultSettingsStoreOptions.outboundWriteEnabled}. */
  private readonly outboundWriteEnabled: boolean;
  /** One-shot guard so the deprecation notice is logged at most once. */
  private outboundDeprecationWarned = false;

  /** field → vault path of the winning asset. */
  private readonly knownFiles = new Map<string, string>();
  /** path → field (reverse index for O(1) watcher checks). */
  private readonly knownPaths = new Map<string, string>();
  /**
   * field → canonical JSON of the last effective value applied to (or
   * pushed from) plugin settings. Echo/diff baseline.
   */
  private readonly lastApplied = new Map<string, string>();
  private readonly pendingWrites = new Map<string, PendingWrite>();
  private readonly debounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly latestDesired = new Map<string, unknown>();
  private readonly warnedUnknownKeys = new Set<string>();
  /**
   * Fields whose vault write was skipped because the asset was missing
   * (deleted / unmounted during a profile switch). When the asset
   * resurfaces, the LOCAL value is re-pushed instead of applying the
   * asset's stale value — the user's newer intent must not be silently
   * rolled back (reviewer MEDIUM-2).
   */
  private readonly deferredPushFields = new Set<string>();
  private writeChain: Promise<void> = Promise.resolve();
  private scanned = false;

  constructor(options: VaultSettingsStoreOptions) {
    this.app = options.app;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.baseline = options.baseline;
    this.applyRemote = options.applyRemote;
    this.writeDebounceMs = options.writeDebounceMs ?? 1000;
    this.settingsFolder = options.settingsFolder ?? DEFAULT_SETTINGS_FOLDER;
    // RFC f402002b M2.3 — default read-only (no continuous UI→asset auto-write).
    this.outboundWriteEnabled = options.outboundWriteEnabled ?? false;
  }

  // ────────────────────────────────────────────────────────────────
  // Scan + overlay
  // ────────────────────────────────────────────────────────────────

  /**
   * Full class-based scan. Caller MUST invoke this only after
   * `metadataCache.on("resolved")` — earlier, unparsed files yield null
   * frontmatter and existing assets would be misread as missing (F5).
   */
  scanAll(): ScanResult {
    const entries = new Map<string, ScanEntry>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const entry = this.classify(file);
      if (!entry) continue;
      const existing = entries.get(entry.descriptor.field);
      if (existing) {
        // Deterministic winner: lexicographically smallest path (stable
        // across devices — never timestamps, device clocks lie).
        const winner = existing.path <= entry.path ? existing : entry;
        const loser = winner === existing ? entry : existing;
        this.logger.warn(
          `[VaultSettingsStore] duplicate exo__Setting for "${entry.descriptor.field}": ` +
            `keeping ${winner.path}, ignoring ${loser.path}`,
        );
        entries.set(entry.descriptor.field, winner);
        continue;
      }
      entries.set(entry.descriptor.field, entry);
    }

    this.knownFiles.clear();
    this.knownPaths.clear();
    for (const [field, entry] of entries) {
      this.knownFiles.set(field, entry.path);
      this.knownPaths.set(entry.path, field);
    }

    const missing = VAULT_SETTINGS_REGISTRY.filter(
      (d) => !entries.has(d.field),
    );
    this.scanned = true;
    return { entries, missing };
  }

  /**
   * Applies scan results to live settings:
   *  - dirty fields (changed by the user since onload, F12) are NOT
   *    overlaid — their current value is queued for a vault write;
   *  - clean fields whose effective asset value differs from settings
   *    are applied via `applyRemote`.
   *
   * Returns the fields that were overlaid (changed in settings).
   */
  async applyScan(result: ScanResult): Promise<string[]> {
    const settings = this.getSettings();
    const overlaid: string[] = [];

    for (const [field, entry] of result.entries) {
      const effective = this.toEffective(entry.descriptor, entry.assetValue);
      if (effective === undefined) {
        // Invalid/uncoercible asset value — keep data.json fallback,
        // never overwrite the asset with defaults (F8/F11).
        this.logger.warn(
          `[VaultSettingsStore] asset value for "${field}" at ${entry.path} ` +
            `is not coercible to ${entry.descriptor.datatype}; keeping data.json value`,
        );
        this.lastApplied.set(field, this.canonicalOf(field, settings[field]));
        continue;
      }
      const effectiveCanonical = this.canonicalOf(field, effective);
      const currentCanonical = this.canonicalOf(field, settings[field]);
      const baselineCanonical = this.canonicalOf(field, this.baseline[field]);
      const isDirty = currentCanonical !== baselineCanonical;

      if (isDirty) {
        if (this.outboundWriteEnabled) {
          // User acted before the scan landed — their change wins; push it.
          this.lastApplied.set(field, currentCanonical);
          if (effectiveCanonical !== currentCanonical) {
            this.queueWrite(field, settings[field]);
          }
        } else {
          // Read-only transitional (M2.3): no outbound write. The user's
          // pre-scan UI value is kept (not overlaid), but the canonical asset
          // value is what the inbound watcher dedups against — so lastApplied
          // tracks the ASSET, not the un-persisted UI value (a later real
          // asset change still applies; an un-Exported UI change is not durable
          // — RFC §6 R2, canonical = RDF).
          this.lastApplied.set(field, effectiveCanonical);
        }
        continue;
      }

      if (effectiveCanonical !== currentCanonical) {
        await this.applyRemote(field, effective);
        overlaid.push(field);
      }
      this.lastApplied.set(field, effectiveCanonical);
    }

    // Fields with no asset: fallback to data.json (current value), which
    // becomes the diff baseline so a later UI change is still detected.
    for (const d of result.missing) {
      this.lastApplied.set(
        d.field,
        this.canonicalOf(d.field, settings[d.field]),
      );
    }
    return overlaid;
  }

  // ────────────────────────────────────────────────────────────────
  // Migration (one-shot, idempotent)
  // ────────────────────────────────────────────────────────────────

  /**
   * Creates assets for registry fields that have none, seeding each with
   * the CURRENT settings value (data.json). Idempotent: per-key
   * skip-existing; deterministic uid/basename means a re-run — or an
   * independent run on another device — converges on the same file.
   *
   * Caller gates: full scan completed + `_switchInProgress === false`.
   */
  async migrateMissing(): Promise<string[]> {
    if (!this.scanned) {
      throw new Error(
        "VaultSettingsStore.migrateMissing: scanAll() must run first",
      );
    }
    const settings = this.getSettings();
    const created: string[] = [];

    for (const d of VAULT_SETTINGS_REGISTRY) {
      if (this.knownFiles.has(d.field)) continue;
      const path = `${this.settingsFolder}/${d.settingUid}.md`;

      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) {
        // File exists but didn't classify in scan (e.g. Obsidian Sync
        // delivered it mid-session) — adopt, don't duplicate.
        this.register(d.field, path);
        continue;
      }

      try {
        await this.ensureFolder();
        await this.app.vault.create(
          path,
          this.renderAssetContent(d, settings[d.field]),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(msg)) {
          // Sync race — another writer materialised it first. Adopt.
          this.register(d.field, path);
          continue;
        }
        this.logger.warn(
          `[VaultSettingsStore] failed to create setting asset ${path}: ${msg}`,
        );
        continue;
      }
      this.register(d.field, path);
      this.lastApplied.set(
        d.field,
        this.canonicalOf(d.field, settings[d.field]),
      );
      created.push(d.field);
    }
    return created;
  }

  // ────────────────────────────────────────────────────────────────
  // UI → vault push
  // ────────────────────────────────────────────────────────────────

  /**
   * Called from the `saveSettings()` funnel: diffs registry fields
   * against the last applied/pushed value and queues vault writes for
   * the changed ones. Cheap no-op when nothing relevant changed.
   *
   * DEPRECATED — RFC f402002b M2.3 — the continuous UI→asset auto-write (the
   * "live-mirror" outbound half) is deprecated in favour of the explicit
   * «Exocortex: Export settings» command. When {@link outboundWriteEnabled}
   * is false (the default), this is a no-op that logs a one-time deprecation
   * notice — the watcher stays READ-ONLY (asset→UI still works) and the RDF
   * asset is the canonical authority. Scheduled for removal ≥1 release on.
   */
  pushChangedFields(): void {
    if (!this.outboundWriteEnabled) {
      // Read-only transitional (M2.3): never write assets from UI changes.
      // lastApplied is left untouched (it tracks the canonical asset value via
      // applyScan / the inbound watcher) so inbound dedup stays consistent.
      if (!this.outboundDeprecationWarned) {
        this.outboundDeprecationWarned = true;
        this.logger.warn(
          "[VaultSettingsStore] live-mirror UI→asset auto-write is deprecated " +
            "(RFC f402002b M2.3, read-only transitional). Use «Exocortex: Export " +
            "settings» to persist settings to assets; the asset→UI watcher remains " +
            "read-only and the RDF asset is canonical. This store is scheduled for " +
            "removal ≥1 release after the deprecation window.",
        );
      }
      return;
    }
    if (!this.scanned) return; // pre-scan changes handled as dirty fields
    const settings = this.getSettings();
    for (const d of VAULT_SETTINGS_REGISTRY) {
      const canonical = this.canonicalOf(d.field, settings[d.field]);
      if (this.lastApplied.get(d.field) === canonical) continue;
      this.lastApplied.set(d.field, canonical);
      this.queueWrite(d.field, settings[d.field]);
    }
  }

  /** Trailing-debounced, sequential vault write (F1/F10). */
  private queueWrite(field: string, value: unknown): void {
    this.latestDesired.set(field, value);
    const timer = this.debounceTimers.get(field);
    if (timer) clearTimeout(timer);
    this.debounceTimers.set(
      field,
      setTimeout(() => {
        this.debounceTimers.delete(field);
        const desired = this.latestDesired.get(field);
        this.latestDesired.delete(field);
        this.writeChain = this.writeChain
          .then(() => this.writeValue(field, desired))
          .catch((err) => {
            this.logger.warn(
              `[VaultSettingsStore] vault write for "${field}" failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            this.pendingWrites.delete(field);
          });
      }, this.writeDebounceMs),
    );
  }

  /** Awaitable settling point for tests and orderly shutdown. */
  async flushWrites(): Promise<void> {
    // Fire any armed debounce timers immediately.
    for (const [field, timer] of this.debounceTimers) {
      clearTimeout(timer);
      this.debounceTimers.delete(field);
      const desired = this.latestDesired.get(field);
      this.latestDesired.delete(field);
      this.writeChain = this.writeChain
        .then(() => this.writeValue(field, desired))
        .catch((err) => {
          this.logger.warn(
            `[VaultSettingsStore] vault write for "${field}" failed during flush: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          this.pendingWrites.delete(field);
        });
    }
    await this.writeChain;
  }

  private async writeValue(field: string, value: unknown): Promise<void> {
    const path = this.knownFiles.get(field);
    if (!path) {
      // No asset (not yet migrated / unmounted / deleted): data.json
      // mirror already holds the value — never auto-create here (F2).
      // Remember the field so the local value wins when the asset
      // resurfaces (MEDIUM-2).
      this.deferredPushFields.add(field);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !this.isTFile(file)) {
      // Transient disappearance (ExoSync atomic-write window, profile
      // apply, Sync lag) — mirror-only, asset will resurface (F2).
      this.deferredPushFields.add(field);
      return;
    }
    const descriptor = VAULT_SETTINGS_REGISTRY.find((d) => d.field === field);
    if (!descriptor) return;
    // The local value is about to land — any earlier deferral is moot
    // (advisor round-2 #1: a stale deferred flag could otherwise clobber
    // a later genuine remote change once).
    this.deferredPushFields.delete(field);
    const assetValue = this.toAssetValue(descriptor, value);
    this.pendingWrites.set(field, {
      canonical: this.canonicalOf(field, assetValue),
      ts: Date.now(),
    });
    await this.app.fileManager.processFrontMatter(
      file,
      (fm: Record<string, unknown>) => {
        fm[SETTING_VALUE_PROP] = assetValue;
        fm["exo__Asset_updatedAt"] = this.localTimestamp();
      },
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Watcher handlers (registered by the plugin)
  // ────────────────────────────────────────────────────────────────

  /**
   * `metadataCache.on("changed")` handler. O(1) for non-setting files
   * (F15). Applies remote changes; swallows echoes of own writes (F1).
   */
  async onMetadataChanged(file: TFile): Promise<void> {
    if (!this.scanned) return;
    let field = this.knownPaths.get(file.path);
    let entry: ScanEntry | null = null;

    if (field === undefined) {
      // New file might be a setting asset (Sync delivery, user move).
      entry = this.classify(file);
      if (!entry) return;
      field = entry.descriptor.field;
      const existingPath = this.knownFiles.get(field);
      if (existingPath && existingPath !== file.path) {
        const winner = existingPath <= file.path ? existingPath : file.path;
        if (winner === existingPath) return; // incoming file loses dedup
        // Incoming file wins — evict the loser from the reverse index
        // so its future changed-events cannot keep feeding the field
        // (reviewer MEDIUM-1: two live sources → cross-device
        // ping-pong).
        this.knownPaths.delete(existingPath);
      }
      this.register(field, file.path);
    } else {
      entry = this.classify(file);
      if (!entry) {
        // Frontmatter became unparseable / key removed — treat as
        // transient damage, keep current settings value (F11).
        return;
      }
      if (entry.descriptor.field !== field) {
        // Key was re-pointed to another setting — re-register.
        this.unregisterPath(file.path);
        this.register(entry.descriptor.field, file.path);
        field = entry.descriptor.field;
      }
      if (this.knownFiles.get(field) !== file.path) {
        // Stale reverse-index entry (this path lost a dedup since) —
        // never apply a non-winner file (reviewer MEDIUM-1 guard).
        this.knownPaths.delete(file.path);
        return;
      }
    }

    const descriptor = entry.descriptor;
    const effective = this.toEffective(descriptor, entry.assetValue);
    if (effective === undefined) return;
    const effectiveCanonical = this.canonicalOf(field, effective);
    const assetCanonical = this.canonicalOf(field, entry.assetValue);

    const pending = this.pendingWrites.get(field);
    if (pending) {
      if (
        pending.canonical === assetCanonical ||
        pending.canonical === effectiveCanonical
      ) {
        this.pendingWrites.delete(field); // own echo landed
        return;
      }
      if (Date.now() - pending.ts < PENDING_TTL_MS) {
        // A newer write is still in flight — never let a stale
        // intermediate state roll the user's action back (F1).
        return;
      }
      this.pendingWrites.delete(field); // expired (failed write)
    }

    const settings = this.getSettings();
    const currentCanonical = this.canonicalOf(field, settings[field]);

    if (this.deferredPushFields.has(field)) {
      // The asset resurfaced after a write was skipped while it was
      // missing — the LOCAL value is newer than whatever the asset
      // carries; re-push it instead of rolling the user back
      // (MEDIUM-2).
      this.deferredPushFields.delete(field);
      if (effectiveCanonical !== currentCanonical) {
        this.logger.info(
          `[VaultSettingsStore] re-pushing local value for "${field}" — ` +
            "its asset resurfaced with a stale value",
        );
        this.lastApplied.set(field, currentCanonical);
        this.queueWrite(field, settings[field]);
        return;
      }
      // Values agree — fall through to the normal bookkeeping below.
    }

    if (effectiveCanonical === currentCanonical) {
      this.lastApplied.set(field, effectiveCanonical);
      return;
    }
    this.lastApplied.set(field, effectiveCanonical);
    await this.applyRemote(field, effective);
  }

  /** `vault.on("delete")` handler — value persists via data.json mirror. */
  onFileDeleted(path: string): void {
    this.unregisterPath(path);
  }

  /** `vault.on("rename")` handler — keep tracking relocated assets. */
  onFileRenamed(file: TFile, oldPath: string): void {
    const field = this.knownPaths.get(oldPath);
    if (field === undefined) return;
    this.knownPaths.delete(oldPath);
    this.register(field, file.path);
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  private classify(file: TFile): ScanEntry | null {
    if (!file.path.endsWith(".md")) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    if (!fm) return null;
    if (!this.hasSettingClass(fm["exo__Instance_class"])) return null;
    const descriptor = descriptorByKeyRef(fm[SETTING_KEY_PROP]);
    if (!descriptor) {
      const rawKey = String(fm[SETTING_KEY_PROP] ?? "<missing>");
      if (!this.warnedUnknownKeys.has(rawKey)) {
        this.warnedUnknownKeys.add(rawKey);
        this.logger.warn(
          `[VaultSettingsStore] exo__Setting at ${file.path} references ` +
            `unknown key ${rawKey} — ignored (newer plugin version may know it)`,
        );
      }
      return null;
    }
    return {
      descriptor,
      path: file.path,
      assetValue: this.coerce(descriptor, fm[SETTING_VALUE_PROP]),
    };
  }

  private hasSettingClass(raw: unknown): boolean {
    const refs = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
    return refs.some(
      (r) =>
        typeof r === "string" &&
        (r.includes(SETTING_CLASS_UID) || /\[\[\s*exo__Setting\s*(\||\]\])/.test(r)),
    );
  }

  /** Tolerant datatype coercion (F9). Returns undefined when impossible. */
  private coerce(d: VaultSettingDescriptor, raw: unknown): unknown {
    switch (d.datatype) {
      case "boolean": {
        if (typeof raw === "boolean") return raw;
        if (typeof raw === "string") {
          const s = raw.trim().toLowerCase();
          if (s === "true") return true;
          if (s === "false") return false;
        }
        return undefined;
      }
      case "string": {
        if (typeof raw === "string") return raw;
        if (typeof raw === "number") return String(raw);
        return undefined;
      }
      case "stringList": {
        if (Array.isArray(raw)) {
          return raw.filter((e): e is string => typeof e === "string");
        }
        if (typeof raw === "string") return [raw]; // scalar → 1-elem list
        return undefined;
      }
    }
  }

  /**
   * Asset value → effective settings value (per-field merge policy).
   *  - excludedFolders: canonical normalisation (trailing slash).
   *  - lazyBootstrapFolders: union(defaults, asset) WITHOUT write-back —
   *    anti-regression #3279 (F8).
   */
  private toEffective(
    d: VaultSettingDescriptor,
    assetValue: unknown,
  ): unknown {
    if (assetValue === undefined) return undefined;
    if (d.field === "excludedFolders") {
      return normaliseExcludedFolders(assetValue as string[]);
    }
    if (d.field === "lazyBootstrapFolders") {
      const canonical = (assetValue as string[])
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.endsWith("/") ? s : s + "/"));
      return Array.from(
        new Set([
          ...(DEFAULT_SETTINGS.lazyBootstrapFolders ?? []),
          ...canonical,
        ]),
      );
    }
    return assetValue;
  }

  /** Settings value → value persisted in the asset. */
  private toAssetValue(d: VaultSettingDescriptor, value: unknown): unknown {
    if (d.field === "excludedFolders") {
      return normaliseExcludedFolders(value as string[]);
    }
    if (
      d.field === "exosyncQuarantineRepoUrl" &&
      typeof value === "string" &&
      value.length > 0
    ) {
      // The vault asset syncs further than data.json — never let a URL
      // with embedded credentials (https://user:token@github.com/...)
      // materialise into it (reviewer LOW-2). The PAT channel proper is
      // LocalSecretsStore; this guards user misuse.
      try {
        const u = new URL(value);
        if (u.username || u.password) {
          u.username = "";
          u.password = "";
          this.logger.warn(
            "[VaultSettingsStore] stripped embedded credentials from " +
              "exosyncQuarantineRepoUrl before writing the vault asset",
          );
          return u.toString();
        }
      } catch {
        // Not a parseable URL — persist as-is; the sync engine validates
        // the URL shape on use.
      }
    }
    return value;
  }

  /**
   * Canonical JSON for comparisons: runs the field's effective
   * normalisation over already-effective values so semantically equal
   * shapes compare equal (F4).
   */
  private canonicalOf(field: string, value: unknown): string {
    const d = VAULT_SETTINGS_REGISTRY.find((x) => x.field === field);
    if (d && d.datatype === "stringList" && Array.isArray(value)) {
      const normalised =
        field === "excludedFolders"
          ? normaliseExcludedFolders(value as string[])
          : (value as string[])
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
              .map((s) => (s.endsWith("/") ? s : s + "/"));
      return JSON.stringify(normalised);
    }
    return JSON.stringify(value ?? null);
  }

  private register(field: string, path: string): void {
    this.knownFiles.set(field, path);
    this.knownPaths.set(path, field);
  }

  private unregisterPath(path: string): void {
    const field = this.knownPaths.get(path);
    if (field === undefined) return;
    this.knownPaths.delete(path);
    if (this.knownFiles.get(field) === path) {
      this.knownFiles.delete(field);
    }
  }

  private async ensureFolder(): Promise<void> {
    try {
      await this.app.vault.createFolder(this.settingsFolder);
    } catch {
      // Already exists — fine.
    }
  }

  private renderAssetContent(
    d: VaultSettingDescriptor,
    value: unknown,
  ): string {
    const ts = this.localTimestamp();
    const lines = [
      "---",
      `exo__Asset_uid: ${d.settingUid}`,
      `exo__Asset_createdAt: ${ts}`,
      "exo__Instance_class:",
      `  - "[[${SETTING_CLASS_UID}]]"`,
      `exo__Asset_label: "Setting: ${d.field}"`,
      `${SETTING_KEY_PROP}: "[[${d.keyUid}]]"`,
      ...this.renderValueYaml(d, value),
      "---",
      "",
      `User-configurable Exocortex plugin setting \`${d.field}\` ` +
        `(${d.datatype}). Managed by the plugin per onto-RFC 981b6070; ` +
        "edit the value here or via the plugin settings tab.",
      "",
    ];
    return lines.join("\n");
  }

  private renderValueYaml(
    d: VaultSettingDescriptor,
    value: unknown,
  ): string[] {
    const v = this.toAssetValue(d, value);
    switch (d.datatype) {
      case "boolean":
        return [`${SETTING_VALUE_PROP}: ${v === true ? "true" : "false"}`];
      case "string":
        return [`${SETTING_VALUE_PROP}: ${JSON.stringify(String(v ?? ""))}`];
      case "stringList": {
        const list = Array.isArray(v) ? (v as string[]) : [];
        if (list.length === 0) return [`${SETTING_VALUE_PROP}: []`];
        return [
          `${SETTING_VALUE_PROP}:`,
          ...list.map((e) => `  - ${JSON.stringify(e)}`),
        ];
      }
    }
  }

  private localTimestamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    );
  }

  private isTFile(f: unknown): f is TFile {
    return (
      !!f &&
      typeof f === "object" &&
      "path" in f &&
      typeof (f as { path: unknown }).path === "string" &&
      !("children" in f)
    );
  }
}

/**
 * Compile-time guard: the allowlist and denylist must stay disjoint.
 * (Runtime no-op; the unit test asserts the same empirically.)
 */
const _denySet = new Set(NON_HOMOICONIZABLE_FIELDS);
for (const d of VAULT_SETTINGS_REGISTRY) {
  if (_denySet.has(d.field)) {
    throw new Error(
      `VaultSettingsRegistry: field "${d.field}" is in NON_HOMOICONIZABLE_FIELDS`,
    );
  }
}
