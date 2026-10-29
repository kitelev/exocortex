/**
 * RFC 9821a379 decision 8 — the bypass of ems__Bug 2bc09942.
 *
 * A `query__NamedQuery` body names its parameters as `$<name>` tokens, and
 * {@link NamedQueryRunner} substitutes only what it is given (`$currentAsset`,
 * `$currentClass`, explicit params). A token left in the body is, for the
 * SPARQL engine, an ordinary variable (`$x` ≡ `?x`) that nothing binds — and the
 * engine lets a comparison with an unbound operand pass EVERY row
 * (`FILTER(?l != $who)` → 240 of 240 instead of 0, 2bc09942). The result is a
 * plausible, non-empty, wrong table. This scanner names such tokens so a caller
 * can refuse to evaluate instead.
 *
 * Only the SPARQL TEXT outside string literals, IRIs and comments is scanned:
 * of the 38 live query bodies (vault-my / vault-exodev / vault-tbank,
 * 2026-10-30), 7 carry `$` inside a string — regex anchors, and `"$1"` in
 * `REPLACE(…, "$1")` in 3 of them — and none of those is a token.
 *
 * @returns the token names (without `$`), unique, in order of first appearance.
 */
export function findUnsetQueryTokens(sparql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  const n = sparql.length;
  while (i < n) {
    const c = sparql[i];
    if (c === "#") {
      const eol = sparql.indexOf("\n", i);
      i = eol < 0 ? n : eol;
      continue;
    }
    if (c === "<") {
      const iriLength = iriRefLength(sparql, i);
      if (iriLength > 0) {
        i += iriLength;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(sparql, i, c);
      continue;
    }
    if (c === "$") {
      const token = VARNAME.exec(sparql.slice(i + 1));
      if (token !== null) {
        if (!seen.has(token[0])) {
          seen.add(token[0]);
          names.push(token[0]);
        }
        i += 1 + token[0].length;
        continue;
      }
    }
    i += 1;
  }
  return names;
}

/**
 * Length of the SPARQL 1.1 IRIREF (§19.8) that opens at `start`, 0 when the
 * `<` is an operator instead: an IRIREF has no `<>"{}|^` backtick `\` or
 * control/space character before its `>`.
 */
function iriRefLength(sparql: string, start: number): number {
  for (let j = start + 1; j < sparql.length; j += 1) {
    const ch = sparql[j];
    if (ch === ">") return j - start + 1;
    if (ch.charCodeAt(0) <= 0x20 || IRI_FORBIDDEN.includes(ch)) return 0;
  }
  return 0;
}

const IRI_FORBIDDEN = '<"{}|^`\\';

/** SPARQL 1.1 VARNAME (§19.8), Unicode letters and digits included. */
const VARNAME = /^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_\u00B7\u203F\u2040]*/u;

/**
 * Index just past the string literal that opens at `start` (short or long
 * form). Escapes are honoured in BOTH forms: `"""a\""""` ends after the last
 * quote, not at the escaped one.
 */
function skipString(sparql: string, start: number, quote: string): number {
  const long = quote.repeat(3);
  if (sparql.startsWith(long, start)) {
    let k = start + 3;
    while (k < sparql.length && !sparql.startsWith(long, k)) {
      k += sparql[k] === "\\" ? 2 : 1;
    }
    return Math.min(k + 3, sparql.length);
  }
  let j = start + 1;
  while (j < sparql.length && sparql[j] !== quote) {
    j += sparql[j] === "\\" ? 2 : 1;
  }
  return j + 1;
}
