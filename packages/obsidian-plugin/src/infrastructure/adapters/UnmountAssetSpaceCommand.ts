/**
 * UnmountAssetSpaceCommand — command-palette logic handler for the standalone
 * «Exocortex: Unmount assetspace» command (the inverse of «Add assetspace by
 * URL», {@link BootstrapAssetSpaceCommands.invokeAddAssetSpace}).
 *
 * ## Why this command exists (#e6b8827c)
 *
 * The unmount mechanics already existed, but only *inside* `apply-profile`'s
 * strict mount-state replace (tear down every AssetSpace not in the target
 * profile's effective set). There was NO way to unmount a single AssetSpace on
 * demand — neither in the palette nor in the CLI. This command surfaces the
 * existing `RestAssetSpaceMount.unmount` (git-free, cross-platform after the
 * git-elim REST mount, v16.96.12) as a first-class user action, mirroring the
 * CLI's `assetspace-remove`.
 *
 * ## TS-floor refuse (floor-policy A — «refuse, не rescue»)
 *
 * The TS-floor (`{exo}` per RFC 5aa2a73a / #3440 — `exocmd` +
 * `shared-identities` are OPTIONAL, NOT floor) is never unmounted: tearing it
 * down would brick the runtime (no class defs). A floor AssetSpace surfaces in
 * the picker decorated as protected, and selecting it is REFUSED with a clear
 * Notice — no mutation — exactly as `apply-profile`'s R24 guard refuses a
 * profile that would strip the floor. `isFloor` is computed once at wiring time
 * via the shared `isTsFloorAssetSpace` guard (single source of truth), so this
 * handler is data-driven and fully unit-testable without Obsidian.
 *
 * Pure logic — does NOT depend on Obsidian Plugin / FuzzySuggestModal / vault
 * runtime. Everything platform-specific (the mounted-set scan, the fuzzy picker,
 * the confirm modal, `RestAssetSpaceMount.unmount`) is injected via
 * {@link UnmountAssetSpaceCommandDeps}. Real wiring lives in `ExocortexPlugin`.
 */

/** A currently-mounted AssetSpace the user may pick to unmount. */
export interface UnmountableAssetSpace {
  /** `.gitmodules` mount path (the unmount target, e.g. `assetspaces/kitelev/exoas-pmbok-ontology`). */
  submodulePath: string;
  /** `.gitmodules` URL (display / diagnostics). */
  url: string;
  /** AssetSpace descriptor `exo__Asset_uid` — `""` when the folder has no scannable descriptor. */
  uid: string;
  /** AssetSpace descriptor `exo__AssetSpace_namespace` — `""` when absent. */
  namespace: string;
  /** Display label for the picker. */
  label: string;
  /**
   * Floor-protected (cannot be unmounted — would self-brick the runtime, R24).
   * Computed at wiring time via the shared `isTsFloorAssetSpace` guard so the
   * floor identity stays a single source of truth.
   */
  isFloor: boolean;
}

export interface UnmountAssetSpaceCommandDeps {
  /**
   * Returns the currently-mounted AssetSpaces (the picker source). Built from
   * the `.gitmodules` registry cross-referenced with the AssetSpace descriptor
   * scan (uid + namespace) so `isFloor` can be computed.
   */
  listMounted: () => Promise<UnmountableAssetSpace[]>;
  /**
   * Open a fuzzy picker. Returns the chosen AssetSpace, or null if cancelled.
   * Real implementation wraps Obsidian `FuzzySuggestModal`; tests stub it.
   */
  fuzzyPick: (
    items: UnmountableAssetSpace[],
    title: string,
  ) => Promise<UnmountableAssetSpace | null>;
  /** Yes/no confirmation gate (unmount deletes the folder — destructive). */
  confirm: (message: string) => Promise<boolean>;
  /** Unmount the AssetSpace — `RestAssetSpaceMount.unmount` (git-free). */
  unmount: (submodulePath: string) => Promise<void>;
  /** User-facing Notice. */
  notify: (message: string) => void;
  /**
   * Optional hook fired after a successful unmount so the plugin can re-index
   * (the unmounted assets are gone). Failures are swallowed (best-effort).
   */
  onUnmounted?: () => Promise<void>;
}

export class UnmountAssetSpaceCommand {
  private readonly d: UnmountAssetSpaceCommandDeps;

  constructor(deps: UnmountAssetSpaceCommandDeps) {
    this.d = deps;
  }

  /** Command — `Exocortex: Unmount assetspace`. */
  async invokeUnmount(): Promise<void> {
    let mounted: UnmountableAssetSpace[];
    try {
      mounted = await this.d.listMounted();
    } catch (e) {
      this.d.notify(`Unmount: could not list mounted AssetSpaces — ${this.msg(e)}`);
      return;
    }

    if (mounted.length === 0) {
      this.d.notify("No mounted AssetSpaces to unmount.");
      return;
    }

    const chosen = await this.d.fuzzyPick(mounted, "Unmount assetspace");
    if (chosen === null) return; // user cancelled

    // Floor-policy A — refuse, не rescue. Selecting a floor AssetSpace is a
    // no-op + clear Notice (NO mutation), mirroring apply-profile's R24 guard.
    if (chosen.isFloor) {
      this.d.notify(
        `Unmount refused — «${chosen.label}» is a TS-floor AssetSpace ` +
          `(${chosen.namespace || chosen.uid || chosen.submodulePath}) and cannot be unmounted ` +
          `(it would self-brick the runtime — R24).`,
      );
      return;
    }

    const ok = await this.d.confirm(
      `Unmount «${chosen.label}» (${chosen.submodulePath})? ` +
        "This strips its .gitmodules entry and deletes the folder from the vault.",
    );
    if (!ok) return; // user declined

    this.d.notify(`Unmounting ${chosen.label}…`);
    try {
      await this.d.unmount(chosen.submodulePath);
    } catch (e) {
      this.d.notify(`Unmount failed: ${this.msg(e)}`);
      return;
    }
    this.d.notify(
      `Unmounted ${chosen.label} (${chosen.submodulePath}). ` +
        "Reload Obsidian if the removed assets still appear.",
    );
    await this.runOnUnmounted();
  }

  private async runOnUnmounted(): Promise<void> {
    if (this.d.onUnmounted === undefined) return;
    try {
      await this.d.onUnmounted();
    } catch {
      // Best-effort re-index; failure must not surface as an unmount error.
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
