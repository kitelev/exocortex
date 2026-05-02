import { setWorldConstructor, World, IWorldOptions } from "@cucumber/cucumber";

/**
 * Result of a CLI-style helper invocation (smoke harness only).
 */
export interface CliHelperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Result of a `dyncommand exec`-style grounding invocation captured by the
 * T6.2 step layer. Mirrors `GroundingExecutor.execute` (RFC-009 §5.4) and is
 * augmented with frontmatter snapshots so `Then` clauses can assert the
 * observable state delta against per-grounding `expected.json` fixtures.
 */
export interface GroundingRunResult {
  success: boolean;
  error?: string;
  frontmatterBefore?: Record<string, unknown>;
  frontmatterAfter?: Record<string, unknown>;
}

export class CliBddWorld extends World {
  initialized = false;
  recordedValue: string | null = null;
  helperResult: CliHelperResult | null = null;

  // T6.2 — grounding scenario state
  fixtureVaultPath: string | null = null;
  testTargetRelPath: string | null = null;
  groundingResult: GroundingRunResult | null = null;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(CliBddWorld);
