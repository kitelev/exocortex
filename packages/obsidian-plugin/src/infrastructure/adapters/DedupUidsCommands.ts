/**
 * DedupUidsCommands — «Exocortex: Deduplicate uids» palette logic (#3676).
 *
 * Desktop↔Mobile Command Parity by construction: `dedup-uids` used to live ONLY
 * in the CLI (`exosync-quarantine.ts` `runDedupUids`), yet the dissonance
 * messages (#3675: SyncCommands toast + QuarantineResolverCommands empty-state)
 * point a phone user at it. This command surfaces the SAME fix in-plugin,
 * driving the platform-free core {@link findDuplicateUidGroups} /
 * {@link planDuplicateUidFix} over `vault.adapter` (no Node `fs` — iOS-capable).
 *
 * Pure logic — file enumeration (`listFiles`), persistence (`writeFile`), the
 * confirm modal (`confirm`), the uuid source (`freshUid`) and the Notice
 * (`notify`) are all injected, so the orchestration (D11 guards, report-first,
 * confirm-gate, error redaction) is unit-testable without a renderer.
 *
 * Semantics mirror the CLI `--fix` path: **report-first** (list dup-uids +
 * paths) → **confirm-gated** fix that reassigns a fresh uuid to every duplicate
 * but the first (frontmatter rewrite ONLY — the file is NEVER renamed).
 *
 * D11 exclusion (a fix WRITES): refuse to run during a sync or a profile apply,
 * and refuse re-entry while a fix is in flight. The exclusion is INTENTIONALLY
 * one-directional — unlike the quarantine resolver (which writes the
 * device-local watermark, hence the symmetric HIGH-2 guard), dedup rewrites
 * ONLY markdown frontmatter and never touches the watermark, so it need only
 * refuse to START during a sync/apply; a sync that begins while a dedup is in
 * flight sees the ordinary "file edited mid-sync" state that change-detection
 * already tolerates on the next pass.
 */

import {
  findDuplicateUidGroups,
  planDuplicateUidFix,
  type DedupUidFile,
  type DedupUidGroup,
} from "@kitelev/exocortex-core";

export interface DedupUidsCommandsDeps {
  /**
   * Enumerate the vault's markdown files as `{path, content}` — mobile-safe via
   * `app.vault.getMarkdownFiles()` + `app.vault.read()` (no Node `fs`).
   */
  listFiles: () => Promise<DedupUidFile[]>;
  /** Persist a rewritten file by path (`app.vault.modify`). */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Fresh uuid generator (injected — deterministic in tests; `crypto.randomUUID` in prod). */
  freshUid: () => string;
  /**
   * Report-first + confirm gate. Receives the duplicate-uid groups (uid +
   * paths) to render; resolves `true` to apply the fix, `false` to cancel.
   */
  confirm: (groups: DedupUidGroup[]) => Promise<boolean>;
  /** User-facing Notice (route through ObsidianNotificationService). */
  notify: (message: string) => void;
  /** D11 — a sync/pull/push in flight (SyncCommands.isBusy). */
  isSyncBusy?: () => boolean;
  /** D11 — a profile apply in flight (PluginLocalDataStore). */
  isSwitchInProgress?: () => boolean;
  /** Diagnostic sink (warnings / activity-log). Default console. */
  log?: (message: string) => void;
}

export class DedupUidsCommands {
  private readonly deps: DedupUidsCommandsDeps;
  private running = false;

  constructor(deps: DedupUidsCommandsDeps) {
    this.deps = deps;
  }

  /** «Exocortex: Deduplicate uids» palette entry point. */
  async invokeDedup(): Promise<void> {
    if (this.running) {
      this.deps.notify("Deduplicate is already running");
      return;
    }
    if (this.deps.isSyncBusy?.() === true) {
      this.deps.notify(
        "A sync is in progress — deduplicate after it finishes (D11)",
      );
      return;
    }
    if (this.deps.isSwitchInProgress?.() === true) {
      this.deps.notify(
        "A profile apply is in progress — deduplicate after it finishes (D11)",
      );
      return;
    }

    this.running = true;
    try {
      const files = await this.deps.listFiles();
      const groups = findDuplicateUidGroups(files);
      if (groups.length === 0) {
        this.deps.notify("No duplicate uids on disk ✅");
        return;
      }

      const proceed = await this.deps.confirm(groups);
      if (!proceed) {
        this.deps.notify("Deduplicate cancelled — no changes");
        return;
      }

      // Apply the SAME plan the CLI `--fix` runs — keep the first path per
      // group, reassign a fresh uuid to the rest (frontmatter rewrite only).
      const rewrites = planDuplicateUidFix(files, this.deps.freshUid);
      let fixed = 0;
      for (const r of rewrites) {
        try {
          await this.deps.writeFile(r.path, r.content);
          fixed++;
        } catch (err) {
          this.logWarn(
            `[ExoSync] dedup write ${r.path} failed: ${this.errMsg(err)}`,
          );
        }
      }
      this.deps.notify(
        `Reassigned ${fixed} duplicate uid(s) to fresh values. Run Sync to propagate.`,
      );
    } catch (err) {
      this.deps.notify(`Deduplicate failed: ${this.errMsg(err)}`);
      this.logWarn(`[ExoSync] dedup-uids threw: ${this.errMsg(err)}`);
    } finally {
      this.running = false;
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private logWarn(message: string): void {
    (this.deps.log ?? ((m: string): void => console.warn(m)))(message);
  }
}
