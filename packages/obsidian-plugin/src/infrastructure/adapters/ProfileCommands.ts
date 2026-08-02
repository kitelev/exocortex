/**
 * ProfileCommands — command-palette logic handler для RFC 0a0791c1.
 *
 * RFC 0a0791c1 Phase 5 T2 consolidated the former dual «Switch focus profile»
 * (soft RDF filter) + «Switch knowledge profile» (mount-state) commands into a
 * single «Apply profile» mount-state operation. The soft path was removed.
 *
 * Commands provided:
 *   1. `Exocortex: Apply profile` — fuzzy-picks an `exo__Profile` asset,
 *      invokes `ProfileApplyManager.applyProfile` (the
 *      mount-state strict-replace: materialise the profile's effective
 *      AssetSpace set, unmount the rest — TS-floor never unmounted).
 *   2. `Exocortex: Show current state` — Notice with the active profile label.
 *   3. `Exocortex: Push current assetspace` — identifies AssetSpace from
 *      active file path (B.3 `lookupAssetSpaceForPath`), invokes
 *      B.3 `AssetSpaceManager.pushAssetSpace`.
 *
 * Pure logic — does NOT depend on Obsidian Plugin / FuzzySuggestModal /
 * App.workspace runtime. Dependencies passed via constructor:
 *   - `switchMgr` (B.4)
 *   - `pushMgr` (B.3 — interface `IAssetSpacePusher`)
 *   - `profileLister` — returns available `exo__Profile` assets (the picker)
 *   - `fuzzyPick` — opens picker UI, returns chosen profile or null on cancel
 *   - `getActiveFilePath` — returns active file path или null
 *   - `getActiveProfileUid` — last-applied profile for «Show current state»
 *   - `notify` — user-facing Notice
 *
 * Real Obsidian wiring (plugin.addCommand + FuzzySuggestModal + Notice)
 * happens в B.11 plugin entry-point integration.
 */

import { isAuthError } from "@kitelev/exocortex-core";

import { orderProfilesForQuickSwitch } from "../../domain/profile/quickSwitch";
import type { ProfileApplyManager } from "./ProfileApplyManager";
import {
  ApplyAbortedByUser,
  NoPreviousProfileError,
  TsFloorViolationError,
  UncommittedChangesAbortError,
} from "./ProfileApplyManager";

/** Minimal interface — full implementation in B.3 AssetSpaceManager. */
export interface IAssetSpacePusher {
  lookupAssetSpaceForPath(folderName: string): string | null;
  pushAssetSpace(asUid: string): Promise<string>;
}

/**
 * Sentinel UID for the synthetic «Show all profiles…» picker entry. The
 * default picker view is scoped to locally-relevant profiles (RFC 0002 §3.4
 * P7b); when some profiles are hidden, this entry is appended so the user can
 * broaden the list to every profile. Selecting it re-opens the picker
 * unscoped — it is NEVER passed to `applyProfile`.
 */
export const SHOW_ALL_PROFILES_UID = "__exocortex_show_all_profiles__";

export interface ProfileChoice {
  uid: string;
  label: string;
  /**
   * `true` when this profile is currently active per plugin settings. The
   * picker UI surfaces this so users can see what they are switching FROM
   * without leaving the modal. Optional — `profileLister` may omit when
   * the active selection is unknown.
   */
  isActive?: boolean;
  /**
   * One-line, human-readable description of what the profile mounts / who it
   * is for (RFC 0002 §3.4 P7). Sourced from the `exo__Profile_description`
   * RDF property in the vault (Homoiconicity invariant — descriptions live in
   * RDF, never hardcoded in TS). Optional — absent when the asset omits it.
   */
  description?: string;
  /**
   * `true` when the profile carries `exo__Profile_recommended: true` (RDF) —
   * the picker decorates it with a «recommended for new users» badge
   * (RFC 0002 §3.4 P7, the `starter` profile). RDF-driven, NOT a hardcoded
   * label match, so any profile can be marked recommended without a code
   * change (Homoiconicity invariant).
   */
  isRecommended?: boolean;
  /**
   * Whether this profile is relevant to the current vault — i.e. all of its
   * `exo__Profile_includes` AssetSpaces resolve to assets present on disk
   * (RFC 0002 §3.4 P7b). The picker shows locally-relevant profiles by
   * default and hides the rest behind «Show all profiles», so a tester is not
   * choosing among other testers' profiles (`$$levina-tbank` …). `undefined`
   * / `true` ⇒ shown by default; `false` ⇒ hidden behind the expander.
   */
  isLocallyRelevant?: boolean;
  /**
   * Internal sentinel kind. `"show-all"` marks the synthetic «Show all
   * profiles…» entry (see {@link SHOW_ALL_PROFILES_UID}); absent for real
   * profiles. Selecting a `"show-all"` entry re-opens the picker unscoped
   * rather than applying anything.
   */
  kind?: "show-all";
  /**
   * req 6171f443 — one muted line stating what mounting this row COSTS, in
   * files, measured over the transitive `exo__AssetSpace_dependsOn` closure
   * (see `domain/profile/indexCost.ts` for why the closure and not the
   * AssetSpace's own size). Runtime-derived from `vault.adapter`, never
   * persisted. Absent ⇒ nothing is rendered and the row is byte-identical to
   * the pre-feature behaviour — that is the zero-regression guarantee.
   */
  indexCost?: string;
}

export interface ProfileCommandsDeps {
  switchMgr: ProfileApplyManager;
  pushMgr: IAssetSpacePusher;
  /**
   * Factory rebuilding the pusher from the CURRENTLY stored GitHub PAT, per
   * invocation. Preferred over the onload-captured {@link pushMgr} inside
   * {@link ProfileCommands.invokePushCurrentAssetSpace} so a PAT configured AFTER
   * onload authenticates a push without a reload (Issue #3557 — same fix as the
   * apply path's `assetSpaceManagerFactory`). Falls back to {@link pushMgr} when
   * absent (tests / legacy wiring).
   */
  pushMgrFactory?: () => Promise<IAssetSpacePusher>;
  /** Returns available `exo__Profile` assets (label + uid pairs) — the picker. */
  profileLister: () => Promise<ProfileChoice[]>;
  /**
   * Open a fuzzy picker UI. Returns the user's choice, or null if the
   * picker was cancelled. Real implementation wraps Obsidian
   * `FuzzySuggestModal`; tests provide a programmatic stub. `initialQuery`
   * (optional) pre-narrows the filter — the first-run onboarding panel passes
   * `"starter"` so the recommended profile surfaces first (RFC 0002 §3.1 step 3).
   */
  fuzzyPick: (
    options: ProfileChoice[],
    title: string,
    initialQuery?: string,
  ) => Promise<ProfileChoice | null>;
  /** Returns the currently-active file path, or null if no file is open. */
  getActiveFilePath: () => string | null;
  /**
   * Returns the last-applied profile UID, or null. Used by «Show current
   * state» (RFC 0a0791c1 Phase 5 T2 — single slot).
   */
  getActiveProfileUid: () => string | null;
  /**
   * Returns the undo target — the profile active immediately before the most
   * recent apply (RFC 0002 §3.10), or null. Used by «Undo last profile apply»
   * for the pre-flight availability check + the "Reverting to <label>…" notice.
   */
  getPreviousProfileUid: () => string | null;
  /** Show a user-facing Notice. */
  notify: (message: string) => void;
}

export class ProfileCommands {
  private readonly switchMgr: ProfileApplyManager;
  private readonly pushMgr: IAssetSpacePusher;
  private readonly pushMgrFactory?: () => Promise<IAssetSpacePusher>;
  private readonly profileLister: () => Promise<ProfileChoice[]>;
  private readonly fuzzyPick: ProfileCommandsDeps["fuzzyPick"];
  private readonly getActiveFilePath: () => string | null;
  private readonly getActiveProfileUid: () => string | null;
  private readonly getPreviousProfileUid: () => string | null;
  private readonly notify: (message: string) => void;

  constructor(deps: ProfileCommandsDeps) {
    this.switchMgr = deps.switchMgr;
    this.pushMgr = deps.pushMgr;
    this.pushMgrFactory = deps.pushMgrFactory;
    this.profileLister = deps.profileLister;
    this.fuzzyPick = deps.fuzzyPick;
    this.getActiveFilePath = deps.getActiveFilePath;
    this.getActiveProfileUid = deps.getActiveProfileUid;
    this.getPreviousProfileUid = deps.getPreviousProfileUid;
    this.notify = deps.notify;
  }

  /**
   * Command 1 — `Exocortex: Apply profile` (RFC 0a0791c1 Phase 5 T2;
   * consolidates the former «Switch focus profile» (soft) + «Switch knowledge
   * profile» (mount) commands into a single mount-state operation).
   *
   * Fuzzy-picks an `exo__Profile` asset, then invokes
   * `ProfileApplyManager.applyProfile` which:
   *   1. R24 TS-floor assert (refuses targets that brick the plugin)
   *   2. Vision Lock #5 uncommitted abort (with file list)
   *   3. ModalConfirmGate (DI via switchMgr constructor)
   *   4. Phase 1 pull → Phase 2 destroy+materialize → git commit (desktop) OR
   *      REST mount/unmount (mobile)
   *
   * User-facing error mapping: TsFloorViolationError, UncommittedChangesAbortError,
   * and ApplyAbortedByUser get clear notices distinct from generic «Apply failed».
   *
   * `initialQuery` (optional) pre-narrows the picker — the first-run onboarding
   * panel passes `"starter"` so the recommended profile surfaces first
   * (RFC 0002 §3.1 step 3). The full list is still shown.
   */
  async invokeApplyProfile(initialQuery?: string): Promise<void> {
    let profiles: ProfileChoice[];
    try {
      profiles = await this.profileLister();
    } catch (e) {
      this.notify(`Could not list profiles: ${this.safeMessage(e)}`);
      return;
    }

    if (profiles.length === 0) {
      this.notify("No profiles found in vault");
      return;
    }

    // RFC 0002 §3.4 P7b — scope the default view to locally-relevant profiles
    // (hide other testers' profiles behind «Show all profiles»). Returns the
    // chosen real profile, or null on cancel.
    const chosen = await this.pickProfileScoped(profiles, initialQuery);
    if (chosen === null) return; // user cancelled

    this.notify(`Applying ${chosen.label}…`);
    try {
      await this.switchMgr.applyProfile(chosen.uid);
    } catch (e) {
      if (e instanceof ApplyAbortedByUser) {
        this.notify("Apply profile cancelled.");
        return;
      }
      if (e instanceof TsFloorViolationError) {
        this.notify(`Apply profile refused — ${e.message}`);
        return;
      }
      if (e instanceof UncommittedChangesAbortError) {
        const total = e.affectedFiles.reduce((s, a) => s + a.files.length, 0);
        this.notify(
          `Apply profile aborted — ${total} uncommitted file(s) in ${e.affectedFiles.length} AssetSpace(s) this profile would remove. ` +
            `Commit (or stash) the vault first, then re-apply. Fresh git-backed vault? The pulled assetspaces/ are untracked — run ` +
            `\`git add -A && git commit -m "vault setup"\` (and gitignore \`.obsidian/\` + \`.exocortex/\` to keep your PAT out of git). ` +
            `See docs/explanation/profile.md.`,
        );
        return;
      }
      this.notify(`Apply profile failed: ${this.safeMessage(e)}`);
    }
  }

  /**
   * Command — `Exocortex: Undo last profile apply` (RFC 0002 §3.10, resolves
   * P15). Reverts to the profile active immediately before the most recent
   * apply, so a wrong profile choice is one click to undo without re-finding it
   * in the picker.
   *
   * Delegates to {@link ProfileApplyManager.undoLastApply}, which re-applies the
   * previous profile through the SAME confirm gate + uncommitted-changes guard +
   * mount-before-unmount path as any apply (zero data loss — it never destroys
   * un-pushed work). When nothing is recorded yet, surfaces a friendly notice
   * (the command is also hidden by `checkCallback` until an undo target exists,
   * so this is a defensive fallback).
   *
   * Error mapping mirrors {@link invokeApplyProfile} — cancel / TS-floor /
   * uncommitted aborts get distinct notices.
   */
  async invokeUndoLastApply(): Promise<void> {
    const previous = this.getPreviousProfileUid();
    if (previous === null) {
      this.notify(
        "Nothing to undo — no previous profile recorded yet. Apply a different profile first; this then reverts to the one you had.",
      );
      return;
    }

    const label = await this.resolveLabel(previous, this.profileLister);
    this.notify(`Reverting to ${label}…`);
    try {
      await this.switchMgr.undoLastApply();
    } catch (e) {
      if (e instanceof NoPreviousProfileError) {
        // Surface the specific reason (e.g. the previous profile was deleted),
        // not a generic "no previous profile recorded".
        this.notify(`Nothing to undo — ${e.message}.`);
        return;
      }
      if (e instanceof ApplyAbortedByUser) {
        this.notify("Undo cancelled.");
        return;
      }
      if (e instanceof TsFloorViolationError) {
        this.notify(`Undo refused — ${e.message}`);
        return;
      }
      if (e instanceof UncommittedChangesAbortError) {
        const total = e.affectedFiles.reduce((s, a) => s + a.files.length, 0);
        this.notify(
          `Undo aborted — ${total} uncommitted file(s) in ${e.affectedFiles.length} AssetSpace(s) reverting would remove. ` +
            `Commit (or stash) the vault first, then undo again. See docs/explanation/profile.md.`,
        );
        return;
      }
      this.notify(`Undo failed: ${this.safeMessage(e)}`);
    }
  }

  /**
   * Command 2 — `Exocortex: Show current state` (RFC 0a0791c1 Phase 5 T2).
   *
   * Surfaces a Notice reporting the last-applied profile. The label is
   * resolved best-effort from the lister; an unresolved UID falls back to the
   * raw UID, and an unset slot shows «(none)». Never throws — lister failures
   * degrade to the UID / «(unknown)».
   */
  async invokeShowCurrentState(): Promise<void> {
    const activeUid = this.getActiveProfileUid();
    const activeLabel = await this.resolveLabel(activeUid, this.profileLister);
    this.notify(`Active profile: ${activeLabel}`);
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

    const folderName = ProfileCommands.extractAssetSpaceFolder(activePath);
    if (folderName === null) {
      this.notify(
        "Not in an assetspace folder (expected path under `assetspaces/<as>/`)",
      );
      return;
    }

    // #3557 — rebuild the pusher from the CURRENT PAT so a PAT configured after
    // onload authenticates the push without a reload. Falls back to the
    // onload-captured pushMgr when no factory is wired (tests / legacy). The
    // factory does async PAT I/O that can reject; this command is invoked
    // fire-and-forget, so surface a failure as a Notice rather than leaving an
    // unhandled rejection (code-reviewer LOW).
    let pushMgr: IAssetSpacePusher;
    try {
      pushMgr = this.pushMgrFactory
        ? await this.pushMgrFactory()
        : this.pushMgr;
    } catch (e) {
      this.notify(`Push failed: ${this.safeMessage(e)}`);
      return;
    }

    const asUid = pushMgr.lookupAssetSpaceForPath(folderName);
    if (asUid === null) {
      this.notify(
        `Folder \`${folderName}\` is not declared as an AssetSpace ABox`,
      );
      return;
    }

    this.notify(`Pushing \`${folderName}\`…`);
    try {
      const sha = await pushMgr.pushAssetSpace(asUid);
      if (sha === "" || sha === undefined) {
        // Empty sha indicates «no dirty files» — pushAssetSpace already
        // emitted a Notice. Avoid duplicate user message.
        return;
      }
      this.notify(`Pushed \`${folderName}\` → ${sha.slice(0, 7)}`);
    } catch (e) {
      this.notify(this.mapPushError(e, folderName));
    }
  }

  /**
   * RFC 0002 §3.10 (resolves P15c) — explain a PAT push that 403/401s even
   * though «Test connection» passed. «Test connection» only proves the token can
   * READ (list repos / metadata); a push writes repository Contents, so a token
   * without **Contents: Read and write** — or an expired one — passes the test
   * but 403s on push. Surface that gap + the recovery step instead of the opaque
   * raw HTTP error. Non-auth failures (network, 422 non-fast-forward, …) keep the
   * generic message.
   */
  private mapPushError(e: unknown, folderName: string): string {
    if (isAuthError(e)) {
      return (
        `Push failed — GitHub rejected the token (403/401) for \`${folderName}\`. ` +
        `«Test connection» only checks READ access; pushing needs a fine-grained token with ` +
        `Contents: Read and write on this repo, and it must not be expired. ` +
        `Open Settings → GitHub PAT, create/re-scope the token (Contents: Read and write), ` +
        `save it, then push again. (${this.safeMessage(e)})`
      );
    }
    return `Push failed: ${this.safeMessage(e)}`;
  }

  // === Helpers ===

  /**
   * RFC 0002 §3.4 P7b — open the picker scoped to locally-relevant profiles,
   * with a synthetic «Show all profiles…» entry when some are hidden.
   *
   * Default view = profiles whose `isLocallyRelevant !== false` (an undefined
   * flag is treated as relevant, so callers that do not compute relevance keep
   * the full list). If NOTHING is locally relevant (e.g. a fresh vault where no
   * AssetSpace resolves yet) the full list is shown directly — the picker is
   * never empty when profiles exist. Selecting the «Show all profiles…» entry
   * re-opens the picker with every profile, unscoped.
   *
   * The fuzzy-pick wrapper is the {@link ProfileFuzzyModal}, which carries the
   * picker-selection fix (#3561 — record-in-choose, resolve-in-close-microtask);
   * this method only chooses which list to hand it.
   *
   * req 38e2fdd5 — the list is then passed through
   * {@link orderProfilesForQuickSwitch}, which promotes the profile that was
   * active BEFORE the current one to the first row: profiles are used as a
   * two-context ping-pong, so that is nearly always the switch-back target, and
   * `FuzzySuggestModal` shows `getItems()` in order while the query box is
   * empty — the state the picker opens in. With no previous profile recorded
   * the order is returned untouched (structural zero-regression).
   */
  private async pickProfileScoped(
    profiles: ProfileChoice[],
    initialQuery?: string,
  ): Promise<ProfileChoice | null> {
    const relevant = profiles.filter((p) => p.isLocallyRelevant !== false);
    // Fallback — never present an empty picker. When no profile resolves
    // locally, show all rather than the «Show all» expander alone.
    const scoped = relevant.length > 0 ? relevant : profiles;
    const hasHidden = scoped.length < profiles.length;

    const previousUid = this.getPreviousProfileUid();
    const firstList = orderProfilesForQuickSwitch(
      hasHidden
        ? [
            ...scoped,
            ProfileCommands.showAllEntry(profiles.length - scoped.length),
          ]
        : scoped,
      previousUid,
    );

    const first = await this.fuzzyPick(firstList, "Apply profile", initialQuery);
    if (first === null) return null;
    if (first.kind === "show-all") {
      // User broadened the list — re-open unscoped (no pre-narrow query).
      const all = await this.fuzzyPick(
        orderProfilesForQuickSwitch(profiles, previousUid),
        "Apply profile",
      );
      // A nested «show-all» is impossible (the full list contains no sentinel),
      // but guard against accidental re-selection so it never reaches apply.
      return all !== null && all.kind === "show-all" ? null : all;
    }
    return first;
  }

  /** Build the synthetic «Show all profiles…» picker entry. */
  private static showAllEntry(hiddenCount: number): ProfileChoice {
    return {
      uid: SHOW_ALL_PROFILES_UID,
      label: `Show all profiles… (${hiddenCount} more)`,
      kind: "show-all",
    };
  }

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
    lister: () => Promise<ProfileChoice[]>,
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
