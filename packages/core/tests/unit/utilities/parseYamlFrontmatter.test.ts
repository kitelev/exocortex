import { describe, it, expect, jest, afterEach } from "@jest/globals";
import yaml from "js-yaml";
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
