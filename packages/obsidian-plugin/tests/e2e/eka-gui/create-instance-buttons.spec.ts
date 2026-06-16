import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  createOnTarget,
  findByUid,
  launchObsidianWithPlugin,
  listMarkdown,
  log,
  readVaultFile,
  registerConfirmAutoAccept,
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
 *   - Create Task    on an ems__Area    → ems:Effort_area   = the area
 *   - Create Project on an ems__Area    → ems:Effort_area   = the area
 *   - Create child Area (#3555)         → ems:Area_parent   = the area  ⚠ REGRESSION
 *   - Create Task    on an ems__Project → ems:Effort_parent = the project
 *   - cleanup-idempotent                → created instances removed, ontologies intact
 *
 * Design (see eka-gui-helpers.ts header): one suite over ONE fresh vault per run
 * ("каждый прогон = новое хранилище"); the create-instance commands + the #3555
 * InheritanceRule run LIVE from the published repos, so a regression of that
 * published content is caught (test-fixture-realism). Every create goes through
 * {@link createOnTarget}, which drives the REAL command (CommandExecutionFlow +
 * native window.confirm auto-accepted) + the DynamicFormModal, then retries
 * open→click until the inherited backlink lands (the grounding's InheritanceRule
 * resolution settles a few seconds after the store; first-click can race it).
 * Every assertion checks REAL on-disk frontmatter — no stubs.
 *
 * Relationship-key tolerance: published InheritanceRules emit the backlink in
 * EITHER prefixed (`ems__Effort_area`) OR expanded-IRI
 * (`https://exocortex.my/ontology/ems#Effort_area`) form per grounding (observed
 * empirically). Match `/Effort_area/` etc.; the VALUE (source uid) is the
 * invariant under test.
 *
 * apply-profile (#1), reload-no-hang (#3554) and Create-Meeting are owned by a
 * follow-up (the first two need the apply flow → extend eka-obsidian-leg; the
 * Meeting button binds to a MeetingPrototype-classed INSTANCE, not the prototype
 * asset itself — separate fixture).
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

  test("scenario 2 — Create Task on ems__Area sets Effort_area", async () => {
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_AREA_REL,
      "Create Task",
      "E2E Task on Area",
      /Effort_area/,
    );
    log(`created task: ${rel}`);
    expect(fm, "task must carry the source area in Effort_area").toContain(
      SEED_AREA_UID,
    );
  });

  test("scenario 3 — Create Project on ems__Area sets Effort_area", async () => {
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_AREA_REL,
      "Create Project",
      "E2E Project on Area",
      /Effort_area/,
    );
    log(`created project: ${rel}`);
    expect(fm, "project must carry the source area in Effort_area").toContain(
      SEED_AREA_UID,
    );
  });

  test("scenario 6 — Create child Area sets ems__Area_parent (#3555 regression)", async () => {
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_AREA_REL,
      "Create Area",
      "E2E Child Area",
      /Area_parent/,
    );
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
    // Self-contained: create the project first, then a task on it.
    const proj = await createOnTarget(
      window,
      vaultPath,
      SEED_AREA_REL,
      "Create Project",
      "E2E Project for Task",
      /Effort_area/,
    );
    const projUid =
      proj.fm.match(/exo__Asset_uid:\s*([0-9a-f-]{36})/)?.[1] ?? "";
    expect(projUid, "must capture created project uid").not.toBe("");

    const projAbs = findByUid(vaultPath, projUid) as string;
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      path.relative(vaultPath, projAbs),
      "Create Task",
      "E2E Task on Project",
      /Effort_parent/,
    );
    log(`created task on project: ${rel}`);
    expect(fm, "task must carry the source project in Effort_parent").toContain(
      projUid,
    );
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    const isCreated = (fm: string): boolean =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Project for Task|Task on Project)/.test(
        fm,
      );

    let removed = 0;
    for (const rel of listMarkdown(vaultPath)) {
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
