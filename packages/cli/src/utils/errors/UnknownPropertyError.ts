import { ExitCodes } from "../ExitCodes.js";
import { CLIError } from "./CLIError.js";
import { ErrorCode } from "../../responses/index.js";

/**
 * Error thrown when a `--property KEY=value` uses a property NAME that does not
 * exist in the mounted TBox (RFC 430e84f1). This turns a fail-silent hole —
 * `create` previously accepted ANY `prefix__Name` key, so an LLM agent's typo
 * (`ems__Effort_parentEffort` for `ems__Effort_parent`) landed a DEAD property —
 * into a fail-loud, structured rejection.
 *
 * The `{ unknown, suggestions }` pair is exposed BOTH as typed fields and (via
 * the base {@link CLIError} `context`) in the structured JSON response, so an
 * LLM consumer can auto-correct without a human (RFC must-have #5). There is
 * deliberately NO `--allow-unknown-property` escape-hatch (must-have #6): a flag
 * an assistant could add would nullify the guarantee. New properties are
 * authored through the TBox path (a new `exo__Property` asset), not by writing
 * an unknown key via `create`.
 */
export class UnknownPropertyError extends CLIError {
  readonly exitCode = ExitCodes.INVALID_ARGUMENTS;
  readonly errorCode = ErrorCode.VALIDATION_INVALID_ARGUMENTS;
  readonly guidance: string;

  /** The rejected property name (e.g. `ems__Effort_parentEffort`). */
  readonly unknown: string;
  /** Closest known property names (Levenshtein), best-first; may be empty. */
  readonly suggestions: string[];

  constructor(unknown: string, suggestions: string[]) {
    const didYouMean =
      suggestions.length > 0 ? ` Did you mean '${suggestions[0]}'?` : "";
    const message = `Unknown property '${unknown}' — not in the mounted TBox.${didYouMean}`;

    super(
      message,
      // Structured, machine-readable form for an LLM consumer (must-have #5).
      { unknown, suggestions },
      {
        message:
          suggestions.length > 0
            ? `Use '${suggestions[0]}' (or another property that exists in the mounted TBox).`
            : "Use a property name that exists in the mounted TBox.",
        suggestion:
          "New properties are authored through the TBox (a new exo__Property asset), not via create.",
      },
    );

    this.unknown = unknown;
    this.suggestions = suggestions;
    this.guidance =
      "The property name does not exist in the mounted TBox. Fix the spelling" +
      (suggestions.length > 0 ? ` (e.g. '${suggestions[0]}')` : "") +
      ", or author the new property through the TBox path — `create` does not mint properties.";
  }
}
