/**
 * Issue #3245: --staged is respected by --shapes-mode.
 *
 * Prior to this fix, `validate schema --shapes-mode --staged` ignored the
 * staged scope filter — it always loaded the full vault and reported every
 * SHACL violation, which made the flag unusable from pre-commit hooks.
 *
 * Scenarios:
 *   1. --staged with zero staged .md files → conforms=true, violationCount=0
 *      (short-circuit; no full-vault parse needed)
 *   2. --staged with one staged file that has a SHACL violation → that single
 *      violation is reported
 *   3. --staged with one staged clean file and one unstaged file that has a
 *      violation → violationCount=0 (the unstaged violation is filtered out)
 *   4. Without --staged → full-vault behaviour preserved (every violation
 *      reported), so the fix doesn't regress existing behaviour
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { runShapesModeAction, filterReportToStagedFocusNodes } = await import(
  "../../src/commands/validate-schema.js"
);

interface JsonResponse {
  status: string;
  data: {
    vaultPath: string;
    conforms: boolean;
    violationCount: number;
    violations: Array<{ focusNode: string; propertyPath: string; severity: string; message: string }>;
  };
}

function writeFixtureShapes(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });

  fs.writeFileSync(
    path.join(shapesDir, "ems__Task_name.md"),
    `---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: aaa11111-1111-1111-1111-111111111111
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: ems__Task_name
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_name
---

Test shape: Single-cardinality ems__Task_name.
`,
  );
}

function writeViolatingAsset(vaultDir: string, name: string, uid: string): string {
  const dir = path.join(vaultDir, "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  // maxCount violation: Single cardinality but 2 values
  fs.writeFileSync(
    file,
    `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: ${name.replace(/\.md$/, "")}
ems__Task_name:
  - "First Name"
  - "Second Name"
aliases:
  - ${name.replace(/\.md$/, "")}
---

Violating asset.
`,
  );
  return path.relative(vaultDir, file);
}

function writeCleanAsset(vaultDir: string, name: string, uid: string): string {
  const dir = path.join(vaultDir, "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: ${name.replace(/\.md$/, "")}
ems__Task_name: "Single Valid Name"
aliases:
  - ${name.replace(/\.md$/, "")}
---

Clean asset.
`,
  );
  return path.relative(vaultDir, file);
}

function lastJsonFromCalls(spy: jest.SpiedFunction<typeof console.log>): JsonResponse {
  for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
    const arg = spy.mock.calls[i]?.[0];
    if (typeof arg === "string" && arg.trim().startsWith("{")) {
      return JSON.parse(arg) as JsonResponse;
    }
  }
  throw new Error("no JSON in console.log calls");
}

describe("Issue #3245 — validate schema --shapes-mode --staged respects staged scope", () => {
  describe("filterReportToStagedFocusNodes (pure helper)", () => {
    it("returns empty violations when staged set is empty", () => {
      const result = filterReportToStagedFocusNodes(
        {
          conforms: false,
          violations: [
            {
              focusNode: "obsidian://vault/data/a.md",
              propertyPath: "x",
              severity: "sh:Violation",
              message: "boom",
            },
          ],
        },
        new Set<string>(),
      );
      expect(result.violations).toHaveLength(0);
      expect(result.conforms).toBe(true);
    });

    it("retains violations whose focusNode matches a staged path", () => {
      const result = filterReportToStagedFocusNodes(
        {
          conforms: false,
          violations: [
            {
              focusNode: "obsidian://vault/data/staged.md",
              propertyPath: "p1",
              severity: "sh:Violation",
              message: "v1",
            },
            {
              focusNode: "obsidian://vault/data/unstaged.md",
              propertyPath: "p2",
              severity: "sh:Violation",
              message: "v2",
            },
          ],
        },
        new Set(["data/staged.md"]),
      );
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].focusNode).toContain("staged.md");
      expect(result.conforms).toBe(false);
    });

    it("decodes URL-encoded focusNode segments before matching", () => {
      const stagedRel = "data/with space.md";
      const encoded = "obsidian://vault/data/with%20space.md";
      const result = filterReportToStagedFocusNodes(
        {
          conforms: false,
          violations: [
            {
              focusNode: encoded,
              propertyPath: "p",
              severity: "sh:Violation",
              message: "m",
            },
          ],
        },
        new Set([stagedRel]),
      );
      expect(result.violations).toHaveLength(1);
    });

    it("drops violations whose focusNode does not use the obsidian://vault/ scheme", () => {
      const result = filterReportToStagedFocusNodes(
        {
          conforms: false,
          violations: [
            {
              focusNode: "https://exocortex.my/ontology/ems#SyntheticIRI",
              propertyPath: "p",
              severity: "sh:Violation",
              message: "m",
            },
          ],
        },
        new Set(["data/a.md"]),
      );
      expect(result.violations).toHaveLength(0);
      expect(result.conforms).toBe(true);
    });
  });

  describe("runShapesModeAction with --staged (end-to-end with DI-injected staged list)", () => {
    let tmpDir: string;
    let logSpy: jest.SpiedFunction<typeof console.log>;
    let errSpy: jest.SpiedFunction<typeof console.error>;
    let originalExitCode: number | undefined;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shacl-staged-3245-"));
      writeFixtureShapes(tmpDir);
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      originalExitCode = process.exitCode;
      process.exitCode = undefined;
      // Clean any leftover data files from prior scenario
      const dataDir = path.join(tmpDir, "data");
      if (fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    });

    afterEach(() => {
      logSpy.mockRestore();
      errSpy.mockRestore();
      process.exitCode = originalExitCode;
    });

    it("Scenario 1: --staged with zero staged .md files → conforms=true, violationCount=0 (short-circuit)", async () => {
      // Write a violating asset but DON'T add it to the staged list — should
      // be ignored even though it exists on disk, because nothing is staged.
      writeViolatingAsset(tmpDir, "ignored.md", "00000000-0000-4000-8000-000000000001");

      await runShapesModeAction(
        { vault: tmpDir, format: "json", staged: true },
        { getStagedMdFiles: () => [] },
      );

      const json = lastJsonFromCalls(logSpy);
      expect(json.data.conforms).toBe(true);
      expect(json.data.violationCount).toBe(0);
      expect(json.data.violations).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it("Scenario 2: --staged with one staged violating file → reports only that file's violations, ignoring an unstaged sibling violator", async () => {
      const stagedRel = writeViolatingAsset(tmpDir, "violating.md", "00000000-0000-4000-8000-000000000002");
      // Also drop an unrelated unstaged violator on disk — pre-fix, the full
      // vault scan would report both. Post-fix, only the staged one survives.
      writeViolatingAsset(tmpDir, "other-unstaged.md", "00000000-0000-4000-8000-00000000000a");

      await runShapesModeAction(
        { vault: tmpDir, format: "json", staged: true },
        { getStagedMdFiles: () => [stagedRel] },
      );

      const json = lastJsonFromCalls(logSpy);
      expect(json.data.violationCount).toBeGreaterThanOrEqual(1);
      // All reported violations must come from the staged file — the
      // unstaged sibling violator must NOT leak into the report.
      for (const v of json.data.violations) {
        expect(v.focusNode).toContain("violating.md");
        expect(v.focusNode).not.toContain("other-unstaged.md");
      }
      expect(json.data.conforms).toBe(false);
      expect(process.exitCode).toBe(1);
    });

    it("Scenario 3: --staged with one staged clean file + one unstaged violating file → violationCount=0", async () => {
      const cleanRel = writeCleanAsset(tmpDir, "clean.md", "00000000-0000-4000-8000-000000000003");
      writeViolatingAsset(tmpDir, "unstaged-violator.md", "00000000-0000-4000-8000-000000000004");

      await runShapesModeAction(
        { vault: tmpDir, format: "json", staged: true },
        { getStagedMdFiles: () => [cleanRel] },
      );

      const json = lastJsonFromCalls(logSpy);
      expect(json.data.violationCount).toBe(0);
      expect(json.data.conforms).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it("Scenario 4: without --staged, full vault is validated and unstaged violations ARE reported", async () => {
      writeViolatingAsset(tmpDir, "unstaged.md", "00000000-0000-4000-8000-000000000005");
      // intentionally NOT staged
      await runShapesModeAction({
        vault: tmpDir,
        format: "json",
        staged: false,
      });

      const json = lastJsonFromCalls(logSpy);
      expect(json.data.violationCount).toBeGreaterThanOrEqual(1);
      expect(json.data.conforms).toBe(false);
    });
  });
});
