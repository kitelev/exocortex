/**
 * Issue #3488 — false-positive SHACL violations from IRI-representation artifacts.
 *
 * End-to-end through `runShapesModeAction` (the JSON output path that surfaces
 * the warning counters), against real on-disk vault fixtures that mirror the
 * 2026-06-12 vault-2025 baseline mechanisms:
 *
 *   M1 — an `exo__Asset_relates` to a target that carries no resolvable type in
 *        this vault (cross-vault / dangling) → reported as a WARNING, not a
 *        violation; exit code stays 0; a dedicated `crossVaultRefWarnings`
 *        counter is surfaced.
 *
 *   M2 — a UUID-named `exo__Setting` asset that DOES carry `exo__Setting_key`
 *        must produce ZERO `sh:minCount` violations (no phantom on the synthetic
 *        `uid:<uuid>` join-key).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { runShapesModeAction } = await import(
  "../../src/commands/validate-schema.js"
);

interface JsonResponse {
  status: string;
  data: {
    vaultPath: string;
    conforms: boolean;
    violationCount: number;
    warningCount: number;
    crossVaultRefWarnings: number;
    violations: Array<{ focusNode: string; severity: string; constraint: string }>;
    warnings: Array<{ focusNode: string; severity: string; constraint: string; actualValue?: string }>;
  };
}

function lastJson(logSpy: jest.SpiedFunction<typeof console.log>): JsonResponse {
  const calls = logSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const arg = calls[i][0];
    if (typeof arg === "string" && arg.trim().startsWith("{")) {
      return JSON.parse(arg) as JsonResponse;
    }
  }
  throw new Error("no JSON line logged");
}

/** Declares `exo__Asset_relates` as an ObjectProperty (domain/range exo__Asset). */
function writeAssetRelatesShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Asset_relates.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000a001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: exo__Asset_relates
exo__Property_domain:
  - "[[exo__Asset]]"
exo__Property_range:
  - "[[exo__Asset]]"
exo__Property_severity: sh:Violation
aliases:
  - exo__Asset_relates
---
Test shape: exo__Asset_relates → exo__Asset.
`,
  );
}

/** Declares `exo__Setting_key` as a required (minCount 1) property of exo__Setting. */
function writeSettingKeyShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Setting_key.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000b001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: exo__Setting_key
exo__Property_domain:
  - "[[exo__Setting]]"
exo__Property_minCount: "1"
exo__Property_range: "http://www.w3.org/2001/XMLSchema#string"
exo__Property_severity: sh:Violation
aliases:
  - exo__Setting_key
---
Test shape: exo__Setting_key is required on exo__Setting.
`,
  );
}

describe("Issue #3488: validate schema --shapes-mode — IRI-representation false positives", () => {
  let tmpDir: string;
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shacl-3488-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("M1: exo__Asset_relates to an unresolvable (cross-vault/dangling) target → warning, exit 0, counter", async () => {
    writeAssetRelatesShape(tmpDir);
    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    // Subject is typed exo__Asset and relates to a UUID that exists in no file
    // in this vault → its type cannot be resolved → unresolvable reference.
    fs.writeFileSync(
      path.join(dataDir, "source.md"),
      `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: 11110000-0000-4000-8000-000000000001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Asset]]"
exo__Asset_label: Source
exo__Asset_relates:
  - "[[99999999-9999-4999-8999-999999999999]]"
---
Source relates to an absent (cross-vault) target.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(0);
    expect(json.data.conforms).toBe(true);
    expect(process.exitCode).toBeUndefined(); // warnings do not break exit code
    expect(json.data.warningCount).toBeGreaterThanOrEqual(1);
    expect(json.data.crossVaultRefWarnings).toBeGreaterThanOrEqual(1);
    const warn = json.data.warnings.find((w) =>
      (w.actualValue ?? "").includes("99999999-9999-4999-8999-999999999999"),
    );
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("sh:Warning");
    expect(warn!.constraint).toBe("class");
  });

  it("M2: UUID-named exo__Setting asset WITH Setting_key → 0 minCount violations (no uid: phantom)", async () => {
    writeSettingKeyShape(tmpDir);
    const settingsDir = path.join(tmpDir, "exocortex-settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    const uid = "2a348086-8be4-442e-946e-84f1abe7f612";
    // The file is UUID-named → its subject IRI ends with <uuid>.md, which makes
    // the validator synthesize a `uid:<uuid>` join-key. That synthetic key must
    // NOT be iterated as a focus node (else a phantom Setting_key minCount).
    fs.writeFileSync(
      path.join(settingsDir, `${uid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Setting]]"
exo__Asset_label: a.setting
exo__Setting_key: "some.app.setting"
exo__Setting_value: "42"
---
A valid setting with its key present.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(0);
    expect(json.data.conforms).toBe(true);
    expect(process.exitCode).toBeUndefined();
    // explicitly: no result (error OR warning) may be focused on a uid: key
    const allResults = [...json.data.violations, ...json.data.warnings];
    expect(allResults.some((r) => r.focusNode.startsWith("uid:"))).toBe(false);
  });

  it("M2-regression: a genuinely missing Setting_key still violates (on the real subject, not uid: key)", async () => {
    writeSettingKeyShape(tmpDir);
    const settingsDir = path.join(tmpDir, "exocortex-settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    const uid = "3b459197-9cf5-553f-a57f-95f2bcf8f723";
    fs.writeFileSync(
      path.join(settingsDir, `${uid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Setting]]"
exo__Asset_label: b.setting
exo__Setting_value: "no key here"
---
A setting that is genuinely missing its required key.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(1);
    expect(json.data.conforms).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(json.data.violations[0].focusNode).toContain(uid);
    expect(json.data.violations[0].focusNode.startsWith("uid:")).toBe(false);
  });
});
