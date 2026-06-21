import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFrontmatter,
  asStringArray,
  parseWikilink,
  parseEnumSuffix,
} from "../lib/frontmatter.mjs";

test("parseFrontmatter splits YAML frontmatter from body", () => {
  const { data, body } = parseFrontmatter(
    `---\nexo__Asset_label: "hello world"\nfoo: 1\n---\n# Title\n\nbody text\n`,
  );
  assert.equal(data["exo__Asset_label"], "hello world");
  assert.equal(data["foo"], 1);
  assert.match(body, /# Title/);
  assert.match(body, /body text/);
});

test("parseFrontmatter returns whole content as body when no frontmatter", () => {
  const { data, body } = parseFrontmatter("# just markdown\n");
  assert.deepEqual(data, {});
  assert.match(body, /# just markdown/);
});

test("parseFrontmatter fail-opens on malformed YAML (no crash)", () => {
  const { data, body } = parseFrontmatter(`---\n: : : bad\n  - nope\n---\nbody\n`);
  assert.deepEqual(data, {});
  assert.match(body, /body/);
});

test("parseFrontmatter handles list values (wikilinks)", () => {
  const { data } = parseFrontmatter(
    `---\nexo__Instance_class:\n  - "[[uid|req__Requirement]]"\nreq__Requirement_verifiedBy:\n  - "test::a"\n  - "test::b"\n---\nx`,
  );
  assert.deepEqual(data["req__Requirement_verifiedBy"], ["test::a", "test::b"]);
});

test("asStringArray normalizes scalar | list | null", () => {
  assert.deepEqual(asStringArray("x"), ["x"]);
  assert.deepEqual(asStringArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(asStringArray(null), []);
  assert.deepEqual(asStringArray(42), []);
  assert.deepEqual(asStringArray([1, "a", null]), ["a"]);
});

test("parseWikilink extracts uid + label", () => {
  assert.deepEqual(parseWikilink('"[[abc-123|Some Label]]"'), {
    uid: "abc-123",
    label: "Some Label",
  });
  assert.deepEqual(parseWikilink("[[abc-123]]"), { uid: "abc-123", label: "abc-123" });
});

test("parseEnumSuffix pulls enum local-name via capture regex", () => {
  assert.equal(
    parseEnumSuffix(
      '"[[uid|req__RequirementStatusApproved]]"',
      /RequirementStatus([A-Za-z]+)/,
    ),
    "Approved",
  );
  assert.equal(
    parseEnumSuffix("[[uid|req__RequirementPriorityP0]]", /RequirementPriority(P[0-3])\b/),
    "P0",
  );
  assert.equal(parseEnumSuffix("nonsense", /RequirementStatus([A-Za-z]+)/), null);
});
