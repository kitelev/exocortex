/**
 * Issue #2997 Phase 4: Unit tests for `exocortex-cli validate frontmatter`.
 *
 * Each scenario in the RFC's acceptance criteria gets its own test:
 *   1. Missing `exo__Asset_uid` → actionable error with file path + hint.
 *   2. Missing `exo__Asset_isDefinedBy` → actionable error with file path + hint.
 *   3. Empty literal property → actionable error with file path + property + hint.
 *   4. Invalid Instance_class IRI → actionable error with file path + IRI nature.
 *   5. Clean vault → no errors.
 *
 * Plus:
 *   - The `violationToError` mapper covers each invariant code.
 *   - The command is registered as a `frontmatter` subcommand.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const {
  validateFrontmatterCommand,
  violationToError,
} = await import("../../../src/commands/validate-frontmatter.js");

const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../../src/adapters/FileSystemVaultAdapter.js"
);

function createTmpVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exocortex-validate-fm-"));
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

/**
 * Helper: run the same per-file pipeline that the command's `.action`
 * runs, but inline so we can assert on the structured error list without
 * spinning up Commander's process-exit machinery.
 */
function collectErrors(vaultPath: string) {
  const adapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(adapter);
  const errors = [];
  for (const file of adapter.getAllFiles()) {
    const fm = adapter.getFrontmatter(file);
    if (fm) {
      const violation = converter.validateExocortexAsset(fm);
      if (violation) errors.push(violationToError(file.path, violation));
    }
    try {
      converter.notePathToIRI(file.path);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      errors.push({
        file: file.path,
        code: "INVALID_PATH_IRI" as const,
        reason: `Invalid IRI format for vault path: ${reason}`,
        hint: `rename the file — its path \`${file.path}\` cannot be encoded into a valid \`obsidian://vault/...\` IRI (avoid raw whitespace, control characters, and angle brackets)`,
      });
    }
  }
  return errors;
}

describe("Issue #2997 Phase 4: validate frontmatter command", () => {
  let vault: string;

  beforeEach(() => {
    vault = createTmpVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("registers a 'frontmatter' subcommand with --vault, --output, --staged options", () => {
    const cmd = validateFrontmatterCommand();
    expect(cmd.name()).toBe("frontmatter");

    const flags = (cmd as any).options.map((o: any) => o.long);
    expect(flags).toEqual(
      expect.arrayContaining(["--vault", "--output", "--staged"]),
    );
  });

  describe("AC1: missing exo__Asset_uid", () => {
    it("reports file path + hint to add `exo__Asset_uid: <uuid>` to frontmatter", () => {
      writeFile(
        vault,
        "bad-uid.md",
        `---
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "no uid"
exo__Instance_class:
  - "[[ems__Task]]"
---
body
`,
      );

      const errors = collectErrors(vault);
      const err = errors.find(
        (e) =>
          e.code === "MISSING_PROPERTY" &&
          (e as any).property === "exo__Asset_uid",
      );
      expect(err).toBeDefined();
      expect(err!.file).toBe("bad-uid.md");
      expect(err!.hint).toMatch(/exo__Asset_uid/);
      expect(err!.hint).toMatch(/<uuid>/);
    });
  });

  describe("AC2: missing exo__Asset_isDefinedBy is allowed", () => {
    it("does not report a violation when exo__Asset_isDefinedBy is absent", () => {
      // exo__Asset_isDefinedBy was downgraded from required to optional —
      // downstream consumers (FolderRepairService, URIConstructionService,
      // MetadataExtractor) handle the missing case via defaults, so the loader
      // no longer skips assets that lack the ontology pointer.
      writeFile(
        vault,
        "missing-defined-by.md",
        `---
exo__Asset_uid: 11111111-1111-1111-1111-111111111111
exo__Asset_label: "no defined-by"
exo__Instance_class:
  - "[[ems__Task]]"
---
body
`,
      );

      const errors = collectErrors(vault);
      const err = errors.find(
        (e) =>
          e.code === "MISSING_PROPERTY" &&
          (e as any).property === "exo__Asset_isDefinedBy",
      );
      expect(err).toBeUndefined();
    });
  });

  describe("AC3: empty literal property", () => {
    it("reports file path + property name + hint when a required property is empty", () => {
      // exo__Asset_label is optional (basename fallback); empty exo__Asset_uid
      // exercises the EMPTY_PROPERTY path on a still-required property.
      writeFile(
        vault,
        "empty-uid.md",
        `---
exo__Asset_uid: ""
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "task"
exo__Instance_class:
  - "[[ems__Task]]"
---
`,
      );

      const errors = collectErrors(vault);
      const err = errors.find(
        (e) =>
          e.code === "EMPTY_PROPERTY" &&
          (e as any).property === "exo__Asset_uid",
      );
      expect(err).toBeDefined();
      expect(err!.file).toBe("empty-uid.md");
      expect(err!.hint).toMatch(/exo__Asset_uid/);
      expect(err!.hint).toMatch(/non-empty value|remove|<uuid>/);
    });

    it("reports the property name when an optional property is present but empty", () => {
      writeFile(
        vault,
        "empty-status.md",
        `---
exo__Asset_uid: 33333333-3333-3333-3333-333333333333
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "task"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: ""
---
`,
      );

      const errors = collectErrors(vault);
      const err = errors.find(
        (e) =>
          e.code === "EMPTY_OPTIONAL_PROPERTY" &&
          (e as any).property === "ems__Effort_status",
      );
      expect(err).toBeDefined();
      expect(err!.file).toBe("empty-status.md");
      expect(err!.hint).toMatch(/ems__Effort_status/);
      expect(err!.hint).toMatch(/remove|non-empty/);
    });
  });

  describe("AC4: Invalid IRI format (Instance_class wikilink)", () => {
    it("reports file path + nature of malformed IRI when Instance_class contains spaces or parens", () => {
      writeFile(
        vault,
        "bad-class.md",
        `---
exo__Asset_uid: 44444444-4444-4444-4444-444444444444
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "bad class"
exo__Instance_class:
  - "[[ems__Effort (legacy)]]"
---
`,
      );

      const errors = collectErrors(vault);
      const err = errors.find(
        (e) => e.code === "INVALID_INSTANCE_CLASS_IRI",
      );
      expect(err).toBeDefined();
      expect(err!.file).toBe("bad-class.md");
      expect(err!.reason).toMatch(/Invalid Instance_class IRI/);
      expect(err!.hint).toMatch(/whitespace|parentheses/);
    });
  });

  describe("AC5: clean vault → no errors", () => {
    it("returns zero errors when every asset satisfies invariants", () => {
      writeFile(
        vault,
        "good.md",
        `---
exo__Asset_uid: 55555555-5555-5555-5555-555555555555
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_label: "good"
exo__Instance_class:
  - "[[ems__Task]]"
---
body
`,
      );
      writeFile(
        vault,
        "plain-note.md",
        `# heading

a plain markdown note with no frontmatter
`,
      );

      const errors = collectErrors(vault);
      expect(errors).toEqual([]);
    });
  });

  describe("violationToError mapper", () => {
    it("maps MISSING_PROPERTY for exo__Asset_uid to a uid-template hint", () => {
      const err = violationToError("a.md", {
        code: "MISSING_PROPERTY",
        property: "exo__Asset_uid",
        message: 'Required property "exo__Asset_uid" is missing',
      });
      expect(err.code).toBe("MISSING_PROPERTY");
      expect(err.file).toBe("a.md");
      expect(err.hint).toContain("exo__Asset_uid");
      expect(err.hint).toContain("<uuid>");
    });

    it("maps MISSING_PROPERTY for exo__Asset_isDefinedBy to an ontology-marker hint", () => {
      const err = violationToError("a.md", {
        code: "MISSING_PROPERTY",
        property: "exo__Asset_isDefinedBy",
        message: 'Required property "exo__Asset_isDefinedBy" is missing',
      });
      expect(err.hint).toContain("exo__Asset_isDefinedBy");
      expect(err.hint).toContain("[[!kitelev]]");
    });

    it("maps EMPTY_PROPERTY to a fill-or-remove hint", () => {
      const err = violationToError("a.md", {
        code: "EMPTY_PROPERTY",
        property: "exo__Asset_label",
        message: 'Required property "exo__Asset_label" is empty',
      });
      expect(err.hint).toMatch(/non-empty/);
      expect(err.hint).toContain("exo__Asset_label");
    });

    it("maps EMPTY_OPTIONAL_PROPERTY to a remove-or-fill hint", () => {
      const err = violationToError("a.md", {
        code: "EMPTY_OPTIONAL_PROPERTY",
        property: "ems__Effort_status",
        message: 'Optional property "ems__Effort_status" is present but empty',
      });
      expect(err.hint).toMatch(/remove|non-empty/);
      expect(err.hint).toContain("ems__Effort_status");
    });

    it("maps INVALID_INSTANCE_CLASS_IRI to a wikilink-fix hint", () => {
      const err = violationToError("a.md", {
        code: "INVALID_INSTANCE_CLASS_IRI",
        property: "exo__Instance_class",
        message: 'Invalid Instance_class IRI: "[[ems__Foo (bar)]]"',
      });
      expect(err.hint).toMatch(/whitespace|parentheses/);
    });
  });
});
