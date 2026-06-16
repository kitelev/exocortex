import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * ============================================================================
 *  EKA GUI BDD — shared fresh-vault fixture + drive helpers
 * ============================================================================
 *
 * Backs the GUI-BDD-CI suite (node a2e20c69 Ф4): the prose Gherkin scenarios in
 * vault node 76d9207c, formalised as repeatable e2e specs that exercise the
 * Exocortex *plugin* against a FRESH ephemeral vault built from the REAL
 * published `kitelev/exoas-*` ontology repos.
 *
 * ---------------------------------------------------------------------------
 * WHY "real published content" instead of hand-written fixtures
 * ---------------------------------------------------------------------------
 * The create-instance commands, their groundings/bindings, and especially the
 * #3555 `InheritanceRule: uid→ems__Area_parent` live in the PUBLISHED
 * `exoas-exocmd` / `exoas-public` repos — NOT in this codebase. A hand-seeded
 * fixture would test a static COPY and give false confidence: a regression of
 * the published command content (which is what #3554/#3555 guard) would be
 * invisible. So this fixture `git clone`s the three PUBLIC repos
 * (`exoas-exo` + `exoas-exocmd` + `exoas-public`) into the ephemeral vault, then
 * exercises the live commands. (test-fixture-realism.)
 *
 * ---------------------------------------------------------------------------
 * WHY this is NOT one of the 13 required CI checks
 * ---------------------------------------------------------------------------
 * It lives OUTSIDE `tests/e2e/specs`, so the 6 sharded configs + the
 * `validate-shard-assignments.mjs` drift guard never see it. The three repos
 * are PUBLIC, so the suite needs NO PAT and clones unauthenticated (an optional
 * `GH_TOKEN`/`GITHUB_TOKEN` is used only to lift the anonymous API rate limit).
 * It runs on push-to-main / nightly / dispatch — the "авто на каждом релизе"
 * release-gate cadence the node DoD asks for — without ever PR-blocking on
 * network/QEMU flake (perf-tests-dont-hard-gate-ci).
 *
 * Apply-profile fidelity (the full private bootstrap→add→apply DAG) is owned by
 * the sibling `tests/e2e/eka/eka-obsidian-leg.spec.ts` (REGISTRY_TOKEN-gated).
 */

// ---- Published PUBLIC ontology repos (verified public 2026-06-16) ----------
const EXO_URL = "https://github.com/kitelev/exoas-exo";
const EXOCMD_URL = "https://github.com/kitelev/exoas-exocmd";
const PUBLIC_URL = "https://github.com/kitelev/exoas-public";

// Mount paths mirror the real Maven layout (`assetspaces/<owner>/<repo>`) so the
// co-location resolver (`findReferencedFile`) finds the ontology anchors and the
// create-instance grounding co-locates new assets next to them.
const EXO_DIR = "assetspaces/kitelev/exoas-exo";
const EXOCMD_DIR = "assetspaces/kitelev/exoas-exocmd";
const PUBLIC_DIR = "assetspaces/kitelev/exoas-public";

// ---- Fixture constants (verified against published exoas-public 2026-06-16) --
export const UID = {
  emsAreaClass: "82c74542-1b14-4217-b852-d84730484b25", // ems__Area class
  emsTaskClass: "1b20a8f0-d745-4e93-91db-4531b3df120e", // ems__Task class
  emsProjectClass: "7db5eeff-718a-49b0-8d2b-39b084a356e3", // ems__Project class
  emsAnchor: "f6e01f7a-d727-494a-82a3-815597d33e86", // ems ontology anchor (isDefinedBy)
  meetingPrototype: "7ab483c7-aafc-4ac8-8aca-0de52db34a93", // ems__MeetingPrototype
  // #3555: InheritanceRule uid→ems__Area_parent — exercised live, not seeded.
  areaParentInheritanceRule: "ba0ed3e9-9749-474f-b994-654d4dede2c5",
} as const;

/** Stable UID of the single seeded ems__Area the create-button scenarios target. */
export const SEED_AREA_UID = "e2e0a4ea-0000-4000-a000-000000000001";
export const SEED_AREA_LABEL = "EKA E2E Seed Area";

export function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[eka-gui] ${msg}`);
}

/** Run a git command in `cwd` (used only for ephemeral-vault setup). */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Optional token (CI `GITHUB_TOKEN`) lifts the anon clone rate limit; not required. */
function cloneUrl(httpsUrl: string): string {
  const tok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (!tok) return httpsUrl;
  return httpsUrl.replace(
    "https://github.com/",
    `https://x-access-token:${tok}@github.com/`,
  );
}

/** Shallow-clone a public repo into `<vault>/<destRel>`. */
function cloneAssetSpace(
  httpsUrl: string,
  vaultPath: string,
  destRel: string,
): void {
  const dest = path.join(vaultPath, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  git(["clone", "--depth", "1", "--quiet", cloneUrl(httpsUrl), dest]);
  // Drop the nested .git so the outer vault `git add -A` does not choke on an
  // embedded repo / submodule-like gitlink — we only need the working tree.
  fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });
}

/**
 * Build a fresh ephemeral git vault:
 *   - the prebuilt plugin (main.js + manifest.json) installed + community-enabled,
 *   - the three PUBLIC ontology repos cloned in (real published commands),
 *   - ONE seed ems__Area the create-button scenarios target,
 *   - committed clean so any apply-style guard sees no dirt.
 * Returns the absolute vault path (caller owns teardown).
 */
export function setupGuiVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "eka-gui-vault-"));

  // __dirname = …/packages/obsidian-plugin/tests/e2e/eka-gui → up 4 to package.
  const pluginSrcDir = path.join(__dirname, "..", "..", "..");
  const mainJs = path.join(pluginSrcDir, "main.js");
  const manifest = path.join(pluginSrcDir, "manifest.json");
  if (!fs.existsSync(mainJs) || !fs.existsSync(manifest)) {
    throw new Error(
      `Prebuilt plugin not found (main.js/manifest.json). Run \`npm run build\` ` +
        `before this suite. Looked in ${pluginSrcDir}`,
    );
  }

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
  // Keep .obsidian + plugin runtime dirs out of git so `git add -A` stays clean.
  fs.writeFileSync(
    path.join(vaultPath, ".gitignore"),
    ".obsidian/\n.exocortex/\n",
  );
  // The plugin's lock manager + switch journal write into `.exocortex/`; a fresh
  // vault lacks it, so adapter.write ENOENTs without a parent dir. Pre-create it.
  fs.mkdirSync(path.join(vaultPath, ".exocortex"), { recursive: true });

  // Real published ontology content → live create-instance commands + #3555 rule.
  log("cloning public ontology repos (exo + exocmd + public)…");
  cloneAssetSpace(EXO_URL, vaultPath, EXO_DIR);
  cloneAssetSpace(EXOCMD_URL, vaultPath, EXOCMD_DIR);
  cloneAssetSpace(PUBLIC_URL, vaultPath, PUBLIC_DIR);

  // Seed exactly ONE ems__Area (the DoD's "seed одна ems__Area"). Co-located in
  // the ems ontology folder (its isDefinedBy anchor) so discovery + the
  // create-grounding's co-location resolve cleanly.
  const seedDir = path.join(vaultPath, PUBLIC_DIR, "ems");
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(
    path.join(seedDir, `${SEED_AREA_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${SEED_AREA_UID}\n` +
      `exo__Instance_class:\n  - "[[${UID.emsAreaClass}]]"\n` +
      `exo__Asset_isDefinedBy: "[[${UID.emsAnchor}]]"\n` +
      `exo__Asset_label: "${SEED_AREA_LABEL}"\n` +
      `exo__Asset_createdAt: 2026-06-16T00:00:00\n` +
      `---\n\nEphemeral e2e seed area. Recreated fresh every run.\n`,
  );

  // A trivial note so Obsidian's waitForVaultReady (markdownFiles > 0) does not
  // burn its ceiling racing the clone indexing on launch #1.
  fs.writeFileSync(
    path.join(vaultPath, "welcome.md"),
    "# EKA GUI e2e vault\n\nEphemeral. Created by eka-gui-helpers.ts.\n",
  );

  git(["init", "-q"], vaultPath);
  git(["config", "user.email", "eka-gui-e2e@exocortex.test"], vaultPath);
  git(["config", "user.name", "EKA GUI E2E"], vaultPath);
  git(["add", "-A"], vaultPath);
  git(
    [
      "commit",
      "-q",
      "-m",
      "init eka-gui e2e vault (public ontologies + seed area)",
    ],
    vaultPath,
  );

  log(`ephemeral vault ready: ${vaultPath}`);
  return vaultPath;
}

/** Recursively collect every vault-relative `.md` path (excludes .obsidian/.git). */
export function listMarkdown(vaultPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === ".obsidian" ||
        entry.name === ".exocortex"
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md"))
        out.push(path.relative(vaultPath, full));
    }
  };
  walk(vaultPath);
  return out;
}

/** Find the first file matching `<uid>*.md` under the vault (or null). */
export function findByUid(vaultPath: string, uid: string): string | null {
  for (const rel of listMarkdown(vaultPath)) {
    if (path.basename(rel).startsWith(uid)) return path.join(vaultPath, rel);
  }
  return null;
}

/** Poll a predicate until true or timeout. */
export async function pollUntil(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1500,
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

// ---------------------------------------------------------------------------
//  Plugin-load with relaunch-retry (QEMU-emulation flake on Apple Silicon)
// ---------------------------------------------------------------------------
const MAX_LAUNCH_ATTEMPTS = 8;
const PLUGIN_LOAD_WAIT_MS = 60_000;

async function tryLoadPlugin(
  window: Page,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  const diag = await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pm = (window as any).app?.plugins;
    return {
      hasManifest: !!pm?.manifests?.exocortex,
      loaded: !!pm?.plugins?.exocortex,
    };
  });
  log(`[${label}] plugin state: ${JSON.stringify(diag)}`);
  if (!diag.loaded) {
    const r = await window.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pm = (window as any).app?.plugins;
      try {
        if (pm?.plugins?.exocortex) return "already loaded";
        await pm?.disablePlugin?.("exocortex").catch(() => undefined);
        await pm?.enablePlugin?.("exocortex");
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

/**
 * Launch Obsidian on `vaultPath`, retrying the WHOLE launch (close + fresh
 * Electron) up to {@link MAX_LAUNCH_ATTEMPTS} times — the plugin-load flake is
 * per-launch under QEMU-emulated amd64; a relaunch almost always recovers it.
 * Returns the live launcher (caller owns close).
 */
export async function launchObsidianWithPlugin(
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
      await launcher.waitForModalsToClose(10_000);
      if (await tryLoadPlugin(window, label, PLUGIN_LOAD_WAIT_MS))
        return launcher;
      lastErr = `plugin did not reach loaded within ${PLUGIN_LOAD_WAIT_MS / 1000}s`;
    } catch (e) {
      lastErr = String(e);
      log(`${label}: launch attempt ${attempt} errored: ${lastErr}`);
    }
    await launcher.close().catch(() => undefined);
  }
  throw new Error(
    `${label}: Obsidian + plugin failed to load after ${MAX_LAUNCH_ATTEMPTS} attempts (${lastErr})`,
  );
}

/** Force the triple store + metadataCache to settle so command discovery is complete. */
export async function waitForStoreSettled(
  window: Page,
  timeoutMs = 90_000,
): Promise<number> {
  let prev = -1;
  let stable = 0;
  await pollUntil(
    "triple store settled (indexing complete)",
    async () => {
      const n = await window.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (
          window as any
        ).app?.plugins?.plugins?.exocortex?.sparql?.getTripleStore?.();
        if (!store) return -1;
        try {
          return (await store.count()) as number;
        } catch {
          return -1;
        }
      });
      if (n > 100 && n === prev) stable++;
      else stable = 0;
      prev = n;
      return stable >= 2;
    },
    timeoutMs,
    3000,
  );
  return prev;
}

/**
 * Auto-accept native `window.confirm()` dialogs. Several create commands declare
 * `confirmMessage` and the plugin's CommandPromptAdapter renders it via the
 * NATIVE `window.confirm()` — under CDP, Playwright's default is to DISMISS
 * (→ command bails), so without this the create silently no-ops. Register once
 * per page, before any create-button click.
 */
export function registerConfirmAutoAccept(window: Page): void {
  window.on("dialog", (dialog) => {
    void dialog.accept().catch(() => undefined);
  });
}

/**
 * Dismiss any lingering modal (DynamicFormModal / confirm) via Escape, so a
 * leftover overlay from a prior scenario doesn't hide the action buttons of the
 * next. Idempotent: no-op when nothing is open.
 */
export async function clearModals(window: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const open = await window
      .locator(".modal-container")
      .isVisible()
      .catch(() => false);
    if (!open) return;
    await window.keyboard.press("Escape");
    await window
      .locator(".modal-container")
      .waitFor({ state: "hidden", timeout: 2000 })
      .catch(() => undefined);
  }
}

/** Open a vault file in a fresh leaf and force a layout render (buttons appear). */
export async function openAssetAndRender(
  window: Page,
  relPath: string,
): Promise<void> {
  // Clear any leftover modal first (prior scenario's create form / confirm).
  await clearModals(window);
  // A just-created asset can lag the in-memory vault tree (fs-move bypasses the
  // create-event). Poll until Obsidian has indexed it before opening.
  await pollUntil(
    `vault indexed ${relPath}`,
    () =>
      window.evaluate(
        (p) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          !!(window as any).app?.vault?.getAbstractFileByPath?.(p),
        relPath,
      ),
    30_000,
    1000,
  );
  await window.evaluate(async (p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).app;
    const file = app.vault.getAbstractFileByPath(p);
    if (!file) throw new Error(`open: file not found ${p}`);
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: "preview" } });
  }, relPath);
  // Force a re-render with populated store (mirrors dynamic-command-buttons-render).
  await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = (window as any).app?.plugins?.plugins?.exocortex;
    plugin?.commandResolver?.invalidateCache?.();
    plugin?.refreshLayout?.();
  });
}

/** All currently-rendered exocortex action-button labels (for discovery/logging). */
export async function renderedButtonLabels(window: Page): Promise<string[]> {
  return window.locator(".exocortex-action-button").allTextContents();
}

/**
 * Click a create-instance button by visible text, then drive the resulting
 * {@link DynamicFormModal} (a plain React form, unlike the un-drivable
 * FuzzySuggestModal): fill the `label` field and submit. Returns the set of
 * newly-created vault-relative `.md` paths (post − pre snapshot diff).
 */
export async function clickCreateButtonAndFill(
  window: Page,
  vaultPath: string,
  buttonText: string,
  labelValue: string,
): Promise<string[]> {
  const before = new Set(listMarkdown(vaultPath));

  const btn = window
    .locator(".exocortex-action-button", { hasText: buttonText })
    .first();
  await expect(btn, `create button "${buttonText}" must render`).toBeVisible({
    timeout: 20_000,
  });
  await btn.click();

  // DynamicFormModal → React DynamicForm. The label field is the first text
  // input; submit is the modal CTA. (data-testid="field-<name>"; fall back to
  // the generic input class if the schema field name differs.)
  const labelField = window
    .locator(
      '.dynamic-form [data-testid="field-label"], .dynamic-form input.dynamic-form-input',
    )
    .first();
  await expect(labelField, "create form label input must appear").toBeVisible({
    timeout: 15_000,
  });
  await labelField.fill(labelValue);
  await window
    .locator(".dynamic-form .modal-button-container button.mod-cta")
    .first()
    .click();

  // The form modal closes on submit; wait so it can't shadow the next scenario.
  await window
    .locator(".dynamic-form")
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => undefined);

  // The grounding writes to disk async. Poll for a NEW .md file to appear.
  let created: string[] = [];
  await pollUntil(
    `new asset created via "${buttonText}"`,
    () => {
      created = listMarkdown(vaultPath).filter((p) => !before.has(p));
      return created.length > 0;
    },
    30_000,
  );
  // Diagnostic: dump each created file's frontmatter so the actual relationship
  // keys the grounding wrote are visible in CI logs (drives assertion design).
  for (const rel of created) {
    const fm = readVaultFile(vaultPath, rel)
      .split("\n")
      .slice(0, 30)
      .join(" | ");
    log(`created via "${buttonText}": ${rel} :: ${fm}`);
  }
  return created;
}

/** Read a vault file's raw text by absolute or vault-relative path. */
export function readVaultFile(vaultPath: string, relOrAbs: string): string {
  const abs = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : path.join(vaultPath, relOrAbs);
  return fs.readFileSync(abs, "utf8");
}

/**
 * Create an instance on `targetRel` via `buttonText` and return the created file
 * carrying `backlinkRe` (the inherited relationship key). Retries the whole
 * open→click→create cycle until the backlink appears.
 *
 * WHY retry: binding + grounding (incl. InheritanceRule) resolution settles
 * asynchronously a few seconds after the triple store stops growing. The FIRST
 * click on a freshly-launched vault can fire a grounding whose IR list is still
 * empty → the backlink (Effort_area / Effort_parent / Area_parent) is never
 * written and the executor falls back to a bare prototype link. Re-opening the
 * target re-resolves the grounding against the now-more-indexed store; a few
 * attempts with backoff deterministically reach the resolved state (mirrors the
 * real "reload Obsidian if assets don't appear yet" UX). Created files from a
 * failed attempt are deleted so the snapshot diff stays clean.
 */
export async function createOnTarget(
  window: Page,
  vaultPath: string,
  targetRel: string,
  buttonText: string,
  labelBase: string,
  backlinkRe: RegExp,
  attempts = 4,
): Promise<{ rel: string; fm: string }> {
  let lastDump = "";
  for (let i = 1; i <= attempts; i++) {
    await openAssetAndRender(window, targetRel);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      buttonText,
      `${labelBase} ${i}`,
    );
    for (const rel of created) {
      const fm = readVaultFile(vaultPath, rel);
      if (backlinkRe.test(fm)) return { rel, fm };
    }
    // Backlink absent → grounding IR not resolved yet. Clean up + retry.
    lastDump = created
      .map((r) => `${r}: ${readVaultFile(vaultPath, r).replace(/\n/g, " | ")}`)
      .join("\n");
    for (const rel of created) {
      try {
        fs.rmSync(path.join(vaultPath, rel));
      } catch {
        /* ignore */
      }
    }
    log(
      `createOnTarget "${buttonText}" attempt ${i}/${attempts}: ${backlinkRe} absent — retrying`,
    );
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `"${buttonText}" never wrote ${backlinkRe} after ${attempts} attempts.\nLast created:\n${lastDump}`,
  );
}
