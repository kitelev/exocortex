/**
 * RFC 430e84f1 (P1) — `exocortex-cli create` must REJECT a `--property KEY=value`
 * whose property NAME does not exist in the MOUNTED TBox. `create` already
 * rejects a dangling wikilink VALUE (`WikilinkValidator`); this closes the twin
 * fail-silent hole on the KEY. Real bug (project ab52aee1): an LLM bot wrote
 * `ems__Effort_parentEffort` (typo of `ems__Effort_parent`) → a DEAD property no
 * SPARQL/layout/graph-relation reads → the task silently vanished from its
 * project's sub-tasks.
 *
 * Exercises the REAL `createCommand()` action end-to-end against a temp fixture
 * vault that contains genuine property definitions (a non-empty mounted
 * property-name set), so the collector runs for real — including a UID-form
 * `exo__ObjectProperty` and a DOMAINLESS `exo__DatatypeProperty` (the two shapes
 * `ShapeLoader` drops, proving the dedicated collector is needed). Plus
 * service-level assertions for the structured-error form, the bare-key skip, and
 * the degenerate-mount fail-open.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * commenting out the `propertyNameValidator.validate(...)` call in create.ts
 * (type-preserving) makes the unknown-prefix + misspelled-name scenarios PASS
 * the create (exit 0) → those assertions go RED; the no-false-positive + bare-key
 * skip + degenerate fail-open + no-flag negative-controls stay GREEN in both
 * states, proving non-vacuity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");
const { PropertyNameValidator } = await import(
  "../../src/services/PropertyNameValidator.js"
);
const { UnknownPropertyError } = await import(
  "../../src/utils/errors/UnknownPropertyError.js"
);

const REQ = "40a9a81b-729e-4dc1-9bc1-53295515a4b2";

// Full-UUID class → `--class <uid>` pass-through fires without a class-def file.
const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
// A resolvable wikilink target for property VALUES (name validation is
// independent, but we skip wikilink validation anyway to isolate the KEY check).
const VALID_TARGET = "cafe0000-0000-0000-0000-000000000001";

const OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";
const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Write a property-definition file (UID-named, like the real UID-canon TBox). */
function writeProp(
  vault: string,
  uid: string,
  label: string,
  metaclassRef: string,
  extra: Record<string, string | string[]> = {},
): void {
  const dir = path.join(vault, "assetspaces/kitelev/exoas-exo/exo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Instance_class: `"${metaclassRef}"`,
      exo__Asset_label: label,
      ...extra,
    }),
  );
}

/**
 * Build a fixture vault with a non-empty mounted property-name set:
 *  - ems__Effort_parent      (ObjectProperty, label-form metaclass ref, has domain)
 *  - ems__Effort_status      (ObjectProperty, UID-form metaclass ref)
 *  - ems__Effort_startTimestamp (DatatypeProperty, UID-form, NO domain — the two
 *                                shapes ShapeLoader drops)
 *  - exo__Asset_isDefinedBy  (ObjectProperty) — so structural keys pass
 *  - exo__Asset_relates      (ObjectProperty)
 * → knownPrefixes = {ems, exo}; 5 known names.
 */
function buildFixtureVault(vault: string): void {
  fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
  writeProp(vault, "0000-prop-1", "ems__Effort_parent", "[[exo__ObjectProperty]]", {
    exo__Property_domain: '"[[ems__Effort]]"',
  });
  writeProp(
    vault,
    "0000-prop-2",
    "ems__Effort_status",
    `[[${OBJECT_PROPERTY_UID}|exo__ObjectProperty]]`,
  );
  // DatatypeProperty + NO domain → the pair ShapeLoader silently skips.
  writeProp(
    vault,
    "0000-prop-3",
    "ems__Effort_startTimestamp",
    `[[${DATATYPE_PROPERTY_UID}]]`,
  );
  writeProp(vault, "0000-prop-4", "exo__Asset_isDefinedBy", "[[exo__ObjectProperty]]");
  writeProp(vault, "0000-prop-5", "exo__Asset_relates", "[[exo__ObjectProperty]]");
}

describe("RFC 430e84f1: `cli create` validates property NAMES against the mounted TBox", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-propval-"));
    buildFixtureVault(vault);

    stdoutChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function runCreate(extraArgs: string[]): Promise<void> {
    const cmd = createCommand();
    await cmd.parseAsync(
      [
        "--class",
        CLASS_UID,
        "--label",
        "E2E-TEST property-name validation",
        "--vault",
        vault,
        "--skip-wikilink-validation",
        ...extraArgs,
      ],
      { from: "user" },
    );
  }

  /** Count asset files anywhere under the vault (excludes the 5 fixture props). */
  function createdAssetCount(): number {
    const walk = (dir: string): number => {
      let n = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) n += walk(full);
        else if (e.name.endsWith(".md") && !e.name.startsWith("0000-prop-")) n++;
      }
      return n;
    };
    return walk(vault);
  }

  it(`rejects an UNKNOWN-PREFIX property name — exit != 0, no asset created @req:${REQ}`, async () => {
    await runCreate(["--property", "nonExisting__Prop=x"]);

    expect(exitCodes).not.toContain(0);
    expect(exitCodes).toContain(2); // INVALID_ARGUMENTS
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("Unknown property");
    expect(stderr).toContain("nonExisting__Prop");
    expect(createdAssetCount()).toBe(0);
    expect(stdoutChunks.join("")).toBe(""); // no success JSON
  });

  it(`rejects a KNOWN-PREFIX MISSPELLED name and fuzzy-suggests the closest @req:${REQ}`, async () => {
    await runCreate(["--property", `ems__Effort_parentEffort=[[${VALID_TARGET}]]`]);

    expect(exitCodes).not.toContain(0);
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("ems__Effort_parent"); // the suggestion
    expect(createdAssetCount()).toBe(0);
  });

  it(`a REAL (known) property passes — no false-positive @req:${REQ}`, async () => {
    await runCreate([
      "--property",
      `ems__Effort_parent=[[${VALID_TARGET}]]`,
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(2);
    const json = JSON.parse(stdoutChunks.join("").trim());
    expect(json.uuid).toBeTruthy();
    expect(createdAssetCount()).toBe(1);
  });

  it(`a DOMAINLESS DatatypeProperty name passes (the shape ShapeLoader drops) @req:${REQ}`, async () => {
    await runCreate([
      "--property",
      `ems__Effort_startTimestamp=2026-07-27T10:00:00`,
    ]);

    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(2);
  });

  // ── Service-level assertions (real collector over the real fixture files) ──

  it(`structured error carries a machine-readable { unknown, suggestions } @req:${REQ}`, async () => {
    const validator = new PropertyNameValidator(vault);
    let caught: unknown;
    try {
      await validator.validate(["ems__Effort_parentEffort"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownPropertyError);
    const err = caught as InstanceType<typeof UnknownPropertyError>;
    expect(err.unknown).toBe("ems__Effort_parentEffort");
    expect(err.suggestions).toContain("ems__Effort_parent");
    // Also surfaced in the base CLIError structured context (JSON mode).
    expect(err.context).toEqual({
      unknown: "ems__Effort_parentEffort",
      suggestions: err.suggestions,
    });
  });

  it(`skips bare Obsidian-native YAML keys (aliases/tags/title) @req:${REQ}`, async () => {
    const validator = new PropertyNameValidator(vault);
    await expect(
      validator.validate(["aliases", "tags", "title", "cssclasses"]),
    ).resolves.toBeUndefined();
  });

  it(`known property names pass at the service level (incl. UID-form + domainless) @req:${REQ}`, async () => {
    const validator = new PropertyNameValidator(vault);
    await expect(
      validator.validate([
        "ems__Effort_parent",
        "ems__Effort_status", // UID-form ObjectProperty metaclass ref
        "ems__Effort_startTimestamp", // domainless DatatypeProperty
        "exo__Asset_relates",
      ]),
    ).resolves.toBeUndefined();
  });

  it(`degenerate mount (ZERO property definitions) → fail-open, no reject @req:${REQ}`, async () => {
    const emptyVault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-propval-empty-"));
    try {
      const validator = new PropertyNameValidator(emptyVault);
      await expect(
        validator.validate(["anything__Prop", "fake__Whatever"]),
      ).resolves.toBeUndefined();
    } finally {
      fs.rmSync(emptyVault, { recursive: true, force: true });
    }
  });

  it("exposes NO bot-accessible escape-hatch flag (--allow-unknown-property)", () => {
    const flags = createCommand()
      .options.map((o) => o.long)
      .filter((l): l is string => Boolean(l));
    expect(flags).not.toContain("--allow-unknown-property");
    expect(flags.some((f) => /allow.*(unknown|property)/i.test(f))).toBe(false);
  });
});
