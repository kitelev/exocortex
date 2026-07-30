import { ExitCodes } from "../ExitCodes.js";
import { CLIError } from "./CLIError.js";
import { ErrorCode } from "../../responses/index.js";

/**
 * A single SHACL-lite constraint failure on the candidate asset, in the shape
 * an LLM consumer can act on without re-parsing a human message.
 */
export interface ShaclConformanceViolation {
  /**
   * The frontmatter KEY the constraint is attached to (`ems__Task_count`) — the
   * form the caller actually typed as `--property`, so a fix is mechanical. Falls
   * back to the raw IRI when the path is not an Exocortex ontology term.
   */
  propertyPath: string;
  /** The raw SHACL property-path IRI, kept for traceability. */
  propertyIri: string;
  /** Which constraint failed (`minCount` / `maxCount` / `class` / `datatype` / …). */
  constraint: string;
  /** Human-readable explanation from the validator. */
  message: string;
  /** The offending value, when the validator could name one. */
  actualValue?: string;
  /** The expected class/datatype, when the constraint declares one. */
  expectedRange?: string;
}

/**
 * Error thrown when `create --validate` finds the about-to-be-created asset
 * non-conformant to the vault's SHACL-lite shapes (project 38800c80 W3).
 *
 * This is the CLI counterpart of the PreToolUse Write hook `validate-asset.sh`,
 * which gives the Write path the same guarantee by shelling out to
 * `validate schema --shapes-mode`. Because a CLI `create` runs through Bash the
 * hook never fires, so `create` re-implements the guarantees itself: co-location
 * (#3520/#3934), dangling-wikilink VALUE rejection (`WikilinkValidator`),
 * unknown property NAME rejection (`PropertyNameValidator`, RFC 430e84f1) — and,
 * with the opt-in `--validate` flag, SHACL conformance.
 *
 * The gate runs BEFORE the write, so a rejected candidate leaves **no file on
 * disk** — strictly better than the hook, which must materialise a temp file
 * inside the vault to get its verdict.
 *
 * The `{ path, violations }` pair is exposed both as typed fields and (via the
 * base {@link CLIError} `context`) in the structured JSON response, so an agent
 * can repair the frontmatter and retry without a human reading the message.
 */
export class ShaclConformanceError extends CLIError {
  readonly exitCode = ExitCodes.INVALID_ARGUMENTS;
  readonly errorCode = ErrorCode.VALIDATION_INVALID_FORMAT;
  readonly guidance: string;

  /** Vault-relative path the candidate WOULD have been written to. */
  readonly assetPath: string;
  /** The gating `sh:Violation` results scoped to this candidate. */
  readonly violations: ShaclConformanceViolation[];

  constructor(assetPath: string, violations: ShaclConformanceViolation[]) {
    const detail = violations
      .map(
        (v) =>
          `  • ${v.propertyPath} (${v.constraint}): ${v.message}` +
          (v.expectedRange ? ` [expected: ${v.expectedRange}]` : "") +
          (v.actualValue ? ` [actual: ${v.actualValue}]` : ""),
      )
      .join("\n");
    const message =
      `SHACL-lite validation failed for the new asset — nothing was written.\n` +
      `${violations.length} violation(s) in ${assetPath}:\n${detail}`;

    super(
      message,
      // Structured, machine-readable form for an LLM consumer.
      { path: assetPath, violations },
      {
        message:
          "Fix the frontmatter so the asset satisfies its class shapes, then re-run create.",
        suggestion:
          "Run `validate schema --shapes-mode` on the vault to see the same shapes the gate applied.",
      },
    );

    this.assetPath = assetPath;
    this.violations = violations;
    this.guidance =
      "The asset does not conform to the SHACL-lite shapes declared for its class. " +
      "Add the missing required properties (or correct the offending value's class/datatype) " +
      "and re-run `create --validate`. Omitting `--validate` skips the gate entirely.";
  }
}
