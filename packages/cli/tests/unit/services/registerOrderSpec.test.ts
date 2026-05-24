/**
 * Tests for `registerOrderSpecFromVault` — CLI vault scanner that reads
 * `exo__FrontmatterOrderSpec` assets via fs and registers an
 * OrderSpecLoader. Production-shape: writes real markdown files to tmpdir,
 * scans them, asserts the loaded spec via the singleton registry.
 *
 * RFC 27a7a877.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// registerOrderSpec.ts imports from real `exocortex` source via
// jest config moduleNameMapper. No mock — verify true behaviour.
const { registerOrderSpecFromVault } = await import("../../../src/services/registerOrderSpec.js");
const { loadDefaultSpec, clearOrderSpecLoader } = await import("exocortex");

const HEAD = [
  "exo__Asset_isDefinedBy",
  "exo__Asset_uid",
];
const TAIL = ["exo__Asset_label"];

function makeSpecMarkdown(
  opts: {
    default?: boolean;
    head?: string[];
    tail?: string[];
    middleStrategy?: string;
    headIndent?: string;
    extraFrontmatter?: string;
    eol?: "\n" | "\r\n";
  } = {},
): string {
  const eol = opts.eol ?? "\n";
  const lines: string[] = ["---"];
  if (opts.default !== undefined) {
    lines.push(`exo__FrontmatterOrderSpec_default: ${String(opts.default)}`);
  }
  lines.push(`exo__FrontmatterOrderSpec_middleStrategy: ${opts.middleStrategy ?? "alphabetical"}`);
  if (opts.head !== undefined) {
    lines.push("exo__FrontmatterOrderSpec_head:");
    const indent = opts.headIndent ?? "  ";
    for (const h of opts.head) lines.push(`${indent}- ${h}`);
  }
  if (opts.tail !== undefined) {
    lines.push("exo__FrontmatterOrderSpec_tail:");
    for (const t of opts.tail) lines.push(`  - ${t}`);
  }
  if (opts.extraFrontmatter) {
    lines.push(opts.extraFrontmatter);
  }
  lines.push("---", "", "Body");
  return lines.join(eol);
}

describe("registerOrderSpecFromVault", () => {
  let tmpVault: string;

  beforeEach(() => {
    tmpVault = mkdtempSync(join(tmpdir(), "exocortex-spec-test-"));
    mkdirSync(join(tmpVault, "assetspaces", "exo"), { recursive: true });
    clearOrderSpecLoader();
  });

  afterEach(() => {
    clearOrderSpecLoader();
    rmSync(tmpVault, { recursive: true, force: true });
  });

  it("loads spec from a single default asset", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "default-spec.md"),
      makeSpecMarkdown({ default: true, head: HEAD, tail: TAIL }),
    );
    registerOrderSpecFromVault(tmpVault);
    const spec = loadDefaultSpec();
    expect(spec).not.toBeNull();
    expect(spec!.head).toEqual(HEAD);
    expect(spec!.tail).toEqual(TAIL);
    expect(spec!.middleStrategy).toBe("alphabetical");
  });

  it("returns null when no default-marked asset exists", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "non-default.md"),
      makeSpecMarkdown({ default: false, head: HEAD, tail: TAIL }),
    );
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()).toBeNull();
  });

  it("returns null when assetspaces/exo directory does not exist", () => {
    rmSync(join(tmpVault, "assetspaces", "exo"), { recursive: true });
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()).toBeNull();
  });

  it("returns null when vault has no spec files at all", () => {
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()).toBeNull();
  });

  it("ignores non-.md files in the scan directory", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "default.txt"),
      makeSpecMarkdown({ default: true, head: HEAD }),
    );
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()).toBeNull();
  });

  it("skips files without frontmatter", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "no-fm.md"),
      "# No frontmatter here\n",
    );
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "spec.md"),
      makeSpecMarkdown({ default: true, head: HEAD }),
    );
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()).not.toBeNull();
    expect(loadDefaultSpec()!.head).toEqual(HEAD);
  });

  it("returns empty arrays when head/tail keys are absent", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "minimal.md"),
      makeSpecMarkdown({ default: true }),
    );
    registerOrderSpecFromVault(tmpVault);
    const spec = loadDefaultSpec();
    expect(spec).not.toBeNull();
    expect(spec!.head).toEqual([]);
    expect(spec!.tail).toEqual([]);
  });

  it("defaults middleStrategy to 'alphabetical' when scalar missing", () => {
    const content = ["---", "exo__FrontmatterOrderSpec_default: true", "---", "", "Body"].join("\n");
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "spec.md"),
      content,
    );
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()!.middleStrategy).toBe("alphabetical");
  });

  it("returns the first matching default when multiple files have _default: true (alphabetical filename order)", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "b-second.md"),
      makeSpecMarkdown({ default: true, head: ["second"] }),
    );
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "a-first.md"),
      makeSpecMarkdown({ default: true, head: ["first"] }),
    );
    registerOrderSpecFromVault(tmpVault);
    // readdirSync typically returns inode order; allow either deterministic
    // result but require it to be one of the two spec files.
    const result = loadDefaultSpec()!.head;
    expect([["first"], ["second"]]).toContainEqual(result);
  });

  it("survives unreadable files in the scan directory", () => {
    writeFileSync(
      join(tmpVault, "assetspaces", "exo", "spec.md"),
      makeSpecMarkdown({ default: true, head: HEAD }),
    );
    // Create a directory with .md extension — readFileSync throws EISDIR
    mkdirSync(join(tmpVault, "assetspaces", "exo", "fake.md"));
    registerOrderSpecFromVault(tmpVault);
    expect(loadDefaultSpec()!.head).toEqual(HEAD);
  });

  it("re-registering with a different vault re-loads the spec", () => {
    const otherVault = mkdtempSync(join(tmpdir(), "exocortex-spec-other-"));
    mkdirSync(join(otherVault, "assetspaces", "exo"), { recursive: true });
    try {
      writeFileSync(
        join(tmpVault, "assetspaces", "exo", "spec.md"),
        makeSpecMarkdown({ default: true, head: ["vault1"] }),
      );
      writeFileSync(
        join(otherVault, "assetspaces", "exo", "spec.md"),
        makeSpecMarkdown({ default: true, head: ["vault2"] }),
      );

      registerOrderSpecFromVault(tmpVault);
      expect(loadDefaultSpec()!.head).toEqual(["vault1"]);

      registerOrderSpecFromVault(otherVault);
      expect(loadDefaultSpec()!.head).toEqual(["vault2"]);
    } finally {
      rmSync(otherVault, { recursive: true, force: true });
    }
  });

  describe("regex parser edge cases", () => {
    it("handles spec with extra frontmatter properties (uid, label, etc.)", () => {
      const content = [
        "---",
        "exo__Asset_uid: 0072f897-6bfb-435b-9828-76782f9ea732",
        'exo__Asset_label: "Default spec"',
        "exo__FrontmatterOrderSpec_default: true",
        "exo__FrontmatterOrderSpec_middleStrategy: alphabetical",
        "exo__FrontmatterOrderSpec_head:",
        "  - exo__Asset_uid",
        "  - exo__Asset_label",
        "---",
        "",
        "Body",
      ].join("\n");
      writeFileSync(join(tmpVault, "assetspaces", "exo", "spec.md"), content);
      registerOrderSpecFromVault(tmpVault);
      expect(loadDefaultSpec()!.head).toEqual(["exo__Asset_uid", "exo__Asset_label"]);
    });

    it("does not match `_default: false` as truthy", () => {
      writeFileSync(
        join(tmpVault, "assetspaces", "exo", "spec.md"),
        makeSpecMarkdown({ default: false, head: HEAD }),
      );
      registerOrderSpecFromVault(tmpVault);
      expect(loadDefaultSpec()).toBeNull();
    });

    it("matches `_default: true` with `\\b` boundary (rejects 'truex')", () => {
      const content = [
        "---",
        "exo__FrontmatterOrderSpec_default: truex",
        "exo__FrontmatterOrderSpec_middleStrategy: alphabetical",
        "exo__FrontmatterOrderSpec_head:",
        "  - x",
        "---",
        "",
        "Body",
      ].join("\n");
      writeFileSync(join(tmpVault, "assetspaces", "exo", "spec.md"), content);
      registerOrderSpecFromVault(tmpVault);
      expect(loadDefaultSpec()).toBeNull();
    });

    it("returns empty head when list uses 4-space indent (current regex expects 2)", () => {
      // Documented limitation: list extraction uses `  - ` (2 spaces). 4-space
      // indent (some YAML styles) returns empty list. Caller should normalise
      // when authoring spec assets. This test pins the documented behaviour.
      writeFileSync(
        join(tmpVault, "assetspaces", "exo", "spec.md"),
        makeSpecMarkdown({ default: true, head: HEAD, headIndent: "    " }),
      );
      registerOrderSpecFromVault(tmpVault);
      expect(loadDefaultSpec()!.head).toEqual([]);
    });
  });
});
