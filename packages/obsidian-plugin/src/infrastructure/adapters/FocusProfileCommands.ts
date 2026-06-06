/**
 * FocusProfileCommands — command-palette logic handler для RFC 0a0791c1 §B.7
 * + RFC 13da049f Phase 6.5b AC17 (dual Knowledge/Focus palette commands).
 *
 * Commands provided:
 *   1. `Exocortex: Switch focus profile` — fuzzy-picks a FocusProfile asset,
 *      invokes B.4 `FocusProfileSwitchManager.softSwitchFocusProfile` (soft —
 *      RDF query-time filter only).
 *   2. `Exocortex: Switch knowledge profile` — fuzzy-picks a KnowledgeProfile
 *      asset, invokes `FocusProfileSwitchManager.hardSwitchKnowledgeProfile`
 *      (hard — filesystem destroy + materialise).
 *   3. `Exocortex: Show current state` — Notice with the active Knowledge +
 *      Focus profile labels.
 *   4. `Exocortex: Push current assetspace` — identifies AssetSpace from
 *      active file path (B.3 `lookupAssetSpaceForPath`), invokes
 *      B.3 `AssetSpaceManager.pushAssetSpace`.
 *
 * Pure logic — does NOT depend on Obsidian Plugin / FuzzySuggestModal /
 * App.workspace runtime. Dependencies passed via constructor:
 *   - `switchMgr` (B.4)
 *   - `pushMgr` (B.3 — interface `IAssetSpacePusher`)
 *   - `profileLister` — returns available FocusProfile assets (soft picker)
 *   - `knowledgeProfileLister` — returns available KnowledgeProfile assets
 *     (hard picker, AC17). Dual-class assets appear in both lists.
 *   - `fuzzyPick` — opens picker UI, returns chosen profile or null on cancel
 *   - `getActiveFilePath` — returns active file path или null
 *   - `getActiveKnowledgeProfileUid` / `getActiveFocusProfileUid` — current
 *     active selections for the «Show current state» command (AC17)
 *   - `notify` — user-facing Notice
 *
 * Real Obsidian wiring (plugin.addCommand + FuzzySuggestModal + Notice)
 * happens в B.11 plugin entry-point integration.
 */

import type { FocusProfileSwitchManager } from "./FocusProfileSwitchManager";
import {
  HardSwitchAbortedByUser,
  TsFloorViolationError,
  UncommittedChangesAbortError,
} from "./FocusProfileSwitchManager";

/** Minimal interface — full implementation in B.3 AssetSpaceManager. */
export interface IAssetSpacePusher {
  lookupAssetSpaceForPath(folderName: string): string | null;
  pushAssetSpace(asUid: string): Promise<string>;
}

export interface FocusProfileChoice {
  uid: string;
  label: string;
  /**
   * `true` when this profile is currently active per plugin settings. The
   * picker UI surfaces this so users can see what they are switching FROM
   * without leaving the modal. Optional — `profileLister` may omit when
   * the active selection is unknown.
   */
  isActive?: boolean;
}

export interface FocusProfileCommandsDeps {
  switchMgr: FocusProfileSwitchManager;
  pushMgr: IAssetSpacePusher;
  /** Returns available FocusProfile assets (label + uid pairs) — soft picker. */
  profileLister: () => Promise<FocusProfileChoice[]>;
  /**
   * Returns available KnowledgeProfile assets — hard picker (AC17). Dual-class
   * assets (declaring both Focus + Knowledge) appear in both this list and
   * {@link profileLister}.
   */
  knowledgeProfileLister: () => Promise<FocusProfileChoice[]>;
  /**
   * Open a fuzzy picker UI. Returns the user's choice, or null if the
   * picker was cancelled. Real implementation wraps Obsidian
   * `FuzzySuggestModal`; tests provide a programmatic stub.
   */
  fuzzyPick: (
    options: FocusProfileChoice[],
    title: string,
  ) => Promise<FocusProfileChoice | null>;
  /** Returns the currently-active file path, or null if no file is open. */
  getActiveFilePath: () => string | null;
  /**
   * Returns the active Knowledge profile UID (hard switch slot), or null.
   * Used by «Show current state» (AC17).
   */
  getActiveKnowledgeProfileUid: () => string | null;
  /**
   * Returns the active Focus profile UID (soft switch slot), or null.
   * Used by «Show current state» (AC17).
   */
  getActiveFocusProfileUid: () => string | null;
  /** Show a user-facing Notice. */
  notify: (message: string) => void;
}

export class FocusProfileCommands {
  private readonly switchMgr: FocusProfileSwitchManager;
  private readonly pushMgr: IAssetSpacePusher;
  private readonly profileLister: () => Promise<FocusProfileChoice[]>;
  private readonly knowledgeProfileLister: () => Promise<FocusProfileChoice[]>;
  private readonly fuzzyPick: FocusProfileCommandsDeps["fuzzyPick"];
  private readonly getActiveFilePath: () => string | null;
  private readonly getActiveKnowledgeProfileUid: () => string | null;
  private readonly getActiveFocusProfileUid: () => string | null;
  private readonly notify: (message: string) => void;

  constructor(deps: FocusProfileCommandsDeps) {
    this.switchMgr = deps.switchMgr;
    this.pushMgr = deps.pushMgr;
    this.profileLister = deps.profileLister;
    this.knowledgeProfileLister = deps.knowledgeProfileLister;
    this.fuzzyPick = deps.fuzzyPick;
    this.getActiveFilePath = deps.getActiveFilePath;
    this.getActiveKnowledgeProfileUid = deps.getActiveKnowledgeProfileUid;
    this.getActiveFocusProfileUid = deps.getActiveFocusProfileUid;
    this.notify = deps.notify;
  }

  /**
   * Command 1 — `Exocortex: Switch focus profile`.
   *
   * Lists available profiles → fuzzy pick → invokes B.4 softSwitchFocusProfile.
   * Errors during switch surface as a Notice (redacted in lower layers).
   */
  async invokeSwitchProfile(): Promise<void> {
    let profiles: FocusProfileChoice[];
    try {
      profiles = await this.profileLister();
    } catch (e) {
      this.notify(`Could not list profiles: ${this.safeMessage(e)}`);
      return;
    }

    if (profiles.length === 0) {
      this.notify("No FocusProfile assets found in vault");
      return;
    }

    const chosen = await this.fuzzyPick(profiles, "Switch focus profile");
    if (chosen === null) return; // user cancelled

    this.notify(`Switching to ${chosen.label}…`);
    try {
      await this.switchMgr.softSwitchFocusProfile(chosen.uid);
      // softSwitchFocusProfile itself emits a success Notice; nothing more here
    } catch (e) {
      this.notify(`Switch failed: ${this.safeMessage(e)}`);
    }
  }

  /**
   * Command 2 — `Exocortex: Switch knowledge profile` (RFC 13da049f Phase 6.5b
   * AC17; supersedes the RFC 22b50a17 «Hard switch focus profile» command).
   *
   * Fuzzy-picks an `exo__Profile` asset (the mount-state picker — RFC 01a83de8
   * Phase 3 T4 collapsed the former per-class KnowledgeProfile list into the
   * single profile class), then invokes
   * `FocusProfileSwitchManager.hardSwitchKnowledgeProfile` which:
   *   1. R24 TS-floor assert (refuses targets that brick the plugin)
   *   2. Vision Lock #5 uncommitted abort (with file list)
   *   3. ModalConfirmGate (DI via switchMgr constructor)
   *   4. Phase 1 pull → Phase 2 destroy+materialize → git commit
   *
   * User-facing error mapping: TsFloorViolationError, UncommittedChangesAbortError,
   * and HardSwitchAbortedByUser get clear notices distinct from generic «Switch failed».
   */
  async invokeSwitchKnowledgeProfile(): Promise<void> {
    let profiles: FocusProfileChoice[];
    try {
      profiles = await this.knowledgeProfileLister();
    } catch (e) {
      this.notify(`Could not list profiles: ${this.safeMessage(e)}`);
      return;
    }

    if (profiles.length === 0) {
      this.notify("No profiles found in vault");
      return;
    }

    const chosen = await this.fuzzyPick(
      profiles,
      "Switch knowledge profile (filesystem destroy + materialize)",
    );
    if (chosen === null) return; // user cancelled

    this.notify(`Switching knowledge profile to ${chosen.label}…`);
    try {
      await this.switchMgr.hardSwitchKnowledgeProfile(chosen.uid);
    } catch (e) {
      if (e instanceof HardSwitchAbortedByUser) {
        this.notify("Knowledge profile switch cancelled.");
        return;
      }
      if (e instanceof TsFloorViolationError) {
        this.notify(`Knowledge profile switch refused — ${e.message}`);
        return;
      }
      if (e instanceof UncommittedChangesAbortError) {
        const total = e.affectedFiles.reduce((s, a) => s + a.files.length, 0);
        this.notify(
          `Knowledge profile switch aborted — ${total} uncommitted file(s) в ${e.affectedFiles.length} AssetSpace(s). Commit or stash first.`,
        );
        return;
      }
      this.notify(`Knowledge profile switch failed: ${this.safeMessage(e)}`);
    }
  }

  /**
   * @deprecated Use {@link invokeSwitchKnowledgeProfile}. Retained for backward
   * compatibility (RFC 13da049f Phase 6.5b AC17 — Knowledge/Focus palette split).
   * Hard switch is now surfaced as «Switch knowledge profile» and picks from
   * KnowledgeProfile assets rather than FocusProfile assets.
   */
  async invokeHardSwitchProfile(): Promise<void> {
    return this.invokeSwitchKnowledgeProfile();
  }

  /**
   * Command 3 — `Exocortex: Show current state` (RFC 13da049f Phase 6.5b AC17).
   *
   * Surfaces a Notice reporting the currently-active Knowledge profile (hard
   * switch slot) and Focus profile (soft switch slot). Labels are resolved
   * best-effort from the per-class listers; an unresolved UID falls back to the
   * raw UID, and an unset slot shows «(none)». Never throws — lister failures
   * degrade to the UID / «(unknown)».
   */
  async invokeShowCurrentState(): Promise<void> {
    const knowledgeUid = this.getActiveKnowledgeProfileUid();
    const focusUid = this.getActiveFocusProfileUid();

    const knowledgeLabel = await this.resolveLabel(
      knowledgeUid,
      this.knowledgeProfileLister,
    );
    const focusLabel = await this.resolveLabel(focusUid, this.profileLister);

    this.notify(
      `Active profiles — Knowledge: ${knowledgeLabel} · Focus: ${focusLabel}`,
    );
  }

  /**
   * Command 2 — `Exocortex: Push current assetspace` (Vision Lock #4).
   *
   * Determines the AssetSpace context от active file path, invokes
   * B.3 `pushAssetSpace`. Shows graceful Notice when active file is not
   * inside an AssetSpace folder, or no file is open.
   */
  async invokePushCurrentAssetSpace(): Promise<void> {
    const activePath = this.getActiveFilePath();
    if (activePath === null) {
      this.notify("No active file — open a note inside assetspaces/<as>/ first");
      return;
    }

    const folderName = FocusProfileCommands.extractAssetSpaceFolder(activePath);
    if (folderName === null) {
      this.notify(
        "Not in an assetspace folder (expected path under `assetspaces/<as>/`)",
      );
      return;
    }

    const asUid = this.pushMgr.lookupAssetSpaceForPath(folderName);
    if (asUid === null) {
      this.notify(
        `Folder \`${folderName}\` is not declared as an AssetSpace ABox`,
      );
      return;
    }

    this.notify(`Pushing \`${folderName}\`…`);
    try {
      const sha = await this.pushMgr.pushAssetSpace(asUid);
      if (sha === "" || sha === undefined) {
        // Empty sha indicates «no dirty files» — pushAssetSpace already
        // emitted a Notice. Avoid duplicate user message.
        return;
      }
      this.notify(`Pushed \`${folderName}\` → ${sha.slice(0, 7)}`);
    } catch (e) {
      this.notify(`Push failed: ${this.safeMessage(e)}`);
    }
  }

  // === Helpers ===

  /**
   * Extract the AssetSpace folder name from a vault-relative path.
   * Returns null if the path is not under `assetspaces/<as>/`.
   *
   * Examples:
   *   `"assetspaces/exo/foo.md"` → `"assetspaces/exo"`
   *   `"assetspaces/ems/sub/dir/bar.md"` → `"assetspaces/ems"`
   *   `"03 Knowledge/note.md"` → `null`
   *   `"assetspaces/foo.md"` → `null` (no AS subfolder)
   */
  static extractAssetSpaceFolder(path: string): string | null {
    // Normalize separators
    const normalized = path.replace(/\\/g, "/");
    const match = normalized.match(/^(assetspaces\/[^/]+)\//);
    return match === null ? null : match[1];
  }

  private safeMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
  }

  /**
   * Best-effort UID → label resolution for «Show current state». Returns
   * «(none)» when the slot is unset, the matched label when the lister has it,
   * the raw UID when unmatched, and «(unknown)» when the lister throws.
   */
  private async resolveLabel(
    uid: string | null,
    lister: () => Promise<FocusProfileChoice[]>,
  ): Promise<string> {
    if (uid === null || uid.length === 0) return "(none)";
    try {
      const choices = await lister();
      const match = choices.find((c) => c.uid === uid);
      return match !== undefined ? match.label : uid;
    } catch {
      return `${uid} (unknown)`;
    }
  }
}
