import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import type { HardSwitchPlan, IConfirmGate } from "exocortex";
import { CliFocusProfileResolver } from "../services/CliFocusProfileResolver.js";
import { HeadlessConfirmGate } from "../services/HeadlessConfirmGate.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";

/**
 * Options surface for `exocortex hard-switch <profile-uid>`.
 */
export interface HardSwitchCommandOptions {
  vault: string;
  yes?: boolean;
  verbose?: boolean;
}

/**
 * Phase 1b SCAFFOLD message — surfaced when the CLI is invoked before the
 * Phase 3 orchestrator lands. Tests assert on this string, so changing it
 * also touches `hard-switch.integration.test.ts`.
 */
export const HARD_SWITCH_PHASE3_PENDING_NOTICE =
  "[hard-switch] CLI command scaffolded. hardSwitchProfile() implementation pending Phase 3.";

/**
 * Build a minimal stub plan the gate can render. Once Phase 3 ships, the
 * orchestrator computes the real plan; for the Phase 1b scaffold we synth
 * an empty-but-shape-faithful plan so the gate logs decisions.
 */
function buildScaffoldPlan(
  targetProfileUid: string,
  targetProfileLabel: string,
): HardSwitchPlan {
  return {
    targetProfileUid,
    targetProfileLabel,
    sourceProfileUid: null,
    sourceProfileLabel: "<unknown>",
    filesToDestroy: new Map(),
    assetSpacesBeingTornDown: [],
    assetSpacesBeingMaterialized: [],
  };
}

/**
 * Internal action handler — exported для integration tests, which inject
 * a fake `IConfirmGate` to verify the wiring без spinning a real CLI
 * subprocess.
 */
export interface HardSwitchActionDeps {
  /** Override the confirm gate (test seam). */
  confirmGate?: IConfirmGate;
  /**
   * Override the resolver factory (test seam). Production omits and the
   * action constructs `CliFocusProfileResolver` from CLI options.
   */
  resolverFactory?: (opts: HardSwitchCommandOptions) => CliFocusProfileResolver;
  /** Override exit so tests can capture the code без killing Jest. */
  exit?: (code: number) => never;
  /** Override stdout/stderr sink so tests capture без spying. */
  out?: (msg: string) => void;
  err?: (msg: string) => void;
}

/**
 * Run the hard-switch flow. Throws typed `CLIError` subclasses on
 * validation failure; the caller (commander action handler OR test) is
 * responsible for routing those через `ErrorHandler.handle` or capturing
 * them. Keeping the throw-path lean lets tests inject seams without
 * fighting the global `process.exit` instrumentation Jest installs.
 *
 * @returns A struct with the exit code and informational messages so
 *   tests can assert on outcomes without spying on process streams.
 */
export interface HardSwitchResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runHardSwitch(
  profileUid: string,
  opts: HardSwitchCommandOptions,
  deps: HardSwitchActionDeps = {},
): Promise<HardSwitchResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out =
    deps.out ??
    ((msg: string) => {
      stdout.push(msg);
      process.stdout.write(`${msg}\n`);
    });
  const err =
    deps.err ??
    ((msg: string) => {
      stderr.push(msg);
      process.stderr.write(`${msg}\n`);
    });
  // Test-injected `out`/`err` already capture; bridge them into our
  // result struct too so the returned object always reflects observable
  // output regardless of injection mode.
  const captureOut = (msg: string) => {
    stdout.push(msg);
    out(msg);
  };
  const captureErr = (msg: string) => {
    stderr.push(msg);
    err(msg);
  };

  if (!opts.vault) {
    throw new InvalidArgumentsError("--vault is required");
  }
  const vaultPath = resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new VaultNotFoundError(vaultPath);
  }

  if (!profileUid || profileUid.length === 0) {
    throw new InvalidArgumentsError(
      "profile-uid argument is required",
      "exocortex hard-switch <profile-uid> --vault <path>",
    );
  }

  // Validate profile exists via existing resolver. The resolver scans
  // vault filesystem once; the same scan is reused in Phase 3 by the
  // orchestrator.
  const resolver =
    deps.resolverFactory?.(opts) ??
    new CliFocusProfileResolver({
      vaultPath,
      warn: (msg) => captureErr(msg),
    });
  const outcome = await resolver.resolveFilter(profileUid);

  if (outcome.outcome === "missing-profile") {
    throw new InvalidArgumentsError(
      `Profile not found: ${profileUid}`,
      "Run `exocortex find --class exo__FocusProfile` to list available profiles",
    );
  }
  if (outcome.outcome === "error") {
    captureErr(`[hard-switch] Resolver error: ${outcome.reason}`);
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }

  // Build a confirm-gate (test seam allows override) and synth a stub
  // plan. Phase 3 replaces the stub с a real plan computed from the
  // resolver's effective set + the SwitchCacheLayer's destroy targets.
  const gate =
    deps.confirmGate ??
    new HeadlessConfirmGate({
      yes: opts.yes ?? false,
      verbose: opts.verbose ?? false,
      log: (msg) => captureErr(msg),
    });

  const plan = buildScaffoldPlan(profileUid, profileUid);
  const approved = await gate.confirmHardSwitch(plan);

  if (!approved) {
    // Refusal — exit 0 (the gate already logged "Refused: --yes
    // required"). Phase 3 may upgrade this to a non-zero refusal code
    // depending on the orchestrator's automation contract.
    return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
  }

  captureOut(HARD_SWITCH_PHASE3_PENDING_NOTICE);
  return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
}

export function hardSwitchCommand(): Command {
  const cmd = new Command("hard-switch")
    .description(
      "Hard switch to specified FocusProfile (filesystem mutation, Phase 3+). Requires --yes for headless mode.",
    )
    .argument("<profile-uid>", "Target FocusProfile UID")
    .requiredOption("--vault <path>", "Path to Obsidian vault")
    .option(
      "--yes",
      "Confirm hard switch (headless mode safety override per RFC 22b50a17 Decision #2)",
      false,
    )
    .option(
      "--verbose",
      "Print plan summary to stderr before deciding",
      false,
    )
    .action(async (profileUid: string, opts: HardSwitchCommandOptions) => {
      try {
        const result = await runHardSwitch(profileUid, opts);
        process.exit(result.exitCode);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
  return cmd;
}
