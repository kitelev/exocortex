import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  launchObsidianWithPlugin,
  log,
  pollUntil,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — index-cost visibility in the Apply-profile picker (req 6171f443)
 * ============================================================================
 *
 * The VISUAL gate for the index-cost line shipped in v16.207.0. Its unit tests
 * (`tests/unit/domain/profile/indexCost.test.ts`) prove the arithmetic; this
 * spec proves the number a USER actually sees — rendered by the real
 * `ProfileFuzzyModal` inside real Obsidian, priced by the real
 * `ProfileApplyManager.getIndexCostInputs()` walking a real vault.
 *
 * ---------------------------------------------------------------------------
 * WHY an e2e (and why in CI, never locally)
 * ---------------------------------------------------------------------------
 * Standing directive (Andrey, 2026-08-02): anything that needs VISUAL
 * verification gets an explicit E2E UI test with Docker, **run in CI** — local
 * Docker/QEMU runs OOM the machine (and, per
 * `rules/docker-qemu-e2e-multichild-panic.md`, can kernel-panic it). So the
 * pixel-level claim lives here, in the native-amd64 CI suite, not in a
 * one-off manual smoke that leaves no repeatable artifact.
 *
 * ---------------------------------------------------------------------------
 * WHAT makes this non-vacuous (the discriminator)
 * ---------------------------------------------------------------------------
 * The feature's whole point (ALP P0 gate `8b8466bb`) is that a profile's real
 * mount cost is its transitive `exo__AssetSpace_dependsOn` CLOSURE, not the
 * size of the one AssetSpace it declares. So the fixture builds a 3-link chain
 *
 *     exoas-public → exoas-exocmd → exoas-exo
 *
 * and three profiles over it:
 *
 *   - LEAF  declares ONLY `exoas-public`   → must price **3 assetspaces**
 *   - FULL  declares all three explicitly  → must price the SAME string
 *   - FLOOR declares ONLY `exoas-exo`      → must price **1 assetspace**
 *
 * A regression that dropped the closure walk (or priced the declared set) would
 * render "1 assetspace" on LEAF and a smaller file total — both asserted. The
 * LEAF≡FULL equality is a pure invariant: no magic numbers, no coupling to how
 * many files the published repos happen to contain today.
 *
 * The three AssetSpace descriptors point at the three repos the shared fixture
 * already clones, so `derivePath(source)` → `assetspaces/kitelev/<repo>` lands
 * on real on-disk directories and every closure member is genuinely counted
 * (asserted: no `≥` lower-bound marker in the rendered line).
 *
 * Render-only: the picker is dismissed with Escape. Nothing is applied, so the
 * ephemeral vault's mount state is never mutated.
 */

/** `exo__AssetSpace` class UID (registry descriptors are UID-canon). */
const AS_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
/** `exo__Profile` class UID — what `VaultProfileResolver.listProfileFiles` matches. */
const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";
const APPLY_PROFILE_COMMAND_ID = "exocortex:apply-profile";

/** Stable fixture UIDs (`e2e0c057` = "e2e cost"), distinct from the shared seeds. */
const AS_EXO_UID = "e2e0c057-0000-4000-a000-0000000000e0";
const AS_EXOCMD_UID = "e2e0c057-0000-4000-a000-0000000000c0";
const AS_PUBLIC_UID = "e2e0c057-0000-4000-a000-0000000000b0";
const PROFILE_LEAF_UID = "e2e0c057-0000-4000-a000-0000000000f1";
const PROFILE_FULL_UID = "e2e0c057-0000-4000-a000-0000000000f2";
const PROFILE_FLOOR_UID = "e2e0c057-0000-4000-a000-0000000000f3";

const LEAF_LABEL = "E2E Cost Leaf (declares public only)";
const FULL_LABEL = "E2E Cost Full (declares all three)";
const FLOOR_LABEL = "E2E Cost Floor (declares exo only)";

/** Folder the fixture descriptors + profiles live in (outside the cloned repos). */
const FIXTURE_DIR = "e2e-index-cost";

interface PickerRow {
  label: string;
  cost: string | null;
}

function assetSpaceAsset(
  uid: string,
  repo: string,
  namespace: string,
  dependsOn: string[],
): string {
  const deps =
    dependsOn.length === 0
      ? ""
      : `exo__AssetSpace_dependsOn:\n${dependsOn
          .map((d) => `  - "[[${d}]]"`)
          .join("\n")}\n`;
  return (
    `---\n` +
    `exo__Asset_uid: ${uid}\n` +
    `exo__Instance_class:\n  - "[[${AS_CLASS_UID}]]"\n` +
    `exo__Asset_label: "${repo}"\n` +
    `exo__AssetSpace_source: "https://github.com/kitelev/${repo}"\n` +
    `exo__AssetSpace_namespace: "${namespace}"\n` +
    deps +
    `---\n\nEphemeral e2e AssetSpace descriptor. Recreated fresh every run.\n`
  );
}

function profileAsset(uid: string, label: string, includes: string[]): string {
  return (
    `---\n` +
    `exo__Asset_uid: ${uid}\n` +
    `exo__Instance_class:\n  - "[[${PROFILE_CLASS_UID}]]"\n` +
    `exo__Asset_label: "${label}"\n` +
    `exo__Profile_includes:\n${includes.map((i) => `  - "[[${i}]]"`).join("\n")}\n` +
    `---\n\nEphemeral e2e profile. Recreated fresh every run.\n`
  );
}

/**
 * Seed the dependsOn chain + the three profiles into an already-built GUI vault,
 * then commit so any apply-style uncommitted-guard still sees a clean tree.
 *
 * The chain mirrors the real EKA topology (a leaf depends on the shared TBox
 * which depends on the floor), which is exactly the shape that makes "the
 * AssetSpace's own size" a misleading number.
 */
function seedIndexCostFixture(vaultPath: string): void {
  const dir = path.join(vaultPath, FIXTURE_DIR);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, `${AS_EXO_UID}.md`),
    assetSpaceAsset(AS_EXO_UID, "exoas-exo", "exo", []),
  );
  fs.writeFileSync(
    path.join(dir, `${AS_EXOCMD_UID}.md`),
    assetSpaceAsset(AS_EXOCMD_UID, "exoas-exocmd", "exocmd", [AS_EXO_UID]),
  );
  fs.writeFileSync(
    path.join(dir, `${AS_PUBLIC_UID}.md`),
    assetSpaceAsset(AS_PUBLIC_UID, "exoas-public", "public", [AS_EXOCMD_UID]),
  );

  fs.writeFileSync(
    path.join(dir, `${PROFILE_LEAF_UID}.md`),
    profileAsset(PROFILE_LEAF_UID, LEAF_LABEL, [AS_PUBLIC_UID]),
  );
  fs.writeFileSync(
    path.join(dir, `${PROFILE_FULL_UID}.md`),
    profileAsset(PROFILE_FULL_UID, FULL_LABEL, [
      AS_PUBLIC_UID,
      AS_EXOCMD_UID,
      AS_EXO_UID,
    ]),
  );
  fs.writeFileSync(
    path.join(dir, `${PROFILE_FLOOR_UID}.md`),
    profileAsset(PROFILE_FLOOR_UID, FLOOR_LABEL, [AS_EXO_UID]),
  );

  const git = (args: string[]): void => {
    execFileSync("git", args, {
      cwd: vaultPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
  git(["add", "-A"]);
  git([
    "commit",
    "-q",
    "-m",
    "seed index-cost fixture (dependsOn chain + profiles)",
  ]);
  log(`index-cost fixture seeded under ${FIXTURE_DIR}/`);
}

/**
 * The rendered file total, as an integer. Parsed by stripping every non-digit
 * from the segment before the `·` separator — deliberately NOT by matching the
 * formatted string, because `formatFileCount` groups digits with U+202F
 * (NARROW NO-BREAK SPACE) and an assertion carrying an invisible codepoint is
 * unreadable when it fails (rules/edit-tool-unicode-escape-becomes-codepoint).
 */
function costFiles(cost: string): number {
  const head = cost.split("·")[0] ?? "";
  const digits = head.replace(/\D/g, "");
  expect(
    digits.length,
    `no file count parsed from cost line "${cost}"`,
  ).toBeGreaterThan(0);
  return Number(digits);
}

function rowFor(rows: PickerRow[], label: string): PickerRow {
  const row = rows.find((r) => r.label.includes(label));
  expect(
    row,
    `picker must render profile "${label}". Rendered: ${JSON.stringify(rows)}`,
  ).toBeDefined();
  return row as PickerRow;
}

test.describe.configure({ mode: "default" });

test.describe("EKA GUI — Apply-profile index cost (req 6171f443)", () => {
  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;
  let window: Page;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    vaultPath = setupGuiVault();
    seedIndexCostFixture(vaultPath);
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-gui-index-cost");
    window = await launcher.getWindow();
    await waitForStoreSettled(window);
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  test("@req:6171f443-a57f-4d3a-bad6-8d964decb308 picker prices the dependsOn CLOSURE, not the declared AssetSpace", async () => {
    test.setTimeout(300_000);

    // The command exists only when apply deps wired (desktop git path). A miss
    // here is a load-time regression, not a picker bug — say so explicitly.
    const commandIds: string[] = await window.evaluate(() => {
      const app = (window as any).app;
      return (app?.commands?.listCommands?.() ?? []).map(
        (c: { id: string }) => c.id,
      );
    });
    expect(
      commandIds,
      `"${APPLY_PROFILE_COMMAND_ID}" not registered — apply deps unwired?`,
    ).toContain(APPLY_PROFILE_COMMAND_ID);

    // The profile fixtures must be discoverable before the picker can list
    // them (metadataCache indexes the seeded folder asynchronously).
    await pollUntil(
      "index-cost profile fixtures discoverable",
      async () =>
        (await window.evaluate((classUid: string) => {
          const app = (window as any).app;
          let n = 0;
          for (const file of app?.vault?.getMarkdownFiles?.() ?? []) {
            const raw =
              app.metadataCache.getFileCache(file)?.frontmatter?.[
                "exo__Instance_class"
              ];
            const classes = Array.isArray(raw) ? raw : raw ? [raw] : [];
            if (
              classes.some(
                (c: unknown) => typeof c === "string" && c.includes(classUid),
              )
            )
              n++;
          }
          return n;
        }, PROFILE_CLASS_UID)) >= 3,
      120_000,
    );

    // Fire-and-forget callback: it lists profiles (pricing every row against a
    // ONE-shot vault walk) and then opens ProfileFuzzyModal.
    await window.evaluate((id: string) => {
      (window as any).app.commands.executeCommandById(id);
    }, APPLY_PROFILE_COMMAND_ID);

    await expect(
      window.locator(".exocortex-profile-suggestion").first(),
    ).toBeVisible({ timeout: 60_000 });

    // The cost line is rendered asynchronously WITH the row (same render pass),
    // but the vault walk that prices it runs before the modal opens — so once a
    // row is visible the cost is either there or structurally absent (the
    // best-effort catch in `profileLister`). Poll briefly, then read once.
    await pollUntil(
      "cost line rendered",
      async () =>
        (await window.locator(".exocortex-profile-suggestion__cost").count()) >
        0,
      30_000,
      1_000,
    );

    const rows: PickerRow[] = await window.evaluate(() => {
      const out: { label: string; cost: string | null }[] = [];
      document
        .querySelectorAll(".exocortex-profile-suggestion")
        .forEach((el) => {
          out.push({
            label:
              el.querySelector(".exocortex-profile-suggestion__label")
                ?.textContent ?? "",
            cost:
              el.querySelector(".exocortex-profile-suggestion__cost")
                ?.textContent ?? null,
          });
        });
      return out;
    });
    log(`picker rows: ${JSON.stringify(rows)}`);

    const leaf = rowFor(rows, LEAF_LABEL);
    const full = rowFor(rows, FULL_LABEL);
    const floor = rowFor(rows, FLOOR_LABEL);

    // 1. The cost line exists at all — the user-visible deliverable.
    expect(
      leaf.cost,
      "the leaf profile row must carry an index-cost line",
    ).not.toBeNull();
    const leafCost = leaf.cost as string;
    const fullCost = full.cost as string;
    const floorCost = floor.cost as string;

    // 2. CLOSURE expansion: ONE declared AssetSpace prices THREE. This is the
    //    discriminator — pricing the declared set alone would say "1".
    expect(
      leafCost,
      `leaf profile declares 1 AssetSpace but must price its 3-member closure (got "${leafCost}")`,
    ).toMatch(/·\s*3\s+assetspaces\b/);

    // 3. Singular unit on a 1-member closure (pluralisation is user-visible).
    expect(floorCost).toMatch(/·\s*1\s+assetspace\b/);

    // 4. Every closure member was actually counted — no lower-bound marker.
    expect(
      leafCost,
      "every AssetSpace in the closure is on disk, so the cost must not be a lower bound",
    ).not.toContain("≥");

    // 5. Closure-equivalence invariant: declaring the leaf costs exactly what
    //    declaring the whole chain costs. Magic-number-free.
    expect(
      leafCost,
      "declaring only the leaf must price identically to declaring the full chain",
    ).toBe(fullCost);

    // 6. …and that total strictly exceeds the floor-only profile's, i.e. the
    //    closure really pulled additional files in.
    expect(costFiles(leafCost)).toBeGreaterThan(costFiles(floorCost));

    // Render-only smoke: dismiss without applying — the vault's mount state is
    // never mutated (gui-mutation-test-on-temp-vault).
    await window.keyboard.press("Escape");
    await window
      .waitForSelector(".exocortex-profile-suggestion", {
        state: "hidden",
        timeout: 5_000,
      })
      .catch(() => undefined);
  });
});
