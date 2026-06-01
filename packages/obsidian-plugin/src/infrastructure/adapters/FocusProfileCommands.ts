/**
 * FocusProfileCommands — command-palette logic handler для RFC 0a0791c1 §B.7.
 *
 * Two commands provided:
 *   1. `Exocortex: Switch focus profile` — fuzzy-picks a FocusProfile asset,
 *      invokes B.4 `FocusProfileSwitchManager.switchProfile`
 *   2. `Exocortex: Push current assetspace` — identifies AssetSpace from
 *      active file path (B.3 `lookupAssetSpaceForPath`), invokes
 *      B.3 `AssetSpaceManager.pushAssetSpace`
 *
 * Pure logic — does NOT depend on Obsidian Plugin / FuzzySuggestModal /
 * App.workspace runtime. Dependencies passed via constructor:
 *   - `switchMgr` (B.4)
 *   - `pushMgr` (B.3 — interface `IAssetSpacePusher`)
 *   - `profileLister` — returns available FocusProfile assets
 *   - `fuzzyPick` — opens picker UI, returns chosen profile or null on cancel
 *   - `getActiveFilePath` — returns active file path или null
 *   - `notify` — user-facing Notice
 *
 * Real Obsidian wiring (plugin.addCommand + FuzzySuggestModal + Notice)
 * happens в B.11 plugin entry-point integration.
 */

import type { FocusProfileSwitchManager } from "./FocusProfileSwitchManager";

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
  /** Returns available FocusProfile assets (label + uid pairs). */
  profileLister: () => Promise<FocusProfileChoice[]>;
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
  /** Show a user-facing Notice. */
  notify: (message: string) => void;
}

export class FocusProfileCommands {
  private readonly switchMgr: FocusProfileSwitchManager;
  private readonly pushMgr: IAssetSpacePusher;
  private readonly profileLister: () => Promise<FocusProfileChoice[]>;
  private readonly fuzzyPick: FocusProfileCommandsDeps["fuzzyPick"];
  private readonly getActiveFilePath: () => string | null;
  private readonly notify: (message: string) => void;

  constructor(deps: FocusProfileCommandsDeps) {
    this.switchMgr = deps.switchMgr;
    this.pushMgr = deps.pushMgr;
    this.profileLister = deps.profileLister;
    this.fuzzyPick = deps.fuzzyPick;
    this.getActiveFilePath = deps.getActiveFilePath;
    this.notify = deps.notify;
  }

  /**
   * Command 1 — `Exocortex: Switch focus profile`.
   *
   * Lists available profiles → fuzzy pick → invokes B.4 switchProfile.
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
      await this.switchMgr.switchProfile(chosen.uid);
      // switchProfile itself emits a success Notice; nothing more here
    } catch (e) {
      this.notify(`Switch failed: ${this.safeMessage(e)}`);
    }
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
}
