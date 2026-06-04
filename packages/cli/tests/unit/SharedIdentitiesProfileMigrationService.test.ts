/**
 * @jest-environment node
 *
 * Unit tests для SharedIdentitiesProfileMigrationService.
 * Synthetic 5-file vault scenarios per advisor incremental-test recommendation.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  SharedIdentitiesProfileMigrationService,
  KNOWLEDGE_PROFILE_CLASS_UID,
  FOCUS_PROFILE_CLASS_UID,
} from "../../src/services/SharedIdentitiesProfileMigrationService";

function makeSyntheticVault(): { vaultPath: string; cleanup: () => void } {
  const vaultPath = mkdtempSync(path.join(os.tmpdir(), "exo-migrate-test-"));
  const sharedDir = path.join(vaultPath, "assetspaces", "shared-identities");
  mkdirSync(sharedDir, { recursive: true });

  // 4 FocusProfile instances mirroring real vault structure.
  writeFileSync(
    path.join(sharedDir, "ae00f219-f50b-4fc1-b842-9ec1e03fefd6.md"),
    `---
exo__Asset_uid: ae00f219-f50b-4fc1-b842-9ec1e03fefd6
exo__Asset_label: profile-base
exo__Instance_class:
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-shared-identities]]"
  - "[[ontology-exo]]"
---

# profile-base
`,
  );

  writeFileSync(
    path.join(sharedDir, "7e7be7a6-ca57-4aa8-a63a-69aaee32be25.md"),
    `---
exo__Asset_uid: 7e7be7a6-ca57-4aa8-a63a-69aaee32be25
exo__Asset_label: profile-personal
exo__Instance_class:
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-personal]]"
exo__FocusProfile_extends: "[[ae00f219-f50b-4fc1-b842-9ec1e03fefd6]]"
---

# profile-personal
`,
  );

  writeFileSync(
    path.join(sharedDir, "42d500a3-f931-483e-a92e-cd4fae6cfb6e.md"),
    `---
exo__Asset_uid: 42d500a3-f931-483e-a92e-cd4fae6cfb6e
exo__Asset_label: profile-work
exo__Instance_class:
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-work]]"
---

# profile-work
`,
  );

  writeFileSync(
    path.join(sharedDir, "8169cc07-995a-400b-9267-1cce22654ef5.md"),
    `---
exo__Asset_uid: 8169cc07-995a-400b-9267-1cce22654ef5
exo__Asset_label: profile-reading
exo__Instance_class:
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-reading]]"
---

# profile-reading
`,
  );

  // 1 non-FocusProfile file (ims__Concept "Audit") — should be SKIPPED.
  writeFileSync(
    path.join(sharedDir, "007d1731-105e-4f44-a1a0-51df96685c06.md"),
    `---
exo__Asset_uid: 007d1731-105e-4f44-a1a0-51df96685c06
exo__Asset_label: Audit (Disambiguation)
exo__Instance_class:
  - "[[dda12c48-6886-4624-8710-ed4ba92ce2b3]]"
  - "[[bf21727b-fce8-44ce-be2e-01afeb90f77c]]"
---

# Audit
`,
  );

  return {
    vaultPath,
    cleanup: () => rmSync(vaultPath, { recursive: true, force: true }),
  };
}

describe("SharedIdentitiesProfileMigrationService", () => {
  let setup: ReturnType<typeof makeSyntheticVault>;

  afterEach(() => {
    setup?.cleanup();
  });

  describe("generatePlan (dry-run)", () => {
    it("identifies 4 FocusProfile + 1 skip when vault has 5 files", () => {
      setup = makeSyntheticVault();
      const svc = new SharedIdentitiesProfileMigrationService();
      const plan = svc.generatePlan({ vaultPath: setup.vaultPath });

      expect(plan.summary.relocate).toBe(4);
      expect(plan.summary.skipped).toBe(1);
      expect(plan.summary.alreadyMigrated).toBe(0);

      const relocations = plan.actions.filter((a) => a.kind === "relocate-and-dual-class");
      expect(relocations.map((a) => a.uid).sort()).toEqual([
        "42d500a3-f931-483e-a92e-cd4fae6cfb6e",
        "7e7be7a6-ca57-4aa8-a63a-69aaee32be25",
        "8169cc07-995a-400b-9267-1cce22654ef5",
        "ae00f219-f50b-4fc1-b842-9ec1e03fefd6",
      ]);
    });

    it("empty vault → empty plan", () => {
      setup = { vaultPath: mkdtempSync(path.join(os.tmpdir(), "empty-")), cleanup: () => undefined };
      const svc = new SharedIdentitiesProfileMigrationService();
      const plan = svc.generatePlan({ vaultPath: setup.vaultPath });
      expect(plan.actions.length).toBe(0);
    });
  });

  describe("apply mode", () => {
    it("relocates 4 FocusProfiles + adds dual-class transform", () => {
      setup = makeSyntheticVault();
      const svc = new SharedIdentitiesProfileMigrationService();
      const result = svc.apply({ vaultPath: setup.vaultPath, apply: true });

      expect(result.applied.length).toBe(4);
      expect(result.errors.length).toBe(0);

      // Verify each profile в new location + dual-class transformed.
      const profilesDir = path.join(setup.vaultPath, "assetspaces/profiles");
      const baseFile = path.join(profilesDir, "ae00f219-f50b-4fc1-b842-9ec1e03fefd6.md");
      expect(existsSync(baseFile)).toBe(true);
      const content = readFileSync(baseFile, "utf8");
      // Dual class: KnowledgeProfile UID added к Instance_class.
      expect(content).toContain(KNOWLEDGE_PROFILE_CLASS_UID);
      expect(content).toContain(FOCUS_PROFILE_CLASS_UID);
      // KnowledgeProfile_includes mirrors FocusProfile_includes.
      expect(content).toContain("exo__KnowledgeProfile_includes:");
      expect(content).toContain('"[[ontology-shared-identities]]"');
      expect(content).toContain('"[[ontology-exo]]"');
    });

    it("non-FocusProfile files left in shared-identities", () => {
      setup = makeSyntheticVault();
      const svc = new SharedIdentitiesProfileMigrationService();
      svc.apply({ vaultPath: setup.vaultPath, apply: true });

      const sharedDir = path.join(setup.vaultPath, "assetspaces/shared-identities");
      const remaining = readdirSync(sharedDir).filter((f) => f.endsWith(".md"));
      // 1 non-FocusProfile file (Audit) remains.
      expect(remaining).toContain("007d1731-105e-4f44-a1a0-51df96685c06.md");
    });

    it("idempotent — re-running после apply = no-op", () => {
      setup = makeSyntheticVault();
      const svc = new SharedIdentitiesProfileMigrationService();
      const first = svc.apply({ vaultPath: setup.vaultPath, apply: true });
      expect(first.applied.length).toBe(4);

      const second = svc.apply({ vaultPath: setup.vaultPath, apply: true });
      // No actions applied — source files moved-and-renamed-к-.migrated-backup,
      // plan finds zero remaining .md FocusProfile sources.
      expect(second.applied.length).toBe(0);
      expect(second.errors.length).toBe(0);
      expect(second.plan.summary.relocate).toBe(0);
    });

    it("HIGH-fix: handles CRLF + BOM-prefixed FocusProfile files (defensive normalization)", () => {
      const vaultPath = mkdtempSync(path.join(os.tmpdir(), "exo-crlf-"));
      const sharedDir = path.join(vaultPath, "assetspaces", "shared-identities");
      mkdirSync(sharedDir, { recursive: true });
      const crlfContent = `﻿---\r\nexo__Asset_uid: aaaa1111-bbbb-2222-cccc-333344445555\r\nexo__Asset_label: profile-crlf\r\nexo__Instance_class:\r\n  - "[[${FOCUS_PROFILE_CLASS_UID}]]"\r\nexo__FocusProfile_includes:\r\n  - "[[ontology-test]]"\r\n---\r\n\r\n# profile-crlf\r\n`;
      writeFileSync(
        path.join(sharedDir, "aaaa1111-bbbb-2222-cccc-333344445555.md"),
        crlfContent,
      );

      const svc = new SharedIdentitiesProfileMigrationService();
      const plan = svc.generatePlan({ vaultPath });
      expect(plan.summary.relocate).toBe(1);
      const result = svc.apply({ vaultPath, apply: true });
      expect(result.applied.length).toBe(1);
      expect(result.errors.length).toBe(0);
      const out = readFileSync(
        path.join(vaultPath, "assetspaces/profiles", "aaaa1111-bbbb-2222-cccc-333344445555.md"),
        "utf8",
      );
      expect(out).toContain(KNOWLEDGE_PROFILE_CLASS_UID);
      expect(out).toContain("exo__KnowledgeProfile_includes:");
      rmSync(vaultPath, { recursive: true, force: true });
    });

    it("idempotent при already-dual-class: no duplicate KnowledgeProfile UID", () => {
      const vaultPath = mkdtempSync(path.join(os.tmpdir(), "exo-dual-"));
      const sharedDir = path.join(vaultPath, "assetspaces", "shared-identities");
      mkdirSync(sharedDir, { recursive: true });
      writeFileSync(
        path.join(sharedDir, "bbbb1111-2222-3333-4444-555566667777.md"),
        `---
exo__Asset_uid: bbbb1111-2222-3333-4444-555566667777
exo__Asset_label: already-dual
exo__Instance_class:
  - "[[${KNOWLEDGE_PROFILE_CLASS_UID}]]"
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-x]]"
exo__KnowledgeProfile_includes:
  - "[[ontology-x]]"
---

# already-dual
`,
      );

      const svc = new SharedIdentitiesProfileMigrationService();
      svc.apply({ vaultPath, apply: true });
      const out = readFileSync(
        path.join(vaultPath, "assetspaces/profiles", "bbbb1111-2222-3333-4444-555566667777.md"),
        "utf8",
      );
      const kpMatches = out.match(new RegExp(KNOWLEDGE_PROFILE_CLASS_UID, "g")) ?? [];
      // 1 in Instance_class — should NOT add second.
      expect(kpMatches.length).toBe(1);
      rmSync(vaultPath, { recursive: true, force: true });
    });

    it("dry-run does NOT mutate vault", () => {
      setup = makeSyntheticVault();
      const svc = new SharedIdentitiesProfileMigrationService();
      const result = svc.apply({ vaultPath: setup.vaultPath, apply: false });

      expect(result.applied.length).toBe(0);
      // Original files still in shared-identities.
      const sharedDir = path.join(setup.vaultPath, "assetspaces/shared-identities");
      expect(existsSync(path.join(sharedDir, "ae00f219-f50b-4fc1-b842-9ec1e03fefd6.md"))).toBe(true);
      // profiles/ dir not created.
      expect(existsSync(path.join(setup.vaultPath, "assetspaces/profiles"))).toBe(false);
    });
  });
});
