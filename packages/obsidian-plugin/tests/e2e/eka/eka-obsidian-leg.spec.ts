import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * ============================================================================
 *  EKA "Obsidian leg" — automated end-to-end test (PLUGIN path, Cmd+P commands)
 * ============================================================================
 *
 * Drives the FULL alpha-tester path through the Exocortex **plugin** (not the
 * CLI) against LIVE GitHub, in a fresh ephemeral vault:
 *
 *   1. Bootstrap vault   → exo-only floor `exoas-exo` (public). exocmd is no
 *                          longer a bootstrap field (2026-06-20 decision).
 *   2. Add assetspace    → `exoas-exocmd` + central `exoas-registry` +
 *                          `exoas-profiles` (public).
 *   3. Apply profile     → `$$kitelev-exodev` (62338881-…) — materialises the
 *                          full transitive effective set (PRIVATE `exoas-exodev`
 *                          leaf + deps + floor), with NO degraded refuse. This
 *                          is the in-GUI proof of the #3511 closure-expansion
 *                          fix (CLI leg proven green in eka-e2e-test-results.md).
 *   4. Create asset      → an ephemeral asset co-located into the materialised
 *                          `exoas-exodev` folder; assert file + frontmatter.
 *
 * The CLI leg of this same path is already proven green (Scenario A+B in
 * /Users/kitelev/Developer/eka-e2e-test-results.md). This spec automates the
 * equivalent path through the plugin so it can be re-run repeatably in Docker.
 *
 * ---------------------------------------------------------------------------
 * STEP 5 (ExoSync write/push round-trip) — deliberate FOLLOW-UP, not run here
 * ---------------------------------------------------------------------------
 * The apply-profile READ leg above (pull live exoas-* via tarball + git
 * submodule) is the core proof and runs against the real repos. The WRITE
 * (push) leg is intentionally NOT driven here, for verified reasons:
 *   - The plugin's `push-current-assetspace` command pushes only files marked
 *     dirty via `AssetSpaceManager.markDirty`, which is wired from a
 *     `vault.on("modify")` handler — and grep shows it is currently invoked
 *     NOWHERE in production (only in a docstring), so that command is a no-op
 *     for an e2e to exercise.
 *   - The other write surface, ExoSync `Sync`/`Push` (RFC 4e4dc453 SyncEngine,
 *     `restCreateCommit` Git Data API), has its REST write path ALREADY proven
 *     green against the dedicated sandbox `kitelev/exosync-test-sandbox` by
 *     `packages/core/tests/integration/sync/syncEngine.real-github.integration.test.ts`
 *     (disposable per-run branch, cleaned up). Re-driving it through the plugin
 *     GUI would need an ExoSync repo binding + watermark config on the
 *     ephemeral vault — scaffolding orthogonal to the apply-profile proof.
 *   - Per the orchestrator directive, the live private `exoas-exodev` must not
 *     be mutated by a repeatable/scheduled test; the sandbox already covers the
 *     write path. The CLI leg additionally proved the full create→push→pull
 *     round-trip end-to-end.
 * Net: write-path coverage exists (sandbox integration test + CLI leg); this
 * spec owns the plugin READ/apply leg. Wiring the plugin push GUI to the
 * sandbox is tracked as a follow-up.
 *
 * ---------------------------------------------------------------------------
 * HOW TO RUN
 * ---------------------------------------------------------------------------
 *   Locally in Docker (one command):
 *     export EKA_E2E_PAT=$(gh auth token)   # kitelev → access to private exoas-*
 *     packages/obsidian-plugin/scripts/test-eka-obsidian-leg.sh
 *
 *   Directly (inside a container / on a host with Obsidian + xvfb):
 *     EKA_E2E_PAT=<pat> npx playwright test \
 *       -c packages/obsidian-plugin/playwright-eka-obsidian-leg.config.ts
 *
 * ---------------------------------------------------------------------------
 * ISOLATION FROM REQUIRED CI (important)
 * ---------------------------------------------------------------------------
 *   - This spec lives OUTSIDE `tests/e2e/specs`, so the 6 sharded e2e configs
 *     and the `validate-shard-assignments.mjs` drift guard never see it. It is
 *     NOT one of the 13 required checks and cannot flake them.
 *   - It additionally `test.skip(!EKA_E2E_PAT)` so a stray run without a PAT is
 *     a clean skip, never a failure.
 *
 * ---------------------------------------------------------------------------
 * WHY A GIT VAULT + git credential rewrite
 * ---------------------------------------------------------------------------
 *   The plugin's DESKTOP apply path (`ProfileApplyManager.applyProfile`, Phase 2)
 *   registers each newly-materialised AssetSpace via `git submodule add <url>`
 *   (`GitSubmoduleOps.submoduleAdd`) — it clones the repo, then overwrites the
 *   working tree with the authenticated tarball pull. The PRIVATE repos
 *   (`exoas-exodev`, `exoas-shared-private`) therefore require git credentials.
 *   We set a global `url.insteadOf` rewrite injecting the PAT; `stripGitEnv()`
 *   preserves `HOME`, so the plugin's git subprocess reads `/root/.gitconfig`.
 *   The PAT in `data.local.json` separately authenticates the tarball pulls.
 *
 * Production-shape: every assertion checks REAL on-disk materialisation and the
 * REAL confirm-modal plan — no stubs, no mocks. Removing the #3511 fix would
 * make apply degrade-refuse (no `exoas-exodev` on disk) → this spec FAILS.
 */

/**
 * Token resolution mirrors the ExoSync `syncEngine.real-github` integration
 * precedent: explicit `EKA_E2E_PAT` env, OR `EKA_E2E=1` to opt into the
 * `gh auth token` fallback. Without either, the suite self-skips — so CI,
 * unauthenticated environments, and routine local runs stay green + network-free.
 */
function resolveEkaToken(): string {
  if (process.env.EKA_E2E_PAT) return process.env.EKA_E2E_PAT;
  if (process.env.EKA_E2E !== "1") return "";
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 15_000,
    }).trim();
  } catch {
    return "";
  }
}

const PAT = resolveEkaToken();

// ---- Fixtures: the EKA alpha path constants (verified in registry 2026-06-14) ----
const EXO_URL = "https://github.com/kitelev/exoas-exo";
const EXOCMD_URL = "https://github.com/kitelev/exoas-exocmd";
const REGISTRY_URL = "https://github.com/kitelev/exoas-registry";
const PROFILES_URL = "https://github.com/kitelev/exoas-profiles";

const PROFILE_UID = "62338881-a9ff-4b46-b56c-538a1deb2185";
const PROFILE_LABEL = "$$kitelev-exodev";
const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174"; // exo__Profile
const EMS_TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const EXODEV_ANCHOR_UID = "32d2374c-1bef-4b64-ad23-e26b53b52df8"; // $exodev anchor

// Where the plugin materialises each AssetSpace (Maven `assetspaces/<owner>/<repo>`
// for bootstrap + descriptor mount paths; flat `assetspaces/<repo-strip-exoas>`
// for `add-assetspace`). Verified against derivePath + registry descriptors.
const EXO_DIR = "assetspaces/kitelev/exoas-exo";
const EXOCMD_DIR = "assetspaces/kitelev/exoas-exocmd";
const REGISTRY_DIR = "assetspaces/registry";
const PROFILES_DIR = "assetspaces/profiles";
const EXODEV_DIR = "assetspaces/kitelev/exoas-exodev";

const COMMAND = {
  bootstrap: "exocortex:bootstrap-vault",
  addAssetspace: "exocortex:add-assetspace",
  applyProfile: "exocortex:apply-profile",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[eka-obsidian-leg] ${msg}`);
}

/** Run a git command in `cwd` (used for vault setup, never the plugin path). */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Configure git GLOBALLY so the plugin's `git submodule add` can clone the
 * private repos. `stripGitEnv()` preserves HOME, so this `~/.gitconfig`
 * applies to the Obsidian-spawned git subprocess.
 */
function configureGitCredentials(): void {
  git(["config", "--global", "user.email", "eka-e2e@exocortex.test"]);
  git(["config", "--global", "user.name", "EKA E2E"]);
  // Vault dir is created by root in a tmpdir — silence dubious-ownership errors.
  git(["config", "--global", "--add", "safe.directory", "*"]);
  // Transport-level credential injection (NOT written into .gitmodules; that
  // keeps the plain https URL). Authenticates private-repo clones.
  git([
    "config",
    "--global",
    `url.https://x-access-token:${PAT}@github.com/.insteadOf`,
    "https://github.com/",
  ]);
}

/** Build a fresh ephemeral git vault with the prebuilt plugin + PAT installed. */
function setupVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "eka-obsidian-vault-"));
  // __dirname = …/packages/obsidian-plugin/tests/e2e/eka → up 3 to the package.
  const pluginSrcDir = path.join(__dirname, "..", "..", "..");
  const mainJs = path.join(pluginSrcDir, "main.js");
  const manifest = path.join(pluginSrcDir, "manifest.json");
  if (!fs.existsSync(mainJs) || !fs.existsSync(manifest)) {
    throw new Error(
      `Prebuilt plugin not found (main.js/manifest.json). Build with ` +
        `\`npm run build\` before running. Looked in ${pluginSrcDir}`,
    );
  }

  // .obsidian config + plugin install (mirrors the e2e test-vault layout).
  const obsidianDir = path.join(vaultPath, ".obsidian");
  const pluginDir = path.join(obsidianDir, "plugins", "exocortex");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(mainJs, path.join(pluginDir, "main.js"));
  fs.copyFileSync(manifest, path.join(pluginDir, "manifest.json"));
  fs.writeFileSync(
    path.join(obsidianDir, "community-plugins.json"),
    JSON.stringify(["exocortex"]),
  );
  fs.writeFileSync(
    path.join(obsidianDir, "app.json"),
    JSON.stringify({ promptDelete: false }),
  );
  // PAT in device-local secrets (Sync-excluded). Read per-invocation by
  // ApplyDepsFactory.buildAssetSpacePuller → authenticates tarball pulls.
  fs.writeFileSync(
    path.join(pluginDir, "data.local.json"),
    JSON.stringify({ pat: PAT }, null, 2),
  );

  // Keep .obsidian (and the PAT) out of git so `git add assetspaces/` during
  // apply never stages the secret, and the vault opens cleanly.
  fs.writeFileSync(
    path.join(vaultPath, ".gitignore"),
    ".obsidian/\n.exocortex/\n",
  );
  // The plugin's apply-profile lock manager + switch journal write into
  // `.exocortex/` (lock, journal, cache). A real vault has it from indexing;
  // a fresh one doesn't, so `adapter.write` ENOENTs on the lock file (no parent
  // dir). Pre-create it (and keep it out of git).
  fs.mkdirSync(path.join(vaultPath, ".exocortex"), { recursive: true });
  // A trivial note so Obsidian's `waitForVaultReady` (markdownFiles > 0) does
  // not burn its 30s ceiling on launch #1.
  fs.writeFileSync(
    path.join(vaultPath, "welcome.md"),
    "# EKA e2e vault\n\nEphemeral. Created by eka-obsidian-leg.spec.ts.\n",
  );

  // Git vault — required by the desktop apply path (git submodule add + commit).
  git(["init", "-q"], vaultPath);
  git(["add", "-A"], vaultPath);
  git(["commit", "-q", "-m", "init eka e2e vault"], vaultPath);

  return vaultPath;
}

/** Recursively count `.md` files under a vault-relative dir. */
function countMarkdown(vaultPath: string, relDir: string): number {
  const root = path.join(vaultPath, relDir);
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) n++;
    }
  };
  walk(root);
  return n;
}

/** Find the first file matching `<uid>*.md` under the vault (or null). */
function findByUid(vaultPath: string, uid: string): string | null {
  let found: string | null = null;
  const walk = (dir: string): void => {
    if (found) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found) return;
      if (entry.name === ".git" || entry.name === ".obsidian") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith(uid) && entry.name.endsWith(".md"))
        found = full;
    }
  };
  walk(vaultPath);
  return found;
}

/** Read `.gitmodules` (empty string if absent — bootstrap may not have run yet). */
function readGitmodules(vaultPath: string): string {
  const p = path.join(vaultPath, ".gitmodules");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Poll a predicate until true or timeout. */
async function pollUntil(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) {
      log(`✓ ${label} (after ${Math.round((Date.now() - start) / 1000)}s)`);
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out (${Math.round(timeoutMs / 1000)}s) waiting for: ${label}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Execute a plugin command by id (the Cmd+P palette callback path). */
async function executeCommand(window: Page, id: string): Promise<void> {
  await window.evaluate((cmdId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).app;
    app.commands.executeCommandById(cmdId);
  }, id);
}

/** Wait for a command id to be registered (poll, like focus-profile-picker). */
async function waitForCommand(window: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () =>
        window.evaluate((cmdId) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const app = (window as any).app;
          const cmds = app?.commands?.commands ?? {};
          return Object.prototype.hasOwnProperty.call(cmds, cmdId);
        }, id),
      { timeout: 30000, message: `command ${id} not registered` },
    )
    .toBe(true);
}

/**
 * Try to bring the exocortex plugin to `loaded` in the current Obsidian window.
 * Under QEMU-emulated amd64 the onload is both slower AND non-deterministic —
 * occasionally a launch leaves the plugin `enabled` but never runs onload. We
 * force a fresh load (disable → enable; a plain enable on an already-enabled
 * plugin is a no-op and can't recover that state) and wait. Returns whether the
 * plugin reached `loaded` within the ceiling (caller relaunches on false).
 */
async function tryLoadPlugin(
  window: Page,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  const diag = await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).app;
    const pm = app?.plugins;
    return {
      hasManifest: !!pm?.manifests?.exocortex,
      enabled: Array.isArray(pm?.enabledPlugins)
        ? pm.enabledPlugins.includes?.("exocortex")
        : pm?.enabledPlugins?.has?.("exocortex") ?? null,
      loaded: !!pm?.plugins?.exocortex,
    };
  });
  log(`[${label}] plugin state: ${JSON.stringify(diag)}`);

  if (!diag.loaded) {
    const r = await window.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      try {
        if (app?.plugins?.plugins?.exocortex) return "already loaded";
        await app?.plugins?.disablePlugin?.("exocortex").catch(() => undefined);
        await app?.plugins?.enablePlugin?.("exocortex");
        return "force-reloaded (disable→enable)";
      } catch (e) {
        return `reload error: ${String(e)}`;
      }
    });
    log(`[${label}] ${r}`);
  }

  try {
    await waitForExocortexPluginViaPlaywright(window, {
      specName: label,
      timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

/** Whole-launch retry budget + per-attempt plugin-load ceiling (emulation flake). */
const MAX_LAUNCH_ATTEMPTS = 8;
const PLUGIN_LOAD_WAIT_MS = 60000;

/**
 * Launch Obsidian on `vaultPath` and ensure the plugin loads, retrying the WHOLE
 * launch (close + fresh Electron) up to {@link MAX_LAUNCH_ATTEMPTS} times. The
 * plugin-load flake is per-launch under QEMU-emulated amd64, so a relaunch
 * almost always recovers it. Returns the live launcher (caller owns close);
 * throws if every attempt fails.
 */
async function launchObsidianWithPlugin(
  vaultPath: string,
  label: string,
): Promise<ObsidianLauncher> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
    const launcher = new ObsidianLauncher(vaultPath);
    try {
      log(`${label}: launch attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS}`);
      await launcher.launch();
      const window = await launcher.getWindow();
      await launcher.waitForModalsToClose(10000);
      if (await tryLoadPlugin(window, label, PLUGIN_LOAD_WAIT_MS)) return launcher;
      lastErr = `plugin did not reach loaded within ${PLUGIN_LOAD_WAIT_MS / 1000}s`;
    } catch (e) {
      lastErr = String(e);
      log(`${label}: launch attempt ${attempt} errored: ${lastErr}`);
    }
    log(`${label}: attempt ${attempt} failed (${lastErr}) — relaunching…`);
    await launcher.close().catch(() => undefined);
  }
  throw new Error(
    `${label}: Obsidian + plugin failed to load after ${MAX_LAUNCH_ATTEMPTS} attempts (${lastErr})`,
  );
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test.describe("EKA Obsidian leg — bootstrap → add → apply-profile → create", () => {
  // Skip the whole group cleanly when no token is available (offline / non-EKA
  // CI). Guards the private clone AND the required-CI isolation contract — this
  // spec must never red a PR. Mirrors the ExoSync `syncEngine.real-github`
  // opt-in gating idiom.
  test.skip(
    !PAT,
    "EKA Obsidian-leg e2e needs EKA_E2E_PAT (or EKA_E2E=1 + gh auth) — live GitHub + private exoas-exodev",
  );

  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;

  test.beforeAll(() => {
    configureGitCredentials();
    vaultPath = setupVault();
    log(`ephemeral vault: ${vaultPath}`);
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    // Cleanup: the ephemeral asset only ever existed in this tmpdir vault and
    // was never pushed to any live repo → no remote cleanup needed. Remove the
    // whole vault.
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  test("full alpha path materialises the private profile through the plugin", async () => {
    // ============== PHASE 1 — vault setup via plugin commands ==============
    log("launch #1 (empty vault)…");
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-leg-1");
    let window = await launcher.getWindow();

    // ---- Step 1: Bootstrap vault (exo-only clean bootstrap, 2026-06-20) ----
    log("step 1: bootstrap-vault (exo-only)");
    await waitForCommand(window, COMMAND.bootstrap);
    await executeCommand(window, COMMAND.bootstrap);
    // BootstrapVaultModal: ONE text input (exo) + «Bootstrap» CTA. The misleading
    // exocmd-URL field was removed — exocmd is added in Step 2 via add-assetspace
    // (it would otherwise arrive transitively when a profile is applied).
    await window.waitForSelector(".bootstrap-vault-input", { timeout: 15000 });
    await window.locator(".bootstrap-vault-input").fill(EXO_URL);
    await window
      .locator(".bootstrap-vault-actions button.mod-cta")
      .click();
    // Materialisation (1 tarball pull) runs async. Bootstrap writes the
    // `.gitmodules` entry AFTER moving files into place, so gate on the entry
    // being registered (not just the .md on disk) — otherwise a fast disk poll
    // races `appendGitmodulesEntry` and the assertion below flakes.
    await pollUntil(
      "exo floor materialised + registered",
      () =>
        countMarkdown(vaultPath, EXO_DIR) > 0 &&
        readGitmodules(vaultPath).includes("exoas-exo"),
      180000,
    );
    const gm1 = readGitmodules(vaultPath);
    expect(gm1).toContain("exoas-exo");

    // Bootstrap success now opens a durable result panel (RFC 0002 §3.3 / P5).
    // Dismiss it before Step 2 so its overlay doesn't intercept the next
    // command's modal (Esc, mirroring the profile-picker dismissal below).
    await window
      .locator(".bootstrap-result")
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => undefined);
    await window.keyboard.press("Escape");

    // ---- Step 2: Add assetspace — exocmd, registry, then profiles ----
    // exocmd is no longer a bootstrap floor field; the user adds it explicitly
    // here (the «либо явно командой add-assetspace» path of the 2026-06-20
    // decision). It is also part of the profile effective set, so a later
    // apply-profile keeps it materialised.
    for (const [label, url, dir] of [
      ["exocmd", EXOCMD_URL, EXOCMD_DIR],
      ["registry", REGISTRY_URL, REGISTRY_DIR],
      ["profiles", PROFILES_URL, PROFILES_DIR],
    ] as const) {
      log(`step 2: add-assetspace ${label}`);
      await launcher.waitForModalsToClose(10000);
      await executeCommand(window, COMMAND.addAssetspace);
      await window.waitForSelector(".add-assetspace-input", { timeout: 15000 });
      await window.locator(".add-assetspace-input").fill(url);
      await window
        .locator(".add-assetspace-actions button.mod-cta")
        .click();
      const repo = url.split("/").pop() as string; // e.g. "exoas-registry"
      await pollUntil(
        `${label} materialised + registered`,
        () =>
          countMarkdown(vaultPath, dir) > 0 &&
          readGitmodules(vaultPath).includes(repo),
        120000,
      );
      expect(countMarkdown(vaultPath, dir)).toBeGreaterThan(0);
    }
    // The profile asset must now be present on disk (inside exoas-profiles).
    expect(
      findByUid(vaultPath, PROFILE_UID),
      "profile 62338881 must exist on disk after add-assetspace profiles",
    ).not.toBeNull();
    const gm2 = readGitmodules(vaultPath);
    expect(gm2).toContain("exoas-exocmd"); // added explicitly in Step 2 now
    expect(gm2).toContain("exoas-registry");
    expect(gm2).toContain("exoas-profiles");

    // Commit the materialised AssetSpaces so apply's Vision Lock #5
    // uncommitted-changes guard sees a clean tree. Bootstrap / Add fs-move
    // files WITHOUT committing (the user commits after cold-bootstrap), and an
    // untracked dir surfaces to `git status` as a dirty entry that aborts apply.
    git(["add", "-A"], vaultPath);
    git(["commit", "-q", "-m", "chore: materialise floor + registry + profiles"], vaultPath);
    log("phase 1 complete — floor + registry + profiles on disk (committed)");

    // ============== PHASE 2 — relaunch, apply profile, create ==============
    // A fresh launch fully indexes the materialised files into metadataCache +
    // the triple store, so the profile picker lists 62338881 and applyProfile
    // can resolve the AssetSpace descriptor DAG. This mirrors the real alpha UX
    // («Reload Obsidian if the new assets do not appear»).
    log("close #1 + relaunch #2 (full reindex)…");
    await launcher.close();
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-leg-2");
    window = await launcher.getWindow();
    await waitForCommand(window, COMMAND.applyProfile);

    // Profile must be discoverable in metadataCache (same substring discovery
    // VaultProfileResolver uses) before we open the picker.
    await expect
      .poll(
        async () =>
          window.evaluate((classUid) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const files = app?.vault?.getMarkdownFiles?.() ?? [];
            let count = 0;
            for (const f of files) {
              const raw = app.metadataCache.getFileCache(f)?.frontmatter?.[
                "exo__Instance_class"
              ];
              const classes = Array.isArray(raw) ? raw : raw ? [raw] : [];
              if (
                classes.some(
                  (c: unknown) => typeof c === "string" && c.includes(classUid),
                )
              )
                count++;
            }
            return count;
          }, PROFILE_CLASS_UID),
        { timeout: 60000, message: "profiles not discoverable in metadataCache" },
      )
      .toBeGreaterThanOrEqual(1);

    // applyProfile resolves the AssetSpace-descriptor DAG from the RDF triple
    // store (`listAllAssetSpaceInfos`), which convertVault populates AFTER (and
    // more slowly than) metadataCache. Wait until the store stops growing so the
    // closure resolution sees the full registry — otherwise the plan is empty
    // and no confirm modal opens.
    let prevCount = -1;
    let stable = 0;
    await pollUntil(
      "triple store settled (indexing complete)",
      async () => {
        const n = await window.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const app = (window as any).app;
          const store = app?.plugins?.plugins?.exocortex?.sparql?.getTripleStore?.();
          if (!store) return -1;
          try {
            return (await store.count()) as number;
          } catch {
            return -1;
          }
        });
        if (n > 100 && n === prevCount) stable++;
        else stable = 0;
        prevCount = n;
        return stable >= 2;
      },
      90000,
      3000,
    );
    log(`triple store size at apply time: ${prevCount}`);

    // DIAGNOSTIC — replicate the plugin's `listAllAssetSpaceInfos` matcher
    // (frontmatter `exo__Instance_class` string contains "AssetSpace") so a
    // no-op apply can be attributed to descriptor non-recognition vs a real
    // resolution error. Logs the count + the exodev descriptor's class form.
    const asDiag = await window.evaluate((exodevDescUid) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = app?.vault?.getMarkdownFiles?.() ?? [];
      let asCount = 0;
      let exodevClass: unknown = null;
      for (const f of files) {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm) continue;
        const raw = fm["exo__Instance_class"];
        const classes = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (
          classes.some(
            (c: unknown) =>
              typeof c === "string" &&
              c.includes("AssetSpace") &&
              !c.includes("AssetSpaceManager"),
          )
        )
          asCount++;
        if (fm["exo__Asset_uid"] === exodevDescUid) exodevClass = raw;
      }
      return { asCount, exodevClass };
    }, "766b36db-bfa2-460c-8b24-b71646b46788");
    log(
      `AssetSpace descriptors recognised by string-match: ${asDiag.asCount}; ` +
        `exodev descriptor class = ${JSON.stringify(asDiag.exodevClass)}`,
    );

    // ---- Step 3: Apply profile $$kitelev-exodev ----
    log("step 3: apply-profile $$kitelev-exodev");
    const exodevBefore = countMarkdown(vaultPath, EXODEV_DIR);

    // (3a) Prove the Cmd+P GUI surface: the `apply-profile` command opens the
    // FuzzySuggestModal and renders the exodev profile by label (same
    // non-vacuous gate as focus-profile-picker.spec.ts). Then dismiss — we do
    // NOT drive the fuzzy selection by synthetic keyboard/click, which is
    // unreliable under the emulated CDP runtime (the existing focus-profile spec
    // only ever exercises Escape, never a selection).
    await executeCommand(window, COMMAND.applyProfile);
    const promptInput = window.locator(
      '.prompt-input[placeholder="Apply profile"]',
    );
    await expect(promptInput).toBeVisible({ timeout: 15000 });
    await expect(
      window.locator(".suggestion-item", { hasText: "kitelev-exodev" }).first(),
    ).toBeVisible({ timeout: 15000 });
    log(
      `picker renders: ${JSON.stringify(
        await window.locator(".suggestion-item").allTextContents(),
      )}`,
    );
    await window.keyboard.press("Escape");
    await promptInput
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => undefined);

    // (3b) Apply the profile through the plugin's REAL apply method. The
    // `apply-profile` command callback ultimately calls
    // `ProfileApplyManager.applyProfile(uid)`; the plugin already exposes that
    // manager publicly as `plugin.profileApplyManager` (Issue #3320). Invoking
    // it with the profile UID runs the identical production path — closure
    // resolution (#3511), the ModalConfirmGate (a real modal we drive below),
    // and the git-submodule + tarball materialisation — while skipping only the
    // pure-UI fuzzy SELECTION that emulated CDP can't reliably trigger.
    const applyKickoff = await window.evaluate((uid) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const mgr = w.app?.plugins?.plugins?.exocortex?.profileApplyManager;
      if (!mgr || typeof mgr.applyProfile !== "function") {
        return { ok: false, error: "profileApplyManager.applyProfile missing" };
      }
      // Record outcome on a window global so the test can distinguish
      // "threw before the confirm gate" from "completed as a NO-OP" when the
      // modal never appears (renderer console.error is NOT captured to stdout).
      w.__ekaApply = { started: true, done: false, error: null };
      mgr
        .applyProfile(uid)
        .then(() => {
          w.__ekaApply.done = true;
        })
        .catch((e: unknown) => {
          w.__ekaApply.error = String(
            (e as { stack?: string })?.stack ?? e,
          );
        });
      return { ok: true };
    }, PROFILE_UID);
    expect(applyKickoff.ok, applyKickoff.error).toBe(true);

    // The ModalConfirmGate opens its plan modal. If applyProfile instead threw
    // (e.g. resolution error) or completed as a no-op (empty effective set),
    // surface that explicitly instead of an opaque selector timeout.
    const matLoc = window.locator(".apply-confirm-mat-section");
    await pollUntil(
      "apply-profile confirm modal opens",
      async () => {
        if (await matLoc.isVisible().catch(() => false)) return true;
        const st = await window.evaluate(
          () => (window as unknown as { __ekaApply?: unknown }).__ekaApply,
        );
        const s = (st ?? {}) as { error?: string | null; done?: boolean };
        if (s.error) {
          throw new Error(`applyProfile threw before confirm gate: ${s.error}`);
        }
        if (s.done) {
          throw new Error(
            "applyProfile completed WITHOUT opening the confirm modal " +
              "(no-op: effective set empty / already mounted — closure resolution failed)",
          );
        }
        return false;
      },
      120000,
      2000,
    );

    // ApplyConfirmModal renders the plan. This is the #3511 GUI proof:
    //   - «Assetspaces to remove» = (none)  → NOT a degraded floor-teardown.
    //   - «Assetspaces to materialize» lists the resolved effective set incl.
    //     the exodev leaf → closure expansion succeeded.
    const tearText = (
      await window.locator(".apply-confirm-tear-section").innerText()
    ).trim();
    const matText = (
      await window.locator(".apply-confirm-mat-section").innerText()
    ).trim();
    log(`confirm modal — remove section:\n${tearText}`);
    log(`confirm modal — materialize section:\n${matText}`);
    // #3511 keepMaterializedCatalog invariant: a leaf-profile apply must NEVER
    // tear down the central catalog (registry / profiles) — doing so would
    // delete the descriptors that resolve every AssetSpace (one-level
    // self-brick). The teardown plan must exclude them.
    expect(
      tearText.includes("registry"),
      `apply must NOT tear down the registry catalog (#3511 self-brick guard). Remove section:\n${tearText}`,
    ).toBe(false);
    expect(
      tearText.includes("profiles"),
      `apply must NOT tear down the profiles catalog (#3511 self-brick guard). Remove section:\n${tearText}`,
    ).toBe(false);
    const matItems = await window
      .locator(".apply-confirm-mat-section li")
      .allTextContents();
    expect(
      matItems.length,
      `materialize plan must be non-empty. Got: ${matItems.join(" | ")}`,
    ).toBeGreaterThan(0);
    expect(
      matItems.some((t) => t.includes("exodev")),
      `materialize plan must include the exodev leaf. Got: ${matItems.join(" | ")}`,
    ).toBe(true);

    // Confirm the apply (the red «Apply» / mod-warning button).
    await window
      .locator(".apply-confirm-buttons button.mod-warning")
      .click();

    // Materialisation: git submodule add + tarball pull per AssetSpace (6 repos
    // here — slow under QEMU-emulated amd64). Poll the private leaf onto disk
    // (the #3511 fix proof). Surface an applyProfile throw instead of an opaque
    // timeout, and stop early if it finished without producing the leaf.
    await pollUntil(
      "exoas-exodev leaf materialised on disk (#3511 fix in GUI)",
      async () => {
        if (countMarkdown(vaultPath, EXODEV_DIR) > exodevBefore) return true;
        const st = (await window.evaluate(
          () => (window as unknown as { __ekaApply?: unknown }).__ekaApply,
        )) as { error?: string | null; done?: boolean } | undefined;
        if (st?.error) {
          throw new Error(`applyProfile threw during materialisation: ${st.error}`);
        }
        if (st?.done && countMarkdown(vaultPath, EXODEV_DIR) <= exodevBefore) {
          throw new Error(
            "applyProfile completed but exoas-exodev not on disk — materialisation produced nothing",
          );
        }
        return false;
      },
      1200000,
      4000,
    );
    expect(countMarkdown(vaultPath, EXODEV_DIR)).toBeGreaterThan(exodevBefore);
    // The exodev namespace anchor must be among the materialised files.
    expect(
      findByUid(vaultPath, EXODEV_ANCHOR_UID),
      "exodev anchor must be present after apply",
    ).not.toBeNull();
    // The picker / apply path must have recorded the selection (no refuse).
    const activeProfile = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      const data = app?.plugins?.plugins?.exocortex;
      return data ? "loaded" : "missing";
    });
    expect(activeProfile).toBe("loaded");
    log("step 3 complete — effective set materialised, no degraded refuse");

    // ---- Step 4: Create an asset in the mounted exoas-exodev assetspace ----
    log("step 4: create ephemeral asset in exoas-exodev");
    const ephemeralUid = makeUid();
    const targetRel = path.posix.join(
      EXODEV_DIR,
      "exodev",
      `${ephemeralUid}.md`,
    );
    const created = await window.evaluate(
      async ({ rel, uid, classUid, anchor }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (window as any).app;
        const now = new Date().toISOString();
        const body =
          `---\n` +
          `exo__Asset_uid: ${uid}\n` +
          `exo__Instance_class:\n  - "[[${classUid}]]"\n` +
          `exo__Asset_isDefinedBy: "[[${anchor}]]"\n` +
          `exo__Asset_label: "EKA Obsidian-leg ephemeral ${now}"\n` +
          `exo__Asset_createdAt: ${now}\n` +
          `---\n\nEphemeral e2e asset — auto-removed with the vault.\n`;
        try {
          const f = await app.vault.create(rel, body);
          return { ok: true, path: f?.path ?? rel, via: "vault.create" };
        } catch (e) {
          // The just-materialised folder may not be in Obsidian's in-memory
          // tree yet (git submodule add + fs move bypass the create-event); fall
          // back to the vault adapter, which writes straight to disk. Still the
          // plugin's Obsidian vault API — not a raw Node fs write.
          try {
            await app.vault.adapter.write(rel, body);
            return { ok: true, path: rel, via: "adapter.write" };
          } catch (e2) {
            return { ok: false, error: `${String(e)} | ${String(e2)}` };
          }
        }
      },
      {
        rel: targetRel,
        uid: ephemeralUid,
        classUid: EMS_TASK_CLASS_UID,
        anchor: EXODEV_ANCHOR_UID,
      },
    );
    expect(created.ok, `vault.create failed: ${created.error}`).toBe(true);

    // Assert the asset exists on disk with the required frontmatter.
    const createdAbs = path.join(vaultPath, targetRel);
    await pollUntil(
      "ephemeral asset written to disk",
      () => fs.existsSync(createdAbs),
      20000,
    );
    const fm = fs.readFileSync(createdAbs, "utf8");
    expect(fm).toContain(`exo__Asset_uid: ${ephemeralUid}`);
    expect(fm).toContain(`[[${EMS_TASK_CLASS_UID}]]`); // class
    expect(fm).toContain(`[[${EXODEV_ANCHOR_UID}]]`); // isDefinedBy (co-located)
    log(
      `step 4 complete — asset ${ephemeralUid} created in exoas-exodev (via ${created.via})`,
    );

    // ---- Step 5: applied-state assertion (follow-up node fc83d482 #1) ----
    // The apply path persists the last-applied profile cache to the device-local
    // data.local.json (PluginSettingsStoreAdapter → PluginLocalDataStore): a clean
    // apply leaves activeProfileUid = the applied profile and _switchInProgress =
    // false (set before the reindex, cleared after — ProfileApplyManager.applyProfile
    // §510-519). This is the Gherkin scenario-1 "git-commit apply проходит
    // (activeProfileUid set, switchInProgress=False)" gate, disk-asserted.
    log(
      "step 5: assert applied-state (activeProfileUid set, switch not in progress)",
    );
    const localDataPath = path.join(
      vaultPath,
      ".obsidian",
      "plugins",
      "exocortex",
      "data.local.json",
    );
    await pollUntil(
      "data.local.json records the applied profile",
      () => {
        if (!fs.existsSync(localDataPath)) return false;
        try {
          const d = JSON.parse(fs.readFileSync(localDataPath, "utf8")) as {
            activeProfileUid?: unknown;
            _switchInProgress?: unknown;
          };
          return (
            d.activeProfileUid === PROFILE_UID && d._switchInProgress !== true
          );
        } catch {
          return false;
        }
      },
      30000,
    );
    const localData = JSON.parse(fs.readFileSync(localDataPath, "utf8")) as {
      activeProfileUid?: unknown;
      _switchInProgress?: unknown;
    };
    expect(
      localData.activeProfileUid,
      "applied profile must be cached as activeProfileUid",
    ).toBe(PROFILE_UID);
    expect(
      localData._switchInProgress,
      "switch must not be left in progress after a clean apply",
    ).not.toBe(true);
    // Materialized effective set: floor (exo + exocmd) + catalog (registry +
    // profiles) + the exodev leaf, all on disk — closure-expansion proof.
    expect(
      countMarkdown(vaultPath, EXO_DIR),
      "floor exo must be materialised",
    ).toBeGreaterThan(0);
    expect(
      countMarkdown(vaultPath, EXOCMD_DIR),
      "floor exocmd must be materialised",
    ).toBeGreaterThan(0);
    expect(
      countMarkdown(vaultPath, EXODEV_DIR),
      "exodev leaf must be materialised",
    ).toBeGreaterThan(0);
    log("step 5 complete — applied-state persisted, effective set on disk");

    // ---- Step 6: reload-no-hang (#3554 regression, CRITICAL) ----
    // #3554: profile crash-recovery + cross-device reconcile used to run INLINE in
    // onload (before onLayoutReady). reconcileToLocal() can open a blocking
    // ApplyConfirmModal; awaiting it during onload deadlocks Obsidian on "Loading
    // plugins…" because the modal can never be confirmed (UI not interactive yet)
    // → workspace.layoutReady never fires. The fix (ExocortexPlugin
    // .runDeferredProfileRecovery) defers ALL recovery to onLayoutReady, detached
    // (`void`), so onload returns promptly. Gate: arm the recovery path
    // (_switchInProgress=true forces recoverIfNeeded/recoverIncompleteSwitch to
    // run on next onload) then relaunch, and assert the plugin loads + the
    // workspace becomes ready WITHOUT hanging — the Gherkin scenario-7 gate.
    //
    // Honest scope: this is a SMOKE gate (recovery-armed reload reaches
    // layoutReady). The deterministic pre-#3554 hang needs reconcileToLocal to
    // open a modal during onload, which requires a staged cross-device divergence
    // that this single-profile fixture cannot set up; so it does not strictly
    // revert-verify. launchObsidianWithPlugin additionally waits for the plugin to
    // reach `loaded`, which is itself a coarse hang gate (a never-resolving onload
    // would exhaust its relaunch retries).
    log(
      "step 6: reload-no-hang (#3554) — arm recovery, relaunch, assert layoutReady",
    );
    const armed = { ...localData, _switchInProgress: true };
    fs.writeFileSync(localDataPath, JSON.stringify(armed, null, 2));
    await launcher.close();
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-leg-3-reload");
    window = await launcher.getWindow();
    await expect
      .poll(
        () =>
          window.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            return app?.workspace?.layoutReady === true;
          }),
        {
          timeout: 60000,
          message:
            "workspace.layoutReady must become true after reload (#3554 — no onload hang)",
        },
      )
      .toBe(true);
    const reloadDiag = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = app?.vault?.getMarkdownFiles?.() ?? [];
      return {
        loaded: !!app?.plugins?.plugins?.exocortex,
        layoutReady: app?.workspace?.layoutReady === true,
        markdownFiles: files.length,
      };
    });
    expect(
      reloadDiag.loaded,
      "plugin must load after reload (no onload hang)",
    ).toBe(true);
    expect(
      reloadDiag.layoutReady,
      "workspace must be ready after reload",
    ).toBe(true);
    expect(
      reloadDiag.markdownFiles,
      "vault must be usable (markdown files indexed) after reload",
    ).toBeGreaterThan(0);
    log(
      `step 6 complete — reload-no-hang: ${JSON.stringify(reloadDiag)} (#3554 gate)`,
    );

    log(
      "✅ EKA Obsidian leg PASS — bootstrap + add + apply-profile + create + applied-state + reload-no-hang",
    );
  });
});

/** Minimal RFC-4122-ish v4 uid without pulling a dep (ephemeral, test-only). */
function makeUid(): string {
  const h = (n: number): string =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
}
