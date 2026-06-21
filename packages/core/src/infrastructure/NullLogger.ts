import type { ILogger } from "../interfaces/ILogger";

/**
 * No-op logger implementation for use when no logger is provided.
 * All methods silently discard messages.
 */
export const NullLogger: ILogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
