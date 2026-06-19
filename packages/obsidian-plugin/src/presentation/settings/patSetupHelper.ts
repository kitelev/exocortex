/**
 * PAT setup create-token helper — RFC 0002 §3.5 (resolves P9: PAT setup has no
 * inline "create token" helper or scope guidance).
 *
 * PAT creation is the single hardest onboarding step: a new tester must leave
 * Obsidian, find GitHub's *fine-grained* token page (not the classic one), and
 * guess which permissions Exocortex needs. This module scaffolds that step with:
 *   1. a deep-link straight to GitHub's fine-grained token creation page, and
 *   2. an inline list of the exact permissions the token needs.
 *
 * It is a **reusable, side-effect-free renderer** (no plugin/app coupling — it
 * only writes DOM into a caller-supplied element) so the same guidance can be
 * shown in two places without divergence:
 *   - the Settings "GitHub PAT" section (`ExocortexSettingTab`), and
 *   - the first-run Welcome panel's PAT step (cd9444bd, RFC 0002 §3.1).
 *
 * The deep-link URL and the permission list are exported as pure data so they
 * can be unit-tested (and reused) independently of the Obsidian DOM wiring.
 */

/**
 * Deep-link to GitHub's *fine-grained* personal-access-token creation page.
 *
 * Fine-grained (not classic) is required: ExoSync/Push needs a token with a
 * per-repository allowlist scoped to the user's `exoas-*` repos. The classic
 * token page (`/settings/tokens/new`) issues coarse `repo`-scoped tokens that
 * the plugin's settings copy explicitly steers users away from.
 */
export const GITHUB_FINE_GRAINED_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new";

/** Visible label of the create-token link. */
export const PAT_CREATE_TOKEN_LABEL = "Create token on GitHub";

/** One required permission line shown to the user. */
export interface PatRequiredScope {
  /** GitHub fine-grained permission name (e.g. "Contents"). */
  readonly permission: string;
  /** Access level to grant (e.g. "Read and write"). */
  readonly access: string;
  /** Plain-language reason the token needs it. */
  readonly why: string;
}

/**
 * The fine-grained permissions an Exocortex sync/push token needs, on the
 * repositories the user pushes (their `exoas-*` AssetSpace repos).
 *
 * - **Contents: Read and write** — the load-bearing one (RFC 0002 §3.5):
 *   pushing AssetSpace submodule commits writes repository contents.
 * - **Metadata: Read-only** — GitHub auto-selects this for every fine-grained
 *   token; listed so the user isn't surprised by it, and because the settings
 *   "Test connection" button lists repos (which needs metadata read).
 */
export const PAT_REQUIRED_SCOPES: readonly PatRequiredScope[] = [
  {
    permission: "Contents",
    access: "Read and write",
    why: "push AssetSpace submodule commits to your exoas-* repos",
  },
  {
    permission: "Metadata",
    access: "Read-only",
    why: "mandatory baseline (GitHub auto-selects it); also lets Test connection list your repos",
  },
];

/**
 * Render the create-token helper (deep-link + required-permissions list) into
 * `containerEl` and return the wrapper element it created.
 *
 * Pure DOM, no plugin state — safe to call from any settings/modal context.
 *
 * ## Accessibility (RFC 0002 §3.11 / P16)
 * - The create-token control is a native `<a>` (keyboard-focusable, activatable
 *   with Enter) carrying an explicit `aria-label` that states it opens GitHub.
 * - `target="_blank"` is paired with `rel="noopener noreferrer"` (security +
 *   no reverse-tabnabbing).
 * - The permissions are a semantic `<ul>` with an `aria-label`, so assistive
 *   tech announces them as a labelled list rather than loose text.
 */
export function renderPatSetupHelper(containerEl: HTMLElement): HTMLElement {
  const wrapper = containerEl.createEl("div", {
    cls: "exocortex-pat-setup-helper",
  });

  const link = wrapper.createEl("a", {
    cls: "exocortex-pat-setup-create-link",
    text: PAT_CREATE_TOKEN_LABEL,
    href: GITHUB_FINE_GRAINED_TOKEN_URL,
  });
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.setAttribute(
    "aria-label",
    "Create a fine-grained GitHub token (opens GitHub in your browser)",
  );

  wrapper.createEl("p", {
    cls: "exocortex-pat-setup-intro",
    text:
      "Create a fine-grained token scoped to your exoas-* repositories, grant " +
      "these permissions, then paste it above and click Save PAT:",
  });

  const list = wrapper.createEl("ul", { cls: "exocortex-pat-setup-scopes" });
  list.setAttribute("aria-label", "Required GitHub token permissions");
  for (const scope of PAT_REQUIRED_SCOPES) {
    const item = list.createEl("li", { cls: "exocortex-pat-setup-scope" });
    item.createEl("strong", { text: `${scope.permission}: ${scope.access}` });
    item.createEl("span", { text: ` — ${scope.why}` });
  }

  return wrapper;
}
