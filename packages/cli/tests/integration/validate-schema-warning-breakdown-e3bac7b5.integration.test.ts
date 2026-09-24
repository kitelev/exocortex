/**
 * Ticket `e3bac7b5` / req `f28051a9` — `validate schema --shapes-mode` names the
 * REASONS behind its warning count on the DEFAULT (text) surface.
 *
 * ⛔ Every axis asserts the PRINTED TEXT (`integration-test-revert-verify` §A66).
 * The subject of the requirement is the output, and the data it needs is already
 * collected inside the command and already shipped by `--format json`
 * (`data.warnings[]`) and `--format earl` (`dc:description`) — so an axis on the
 * internal structure, or on either machine branch, would be vacuous BY
 * CONSTRUCTION: it would pass on the pre-fix code too.
 *
 * Fixtures mirror the mechanisms measured live on vault-exodev with the
 * published CLI v16.251.0 (2026-09-24, 550 warnings / 0 violations):
 *   - 546 of 550 were `obsidian://vault/<uuid>.md` with NO directory segment —
 *     `NoteToRDFConverter.synthesizeWikilinkTargetIRI`, "NOT a file in this vault";
 *   - 4 of 550 were symbolic property term IRIs such as
 *     `https://exocortex.my/ontology/ems#Effort_votes`, reached from
 *     `[[ems__Effort_votes]]` wikilinks via `expandClassValue`.
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

const BREAKDOWN_HEADER = "Breakdown by reason";
const REASON_NO_PATH_FULL = "class target IRI has no path segment under obsidian://vault/";
const REASON_WITH_PATH_FULL = "class target IRI has a path segment under obsidian://vault/";
const REASON_SYMBOLIC_FULL =
  "class target IRI is not under obsidian://vault/ (symbolic term IRI)";
const REASON_NO_PATH = REASON_NO_PATH_FULL;
const REASON_WITH_PATH = REASON_WITH_PATH_FULL;
const REASON_SYMBOLIC = REASON_SYMBOLIC_FULL;
/**
 * ⛔ Strings review disproved BY EXECUTION — they must never come back. The old
 * labels claimed resolution and type status; `constraint: "class"` has two
 * origins at the emitter and the second one resolves its target's type, so the
 * "no resolvable type" wording was false for a real, fixture-reachable input
 * (WB12). Asserting their ABSENCE is what keeps the claim from creeping back.
 */
const RETRACTED_CLAIMS = [
  "target not present in this vault",
  "carries no resolvable type",
];
const REASON_COLLISION_BUCKET = "term-IRI collision (one IRI emitted by several assets)";
/** The detail block owned by req 00e8079e — must survive untouched. */
const COLLISION_DETAIL = "term-IRI collision(s) — one IRI emitted by several assets";

function printed(logSpy: jest.SpiedFunction<typeof console.log>): string {
  return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
}

/**
 * The JSON branch logs the whole pretty-printed document as ONE call argument.
 * ⛔ Scanning the JOINED text line-by-line for a line starting with `{` picks the
 * document's opening brace alone and JSON.parse then fails — the first draft of
 * this file did exactly that.
 */
function lastJson(logSpy: jest.SpiedFunction<typeof console.log>): {
  data: {
    warningCount: number;
    warnings: Array<{ actualValue?: string; constraint: string }>;
  };
} {
  const calls = logSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const arg = String(calls[i][0]);
    if (arg.trim().startsWith("{")) return JSON.parse(arg);
  }
  throw new Error("no JSON document logged");
}

/** `exo__Asset_relates` as an ObjectProperty (domain/range exo__Asset). */
function writeRelatesShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Asset_relates.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000bbbb-0000-0000-0000-00000000a001
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

/**
 * A REQUIRED property whose shape declares `sh:Warning` severity. This is the
 * only way a `minCount` result reaches the warning set — and `minCount` is one
 * of the three emitters that carry NO `actualValue` (ShaclLiteValidator :356
 * minCount, :372 maxCount, :509 unknown-property; only :455 class and :486
 * datatype set it). It is what locks the breakdown to `constraint`.
 */
function writeWarnSeverityMinCountShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Setting_key.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000bbbb-0000-0000-0000-00000000b001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: exo__Setting_key
exo__Property_domain:
  - "[[exo__Setting]]"
exo__Property_minCount: "1"
exo__Property_range: "http://www.w3.org/2001/XMLSchema#string"
exo__Property_severity: sh:Warning
aliases:
  - exo__Setting_key
---
Test shape: exo__Setting_key is required, but only at WARNING severity.
`,
  );
}

function writeAsset(
  vaultDir: string,
  relDir: string,
  uid: string,
  frontmatter: string,
): void {
  const dir = path.join(vaultDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${uid}.md`),
    `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
${frontmatter}---
Fixture asset ${uid}.
`,
  );
}

/** Source typed exo__Asset relating to `target` (raw frontmatter value). */
function writeRelatingSource(
  vaultDir: string,
  uid: string,
  target: string,
  label = "Source",
): void {
  writeAsset(
    vaultDir,
    "data",
    uid,
    `exo__Instance_class:
  - "[[exo__Asset]]"
exo__Asset_label: ${label}
exo__Asset_relates:
  - "${target}"
`,
  );
}

const ABSENT_UUID = "99999999-9999-4999-8999-999999999999";
const UNTYPED_UUID = "88888888-8888-4888-8888-888888888881";

describe("e3bac7b5: validate schema text output names the reasons behind the warning count", () => {
  let tmpDir: string;
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "warn-breakdown-e3bac7b5-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB1: an ABSENT target (pathless synthesised IRI) is named as not present in this vault", async () => {
    writeRelatesShape(tmpDir);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000001", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(`${BREAKDOWN_HEADER} (1 total):`);
    expect(out).toContain(REASON_NO_PATH);
    expect(out).not.toContain(REASON_WITH_PATH);
    expect(process.exitCode).toBeUndefined();
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB2: a target that RESOLVED here but carries no type is distinguished from an absent one", async () => {
    writeRelatesShape(tmpDir);
    // The target file EXISTS and the wikilink RESOLVES to it, so actualValue keeps
    // its directory — measured: `obsidian://vault/data/<uid>.md`. It has no
    // exo__Instance_class, so no type resolves. ⛤ Measured too: such a file is
    // dropped by the vault loader and contributes ZERO triples (a subject query
    // over this very fixture returned 2 subjects for 3 files), which is why the
    // reason is read off the IRI FORM and not off graph membership.
    writeAsset(tmpDir, "data", UNTYPED_UUID, `exo__Asset_label: Untyped target\n`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000002", `[[${UNTYPED_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(`${BREAKDOWN_HEADER} (1 total):`);
    expect(out).toContain(REASON_WITH_PATH);
    expect(out).not.toContain(REASON_NO_PATH);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB3: a SYMBOLIC term IRI target is distinguished from both file cases", async () => {
    writeRelatesShape(tmpDir);
    // `[[ems__Effort_votes]]` → expandClassValue → https://exocortex.my/ontology/ems#Effort_votes.
    // This is the live shape of all 4 non-obsidian warnings measured on vault-exodev.
    writeRelatingSource(
      tmpDir,
      "11110000-0000-4000-8000-000000000003",
      "[[ems__Effort_votes]]",
    );

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(`${BREAKDOWN_HEADER} (1 total):`);
    expect(out).toContain(REASON_SYMBOLIC);
    expect(out).not.toContain(REASON_NO_PATH);
    expect(out).not.toContain(REASON_WITH_PATH);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB4: the breakdown is TOTAL — printed counts sum to the printed total and to warningCount", async () => {
    writeRelatesShape(tmpDir);
    // A NON-class warning must be inside the total too: a breakdown that only
    // walked `class` results would still add up on a class-only fixture, so the
    // totality axis is vacuous without this asset.
    writeWarnSeverityMinCountShape(tmpDir);
    writeAsset(
      tmpDir,
      "settings",
      "55550000-0000-4000-8000-000000000002",
      `exo__Instance_class:\n  - "[[exo__Setting]]"\nexo__Asset_label: b.setting\nexo__Setting_value: "7"\n`,
    );
    writeAsset(tmpDir, "data", UNTYPED_UUID, `exo__Asset_label: Untyped target\n`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000004", `[[${ABSENT_UUID}]]`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000005", `[[${UNTYPED_UUID}]]`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000006", "[[ems__Effort_votes]]");

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    const header = /Breakdown by reason \((\d+) total\):/.exec(out);
    expect(header).not.toBeNull();
    const total = Number(header![1]);
    const lines = out
      .split("\n")
      .slice(out.split("\n").findIndex((l) => l.includes(BREAKDOWN_HEADER)) + 1);
    const counts: number[] = [];
    for (const line of lines) {
      const m = /^ {5}(\s*\d+)  (\S.*)$/.exec(line);
      if (!m) break;
      counts.push(Number(m[1].trim()));
    }
    // Exactly four reasons: absent · resolved-untyped · symbolic · minCount.
    expect(counts.length).toBe(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);

    // Same vault, json branch: the aggregate the breakdown must add up to.
    logSpy.mockClear();
    await runShapesModeAction({ vault: tmpDir, format: "json" });
    expect(lastJson(logSpy).data.warningCount).toBe(total);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB5: a vault with ZERO warnings prints no breakdown at all", async () => {
    writeRelatesShape(tmpDir);
    // A relating pair where BOTH sides are typed exo__Asset → conforms, no warnings.
    const target = "77770000-0000-4000-8000-000000000001";
    writeAsset(
      tmpDir,
      "data",
      target,
      `exo__Instance_class:\n  - "[[exo__Asset]]"\nexo__Asset_label: Typed target\n`,
    );
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000007", `[[${target}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain("Vault conforms to all shapes");
    expect(out).not.toContain(BREAKDOWN_HEADER);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB6: --format json is untouched — no breakdown text, full warnings list still shipped", async () => {
    writeRelatesShape(tmpDir);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000008", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const out = printed(logSpy);

    expect(out).not.toContain(BREAKDOWN_HEADER);
    const json = lastJson(logSpy);
    expect(json.data.warningCount).toBe(1);
    expect(json.data.warnings).toHaveLength(1);
    expect(json.data.warnings[0].actualValue).toContain(ABSENT_UUID);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB7: --format earl is untouched — no breakdown text", async () => {
    writeRelatesShape(tmpDir);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-000000000009", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "earl" });
    const out = printed(logSpy);

    expect(out).not.toContain(BREAKDOWN_HEADER);
    expect(out).toContain("sh:Warning");
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB8: the term-IRI collision detail block of req 00e8079e still prints, and gets its own bucket", async () => {
    writeRelatesShape(tmpDir);
    // Two assets whose label parses as <prefix>__<LocalName> → one term IRI, two emitters.
    writeAsset(
      tmpDir,
      "data",
      "66660000-0000-4000-8000-000000000001",
      `exo__Instance_class:\n  - "[[exo__Asset]]"\nexo__Asset_label: ems__DupTerm\n`,
    );
    writeAsset(
      tmpDir,
      "data",
      "66660000-0000-4000-8000-000000000002",
      `exo__Instance_class:\n  - "[[exo__Asset]]"\nexo__Asset_label: ems__DupTerm\n`,
    );
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-00000000000a", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(BREAKDOWN_HEADER);
    expect(out).toContain(REASON_COLLISION_BUCKET);
    expect(out).toContain(REASON_NO_PATH);
    // The pre-existing detail block, unchanged and still after the breakdown.
    expect(out).toContain(COLLISION_DETAIL);
    expect(out.indexOf(BREAKDOWN_HEADER)).toBeLessThan(out.indexOf(COLLISION_DETAIL));
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB9: lines are ordered count-descending and the counts are right-aligned", async () => {
    writeRelatesShape(tmpDir);
    // ⛔ TEN symbolic and ONE no-path, deliberately in this proportion: the
    // count order (symbolic first, 10 > 1) is the OPPOSITE of the code-point
    // order of the two labels ("class target IRI has no path…" < "class target
    // IRI is not under…"). The first draft had it the other way round — ten
    // no-path and one symbolic — and there both orders AGREED, so the mutant
    // that drops the count term printed the same thing and this axis could not
    // see it. That was a defect of the FIXTURE, not of the axis
    // (integration-test-revert-verify §A111).
    for (let i = 0; i < 10; i++) {
      writeRelatingSource(
        tmpDir,
        `2222000${i}-0000-4000-8000-000000000001`,
        "[[ems__Effort_votes]]",
      );
    }
    writeRelatingSource(tmpDir, "33330000-0000-4000-8000-000000000001", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const lines = printed(logSpy).split("\n");
    const start = lines.findIndex((l) => l.includes(BREAKDOWN_HEADER));
    const symbolicAt = lines.findIndex((l) => l.includes(REASON_SYMBOLIC));
    const noPathAt = lines.findIndex((l) => l.includes(REASON_NO_PATH));

    // ⛤ Reading the line back rather than bounding the index: it pins WHAT was
    // found, not merely that the search resolved.
    //
    // ⛔ The reason is NOT that a `>= 0` bound would assert nothing — it would.
    // `findIndex` returns exactly two classes of value, -1 when absent and an
    // index from zero when present, so a lower bound of zero DISCRIMINATES them
    // and is contentful; only a comparison against -1 would be identically true.
    // The reason is that `scripts/check-test-antipatterns.sh` is a TEXTUAL
    // ratchet (its pattern is the literal assertion form) and cannot tell a
    // legitimate index check from coverage filler. So this form is chosen to
    // express the same property more precisely while not matching that pattern —
    // ⛔ never to "fix" an assertion that was already sound.
    expect(lines[start] ?? "").toContain(BREAKDOWN_HEADER);
    expect(symbolicAt).toBeGreaterThan(start);
    expect(noPathAt).toBeGreaterThan(symbolicAt); // 10 before 1
    // Byte-exact lines: the two-digit count sets the column width, so the
    // one-digit count carries a pad space and both end in the same column.
    expect(lines[symbolicAt]).toBe(`     10  ${REASON_SYMBOLIC_FULL}`);
    expect(lines[noPathAt]).toBe(`      1  ${REASON_NO_PATH_FULL}`);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB10: a minCount warning (an emitter with NO actualValue) buckets by constraint, not as a class reason", async () => {
    writeWarnSeverityMinCountShape(tmpDir);
    writeRelatesShape(tmpDir);
    // exo__Setting missing its required key → minCount at sh:Warning severity.
    writeAsset(
      tmpDir,
      "settings",
      "55550000-0000-4000-8000-000000000001",
      `exo__Instance_class:\n  - "[[exo__Setting]]"\nexo__Asset_label: a.setting\nexo__Setting_value: "42"\n`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(BREAKDOWN_HEADER);
    expect(out).toContain("minCount constraint (shape-declared warning severity)");
    // ⛔ The whole point: an emitter with no target must NOT be folded into a
    // class reason. Keying the breakdown on `actualValue` would put it in one.
    expect(out).not.toContain(REASON_NO_PATH);
    expect(out).not.toContain(REASON_WITH_PATH);
    expect(out).not.toContain(REASON_SYMBOLIC);
    expect(out).not.toContain("no target recorded");
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB11: equal counts order by reason code points, not by the order warnings arrive", async () => {
    writeRelatesShape(tmpDir);
    // One no-path and one symbolic → counts tie at 1 each. The validator sorts its
    // results by focusNode, so the SYMBOLIC one arrives FIRST (uid 3333… < 4444…),
    // while code-point order of the reasons puts the no-path one first
    // ("…has no path…" < "…is not under…"). Without the reason tie-break the
    // printed order would follow arrival — the two orders are deliberately
    // OPPOSITE here, which is what makes the mutant on the tie-break visible.
    writeRelatingSource(
      tmpDir,
      "33330000-0000-4000-8000-000000000001",
      "[[ems__Effort_votes]]",
    );
    writeRelatingSource(tmpDir, "44440000-0000-4000-8000-000000000001", `[[${ABSENT_UUID}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const lines = printed(logSpy).split("\n");
    const noPathAt = lines.findIndex((l) => l.includes(REASON_NO_PATH));
    const symbolicAt = lines.findIndex((l) => l.includes(REASON_SYMBOLIC));

    expect(lines[noPathAt] ?? "").toContain(REASON_NO_PATH);
    expect(symbolicAt).toBeGreaterThan(noPathAt);
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB12: a class warning whose target type DOES resolve (range mismatch, shape-declared warning severity) is reported by IRI form, never as a type claim", async () => {
    // ⛔ The input that disproved the earlier labels BY EXECUTION. `constraint:
    // "class"` has two origins at the emitter — `severity: unresolvableRef ?
    // 'sh:Warning' : shape.severity` — and this is the second: the target IS typed
    // exo__Asset, the shape's range is exo__Setting, so the class does not conform
    // while resolving perfectly, and the shape declares sh:Warning severity.
    // Measured shape of the result: constraint "class", severity "sh:Warning",
    // actualValue `obsidian://vault/data/<uid>.md`, message "sh:class violation: …
    // does not conform to expected class …".
    const shapesDir = path.join(tmpDir, "shapes");
    fs.mkdirSync(shapesDir, { recursive: true });
    fs.writeFileSync(
      path.join(shapesDir, "exo__Asset_relates.md"),
      `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000cccc-0000-0000-0000-00000000a001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: exo__Asset_relates
exo__Property_domain:
  - "[[exo__Asset]]"
exo__Property_range:
  - "[[exo__Setting]]"
exo__Property_severity: sh:Warning
aliases:
  - exo__Asset_relates
---
Range is exo__Setting and severity is WARNING: a resolvable non-conforming target warns.
`,
    );
    const target = "aaaa1111-0000-4000-8000-000000000001";
    writeAsset(
      tmpDir,
      "data",
      target,
      `exo__Instance_class:\n  - "[[exo__Asset]]"\nexo__Asset_label: Resolvable but not a Setting\n`,
    );
    writeRelatingSource(tmpDir, "bbbb2222-0000-4000-8000-000000000001", `[[${target}]]`);

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(`${BREAKDOWN_HEADER} (1 total):`);
    expect(out).toContain(REASON_WITH_PATH);
    // ⛔ The whole point: the output must not claim anything about resolution or
    // type status, because here the type DID resolve.
    for (const retracted of RETRACTED_CLAIMS) {
      expect(out).not.toContain(retracted);
    }
  });

  it("@req:f28051a9-4107-497f-ba72-68267496558d WB13: no retracted claim about resolution or type status appears on a mixed-reason vault", async () => {
    writeRelatesShape(tmpDir);
    writeAsset(tmpDir, "data", UNTYPED_UUID, `exo__Asset_label: No Instance_class here\n`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-00000000000b", `[[${ABSENT_UUID}]]`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-00000000000c", `[[${UNTYPED_UUID}]]`);
    writeRelatingSource(tmpDir, "11110000-0000-4000-8000-00000000000d", "[[ems__Effort_votes]]");

    await runShapesModeAction({ vault: tmpDir, format: "text" });
    const out = printed(logSpy);

    expect(out).toContain(BREAKDOWN_HEADER);
    for (const retracted of RETRACTED_CLAIMS) {
      expect(out).not.toContain(retracted);
    }
  });
});
