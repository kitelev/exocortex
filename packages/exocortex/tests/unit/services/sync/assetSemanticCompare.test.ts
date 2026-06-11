/**
 * Semantic-equality proxy for the ExoSync parity harness (E1, M2).
 */

import * as yaml from "js-yaml";
import {
  compareAssetSemantics,
  isFormatOnlyDrift,
  type YamlCodec,
} from "../../../../src";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

const doc = (fm: string, body = "body\n"): string => `---\n${fm}\n---\n\n${body}`;

describe("compareAssetSemantics", () => {
  it("identical documents are format-only drift", () => {
    const a = doc('exo__Asset_uid: u1\nexo__Asset_label: "L"');
    expect(isFormatOnlyDrift(compareAssetSemantics(a, a, codec))).toBe(true);
  });

  it("key order does not matter", () => {
    const a = doc('exo__Asset_uid: u1\nexo__Asset_label: "L"');
    const b = doc('exo__Asset_label: "L"\nexo__Asset_uid: u1');
    expect(compareAssetSemantics(a, b, codec).frontmatterEqual).toBe(true);
  });

  it("multi-value arrays compare as multisets (D20 set semantics)", () => {
    const a = doc("exo__Asset_uid: u1\naliases:\n  - one\n  - two");
    const b = doc("exo__Asset_uid: u1\naliases:\n  - two\n  - one");
    expect(compareAssetSemantics(a, b, codec).frontmatterEqual).toBe(true);

    const c = doc("exo__Asset_uid: u1\naliases:\n  - one\n  - one\n  - two");
    expect(compareAssetSemantics(a, c, codec).frontmatterEqual).toBe(false);
  });

  it("scalar value changes are semantic", () => {
    const a = doc("exo__Asset_uid: u1");
    const b = doc("exo__Asset_uid: u2");
    expect(compareAssetSemantics(a, b, codec).frontmatterEqual).toBe(false);
  });

  it("nested structures canonicalise recursively", () => {
    const a = doc("meta:\n  x: 1\n  y: [b, a]");
    const b = doc("meta:\n  y: [a, b]\n  x: 1");
    expect(compareAssetSemantics(a, b, codec).frontmatterEqual).toBe(true);
  });

  it("body differences are reported independently of frontmatter", () => {
    const a = doc("exo__Asset_uid: u1", "first\n");
    const b = doc("exo__Asset_uid: u1", "second\n");
    const cmp = compareAssetSemantics(a, b, codec);
    expect(cmp.frontmatterEqual).toBe(true);
    expect(cmp.bodyEqual).toBe(false);
  });

  it("newline normalisation + trailing whitespace are NOT semantic", () => {
    const a = doc("exo__Asset_uid: u1", "line one\nline two\n");
    const b = doc("exo__Asset_uid: u1", "line one\r\nline two\r\n\r\n");
    expect(compareAssetSemantics(a, b, codec).bodyEqual).toBe(true);
  });

  it("frontmatter presence asymmetry is semantic", () => {
    const a = doc("exo__Asset_uid: u1");
    const cmp = compareAssetSemantics(a, "plain body only\n", codec);
    expect(cmp.frontmatterEqual).toBe(false);
  });

  it("both without frontmatter compare bodies only", () => {
    const cmp = compareAssetSemantics("same\n", "same\n", codec);
    expect(cmp.frontmatterEqual).toBe(true);
    expect(cmp.bodyEqual).toBe(true);
  });

  it("unparseable YAML degrades to not-equal, never throws", () => {
    const broken = doc("exo__Asset_uid: [unclosed");
    const cmp = compareAssetSemantics(broken, broken, codec);
    expect(cmp.frontmatterEqual).toBe(false);
  });

  it("a ---- scalar line does not terminate the frontmatter block early", () => {
    const a = doc("exo__Asset_uid: u1\nseparator: ----");
    const b = doc("separator: ----\nexo__Asset_uid: u1");
    expect(compareAssetSemantics(a, b, codec).frontmatterEqual).toBe(true);
  });
});
