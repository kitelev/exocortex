import { ExitCodes } from "../ExitCodes.js";
import { CLIError } from "./CLIError.js";
import { ErrorCode } from "../../responses/index.js";

/**
 * Error thrown when command arguments are invalid
 */
export class InvalidArgumentsError extends CLIError {
  readonly exitCode = ExitCodes.INVALID_ARGUMENTS;
  readonly errorCode = ErrorCode.VALIDATION_INVALID_ARGUMENTS;
  readonly guidance: string;

  constructor(
    message: string,
    suggestion?: string,
    context?: Record<string, unknown>,
  ) {
    const defaultGuidance = `Check command syntax and argument format.
Use: exocortex --help for usage information.`;

    super(message, context, {
      message: suggestion || "Check command syntax and argument format",
      suggestion: "exocortex --help",
    });

    this.guidance = suggestion || defaultGuidance;
  }
}
