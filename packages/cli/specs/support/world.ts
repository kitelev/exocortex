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

/**
 * Loose in-memory draft of a GroundingDefinition built piece-by-piece by
 * multiple Given steps for the RFC-024 create_instance + linkBackProperty
 * scenario (Task 4.3). Kept structurally compatible with the production type
 * but typed locally so the BDD layer does not have to import the executor's
 * full GroundingDefinition shape.
 */
export interface GroundingDraft {
  type?: string;
  targetClass?: string;
  targetFolder?: string;
  targetPrototype?: string;
  linkBackProperty?: string;
}

export class CliBddWorld extends World {
  initialized = false;
  recordedValue: string | null = null;
  helperResult: CliHelperResult | null = null;

  // T6.2 — grounding scenario state
  fixtureVaultPath: string | null = null;
  testTargetRelPath: string | null = null;
  groundingResult: GroundingRunResult | null = null;

  // Task 4.3 — bespoke create_instance + linkBackProperty scenario state
  groundingDraft: GroundingDraft | null = null;
  customTargetRelPath: string | null = null;
  customCreatedFrontmatter: Record<string, unknown> | null = null;

  // RFC 36347daf Phase 3 — CLI apply workflow_transition scenario state.
  // Each scenario gets its own isolated temp vault (the helper is cheap),
  // so `wfVaultPath` is a per-scenario root distinct from the shared
  // starter-kit `fixtureVaultPath`. The `wfErrors` buffer captures
  // `console.error` output so terminal-status fail-loud is assertable.
  wfVaultPath: string | null = null;
  wfErrors: string[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(CliBddWorld);
