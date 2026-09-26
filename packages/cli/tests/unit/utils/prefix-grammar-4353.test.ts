import { describe, it, expect, beforeEach } from "@jest/globals";

const { SPARQLErrorEnhancer } = await import(
  "../../../src/utils/SPARQLErrorEnhancer.js"
);

/**
 * Issue #4353 — `SPARQLErrorEnhancer`'s two prefix readers move from `(\w+)` to
 * the shared CLI copy of the grammar (`utils/namespacePrefix.ts` →
 * `Namespace.PREFIX_PATTERN_SOURCE`). `\w` has no `-`, so a hyphenated prefix was
 * TRUNCATED in the diagnostic and, in the declared-prefix reader, missed entirely.
 *
 * Hyphenated prefixes are live in vault-tbank (`tbank-nessy`, `tbank-jira`,
 * `tbank-public`, `tbank-ems`) and `adapter-exo-ims` is in all three vaults.
 *
 * Axis names are `[An]` FIRST in the title (revert-verify driver, §A104).
 */
describe("prefix grammar #4353 — cli SPARQLErrorEnhancer", () => {
  let enhancer: InstanceType<typeof SPARQLErrorEnhancer>;

  beforeEach(() => {
    enhancer = new SPARQLErrorEnhancer();
  });

  it("[A50] names a hyphenated unknown prefix in FULL, not truncated at the hyphen", () => {
    const query = `PREFIX ems: <https://exocortex.my/ontology/ems#>
SELECT ?s WHERE { ?s tbank-nessy:LessonLearned_note ?o }`;

    const enhanced = enhancer.enhanceError(
      new Error("Unknown prefix: tbank-nessy"),
      query,
    );

    // `(\w+)` stopped at the hyphen → the message blamed 'tbank', a prefix the
    // query never used, and the "Replace 'tbank:' with …" advice was unusable.
    expect(enhanced.message).toContain("Unknown prefix 'tbank-nessy'");
    expect(enhanced.message).not.toContain("Unknown prefix 'tbank'");
  });

  it("[A51] lists a DECLARED hyphenated prefix among the available ones", () => {
    const query = `PREFIX adapter-exo-ims: <https://exocortex.my/ontology/adapter-exo-ims#>
SELECT ?s WHERE { ?s adapter-exo-im:relatesToConcept ?o }`;

    const enhanced = enhancer.enhanceError(
      new Error("Unknown prefix: adapter-exo-im"),
      query,
    );

    // `PREFIX\s+(\w+):` never matched the declaration, so the prefix the query
    // DOES declare was absent from "Available prefixes" and from the
    // did-you-mean candidates — the advice pointed away from the real fix.
    expect(enhanced.message).toContain("Available prefixes: adapter-exo-ims");
    expect(enhanced.message).toContain("Did you mean: adapter-exo-ims");
  });

  it("[A52] handles the quoted 'not defined' wording with a hyphenated prefix", () => {
    const query = `PREFIX tbank-jira: <https://exocortex.my/ontology/tbank-jira#>
SELECT ?s WHERE { ?s tbank-jir:Epic ?o }`;

    const enhanced = enhancer.enhanceError(
      new Error("prefix 'tbank-jir' not defined"),
      query,
    );

    expect(enhanced.message).toContain("Unknown prefix 'tbank-jir'");
    expect(enhanced.message).toContain("Did you mean: tbank-jira");
  });
});
