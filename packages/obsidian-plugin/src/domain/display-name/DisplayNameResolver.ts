// Re-export shim (req f17f7c57). The implementation moved to `packages/core` so the CLI
// can compose display names through the SAME engine; this file keeps the original import
// path alive so none of the 31 importers (14 src + 17 tests) had to change. ⛔ Do not add
// logic here — a second implementation is exactly what the move exists to prevent.

export { DisplayNameResolver, createDefaultResolver } from "@kitelev/exocortex-core";
export type {
  DisplayNameContext,
  DisplayNameProvenance,
  ResolvedDisplayName,
} from "@kitelev/exocortex-core";
