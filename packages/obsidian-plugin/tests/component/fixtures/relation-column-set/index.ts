/**
 * RFC be70f741 Phase 3 — fixture barrel for component tests.
 *
 * Four groups cover the fault/behaviour matrix required by the task AC:
 * - happy-path — MVG, 1 valid config produces expected column set
 * - no-config — repository empty, legacy fallback
 * - collision — 2 configs tied on (tier, priority), deterministic winner
 * - invalid — 6 frontmatter shapes rejected at parse time
 */

export * from "./happy-path";
export * from "./no-config";
export * from "./collision";
export * from "./invalid";
