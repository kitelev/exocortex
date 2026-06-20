import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  SEED_MEETING_PROTO_UID,
  SEED_PROJECT_UID,
  UID,
  createInstanceOnClass,
  createOnTarget,
  findByUid,
  launchObsidianWithPlugin,
  listMarkdown,
  log,
  readVaultFile,
  registerConfirmAutoAccept,
  setupGuiVault,
  waitForCreateCommandsResolvable,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/** ems__Area class UID — the seed area's `exo__Instance_class`. */
const EMS_AREA_CLASS_UID = "82c74542-1b14-4217-b852-d84730484b25";

/** exo__Class **metaclass** UID — what the flagship "Create Instance" binding targets. */
const EXO_CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
/**
 * A real published class-definition page to drive the flagship "Create Instance"
 * on: the `ems__Task` class def (an `exo__Class` instance), shipped in the cloned
 * `exoas-public` repo. Co-located in the ems ontology folder.
 */
const EMS_TASK_CLASSDEF_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${UID.emsTaskClass}.md`,
);
/**
 * The ontology the picker SELECTS — deliberately `$exo`, DIFFERENT from the
 * ems__Task class-def's own isDefinedBy (`$ems`). Picking a different ontology
 * proves the form's reusable reference-picker drives BOTH the new instance's
 * `exo__Asset_isDefinedBy` AND its co-location folder ($isDefinedByFolder) — not
 * a copy of the host class's own ontology. `$exo` lives in the cloned exoas-exo.
 */
const PICK_ONTOLOGY_UID = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3"; // $exo
const PICK_ONTOLOGY_QUERY = "$exo"; // fuzzy query that surfaces the $exo option
const PICK_ONTOLOGY_DIR = "assetspaces/kitelev/exoas-exo/exo";

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
 *   - Create Project on an ems__Area     → ems:Effort_area   = the area  (test.fixme #3587)
 *   - Create child Area (#3555)          → ems:Area_parent   = the area  ⚠ REGRESSION
 *   - Create Task on an ems__Project     → ems:Effort_parent = the project
 *   - Create Meeting on a MeetingProto   → exo:Asset_prototype = the source
 *   - Create Instance on an exo__Class   → exo:Instance_class = host class +
 *                                          isDefinedBy/folder = PICKED ontology
 *                                          (flagship bbe40f8c, two-field form)
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
 * Note on "Create Project" (follow-up node fc83d482, perf-investigation → #3587):
 * #3585 dropped Create-Project suspecting a resolver perf bug. The investigation
 * REFUTED that AND found a real correctness bug: the "Create Project" button does
 * NOT render on an ems__Area in the LIVE plugin (Create Task + Create Area do).
 * It is NOT the resolver — a full-store repro of `resolveForAssetMulti` returns
 * `Create Project [bind 9f787938]`, the CLI `apply create-project` resolves it,
 * and `PreconditionEvaluator.evaluate(undefined)=true`. The drop is in the live
 * render-path store (LazyAssetGraphLoader, PR #3257), root cause tracked in #3587.
 * The scenario is therefore kept as `test.fixme` (a runnable regression gate that
 * goes green when #3587 lands) rather than deleted-and-forgotten like #3585.
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
    // #3587: count-plateau ≠ store complete. Gate every scenario on the store
    // being complete enough to resolve ALL create commands on the seed area —
    // otherwise a scenario can assert inside the transient convertVault-load
    // window (partial store → Create Project / Create Task subgraph not yet
    // landed). See waitForCreateCommandsResolvable for the full rationale.
    await waitForCreateCommandsResolvable(window, SEED_AREA_REL, EMS_AREA_CLASS_UID, [
      "Create Task",
      "Create Area",
      "Create Project",
    ]);
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

  // #3587 RESOLVED — was a transient store-load TIMING RACE, NOT a Create-Project
  // render-path logic drop. Two CI DIAG rounds + a Node convertVault repro proved
  // the resolver + converter are correct (full store → resolveForAssetMulti returns
  // Create Project; CLI `apply create-project` resolves it). The live failure was
  // the harness asserting inside the transient store-load window: `waitForStoreSettled`
  // declared "settled" at the first count plateau (~15060 of ~16512 triples) while
  // convertVault was still incrementally populating, so Create Project's binding→
  // command→grounding subgraph (and sometimes Create Task's backlink InheritanceRule)
  // had not yet landed — round-1 caught loadCommand(Project)=NULL, round-2 caught it
  // OK. Fix: `waitForStoreSettled` now also polls resolveForAssetMulti(seed area)
  // until {Create Task, Create Area, Create Project} all resolve, so every scenario
  // asserts against a complete store. The product is eventually-consistent
  // (re-render on store-settle wired post-#3580/v16.97.4) — no permanent miss.
  // Follow-up #3588 tracks the EKA-layout lazyBootstrapFolders preload gap (bigger,
  // design trade-off, post-alpha). Now un-fixme'd → live regression gate (8/8).
  test("scenario 3 — Create Project on ems__Area sets Effort_area (#3587)", async () => {
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

  // ── Flagship: homoiconic «Create Instance» on a CLASS-def page (project ──────
  // bbe40f8c, T5 — closes the deferred live-visual of node 8e892543). ──────────
  //
  // The other scenarios drive the ems-specific create buttons on INSTANCES with a
  // single-field (label) form. THIS drives the generic "Create Instance" command
  // — bound to the `exo__Class` METACLASS, so it renders on every class-def page
  // — on a real published class def (ems__Task), through the TWO-field form:
  // `Label` + the reusable Ontology fuzzy reference-picker (T2). It proves the
  // full flagship path end-to-end against the live published command/binding/
  // grounding: button render → form → picker selection → on-disk UUID instance
  // whose exo__Instance_class is the host class (via the $targetClassSelf
  // PropertyDefault) and whose exo__Asset_isDefinedBy + folder follow the PICKED
  // ontology ($exo ≠ the host's own $ems → proves the picker drives both).
  test("scenario 9 — Create Instance on an exo__Class page (flagship bbe40f8c)", async () => {
    // Store-completeness gate for THIS target: the binding targets the exo__Class
    // metaclass (not ems__Area), so gate on "Create Instance" resolving on the
    // class-def page itself (same #3587 rationale as the beforeAll area gate).
    await waitForCreateCommandsResolvable(
      window,
      EMS_TASK_CLASSDEF_REL,
      EXO_CLASS_METACLASS_UID,
      ["Create Instance"],
      120_000,
      ["exo__Class", "exo__Asset"],
    );

    const { rel, fm } = await createInstanceOnClass(
      window,
      vaultPath,
      EMS_TASK_CLASSDEF_REL,
      UID.emsTaskClass, // host class — set as exo__Instance_class ($targetClassSelf)
      PICK_ONTOLOGY_UID, // picked ontology — set as exo__Asset_isDefinedBy
      PICK_ONTOLOGY_QUERY,
      "E2E Instance on Class",
    );
    log(`created flagship instance: ${rel}`);

    // exo__Instance_class = the host class (the class-def page IS the class).
    expect(
      fm,
      "instance must carry the host class in exo__Instance_class ($targetClassSelf)",
    ).toContain(UID.emsTaskClass);
    // exo__Asset_isDefinedBy = the PICKED ontology ($exo), proving the picker
    // drove it (≠ the host class's own $ems).
    expect(
      fm,
      "instance must carry the picked ontology in exo__Asset_isDefinedBy",
    ).toContain(PICK_ONTOLOGY_UID);
    // Co-located in the PICKED ontology's folder ($isDefinedByFolder) — exoas-exo,
    // NOT the host class's ems folder.
    expect(
      rel.startsWith(PICK_ONTOLOGY_DIR + "/"),
      `instance must be co-located in the picked ontology folder (got ${rel})`,
    ).toBe(true);
    // UID-canon: the instance file is UUID-named.
    expect(
      path.basename(rel),
      `instance file must be UUID-named (got ${path.basename(rel)})`,
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/,
    );
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    const isCreated = (fm: string): boolean =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Task on Project|Meeting on Proto|Instance on Class)/.test(
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
