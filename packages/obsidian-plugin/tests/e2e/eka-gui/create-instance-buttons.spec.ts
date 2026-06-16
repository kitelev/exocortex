import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as fs from "fs";
import * as path from "path";
import {
  SEED_AREA_UID,
  UID,
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
 * Formalises six of the eight Gherkin scenarios from vault node 76d9207c
 * (GUI-BDD-CI Ф4, node a2e20c69) as repeatable e2e against a FRESH ephemeral
 * vault built from the REAL published `kitelev/exoas-*` ontology repos:
 *
 *   2. Create Task   on an ems__Area    → ems__Effort_area = the area
 *   3. Create Project on an ems__Area    → ems__Effort_area = the area
 *   6. Create child Area (#3555)         → ems__Area_parent = the area  ⚠ REGRESSION
 *   4. Create Task   on an ems__Project  → ems__Effort_parent = the project
 *   5. Create Meeting from MeetingPrototype → ems__Meeting (prototype back-link)
 *   8. Cleanup                            → created instances removed, vault clean
 *
 * Design (see eka-gui-helpers.ts header): one serial suite over ONE fresh vault
 * per run ("каждый прогон = новое хранилище") — the create-instance commands +
 * #3555 InheritanceRule are exercised LIVE from the published repos, so a
 * regression of that published content is caught (test-fixture-realism). The
 * full private bootstrap→apply DAG is owned by the sibling eka-obsidian-leg.
 *
 * One scenario = one `test()` block (a distinct reportable unit). They share a
 * single launched Obsidian over a single fresh vault rather than one fresh
 * vault + cold Obsidian boot per file, because eight cold boots × a multi-repo
 * clone would blow the CI budget — the per-run freshness invariant is preserved.
 *
 * The button click drives the REAL command (CommandExecutionFlow.run) and the
 * resulting DynamicFormModal (a plain React form, unlike the un-drivable fuzzy
 * picker). Every assertion checks REAL on-disk frontmatter — no stubs.
 */

const SEED_AREA_REL = path.posix.join(
  "assetspaces/kitelev/exoas-public/ems",
  `${SEED_AREA_UID}.md`,
);

// Shared vault/window across steps (workers:1 in the config keeps them ordered).
// NOTE: intentionally NOT `mode: "serial"` during bring-up — a single failing
// scenario must not skip the rest, so one CI run surfaces every grounding's
// real on-disk behaviour. (createCommandAndFill logs each created file.)
test.describe.configure({ mode: "default" });

test.describe("EKA GUI — create-instance buttons (fresh real-content vault)", () => {
  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;
  let window: Page;
  // Carried across the serial steps: the project created in scenario 3 is the
  // target for scenario 4 (Create Task on Project).
  let createdProjectUid = "";

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    vaultPath = setupGuiVault();
    launcher = await launchObsidianWithPlugin(vaultPath, "eka-gui");
    window = await launcher.getWindow();
    // Create commands with `confirmMessage` (Create Project / Create Meeting)
    // call native window.confirm() — auto-accept it under CDP.
    registerConfirmAutoAccept(window);
    await waitForStoreSettled(window);
    await openAssetAndRender(window, SEED_AREA_REL);
    // Diagnostic: surface the buttons the published bindings render on an Area.
    log(
      `buttons on seed Area: ${JSON.stringify(await renderedButtonLabels(window))}`,
    );
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  // Extract the new instance file matching a predicate from the snapshot diff.
  const pickCreated = (
    created: string[],
    pred: (fm: string) => boolean,
  ): { rel: string; fm: string } => {
    for (const rel of created) {
      const fm = readVaultFile(vaultPath, rel);
      if (pred(fm)) return { rel, fm };
    }
    const dump = created
      .map((r) => `  ${r}:\n${readVaultFile(vaultPath, r).slice(0, 240)}`)
      .join("\n");
    throw new Error(`No created file matched predicate. Candidates:\n${dump}`);
  };

  test("scenario 2 — Create Task on ems__Area sets ems__Effort_area", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Task",
      "E2E Task on Area",
    );
    const { rel, fm } = pickCreated(created, (f) =>
      f.includes("ems__Effort_area"),
    );
    log(`created task: ${rel}`);
    expect(fm, "task must carry the source area in ems__Effort_area").toContain(
      SEED_AREA_UID,
    );
    expect(fm).toMatch(/ems__Effort_area/);
  });

  test("scenario 3 — Create Project on ems__Area sets ems__Effort_area", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Project",
      "E2E Project on Area",
    );
    // The create-Project button's own click-diff yields the project file; match
    // on the area relationship (class may be expressed via prototype not a bare
    // UID, so don't hard-require the class UID).
    const { rel, fm } = pickCreated(created, (f) =>
      f.includes("ems__Effort_area"),
    );
    log(`created project: ${rel}`);
    expect(
      fm,
      "project must carry the source area in ems__Effort_area",
    ).toContain(SEED_AREA_UID);
    const m = fm.match(/exo__Asset_uid:\s*([0-9a-f-]{36})/);
    createdProjectUid = m?.[1] ?? "";
    expect(
      createdProjectUid,
      "must capture created project uid for scenario 4",
    ).not.toBe("");
  });

  test("scenario 6 — Create child Area sets ems__Area_parent (#3555 regression)", async () => {
    await openAssetAndRender(window, SEED_AREA_REL);
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Area",
      "E2E Child Area",
    );
    // The #3555 signal (`ems__Area_parent`) is unambiguous within this click's
    // diff — match on it directly (don't hard-require the class UID form).
    const { rel, fm } = pickCreated(created, (f) =>
      f.includes("ems__Area_parent"),
    );
    log(`created child area: ${rel}`);
    // #3555: without the published `InheritanceRule uid→ems__Area_parent`
    // (ba0ed3e9) the child area is orphaned (no parent). This is the live
    // regression gate — it fails if that rule regresses in exoas-exocmd.
    expect(
      fm,
      "child area MUST set ems__Area_parent to the source area (#3555)",
    ).toContain(SEED_AREA_UID);
    expect(fm).toMatch(/ems__Area_parent/);
  });

  test("scenario 4 — Create Task on ems__Project sets ems__Effort_parent", async () => {
    expect(
      createdProjectUid,
      "scenario 3 must have produced a project",
    ).not.toBe("");
    const projAbs = findByUid(vaultPath, createdProjectUid);
    expect(projAbs, "created project file must exist on disk").not.toBeNull();
    const projRel = path.relative(vaultPath, projAbs as string);

    await openAssetAndRender(window, projRel);
    log(
      `buttons on created Project: ${JSON.stringify(await renderedButtonLabels(window))}`,
    );
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Task",
      "E2E Task on Project",
    );
    const { rel, fm } = pickCreated(created, (f) =>
      f.includes("ems__Effort_parent"),
    );
    log(`created task on project: ${rel}`);
    expect(
      fm,
      "task must carry the source project in ems__Effort_parent",
    ).toContain(createdProjectUid);
    expect(fm).toMatch(/ems__Effort_parent/);
  });

  test("scenario 5 — Create Meeting from ems__MeetingPrototype", async () => {
    const protoAbs = findByUid(vaultPath, UID.meetingPrototype);
    expect(
      protoAbs,
      "MeetingPrototype must be present from exoas-public",
    ).not.toBeNull();
    const protoRel = path.relative(vaultPath, protoAbs as string);

    await openAssetAndRender(window, protoRel);
    log(
      `buttons on MeetingPrototype: ${JSON.stringify(await renderedButtonLabels(window))}`,
    );
    const created = await clickCreateButtonAndFill(
      window,
      vaultPath,
      "Create Meeting Instance",
      "E2E Meeting",
    );
    // The prototype-binding executor writes a back-link prototype on the new file.
    const { rel, fm } = pickCreated(created, (f) =>
      f.includes(UID.meetingPrototype),
    );
    log(`created meeting: ${rel}`);
    expect(fm, "meeting must reference its MeetingPrototype").toContain(
      UID.meetingPrototype,
    );
  });

  test("scenario 8 — cleanup removes created instances, leaves ontologies + seed intact", async () => {
    // Delete every test-created instance: anything carrying one of our e2e labels.
    const all = listMarkdown(vaultPath);
    let removed = 0;
    for (const rel of all) {
      const fm = readVaultFile(vaultPath, rel);
      if (
        /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Task on Project|Meeting)/.test(
          fm,
        )
      ) {
        fs.rmSync(path.join(vaultPath, rel));
        removed++;
      }
    }
    log(`cleanup removed ${removed} created instance(s)`);
    expect(
      removed,
      "cleanup must have something to remove (created instances)",
    ).toBeGreaterThan(0);

    // Idempotent: a second sweep removes nothing.
    const second = listMarkdown(vaultPath).filter((rel) =>
      /exo__Asset_label:\s*"?E2E (Task on Area|Project on Area|Child Area|Task on Project|Meeting)/.test(
        readVaultFile(vaultPath, rel),
      ),
    );
    expect(
      second.length,
      "no created instances should remain after cleanup",
    ).toBe(0);

    // Seed + published ontology survive.
    expect(
      findByUid(vaultPath, SEED_AREA_UID),
      "seed area must remain",
    ).not.toBeNull();
    expect(
      findByUid(vaultPath, UID.emsAreaClass),
      "ems__Area class must remain",
    ).not.toBeNull();
    expect(
      findByUid(vaultPath, UID.meetingPrototype),
      "MeetingPrototype must remain",
    ).not.toBeNull();
  });
});
