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
