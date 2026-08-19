import type { ParkedAssetHit } from "@kitelev/exocortex-core";

/**
 * Renders an unresolved link that points into a PARKED AssetSpace as
 * "<asset label> ⏸" with an activate action, instead of leaving it broken
 * (req `c171e24d`).
 *
 * ## Why the asset's own label and not the AssetSpace's name
 *
 * A link is an identity reference: the reader wants to know WHAT was linked.
 * A placeholder reading `⏸ Concepts` answers "where it lives" and destroys the
 * sentence the moment a paragraph carries two links into the same AssetSpace
 * (`… helps ⏸ Concepts through ⏸ Concepts in ⏸ Concepts`). The asset's label
 * costs only the click-through; the paragraph still says what it said.
 *
 * ## ⛔ Why the AssetSpace name is in the ACTION and never in a tooltip
 *
 * Touch devices generate no hover, so a `title`/`aria-label` tooltip would put
 * the AssetSpace name exactly out of reach on the iPhone — the device parking
 * exists for. The name therefore travels on the ONE channel a phone has: the
 * tap. {@link ParkedPlaceholderDeps.activate} receives the hit and is
 * responsible for naming the AssetSpace in whatever it opens.
 *
 * ## Why a miss must leave the link untouched
 *
 * A link to an asset that exists nowhere stays red. This class decorates ONLY
 * on a positive hit from the parked lookup; every other outcome (miss, thrown
 * lookup) leaves the element byte-identical, so genuinely broken links keep
 * looking broken.
 */

/** Marks a link whose parked-lookup already ran, so it is never re-checked. */
export const PARKED_CHECKED_ATTR = "data-parked-checked";
/** Set on a decorated link; carries the parked AssetSpace for inspection/tests. */
export const PARKED_SPACE_ATTR = "data-parked-assetspace";
/**
 * Class of a rendered placeholder.
 *
 * ⛤ The `exocortex-` prefix is load-bearing beyond styling: `BodyLinkPatch`
 * skips any link inside `[class*='exocortex']`, and `closest()` matches the
 * element itself — so a decorated link is naturally exempt from later
 * display-name patching that would overwrite the placeholder text.
 */
export const PARKED_PLACEHOLDER_CLASS = "exocortex-parked-link";

/** The pause glyph appended to the asset label. */
const PAUSE_GLYPH = "⏸";

export interface ParkedPlaceholderDeps {
  /**
   * Resolve a link target to a parked asset, or `null`.
   *
   * ⛔ MUST be backed by `vault.adapter`, never by `getMarkdownFiles()` /
   * `metadataCache`: the parked root is a dot-folder that Obsidian does not
   * index, so an index-backed lookup returns `null` for every parked asset and
   * the placeholder becomes unreachable by construction.
   */
  lookup(linkTarget: string): Promise<ParkedAssetHit | null>;
  /** Open the activate flow for this hit; MUST name the AssetSpace itself. */
  activate(hit: ParkedAssetHit): void;
}

export class ParkedLinkPlaceholder {
  private readonly deps: ParkedPlaceholderDeps;

  constructor(deps: ParkedPlaceholderDeps) {
    this.deps = deps;
  }

  /**
   * Check an UNRESOLVED link and, if it points into a parked AssetSpace, render
   * the placeholder.
   *
   * Fire-and-forget by design: the callers are synchronous DOM patches driven by
   * a MutationObserver, and the lookup is I/O. The element is marked before the
   * await so a re-patch of the same element cannot start a second lookup.
   */
  decorate(linkEl: HTMLElement, linkTarget: string): void {
    if (linkEl.hasAttribute(PARKED_CHECKED_ATTR)) return;
    linkEl.setAttribute(PARKED_CHECKED_ATTR, "true");
    void this.resolveAndRender(linkEl, linkTarget);
  }

  private async resolveAndRender(
    linkEl: HTMLElement,
    linkTarget: string,
  ): Promise<void> {
    let hit: ParkedAssetHit | null;
    try {
      hit = await this.deps.lookup(linkTarget);
    } catch {
      // A failed lookup is NOT evidence that the asset is parked — leave the
      // link exactly as Obsidian rendered it.
      return;
    }
    if (hit === null) return;
    this.render(linkEl, hit);
  }

  private render(linkEl: HTMLElement, hit: ParkedAssetHit): void {
    const fallback = (hit.path.split("/").pop() ?? hit.path).replace(
      /\.md$/i,
      "",
    );
    const display = hit.label ?? fallback;

    linkEl.textContent = `${display} ${PAUSE_GLYPH}`;
    linkEl.classList.add(PARKED_PLACEHOLDER_CLASS);
    linkEl.setAttribute(PARKED_SPACE_ATTR, hit.assetSpace);
    // ⛔ No AssetSpace name here: a tooltip is unreachable on touch.
    linkEl.setAttribute("aria-label", `${display} — parked on this device`);

    linkEl.addEventListener(
      "click",
      (event: Event) => {
        // Obsidian would otherwise offer to CREATE the missing note — the exact
        // wrong outcome for an asset that already exists on this device.
        event.preventDefault();
        event.stopPropagation();
        this.deps.activate(hit);
      },
      // ⛔ Capture, and per-element on purpose: Obsidian's own handler sits on an
      // ancestor, so only a capture-phase listener ON the link runs first. Do
      // NOT "tidy" this into one delegated ancestor handler — that loses the
      // ordering this depends on. The listener is not a leak: it lives on the
      // element, dies with it, and is attached only on a positive hit.
      true,
    );
  }
}
