import {
  formatActiveProfileIndicator,
  formatActiveProfileTooltip,
  UNRESOLVED_PROFILE_TEXT,
} from "../../domain/profile/quickSwitch";

/** Lucide icon for the ribbon entry — stacked layers ≈ the mounted set. */
export const PROFILE_RIBBON_ICON = "layers";

/** CSS hook for the status-bar item (cursor + spacing live in styles.css). */
export const PROFILE_STATUS_BAR_CLASS = "exocortex-profile-indicator";

/** Minimal profile shape the indicator needs — a subset of `ProfileChoice`. */
export interface IndicatorProfile {
  uid: string;
  label: string;
}

export interface ProfileIndicatorDeps {
  /** Last-applied profile UID (device-local), or `null` when never applied. */
  getActiveProfileUid: () => string | null;
  /** The shared profile lister — same source the picker uses. */
  listProfiles: () => Promise<IndicatorProfile[]>;
  /**
   * Opens the profile switcher. This is the EXISTING apply-profile invocation,
   * not a copy — there is exactly one switching code path in the plugin.
   */
  openSwitcher: () => void;
  /**
   * Registers a ribbon entry. Present on BOTH platforms — on mobile it is the
   * only affordance, since Obsidian has no status bar there.
   */
  addRibbonIcon: (
    icon: string,
    title: string,
    callback: () => void,
  ) => HTMLElement;
  /**
   * Registers a status-bar item. **Omitted on mobile** — `addStatusBarItem` is
   * documented in the Obsidian API as "Not available on mobile", so the caller
   * passes it only where it exists. The split is by SURFACE, never by
   * capability: seeing the context and switching it in ≤2 taps works on both
   * platforms (Desktop↔Mobile Command Parity forbids gating a *command* away,
   * not declining to render chrome a platform has no concept of).
   */
  addStatusBarItem?: () => HTMLElement;
}

/**
 * req 38e2fdd5 — the always-visible "which context am I in, and switch it"
 * affordance.
 *
 * Owns two surfaces and one {@link refresh}; both surfaces activate the same
 * injected {@link ProfileIndicatorDeps.openSwitcher}, so the switcher opened
 * from the status bar, from the ribbon and from the command palette is
 * literally the same flow.
 *
 * Best-effort throughout: a failing lister degrades to "Unknown profile" and
 * never throws into plugin load or into a click handler.
 */
export class ProfileIndicator {
  private statusBarEl: HTMLElement | null = null;
  private ribbonEl: HTMLElement | null = null;
  /**
   * Monotonic refresh token. {@link refresh} resolves the label asynchronously
   * (the lister walks the vault, so its latency varies), and refreshes overlap:
   * one fires at load and one after every apply/undo settles. Without this
   * guard the two would paint in COMPLETION order rather than call order, so a
   * slow refresh started BEFORE a switch could overwrite the newer label and
   * leave the indicator naming a context the device is no longer in.
   */
  private refreshGeneration = 0;
  /**
   * Whether the last paint produced a FINAL answer — a real profile label, or
   * an honest "nothing applied yet". False while the active UID is recorded but
   * unnameable (typically a cold metadata cache at load), which is what
   * {@link refreshIfUnsettled} listens for.
   */
  private labelSettled = false;

  constructor(private readonly deps: ProfileIndicatorDeps) {}

  /**
   * Register the surfaces. Idempotent per instance — a second call is a no-op,
   * so a re-entrant onload cannot stack duplicate ribbon entries.
   */
  mount(): void {
    if (this.ribbonEl !== null || this.statusBarEl !== null) return;

    // Ribbon FIRST and unconditionally: it is the mobile affordance.
    this.ribbonEl = this.deps.addRibbonIcon(
      PROFILE_RIBBON_ICON,
      formatActiveProfileTooltip(null),
      () => {
        this.deps.openSwitcher();
      },
    );

    // Status bar only where the API exists (desktop).
    if (this.deps.addStatusBarItem !== undefined) {
      const el = this.deps.addStatusBarItem();
      el.classList.add(PROFILE_STATUS_BAR_CLASS);
      el.addEventListener("click", () => {
        this.deps.openSwitcher();
      });
      el.textContent = formatActiveProfileIndicator(null);
      el.title = formatActiveProfileTooltip(null);
      this.statusBarEl = el;
    }
  }

  /**
   * Re-read the active profile and repaint both surfaces. Called at load and
   * after every apply/undo completes, so the indicator follows the profile it
   * reports without a plugin reload.
   */
  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const { label, settled } = await this.resolveActive();
    // A newer refresh started while this one was resolving — it will paint the
    // fresher label, so this (now stale) result must not overwrite it.
    if (generation !== this.refreshGeneration) return;
    this.labelSettled = settled;

    const text = formatActiveProfileIndicator(label);
    const tooltip = formatActiveProfileTooltip(label);

    if (this.statusBarEl !== null) {
      this.statusBarEl.textContent = text;
      this.statusBarEl.title = tooltip;
    }
    if (this.ribbonEl !== null) {
      this.ribbonEl.title = tooltip;
      // The ribbon has no visible text — the accessible label is how the
      // active profile is announced on mobile / to assistive tech.
      this.ribbonEl.setAttribute("aria-label", tooltip);
    }
  }

  /**
   * Repaint ONLY while the label is still unresolved.
   *
   * At plugin load the metadata cache is usually cold, so the profile lister
   * finds nothing and the first {@link refresh} can only paint "Unknown
   * profile". Nothing else would ever re-resolve it — the indicator would sit
   * wrong until the user happened to apply a profile. This is the hook the
   * plugin drives from `metadataCache.on("resolved")`, i.e. "the vault finished
   * indexing".
   *
   * It is a no-op once the label HAS settled, because listing profiles walks
   * the vault: an unconditional repaint on every cache-resolution event would
   * put an O(vault) scan on a hot Obsidian event, which is the shape that
   * caused the documented iPhone index-storm. Settled means either a real
   * label or an honest "no profile applied"; only the genuinely-unresolvable
   * case (a recorded UID whose asset is missing) keeps listening, and that
   * self-heals on the next apply.
   */
  async refreshIfUnsettled(): Promise<void> {
    if (this.labelSettled) return;
    await this.refresh();
  }

  /**
   * `label: null` ⇒ nothing applied yet. A recorded UID with no matching asset
   * yields {@link UNRESOLVED_PROFILE_TEXT} rather than the raw UID or a
   * misleading "No profile".
   *
   * `settled` reports whether this answer is final: `false` means the lookup
   * could not name the profile (cold cache, unmounted AssetSpace, deleted
   * asset) and is worth retrying when the vault reports itself indexed.
   */
  private async resolveActive(): Promise<{
    label: string | null;
    settled: boolean;
  }> {
    let uid: string | null;
    try {
      uid = this.deps.getActiveProfileUid();
    } catch {
      return { label: UNRESOLVED_PROFILE_TEXT, settled: false };
    }
    if (uid === null || uid.length === 0) {
      return { label: null, settled: true };
    }

    try {
      const profiles = await this.deps.listProfiles();
      const match = profiles.find((p) => p.uid === uid);
      return match !== undefined
        ? { label: match.label, settled: true }
        : { label: UNRESOLVED_PROFILE_TEXT, settled: false };
    } catch {
      return { label: UNRESOLVED_PROFILE_TEXT, settled: false };
    }
  }
}
