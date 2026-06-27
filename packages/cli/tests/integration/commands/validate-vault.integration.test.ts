import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateVaultCommand } from "../../../src/commands/validate-vault.js";
import { scaffoldValidationCommand } from "../../../src/commands/scaffold-validation.js";

const ONTO_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DUP_UID = "11111111-1111-4111-8111-111111111111";

function writeAsset(dir: string, uid: string, fm: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${uid}.md`),
    ["---", `exo__Asset_uid: ${uid}`, ...fm, "---", "", `# ${uid}`, ""].join("\n"),
    "utf-8",
  );
}

/** Capture console + process.exitCode around a command run. */
async function run(cmd: () => Promise<void>): Promise<{ out: string; code: number | undefined }> {
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    await cmd();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const code = process.exitCode;
  process.exitCode = origCode;
  return { out: logs.join("\n"), code };
}

describe("validate vault + scaffold (RFC f402002b M1.5)", () => {
  let vault: string;
  const onto = () => join(vault, "ontology");

  beforeEach(() => {
    vault = join(tmpdir(), `vv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(vault, { recursive: true });
    // A resolvable ontology to co-locate the scaffolded check settings into.
    writeAsset(onto(), ONTO_UID, [
      'exo__Asset_isDefinedBy: "[[' + ONTO_UID + ']]"',
      'exo__Asset_label: "$test-onto"',
    ]);
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it("@req:5b7c66a1-d32c-4369-a0c5-656f59ee0f77 scaffold creates 4 validation-check settings (uid-uniqueness=true, rest=false) co-located in the chosen ontology", async () => {
    const { out } = await run(() =>
      scaffoldValidationCommand().parseAsync(
        ["--vault", vault, "--ontology", ONTO_UID, "--output", "json"],
        { from: "user" },
      ),
    );
    const result = JSON.parse(out);
    expect(result.created).toHaveLength(4);
    // All co-located in the ontology folder.
    expect(result.targetDir).toBe(onto());
    // Verify the defaults: exactly one (uid-uniqueness) is true.
    const files = readdirSync(onto()).filter((f) => f !== `${ONTO_UID}.md`);
    expect(files).toHaveLength(4);
    const trueCount = files.filter((f) =>
      readFileSync(join(onto(), f), "utf-8").includes("setting__Setting_value: true"),
    ).length;
    expect(trueCount).toBe(1);
    // The true one references the uid-uniqueness check-key.
    const trueFile = files.find((f) =>
      readFileSync(join(onto(), f), "utf-8").includes("setting__Setting_value: true"),
    )!;
    expect(readFileSync(join(onto(), trueFile), "utf-8")).toContain(
      "ac10db25-231c-4677-8cac-647d3cf15c64",
    );
  });

  it("@req:767f7d7c-3b3f-4bbe-86cd-6e02802611ae validate vault runs the scaffolded enabled-set (uid-uniqueness) and fails on a duplicate uid; passes when the duplicate is removed (revert-verify)", async () => {
    // Scaffold the enabled-set (uid-uniqueness=true).
    await run(() =>
      scaffoldValidationCommand().parseAsync(
        ["--vault", vault, "--ontology", ONTO_UID],
        { from: "user" },
      ),
    );
    // Inject a duplicate uid across two paths — the uid-uniqueness check must catch it.
    writeAsset(join(vault, "a"), DUP_UID, []);
    writeAsset(join(vault, "b"), DUP_UID, []);

    const fail = await run(() =>
      validateVaultCommand().parseAsync(
        ["--vault", vault, "--output", "json"],
        { from: "user" },
      ),
    );
    const report = JSON.parse(fail.out);
    const uidResult = report.results.find((r: { label: string }) => r.label === "uid-uniqueness");
    expect(uidResult.status).toBe("fail");
    expect(report.ok).toBe(false);
    expect(fail.code).toBe(1);

    // revert: remove the duplicate (rename one) → uid-uniqueness passes → exit 0.
    rmSync(join(vault, "b", `${DUP_UID}.md`));
    const pass = await run(() =>
      validateVaultCommand().parseAsync(
        ["--vault", vault, "--output", "json"],
        { from: "user" },
      ),
    );
    const passReport = JSON.parse(pass.out);
    expect(passReport.ok).toBe(true);
    expect(pass.code).toBeUndefined();
  });

  it("@req:767f7d7c-3b3f-4bbe-86cd-6e02802611ae --all runs every known check and fails LOUD on the checks whose CLI runner is not wired (SHACL/DAG) — never a silent pass", async () => {
    const { out } = await run(() =>
      validateVaultCommand().parseAsync(
        ["--vault", vault, "--all", "--output", "json"],
        { from: "user" },
      ),
    );
    const report = JSON.parse(out);
    const dag = report.results.find((r: { label: string }) => r.label === "dag-ontology-imports");
    const shacl = report.results.find((r: { label: string }) => r.label === "shacl");
    // SHACL/DAG have no CLI runner wired (M2 unification) → fail-loud error, not a silent skip.
    expect(dag.status).toBe("error");
    expect(dag.errorMessage).toMatch(/runDag/);
    expect(shacl.status).toBe("error");
    expect(shacl.errorMessage).toMatch(/runShacl/);
    // The portable checks (uid-uniqueness, co-location) still run.
    const uid = report.results.find((r: { label: string }) => r.label === "uid-uniqueness");
    expect(uid.status).toBe("pass");
  });
});
