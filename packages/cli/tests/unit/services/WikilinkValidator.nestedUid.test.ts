import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import {
  WikilinkValidator,
  WikilinkNotFoundError,
} from "../../../src/services/WikilinkValidator.js";

/**
 * Production-shape regression test for issue #3701.
 *
 * Uses a REAL on-disk multi-folder vault and the REAL NodeFsAdapter (no mocks of
 * glob / js-yaml / fs) so the malformed-YAML failure mode is reproduced exactly:
 * `create --property "<prop>=[[<nested-uuid>]]"` rejected a nested UID-canon asset
 * that `exocortex resolve` happily found, because the validator's only fallback
 * (frontmatter `exo__Asset_uid` scan) could not parse the asset's malformed YAML.
 *
 * The fix routes wikilink validation through the SAME authoritative FILENAME-based
 * discovery that `resolve` uses (NodeFsAdapter.findFileByUidFilename), which never
 * reads file contents.
 *
 * Revert-verify (mandatory, integration-test-revert-verify rule): with the fix
 * reverted, the AC#1 test FAILS (nested UID with malformed YAML is rejected). With
 * the fix restored it PASSES. AC#2 (nonexistent UID rejected) is GREEN both ways —
 * proof the validator is not blindly accepting everything.
 */
describe("WikilinkValidator — nested UID discovery (issue #3701)", () => {
  let vaultRoot: string;
  let validator: WikilinkValidator;

  // A nested UID-canon asset whose YAML frontmatter is MALFORMED (an unquoted
  // label containing a colon) — exactly the real vault-exodev failure shape.
  const NESTED_UID = "3b40f843-c2b2-44b4-9b8c-b68405548189";
  const NESTED_REL = path.join(
    "assetspaces",
    "kitelev",
    "exoas-exodev",
    "exodev",
    `${NESTED_UID}.md`,
  );
  const MALFORMED_FRONTMATTER = `---
exo__Asset_uid: ${NESTED_UID}
exo__Instance_class:
  - "[[7db5eeff-718a-49b0-8d2b-39b084a356e3]]"
exo__Asset_label: W1 — Facet-1 create-hybrid: agent-workflow on apply create_instance (Task)
exo__Asset_createdAt: 2026-06-21T19:11:13
---

Body.
`;

  // A second nested asset with WELL-FORMED YAML (control: filename lookup must
  // also work for clean files).
  const NESTED_CLEAN_UID = "a1b2c3d4-e5f6-4789-9abc-def012345678";
  const NESTED_CLEAN_REL = path.join(
    "assetspaces",
    "kitelev",
    "exoas-exodev",
    "exodev",
    `${NESTED_CLEAN_UID}.md`,
  );

  // A root-level UID-canon asset (AC#3: no regression for non-nested).
  const ROOT_UID = "11112222-3333-4444-5555-666677778888";
  const ROOT_REL = `${ROOT_UID}.md`;

  // A NON-UID-named asset referenced by its UID — must still resolve via the
  // frontmatter fallback (calendar-plugin whitelist files, e.g. pn__DailyNote).
  const DAILY_UID = "99998888-7777-6666-5555-444433332222";
  const DAILY_REL = path.join("daily", "2025-01-01.md");

  const NONEXISTENT_UID = "deadbeef-0000-0000-0000-000000000000";

  beforeAll(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wlv-3701-"));

    await fs.outputFile(path.join(vaultRoot, NESTED_REL), MALFORMED_FRONTMATTER);
    await fs.outputFile(
      path.join(vaultRoot, NESTED_CLEAN_REL),
      `---\nexo__Asset_uid: ${NESTED_CLEAN_UID}\nexo__Asset_label: Clean nested\n---\n\nBody.\n`,
    );
    await fs.outputFile(
      path.join(vaultRoot, ROOT_REL),
      `---\nexo__Asset_uid: ${ROOT_UID}\nexo__Asset_label: Root asset\n---\n\nBody.\n`,
    );
    await fs.outputFile(
      path.join(vaultRoot, DAILY_REL),
      `---\nexo__Asset_uid: ${DAILY_UID}\nexo__Asset_label: 2025-01-01\n---\n\nBody.\n`,
    );

    const adapter = new NodeFsAdapter(vaultRoot);
    validator = new WikilinkValidator(adapter);
  });

  afterAll(async () => {
    if (vaultRoot) {
      await fs.remove(vaultRoot);
    }
  });

  // AC#1 — the regression: nested UID-canon asset with MALFORMED YAML must pass
  // validation (consistent with `resolve`). This is the revert-verify anchor:
  // RED with the fix reverted, GREEN with it restored.
  it("AC#1: passes for a nested UID-canon asset even with malformed YAML frontmatter", async () => {
    await expect(
      validator.validatePropertyValues({
        "ems__Effort_parent": `[[${NESTED_UID}]]`,
      }),
    ).resolves.toBeUndefined();
  });

  it("AC#1b: passes for a nested UID-canon asset with well-formed YAML", async () => {
    await expect(
      validator.validatePropertyValues({
        "ems__Effort_parent": `[[${NESTED_CLEAN_UID}|Clean nested]]`,
      }),
    ).resolves.toBeUndefined();
  });

  // AC#2 — must STILL reject a genuinely nonexistent UID (proof the validator is
  // not blindly accepting everything). GREEN both pre- and post-fix.
  it("AC#2: still rejects a nonexistent UID wikilink", async () => {
    await expect(
      validator.validatePropertyValues({
        "ems__Effort_parent": `[[${NONEXISTENT_UID}|Missing]]`,
      }),
    ).rejects.toBeInstanceOf(WikilinkNotFoundError);
  });

  // AC#3 — no regression for root-level (non-nested) UID wikilinks.
  it("AC#3: passes for a root-level UID-canon asset", async () => {
    await expect(
      validator.validatePropertyValues({
        "ems__Effort_parent": `[[${ROOT_UID}]]`,
      }),
    ).resolves.toBeUndefined();
  });

  // Frontmatter fallback — a NON-UID-named asset referenced by its UID must still
  // resolve (filename lookup misses, frontmatter scan finds it).
  it("resolves a non-UID-named asset by its frontmatter exo__Asset_uid (fallback)", async () => {
    await expect(
      validator.validatePropertyValues({
        "ems__Effort_day": `[[${DAILY_UID}|2025-01-01]]`,
      }),
    ).resolves.toBeUndefined();
  });
});
