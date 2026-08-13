import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  launchObsidianWithPlugin,
  log,
  openAssetAndRender,
  pollUntil,
  SEED_AREA_UID,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — the PARKED-link placeholder renders in live Obsidian
 *  (req c171e24d, AC7 of vault task 24993104)
 * ============================================================================
 *
 * The mechanism shipped in PR #4043: `ParkedAssetIndex` (core) walks
 * `.exocortex/parked` through a `vault.adapter`-shaped port, and
 * `ParkedLinkPlaceholder` (plugin) rewrites a matching UNRESOLVED link to
 * "<asset label> ⏸". Its jsdom tests drive the real entry points
 * (`BodyLinkPatch.enable()` / `PropertiesLinkPatch.enable()`) and already prove
 * the DOM output of both channels plus the lookup's positive-evidence-only
 * semantics.
 *
 * ---------------------------------------------------------------------------
 * WHY this e2e exists on top of those unit tests
 * ---------------------------------------------------------------------------
 * Those tests cannot be the VISUAL guarantee. Three things they replace with a
 * fake are exactly the things that break in production:
 *
 *   - the `metadataCache` is COLD on a fresh launch — the class of defect that
 *     painted the profile indicator "Unknown" forever, invisible to any manual
 *     smoke because a live vault's cache is always warm
 *     (rules/obsidian-plugin-indicator-surface-and-cold-resolve.md);
 *   - the reading-mode markdown render + MutationObserver are Obsidian's, not
 *     jsdom's — whether a `[[uid]]` even BECOMES an `a.internal-link` carrying
 *     `data-href` is Obsidian's decision;
 *   - the parked lookup reads a REAL dot-folder through the REAL
 *     `vault.adapter`. The unit test's fake reader models the
 *     `getMarkdownFiles()`-vs-adapter asymmetry that IS the whole mechanism;
 *     here the filesystem provides it.
 *
 * Per the standing directive (Andrey, 2026-08-02) a visual claim gets an
 * explicit E2E in CI, never a local Docker run
 * (rules/visual-verification-via-ci-e2e.md, rules/docker-qemu-e2e-multichild-panic.md).
 *
 * ---------------------------------------------------------------------------
 * WHAT makes this non-vacuous (the discriminators)
 * ---------------------------------------------------------------------------
 * A placeholder that swallowed EVERY unresolved link would satisfy a
 * positive-only scenario. So the body note carries four links whose verdicts
 * must DIFFER, and each negative control is checked for having actually been
 * LOOKED UP (`data-parked-checked`) rather than merely left alone:
 *
 *   1. parked asset          → placeholder ("<label> ⏸" + class + AssetSpace)
 *   2. UID present NOWHERE   → checked, still broken
 *   3. non-asset file parked → checked, still broken   (the `exo__Asset_uid`
 *      gate: 22 real `README.md` live inside assetspaces on this device, and a
 *      broken `[[README]]` must never offer to activate an AssetSpace)
 *   4. asset inside a NESTED dot-folder (`.git`) → checked, still broken
 *      (the walk skips nested dot-folders; on a real filesystem that boundary
 *      is real, whereas a fake reader models it by construction)
 *
 * plus 5. a RESOLVED link, which must never be checked at all — the placeholder
 * is only reachable from the `if (!file)` seam.
 *
 * Ordering note for the negatives: every link on the page awaits the SAME
 * `ensureIndex()` walk; a miss then returns on a map lookup, while the hit does
 * one further `read()`. So once the placeholder is on the page, the misses have
 * already resolved — polling for the hit is sufficient to read all five.
 *
 * Render-only: nothing is applied, no profile is switched, and the ephemeral
 * vault is deleted in `afterAll`.
 */

/** Stable fixture prefix for this suite (valid hex, distinct from the shared seeds). */
const PARKED_BODY_UID = "e2e0da4c-0000-4000-a000-0000000000b1";
const PARKED_FM_UID = "e2e0da4c-0000-4000-a000-0000000000f1";
/** A UID that exists neither in the vault nor under the parked root. */
const NOWHERE_UID = "e2e0da4c-0000-4000-a000-00000000dead";

const PARKED_BODY_LABEL = "Припаркованный концепт";
const PARKED_FM_LABEL = "Припаркованная зона";

/** Basename of a parked markdown file that is NOT an asset (no `exo__Asset_uid`). */
const NON_ASSET_BASENAME = "e2e-parked-not-an-asset";
/** Basename of an asset hidden inside the parked mount's own `.git` dot-folder. */
const DOTFOLDER_BASENAME = "e2e-parked-dotfolder-decoy";

/** The parked AssetSpace the fixture materialises, as `<owner>/<repo>`. */
const PARKED_ASSETSPACE = "kitelev/exoas-parked-e2e";
/** Mirrors `PARKED_ROOT` in `packages/core/src/domain/profile/ParkedMountState.ts`. */
const PARKED_ROOT = ".exocortex/parked";

const NOTE_BODY_REL = "e2e-parked-body.md";
const NOTE_FM_REL = "e2e-parked-frontmatter.md";

/** Class name added by `ParkedLinkPlaceholder.render`. */
const PLACEHOLDER_CLASS = "exocortex-parked-link";
/** The pause glyph appended to the asset label (U+23F8). */
const PAUSE_GLYPH = "⏸";

interface RenderedLink {
  href: string | null;
  text: string;
  className: string;
  checked: string | null;
  assetSpace: string | null;
  ariaLabel: string | null;
}

function parkedAsset(uid: string, label: string): string {
  return (
    `---\n` +
    `exo__Asset_uid: ${uid}\n` +
    `exo__Asset_label: "${label}"\n` +
    `---\n\nEphemeral e2e parked asset. Recreated fresh every run.\n`
  );
}

/**
 * Materialise a parked AssetSpace by hand.
 *
 * A real `apply-profile` park is NOT needed: the placeholder reads the parked
 * DIRECTORY, not the switch journal, so writing the bytes where parking would
 * put them exercises the identical code path with none of the apply machinery.
 */
function seedParkedFixture(vaultPath: string): void {
  const mountDir = path.join(
    vaultPath,
    PARKED_ROOT,
    ...PARKED_ASSETSPACE.split("/"),
  );
  const nsDir = path.join(mountDir, "parked");
  fs.mkdirSync(nsDir, { recursive: true });

  fs.writeFileSync(
    path.join(nsDir, `${PARKED_BODY_UID}.md`),
    parkedAsset(PARKED_BODY_UID, PARKED_BODY_LABEL),
  );
  fs.writeFileSync(
    path.join(nsDir, `${PARKED_FM_UID}.md`),
    parkedAsset(PARKED_FM_UID, PARKED_FM_LABEL),
  );

  // A markdown FILE under the parked root that is NOT an asset — no
  // frontmatter, hence no `exo__Asset_uid`. The real shape of the README that
  // motivated the positive-evidence gate.
  fs.writeFileSync(
    path.join(mountDir, `${NON_ASSET_BASENAME}.md`),
    `# Not an asset\n\nA plain readme living inside a parked mount.\n`,
  );

  // A perfectly valid asset hidden in the mount's own `.git` — the walk must
  // skip nested dot-folders, so this must stay unfindable.
  const gitDir = path.join(mountDir, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(
    path.join(gitDir, `${DOTFOLDER_BASENAME}.md`),
    parkedAsset("e2e0da4c-0000-4000-a000-00000000c17a", "Decoy inside .git"),
  );

  // The body note: one hit, three misses that must stay broken, one resolved
  // link that must never be looked up at all.
  fs.writeFileSync(
    path.join(vaultPath, NOTE_BODY_REL),
    `# Parked link placeholder — body channel\n\n` +
      `Parked: [[${PARKED_BODY_UID}]]\n\n` +
      `Nowhere: [[${NOWHERE_UID}]]\n\n` +
      `Non-asset: [[${NON_ASSET_BASENAME}]]\n\n` +
      `Dot-folder: [[${DOTFOLDER_BASENAME}]]\n\n` +
      `Resolved: [[${SEED_AREA_UID}]]\n`,
  );

  // The frontmatter note: the SECOND render channel (`PropertiesLinkPatch`),
  // pointing at a DIFFERENT parked asset so a cross-channel bleed cannot pass.
  fs.writeFileSync(
    path.join(vaultPath, NOTE_FM_REL),
    `---\n` +
      `exo__Asset_uid: e2e0da4c-0000-4000-a000-0000000000f2\n` +
      `exo__Asset_label: "E2E parked frontmatter host"\n` +
      `exo__Asset_relates: "[[${PARKED_FM_UID}]]"\n` +
      `---\n\nThe parked link under test lives in the Properties block above.\n`,
  );

  // `.exocortex/` is gitignored by `setupGuiVault`, so only the two notes land
  // here — committed for parity with the sibling specs (clean tree for any
  // apply-style guard a future scenario might add).
  const git = (args: string[]): void => {
    execFileSync("git", args, {
      cwd: vaultPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed parked-link placeholder fixture"]);
  log(`parked fixture seeded under ${PARKED_ROOT}/${PARKED_ASSETSPACE}`);
}

/**
 * Every rendered link under `scope`, with the attributes the placeholder sets.
 *
 * The attribute names are spelled literally inside the page callback on
 * purpose: it is serialised into the renderer, so it cannot close over a
 * Node-side constant. They mirror `PARKED_CHECKED_ATTR` / `PARKED_SPACE_ATTR`
 * in `src/presentation/parked/ParkedLinkPlaceholder.ts`.
 */
async function collectLinks(
  window: Page,
  scope: string,
): Promise<RenderedLink[]> {
  return window.evaluate((sel: string) => {
    const out: {
      href: string | null;
      text: string;
      className: string;
      checked: string | null;
      assetSpace: string | null;
      ariaLabel: string | null;
    }[] = [];
    document.querySelectorAll(sel).forEach((el) => {
      out.push({
        href: el.getAttribute("data-href"),
        text: el.textContent ?? "",
        className: el.className,
        checked: el.getAttribute("data-parked-checked"),
        assetSpace: el.getAttribute("data-parked-assetspace"),
        ariaLabel: el.getAttribute("aria-label"),
      });
    });
    return out;
  }, scope);
}

function linkFor(links: RenderedLink[], href: string): RenderedLink {
  const hit = links.find((l) => (l.href ?? "").includes(href));
  expect(
    hit,
    `no rendered link for "${href}". Rendered: ${JSON.stringify(links)}`,
  ).toBeDefined();
  return hit as RenderedLink;
}

test.describe.configure({ mode: "default" });

test.describe("EKA GUI — parked-link placeholder (req c171e24d)", () => {
  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;
  let window: Page;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    vaultPath = setupGuiVault();
    seedParkedFixture(vaultPath);
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-gui-parked-link");
    window = await launcher.getWindow();
    await waitForStoreSettled(window);

    // The placeholder is constructed inside `registerProfileCommands()`. Until
    // it is wired, `parkedLinkPlaceholder?.decorate(...)` is a no-op that does
    // not even mark the link — so gate on the wiring before rendering anything,
    // otherwise a miss would be indistinguishable from an unwired plugin.
    await pollUntil(
      "parked-link placeholder wired on the plugin",
      () =>
        window.evaluate(
          () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            !!(window as any).app?.plugins?.plugins?.exocortex
              ?.parkedLinkPlaceholder,
        ),
      120_000,
      1_000,
    );
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  test("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f body channel — a parked link renders as «<label> ⏸» while every non-parked link stays broken", async () => {
    test.setTimeout(300_000);

    await openAssetAndRender(window, NOTE_BODY_REL);

    const bodySelector =
      ".markdown-preview-view a.internal-link:not(.metadata-container a.internal-link)";

    await pollUntil(
      "parked placeholder rendered in the note body",
      async () => {
        const links = await collectLinks(window, bodySelector);
        const parked = links.find((l) =>
          (l.href ?? "").includes(PARKED_BODY_UID),
        );
        return (parked?.className ?? "").includes(PLACEHOLDER_CLASS);
      },
      120_000,
      2_000,
    );

    const links = await collectLinks(window, bodySelector);
    log(`body links: ${JSON.stringify(links)}`);

    // 1. THE claim: the link now reads the ASSET's own label plus the glyph.
    const parked = linkFor(links, PARKED_BODY_UID);
    expect(
      parked.text,
      "a parked link must render the asset's own label followed by the pause glyph",
    ).toBe(`${PARKED_BODY_LABEL} ${PAUSE_GLYPH}`);
    expect(parked.className).toContain(PLACEHOLDER_CLASS);
    // The AssetSpace derived from the REAL parked path — what the tap needs.
    expect(parked.assetSpace).toBe(PARKED_ASSETSPACE);
    // The name travels on the tap, never on a tooltip: a touch device has no hover.
    expect(
      parked.ariaLabel ?? "",
      "the AssetSpace name must not be reachable only via hover",
    ).not.toContain(PARKED_ASSETSPACE);

    // 2. NEGATIVE CONTROL — a UID that exists nowhere. It was LOOKED UP (so the
    //    verdict is a real miss, not an unreached code path) and left broken.
    const nowhere = linkFor(links, NOWHERE_UID);
    expect(
      nowhere.checked,
      "the nowhere-link must have been looked up, else 'still broken' is vacuous",
    ).toBe("true");
    expect(
      nowhere.className,
      "a link to an asset that exists nowhere must stay broken",
    ).not.toContain(PLACEHOLDER_CLASS);
    expect(nowhere.assetSpace).toBeNull();
    expect(nowhere.text).not.toContain(PAUSE_GLYPH);

    // 3. NEGATIVE CONTROL — a markdown FILE under the parked root that carries
    //    no `exo__Asset_uid` is not an ASSET, so it must not be offered for
    //    activation.
    const nonAsset = linkFor(links, NON_ASSET_BASENAME);
    expect(nonAsset.checked).toBe("true");
    expect(
      nonAsset.className,
      "a non-asset file under the parked root must not produce a placeholder",
    ).not.toContain(PLACEHOLDER_CLASS);
    expect(nonAsset.text).not.toContain(PAUSE_GLYPH);

    // 4. NEGATIVE CONTROL — a valid asset inside the parked mount's own `.git`.
    //    The walk skips nested dot-folders; on a real filesystem that is a real
    //    boundary, not a property of a fake reader.
    const decoy = linkFor(links, DOTFOLDER_BASENAME);
    expect(decoy.checked).toBe("true");
    expect(
      decoy.className,
      "an asset inside a nested dot-folder must stay unfindable",
    ).not.toContain(PLACEHOLDER_CLASS);
    expect(decoy.text).not.toContain(PAUSE_GLYPH);

    // 5. NEGATIVE CONTROL — a RESOLVED link is never even looked up: the
    //    placeholder hangs off the `if (!file)` seam only.
    const resolved = linkFor(links, SEED_AREA_UID);
    expect(
      resolved.checked,
      "a resolved link must never reach the parked lookup",
    ).toBeNull();
    expect(resolved.className).not.toContain(PLACEHOLDER_CLASS);
  });

  test("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f frontmatter channel — a parked link in the Properties block renders the same placeholder", async () => {
    test.setTimeout(300_000);

    await openAssetAndRender(window, NOTE_FM_REL);

    const fmSelector = ".metadata-container a[data-href]";

    await pollUntil(
      "parked placeholder rendered in the Properties block",
      async () => {
        const links = await collectLinks(window, fmSelector);
        const parked = links.find((l) =>
          (l.href ?? "").includes(PARKED_FM_UID),
        );
        return (parked?.className ?? "").includes(PLACEHOLDER_CLASS);
      },
      120_000,
      2_000,
    );

    const links = await collectLinks(window, fmSelector);
    log(`frontmatter links: ${JSON.stringify(links)}`);

    const parked = linkFor(links, PARKED_FM_UID);
    expect(
      parked.text,
      "the frontmatter channel must render the same «<label> ⏸» placeholder",
    ).toBe(`${PARKED_FM_LABEL} ${PAUSE_GLYPH}`);
    expect(parked.className).toContain(PLACEHOLDER_CLASS);
    expect(parked.assetSpace).toBe(PARKED_ASSETSPACE);
  });
});
