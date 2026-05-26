import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForLiteralForm,
  auditGroundingTypeLiteralFormCommand,
} from "../../../src/commands/audit-grounding-type-literal-form.js";
import { auditCommand } from "../../../src/commands/audit.js";

const WL_PROPERTY_SET = "[[cf3bb923-f1f1-40be-b728-782844402426]]";

function writeGrounding(dir: string, uid: string, typeLine: string): void {
  const content = `---
exo__Asset_uid: ${uid}
exo__Asset_label: Test Grounding ${uid}
exo__Instance_class: "[[abc12345-0000-0000-0000-000000000001]]"
exocmd__Grounding_type: ${typeLine}
exocmd__Grounding_targetProperty: "[[some-prop]]"
---

Body.
`;
  writeFileSync(join(dir, `${uid}.md`), content, "utf-8");
}

describe("audit grounding-type-literal-form — Commander wiring", () => {
  it("registers under 'audit' parent command", () => {
    const parent = auditCommand();
    expect(parent.name()).toBe("audit");
    const sub = parent.commands.find((c) => c.name() === "grounding-type-literal-form");
    expect(sub).toBeDefined();
  });

  it("subcommand declares --vault required + --output options", () => {
    const sub = auditGroundingTypeLiteralFormCommand();
    expect(sub.name()).toBe("grounding-type-literal-form");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--vault");
    expect(opts).toContain("--output");
  });

  it("--help text references RFC 9d20c91f cutover semantics", () => {
    const sub = auditGroundingTypeLiteralFormCommand();
    const help = sub.helpInformation();
    expect(help).toMatch(/literal-string\s+form/);
  });
});

describe("audit grounding-type-literal-form — scanVaultForLiteralForm", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `audit-grounding-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when all groundings use wikilink form", () => {
    writeGrounding(tmpDir, "uid-001", `"${WL_PROPERTY_SET}"`);
    writeGrounding(tmpDir, "uid-002", `"${WL_PROPERTY_SET}"`);
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it("detects bare-string literal form (quoted)", () => {
    writeGrounding(tmpDir, "uid-003", `"property_set"`);
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].value).toBe(`"property_set"`);
    expect(violations[0].path).toBe("uid-003.md");
  });

  it("detects bare-string literal form (unquoted)", () => {
    writeGrounding(tmpDir, "uid-004", `property_delete`);
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].value).toBe("property_delete");
  });

  it("recurses into nested directories", () => {
    const sub = join(tmpDir, "subdir", "nested");
    mkdirSync(sub, { recursive: true });
    writeGrounding(sub, "uid-005", `"composite"`);
    writeGrounding(tmpDir, "uid-006", `"${WL_PROPERTY_SET}"`);
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].path.endsWith("uid-005.md")).toBe(true);
  });

  it("skips .git, .obsidian, node_modules", () => {
    for (const skip of [".git", ".obsidian", "node_modules"]) {
      const skipDir = join(tmpDir, skip);
      mkdirSync(skipDir, { recursive: true });
      writeGrounding(skipDir, `uid-skip-${skip}`, `"property_set"`);
    }
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it("ignores files without Grounding_type predicate", () => {
    const noGrounding = `---
exo__Asset_uid: uid-007
exo__Asset_label: Plain
---
Body.
`;
    writeFileSync(join(tmpDir, "uid-007.md"), noGrounding, "utf-8");
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it("ignores files without frontmatter", () => {
    writeFileSync(join(tmpDir, "no-fm.md"), "Just body text.\n", "utf-8");
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it("returns multiple violations across files with correct line numbers", () => {
    writeGrounding(tmpDir, "uid-008", `"property_set"`);
    writeGrounding(tmpDir, "uid-009", `service_call`);
    writeGrounding(tmpDir, "uid-010", `"${WL_PROPERTY_SET}"`);
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(2);
    const paths = violations.map((v) => v.path).sort();
    expect(paths).toEqual(["uid-008.md", "uid-009.md"]);
    for (const v of violations) {
      expect(v.line).toBeGreaterThan(0);
    }
  });

  it("treats wikilink with alias as valid (e.g. `[[uid|label]]`)", () => {
    writeGrounding(
      tmpDir,
      "uid-011",
      `"[[cf3bb923-f1f1-40be-b728-782844402426|property_set]]"`,
    );
    const violations = scanVaultForLiteralForm(tmpDir);
    expect(violations).toHaveLength(0);
  });
});
