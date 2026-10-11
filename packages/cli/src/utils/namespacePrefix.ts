/**
 * The namespace-prefix shape, for CLI modules — a literal copy of core
 * `Namespace.PREFIX_PATTERN_SOURCE`: a lowercase letter, then alphanumerics,
 * optionally continued by hyphen-separated alphanumeric runs (`ems`, `aiKnow`,
 * `tbank-nessy`, `device-work-macbook`).
 *
 * Why a copy: many CLI suites mock `@kitelev/exocortex-core` with a factory that
 * does not carry `Namespace`, so the modules those suites load cannot read the
 * constant from core. Why ONE copy: issue #4350 — five CLI modules each held
 * their own `[a-z][a-zA-Z0-9]*` and all of them had to move when core learned
 * hyphenated prefixes. `tests/unit/utils/namespace-prefix-parity-4350.test.ts`
 * fails the moment this string and the core one differ.
 */
export const PREFIX_PATTERN_SOURCE = "[a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*";

/** A whole string that is a namespace prefix. */
export const PREFIX_RE = new RegExp(`^${PREFIX_PATTERN_SOURCE}$`);

/**
 * The external W3C vocabularies core registers canonically in
 * `Namespace.KNOWN_NAMESPACES` (req aceaa2cc-15b6-4e1c-bf63-72c7c209de51; skos —
 * req e750782f-907b-4573-99ce-f9a5e3150418) — a literal copy for the same reason
 * as `PREFIX_PATTERN_SOURCE` above. Every other prefix resolves to the ad-hoc
 * `https://exocortex.my/ontology/<prefix>#`, exactly like core `Namespace.forPrefix`.
 *
 * A `Map`, not an object literal: `constructor` is a legal prefix, and an object
 * would answer it with `Object.prototype.constructor`.
 * `tests/unit/utils/namespace-prefix-parity-4350.test.ts` [P3] fails the moment this
 * table and core's registry disagree.
 */
export const W3C_NAMESPACE_BASES: ReadonlyMap<string, string> = new Map([
  ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["rdfs", "http://www.w3.org/2000/01/rdf-schema#"],
  ["owl", "http://www.w3.org/2002/07/owl#"],
  ["xsd", "http://www.w3.org/2001/XMLSchema#"],
  ["sh", "http://www.w3.org/ns/shacl#"],
  ["skos", "http://www.w3.org/2004/02/skos/core#"],
]);

/** The namespace IRI a prefix resolves to — the CLI mirror of core `Namespace.forPrefix`. */
export function namespaceBaseFor(prefix: string): string {
  return W3C_NAMESPACE_BASES.get(prefix) ?? `https://exocortex.my/ontology/${prefix}#`;
}
