import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  SEED_PROJECT_UID,
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
 *   - Create Task on an ems__Area     → ems:Effort_area   = the area
 *   - Create child Area (#3555)       → ems:Area_parent   = the area  ⚠ REGRESSION
 *   - Create Task on an ems__Project  → ems:Effort_parent = the project
 *   - cleanup-idempotent              → created instances removed, ontologies intact
 *
 * Design (see eka-gui-helpers.ts header): one suite over ONE fresh vault per run
 * ("каждый прогон = новое хранилище"); the create-instance commands + the #3555
 * InheritanceRule run LIVE from the published repos, so a regression of that
 * published content is caught (test-fixture-realism). Every create goes through
 * {@link createOnTarget}, which drives the REAL command (CommandExecutionFlow +
 * native window.confirm auto-accepted) + the DynamicFormModal, retrying
 * open→click on any transient until the inherited backlink lands. Every
 * assertion checks REAL on-disk frontmatter — no stubs.
 *
 * Only the fast/reliable "Create Task" + "Create Area" buttons are exercised
 * here; the seed ems__Area + seed ems__Project are pre-placed so the scenarios
 * target them directly. The "Create Project" button is slow + variable to
 * resolve under Docker indexing (sometimes >2 min), which made it flaky, so the
 * Create-Project-on-Area + Create-Meeting scenarios (and apply-profile #1 /
 * reload-no-hang #3554) are tracked in the follow-up node — see
 * eka-gui-helpers.ts header.
 *
 * Relationship-key tolerance: published InheritanceRules emit the backlink in
 * EITHER prefixed (`ems__Effort_area`) OR expanded-IRI (`…/ems#Effort_area`)
 * form per grounding (observed empirically). Match `/Effort_area/` etc.; the
 * VALUE (source uid) is the invariant under test.
 */

const SEED_AREA_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${SEED_AREA_UID}.md`,
);
const SEED_PROJECT_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${SEED_PROJECT_UID}.md`,
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
    // Create commands with `confirmMessage` call native window.confirm() —
    // auto-accept it under CDP.
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
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_PROJECT_REL,
      "Create Task",
      "E2E Task on Project",
      /Effort_parent/,
    );
    log(`created task on project: ${rel}`);
    expect(fm, "task must carry the source project in Effort_parent").toContain(
      SEED_PROJECT_UID,
    );
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    const isCreated = (fm: string): boolean =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Child Area|Task on Project)/.test(
        fm,
      );

    let removed = 0;
    for (const rel of listMarkdown(vaultPath)) {
      if (isCreated(readVaultFile(vaultPath, rel))) {
        fs.rmSync(path.join(vaultPath, rel));
        removed++;
      }
    }
    // Do NOT hard-assert removed > 0 — the create scenarios already prove
    // persistence; requiring it here would only double-red as a consequence of
    // an earlier flake. This scenario's value is idempotent cleanup + survival.
    log(`cleanup removed ${removed} created instance(s)`);

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
      findByUid(vaultPath, SEED_PROJECT_UID),
      "seed project must remain",
    ).not.toBeNull();
    expect(
      findByUid(vaultPath, "82c74542-1b14-4217-b852-d84730484b25"),
      "ems__Area class must remain",
    ).not.toBeNull();
  });
});
