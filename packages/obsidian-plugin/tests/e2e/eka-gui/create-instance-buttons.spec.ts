import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  SEED_MEETING_PROTO_UID,
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
 *   - Create Task on an ems__Area        → ems:Effort_area   = the area
 *   - Create Project on an ems__Area     → ems:Effort_area   = the area
 *   - Create child Area (#3555)          → ems:Area_parent   = the area  ⚠ REGRESSION
 *   - Create Task on an ems__Project     → ems:Effort_parent = the project
 *   - Create Meeting on a MeetingProto   → exo:Asset_prototype = the source
 *   - cleanup-idempotent                 → created instances removed, ontologies intact
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
 * The "Create Project" + "Create Meeting Instance" commands additionally carry a
 * `Command_confirmMessage`, so clicking them fires a native `window.confirm()`
 * that {@link registerConfirmAutoAccept} (armed in beforeAll) accepts under CDP.
 *
 * Note on "Create Project" (follow-up node fc83d482, perf-investigation): an
 * earlier hotfix (#3585) dropped Create-Project from the suite, suspecting a
 * resolver perf bug ("many binding variants → resolves last"). An empirical
 * source audit refuted that: an ems__Area resolves only its 3 area-targeted
 * bindings + the universal exo__Asset ones (NOT the 14 ems__Project bindings —
 * those match Project assets), ALL of an asset's buttons resolve together in one
 * cached `resolveForAssetMulti`, and the Create-Project grounding (8748f8b0) is
 * structurally LIGHTER than Create-Task's (a222094b has an extra targetPrototype)
 * — so there is no per-button resolution-time difference. The only differentiator
 * is the confirmMessage native dialog. The slowness was emulation/QEMU + a
 * dialog-handling race, not a product perf bug — so the scenario is restored
 * test-side (via createOnTarget's open→click retry), not "fixed" in the plugin.
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
const SEED_MEETING_PROTO_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${SEED_MEETING_PROTO_UID}.md`,
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

  test("scenario 3 — Create Project on ems__Area sets Effort_area", async () => {
    // Restored from the follow-up node (perf-investigation verdict: NOT a
    // resolver perf bug — see file header). "Create Project" carries a
    // confirmMessage → native confirm (auto-accepted in beforeAll). createOnTarget
    // drives the real command + form and retries open→click until the inherited
    // Effort_area backlink lands.
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_AREA_REL,
      "Create Project",
      "E2E Project on Area",
      /Effort_area/,
    );
    log(`created project on area: ${rel}`);
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

  test("scenario 5 — Create Meeting Instance on a MeetingPrototype sets prototype", async () => {
    // The binding (22093ca1, targetClass ems__MeetingPrototype) renders on an
    // INSTANCE of the prototype class — our seed `SEED_MEETING_PROTO`. The
    // grounding (e01b025b) creates an ems__Meeting whose default linkBack
    // (exo__Asset_prototype) points to the source asset. "Create Meeting
    // Instance" carries a confirmMessage → native confirm (auto-accepted).
    const { rel, fm } = await createOnTarget(
      window,
      vaultPath,
      SEED_MEETING_PROTO_REL,
      "Create Meeting",
      "E2E Meeting on Proto",
      /Asset_prototype/,
    );
    log(`created meeting: ${rel}`);
    expect(
      fm,
      "meeting must carry the source MeetingPrototype instance in Asset_prototype",
    ).toContain(SEED_MEETING_PROTO_UID);
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    const isCreated = (fm: string): boolean =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Task on Project|Meeting on Proto)/.test(
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
      findByUid(vaultPath, SEED_MEETING_PROTO_UID),
      "seed meeting-prototype instance must remain",
    ).not.toBeNull();
    expect(
      findByUid(vaultPath, "82c74542-1b14-4217-b852-d84730484b25"),
      "ems__Area class must remain",
    ).not.toBeNull();
  });
});
