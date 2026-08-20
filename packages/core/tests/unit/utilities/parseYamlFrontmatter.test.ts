import { describe, it, expect, jest, afterEach } from "@jest/globals";
import * as yaml from "js-yaml";
import { parseYamlFrontmatterTolerant } from "../../../src/utilities/parseYamlFrontmatter";

/**
 * #3800 — `parseYamlFrontmatterTolerant`: a bare `yaml.load` throws on a
 * duplicated mapping key, which used to collapse the whole asset to `{}`/null
 * at every read (0 triples → every precondition false-fails → invisible &
 * unrepairable). The helper keeps the strict parse for well-formed input and
 * only retries `{ json: true }` (last-wins) + WARN on a throw.
 *
 * Revert-verify: swap the `{ json: true }` retry back to a re-throw / `return
 * null` and the "duplicate key resolves last-wins" cases go RED; the
 * clean/malformed cases stay GREEN (negative controls isolate non-vacuity).
 */
describe("#3800 parseYamlFrontmatterTolerant", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves a duplicated mapping key last-wins instead of throwing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const block = [
      "exo__Asset_uid: 16458983",
      'exo__Asset_prototype: "[[aaa]]"',
      'ems__Effort_status: "[[Backlog]]"',
      'exo__Asset_prototype: "[[bbb]]"',
    ].join("\n");

    const parsed = parseYamlFrontmatterTolerant(block, "repro.md");

    expect(parsed).not.toBeNull();
    // last-wins: the SECOND exo__Asset_prototype survives.
    expect(parsed!.exo__Asset_prototype).toBe("[[bbb]]");
    expect(parsed!.ems__Effort_status).toBe("[[Backlog]]");
    expect(parsed!.exo__Asset_uid).toBe(16458983);
    // WARN emitted so the malformed asset is observable, not silently swallowed.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("duplicated mapping key");
    expect(String(warn.mock.calls[0][0])).toContain("repro.md");
  });

  it("parses well-formed frontmatter identically to a bare yaml.load, with NO warn", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const block = [
      "exo__Asset_uid: abc",
      "exo__Instance_class:",
      '  - "[[ems__Task]]"',
      'exo__Asset_label: "Hello"',
    ].join("\n");

    const parsed = parseYamlFrontmatterTolerant(block);

    // Byte-for-byte identical result to the strict parser for clean input.
    expect(parsed).toEqual(yaml.load(block));
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the last occurrence for a duplicated ARRAY-valued key", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const block = [
      "exo__Asset_uid: abc",
      "ems__Instance_class:",
      '  - "[[first]]"',
      "ems__Instance_class:",
      '  - "[[second]]"',
    ].join("\n");

    const parsed = parseYamlFrontmatterTolerant(block);

    expect(parsed!.ems__Instance_class).toEqual(["[[second]]"]);
  });

  it("returns null for genuinely-malformed YAML (not a mere duplicate key)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Unterminated flow sequence → throws even in json:true mode.
    const parsed = parseYamlFrontmatterTolerant('key: "unterminated\n  bad: [1, 2');
    expect(parsed).toBeNull();
    // No last-wins rescue happened → no misleading warn.
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null for empty / null-scalar frontmatter (no object)", () => {
    // Preserves the pre-fix adapter contract exactly: `typeof parsed ===
    // "object" && parsed !== null`. An empty block / null scalar → null.
    expect(parseYamlFrontmatterTolerant("")).toBeNull();
    expect(parseYamlFrontmatterTolerant("null")).toBeNull();
  });
});

/**
 * Locks the SCHEMA half of the parse, which nothing else covered.
 *
 * js-yaml 4's DEFAULT_SCHEMA gave frontmatter a **dual typing** the vault has
 * relied on since the beginning: a BARE date-like scalar (`2026-08-19`) loads as
 * a `Date`, a QUOTED one (`"2026-08-19"`) stays a `string`. Four production
 * modules branch on exactly that — `NoteToRDFConverter`, `GenericAssetCreation‌Service`,
 * `DisplayNameTemplateEngine`, `display-name/hostFunctions` — and both writers
 * emit both forms (`create` writes bare, `set-property` quotes string-semantic
 * properties), so BOTH types coexist in every real vault.
 *
 * js-yaml 5 changed the default to CORE_SCHEMA, where a bare date is just a
 * string. That is a silent, vault-wide type flip: no parse error, no test
 * failure — a measured ZERO tests asserted `instanceof Date` before this block.
 * `parseYamlFrontmatterTolerant` therefore asks for `YAML11_SCHEMA` by name,
 * which reproduces js-yaml 4's default exactly.
 *
 * Both `yaml.load` call sites are covered on purpose: the strict path AND the
 * tolerant (duplicate-key) retry. Dropping the schema from either one alone
 * must turn one of these axes red — otherwise the guard only covers the call
 * site that happened to be exercised.
 */
describe("parseYamlFrontmatterTolerant — js-yaml 4 dual date typing (YAML11_SCHEMA)", () => {
  it("STRICT path: a bare date-like scalar loads as Date, a quoted one stays a string", () => {
    const parsed = parseYamlFrontmatterTolerant(
      'exo__Asset_createdAt: 2026-08-19\nexo__Asset_label: "2026-08-19"\n',
    );

    expect(parsed?.exo__Asset_createdAt).toBeInstanceOf(Date);
    expect(parsed?.exo__Asset_label).toBe("2026-08-19");
    // ⛤ Not just "is a Date" — the INSTANT must be right, otherwise a schema
    // that parses dates differently (offset/locale) would pass this axis.
    expect((parsed?.exo__Asset_createdAt as Date).toISOString()).toBe(
      "2026-08-19T00:00:00.000Z",
    );
  });

  it("STRICT path: a bare datetime keeps its time component", () => {
    const parsed = parseYamlFrontmatterTolerant(
      "ems__Effort_startTimestamp: 2026-08-19T14:30:45Z\n",
    );

    expect(parsed?.ems__Effort_startTimestamp).toBeInstanceOf(Date);
    expect((parsed?.ems__Effort_startTimestamp as Date).toISOString()).toBe(
      "2026-08-19T14:30:45.000Z",
    );
  });

  it("TOLERANT path: the duplicate-key retry keeps the same dual typing", () => {
    // A duplicated key makes the strict parse throw, so this asset can ONLY be
    // read through the `{ json: true }` retry — a second `yaml.load` with its
    // own schema argument. Without this axis, dropping the schema there would
    // silently degrade every malformed-but-rescued asset to string dates.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const parsed = parseYamlFrontmatterTolerant(
      'exo__Asset_uid: u1\nexo__Asset_createdAt: 2026-08-19\nexo__Asset_label: "2026-08-19"\nexo__Asset_uid: u2\n',
    );

    expect(parsed?.exo__Asset_uid).toBe("u2"); // proves the tolerant path ran
    expect(parsed?.exo__Asset_createdAt).toBeInstanceOf(Date);
    expect(parsed?.exo__Asset_label).toBe("2026-08-19");

    warn.mockRestore();
  });

  it("the helper's schema is the one that produces this typing, not the ambient default", () => {
    // ⛤ Canary against a vacuous suite: if the js-yaml DEFAULT ever produced
    // Dates again, every axis above would pass no matter what the helper asks
    // for. Pinning the default's behaviour makes the axes above meaningful —
    // they only hold BECAUSE the helper names YAML11_SCHEMA explicitly.
    expect(yaml.load("d: 2026-08-19")).toEqual({ d: "2026-08-19" });
    expect(yaml.load("d: 2026-08-19", { schema: yaml.YAML11_SCHEMA })).toEqual({
      d: new Date("2026-08-19T00:00:00.000Z"),
    });
  });
});

/**
 * Locks the STRICTNESS half, which the schema does not cover.
 *
 * js-yaml 5 relaxed the parser: `  : : :` THREW in 4.1.1 ("incomplete explicit
 * mapping pair") and parses in 5 to `{ null: { null: { null: null } } }` — under
 * CORE, under YAML11 and under the default alike. So no schema argument restores
 * it, and `LoadOptions` in 5.3.0 exposes no strictness switch (filename,
 * maxDepth, source, schema, json, maxTotalMergeKeys, maxAliases).
 *
 * Without a guard the bump would silently change production behaviour: every
 * caller of this helper — 11 of them, including the Obsidian adapter's
 * `getFileMetadata` — would receive a mapping keyed `"null"` where it used to
 * receive `{}`. Frontmatter keys are property names, so a key YAML itself
 * resolves to null/bool/number did not come from one.
 *
 * ⛤ The predicate was measured before being chosen, because in YAML 1.1 `on`,
 * `y` and `12` are legitimately non-strings: across vault-exodev + vault-my
 * (26,572 files, 260,914 top-level keys) the number of keys resolving to a
 * non-string is ZERO. It rejects nothing real.
 */
describe("parseYamlFrontmatterTolerant — malformed blocks stay rejected (js-yaml 5 strictness)", () => {
  it("rejects a block whose keys are not property names", () => {
    // The exact input the Obsidian adapter suite feeds: js-yaml 4 threw here.
    expect(parseYamlFrontmatterTolerant("  : : :")).toBeNull();
  });

  it("canary: the parser itself now ACCEPTS that block — the rejection is ours", () => {
    // ⛤ Without this, the axis above could pass because js-yaml still throws,
    // i.e. for a reason that has nothing to do with the guard being present.
    expect(yaml.load("  : : :", { schema: yaml.YAML11_SCHEMA })).toEqual({
      null: { null: { null: null } },
    });
  });

  it("keeps accepting ordinary frontmatter, including keys that merely look odd", () => {
    const parsed = parseYamlFrontmatterTolerant(
      'exo__Asset_uid: u1\naliases:\n  - "a"\ntags: [alpha, beta]\n',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.exo__Asset_uid).toBe("u1");
    expect(parsed?.tags).toEqual(["alpha", "beta"]);
    expect(parsed?.aliases).toEqual(["a"]);
  });
  it("bare y/n/on/off in a VALUE are booleans — YAML 1.1, unchanged by the bump", () => {
    // ⛤ Found by this suite's own control axis: `tags: [x, y]` parses to
    // `["x", true]`, not `["x", "y"]`. That is YAML 1.1 and was equally true
    // under js-yaml 4's default schema, so it is NOT a migration regression —
    // but it is worth pinning, because the guard above deliberately does NOT
    // extend to values: rejecting those would reject real assets.
    expect(
      parseYamlFrontmatterTolerant("tags: [x, y]\nflag: on\n"),
    ).toEqual({ tags: ["x", true], flag: true });
  });
});
