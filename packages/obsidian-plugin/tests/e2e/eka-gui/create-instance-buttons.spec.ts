import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  clickCreateButtonAndFill,
  findByUid,
  launchObsidianWithPlugin,
  listMarkdown,
  log,
  openAssetAndRender,
  readVaultFile,
  registerConfirmAutoAccept,
  renderedButtonLabels,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — create-instance buttons on a fresh, real-content vault
 * ============================================================================
 *
 * Formalises the create-flow Gherkin scenarios of vault node 76d9207c
 * (GUI-BDD-CI Ф4, project node a2e20c69) as repeatable e2e against a FRESH
 * ephemeral vault built from the REAL published `kitelev/exoas-*` ontology repos:
 *
 *   - Create Task    on an ems__Area    → ems:Effort_area  = the area
 *   - Create Project on an ems__Area    → ems:Effort_area  = the area
 *   - Create child Area (#3555)         → ems:Area_parent  = the area  ⚠ REGRESSION
 *   - Create Task    on an ems__Project → ems:Effort_parent = the project
 *   - cleanup-idempotent                → created instances removed, ontologies intact
 *
 * Design (see eka-gui-helpers.ts header): one suite over ONE fresh vault per run
 * ("каждый прогон = новое хранилище"); the create-instance commands + the #3555
 * InheritanceRule run LIVE from the published repos, so a regression of that
 * published content is caught (test-fixture-realism). Scenarios are independent
 * (each re-opens its target + clears modals first) so one failure does not mask
 * the others; `workers: 1` (config) keeps them ordered over the shared window.
 *
 * The button click drives the REAL command (CommandExecutionFlow.run + native
 * window.confirm auto-accepted) and the resulting DynamicFormModal (a plain
 * React form). Every assertion checks REAL on-disk frontmatter — no stubs.
 *
 * Relationship-key tolerance: the published create-instance InheritanceRules
 * emit the backlink property in EITHER prefixed (`ems__Effort_area`) OR
 * expanded-IRI (`https://exocortex.my/ontology/ems#Effort_area`) form depending
 * on the grounding — observed empirically. Assertions match `/Effort_area/`,
 * `/Effort_parent/`, `/Area_parent/` to accept both; the VALUE (the source
 * asset's uid) is the real invariant under test.
 *
 * apply-profile (#1), reload-no-hang (#3554) and Create-Meeting are owned by a
 * follow-up (the first two need the apply flow → extend eka-obsidian-leg; the
 * Meeting button renders on a MeetingPrototype-classed INSTANCE, not on the
 * prototype asset itself — separate fixture).
 */

const SEED_AREA_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${SEED_AREA_UID}.md`,
);

// Independent scenarios over a shared window (workers:1 keeps them ordered).
test.describe.configure({ mode: "default" });

test.describe("EKA GUI — create-instance buttons (fresh real-content vault)", () => {
  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;
  let window: Page;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    vaultPath = setupGuiVault();
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-gui");
    window = await launcher.getWindow();
    // Create commands with `confirmMessage` (Create Project) call native
    // window.confirm() — auto-accept it under CDP.
    registerConfirmAutoAccept(window);
    await waitForStoreSettled(window);
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  // Pick the created file matching a predicate from a click's snapshot diff.
  const pickCreated = (
    created: string[],
    pred: (fm: string) => boolean,
  ): { rel: string; fm: string } => {
    for (const rel of created) {
      const fm = readVaultFile(vaultPath, rel);
      if (pred(fm)) return { rel, fm };
    }
    const dump = created
      .map((r) => `  ${r}:\n${readVaultFile(vaultPath, r)}`)
      .join("\n");
    throw new Error(`No created file matched predicate. Candidates:\n${dump}`);
  };

  test("scenario 2 — Create Task on ems__Area sets Effort_area", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    log(
      `buttons on Area: ${JSON.stringify(await renderedButtonLabels(window))}`,
    );
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Task",
      "E2E Task on Area",
    );
    // Backlink key may be prefixed OR expanded-IRI form — match the property
    // segment; the source-area uid is the real invariant.
    const { rel, fm } = pickCreated(created, (f) => /Effort_area/.test(f));
    log(`created task: ${rel}`);
    expect(fm, "task must carry the source area in Effort_area").toContain(
      SEED_AREA_UID,
    );
  });

  test("scenario 3 — Create Project on ems__Area sets Effort_area", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Project",
      "E2E Project on Area",
    );
    const { rel, fm } = pickCreated(created, (f) => /Effort_area/.test(f));
    log(`created project: ${rel}`);
    expect(fm, "project must carry the source area in Effort_area").toContain(
      SEED_AREA_UID,
    );
  });

  test("scenario 6 — Create child Area sets ems__Area_parent (#3555 regression)", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Area",
      "E2E Child Area",
    );
    const { rel, fm } = pickCreated(created, (f) => /Area_parent/.test(f));
    log(`created child area: ${rel}`);
    // #3555: without the published `InheritanceRule uid→ems__Area_parent`
    // (ba0ed3e9) the child area is orphaned (no parent). This is the LIVE
    // regression gate — it fails if that rule regresses in exoas-exocmd.
    expect(
      fm,
      "child area MUST set Area_parent to the source area (#3555)",
    ).toContain(SEED_AREA_UID);
  });

  test("scenario 4 — Create Task on ems__Project sets Effort_parent", async () => {
    // Self-contained: create the project first, then a task on it (no cross-test
    // state — keeps scenarios independent).
    await openAssetAndRender(window, SEED_AREA_REL);
    const projCreated = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Project",
      "E2E Project for Task",
    );
    const proj = pickCreated(projCreated, (f) => /Effort_area/.test(f));
    const projUid =
      proj.fm.match(/exo__Asset_uid:\s*([0-9a-f-]{36})/)?.[1] ?? "";
    expect(projUid, "must capture created project uid").not.toBe("");

    const projAbs = findByUid(vaultPath, projUid) as string;
    await openAssetAndRender(window, path.relative(vaultPath, projAbs));
    log(
      `buttons on Project: ${JSON.stringify(await renderedButtonLabels(window))}`,
    );
    const taskCreated = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Task",
      "E2E Task on Project",
    );
    const { rel, fm } = pickCreated(taskCreated, (f) =>
      /Effort_parent/.test(f),
    );
    log(`created task on project: ${rel}`);
    expect(fm, "task must carry the source project in Effort_parent").toContain(
      projUid,
    );
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const isCreated = (fm: string): boolean =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Project for Task|Task on Project)/.test(
        fm,
      );

    const all = listMarkdown(vaultPath);
    let removed = 0;
    for (const rel of all) {
      if (isCreated(readVaultFile(vaultPath, rel))) {
        fs.rmSync(path.join(vaultPath, rel));
        removed++;
      }
    }
    log(`cleanup removed ${removed} created instance(s)`);
    expect(
      removed,
      "cleanup must remove the created instances",
    ).toBeGreaterThan(0);

    // Idempotent: nothing matching remains.
    const remaining = listMarkdown(vaultPath).filter((rel) =>
      isCreated(readVaultFile(vaultPath, rel)),
    );
    expect(remaining.length, "no created instances should remain").toBe(0);

    // Seed + published ontology survive.
    expect(
      findByUid(vaultPath, SEED_AREA_UID),
      "seed area must remain",
    ).not.toBeNull();
    expect(
      findByUid(vaultPath, "82c74542-1b14-4217-b852-d84730484b25"),
      "ems__Area class must remain",
    ).not.toBeNull();
  });
});
