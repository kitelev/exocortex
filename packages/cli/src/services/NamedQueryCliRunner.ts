import { NamedQueryRunner, type InMemoryTripleStore } from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { FsQueryBodyResolver } from "./FsQueryBodyResolver.js";

/**
 * Build a {@link NamedQueryRunner} for CLI use (req 2678df55 — read axis).
 *
 * Resolves a `query__NamedQuery` body by UID from the already-hydrated triple
 * store (`?s exo:Asset_uid "<uid>"`) and reads the file through `NodeFsAdapter`,
 * exactly as the `apply` path wires it — so `run-query` and the homoiconic
 * `classes`/`describe-class` share one read-side seam. Execution is read-only
 * (`evaluateWithExoEval` allowlist rejects UPDATE/SERVICE/FROM/LOAD at parse).
 */
export function buildNamedQueryRunner(
  tripleStore: InMemoryTripleStore,
  vaultPath: string,
): NamedQueryRunner {
  const fsAdapter = new NodeFsAdapter(vaultPath);
  return new NamedQueryRunner(
    new FsQueryBodyResolver(tripleStore, fsAdapter),
    tripleStore,
  );
}
