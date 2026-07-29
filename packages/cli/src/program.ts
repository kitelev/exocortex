import "reflect-metadata";
import { Command } from "commander";
import { sparqlQueryCommand } from "./commands/sparql-query.js";
import { sparqlIndexCommand } from "./commands/sparql-index.js";
import { resolveCommand } from "./commands/resolve.js";
import { resolveButtonsCommand } from "./commands/resolve-buttons.js";
import { validateCommand } from "./commands/validate.js";
import { classesCommand } from "./commands/classes.js";
import { runQueryCommand } from "./commands/run-query.js";
import { createCommand } from "./commands/create.js";
import { setPropertyCommand } from "./commands/set-property.js";
import { repairFrontmatterCommand } from "./commands/repair-frontmatter.js";
import { findCommand } from "./commands/find.js";
import { applyCommand } from "./commands/apply.js";
import { auditCommand } from "./commands/audit.js";
import { scaffoldCommand } from "./commands/scaffold-validation.js";
import { applyProfileCommand } from "./commands/apply-profile.js";
import { bootstrapCommand } from "./commands/bootstrap.js";
import { assetSpaceAddCommand } from "./commands/assetspace-add.js";
import { assetSpaceRemoveCommand } from "./commands/assetspace-remove.js";
import { resolveDepsCommand } from "./commands/resolve-deps.js";
import { exosyncParityCommand } from "./commands/exosync-parity.js";
import { exosyncCommand } from "./commands/exosync-sync.js";
import { requirementsCommand } from "./commands/requirements.js";
import { cacheCommand } from "./commands/cache.js";

// Version injected at build time by esbuild (see esbuild.config.mjs)
declare const __CLI_VERSION__: string;

/**
 * Create the CLI program with all commands registered.
 * Exported for testing (kept side-effect-free — the bin entry in index.ts
 * is the only place that calls `.parse()`).
 *
 * RFC 8e83442b (CLI v16.0) — Unix-style surface:
 *   5 verbs: find, apply, query, index, validate.
 *   Removed: batch, batch-repair, command, dyncommand, exoql, convert, sparql (deprecated alias).
 */
export function createProgram(version?: string): Command {
  const program = new Command();

  program
    .name("exocortex")
    .description(
      "CLI tool for Exocortex knowledge management system - SPARQL queries, task management, and more",
    )
    .version(version ?? __CLI_VERSION__);

  // Five core verbs (RFC 8e83442b)
  program.addCommand(findCommand());
  program.addCommand(applyCommand());
  program.addCommand(sparqlQueryCommand());
  program.addCommand(sparqlIndexCommand());
  program.addCommand(validateCommand());

  // Auxiliary commands retained from v15
  program.addCommand(resolveCommand());
  // Issue #3833 — authoritative inline-button-visibility oracle
  // (binding-match ∩ precondition-eval; strictly more complete than
  // `apply --dry-run`, which is precondition-only).
  program.addCommand(resolveButtonsCommand());
  program.addCommand(classesCommand());
  // req 2678df55 — read axis: standalone verb to execute a query__NamedQuery
  // asset by UID (read-only). `classes`/`describe-class` consume the same
  // mechanism (their introspection SPARQL lives in vault query__NamedQuery
  // assets).
  program.addCommand(runQueryCommand());
  program.addCommand(createCommand());
  // Issues #3795 / #3848 — generic guarded mutation primitive: set an arbitrary
  // non-guarded frontmatter property (incl. exo__Asset_isDefinedBy repoint) on an
  // existing asset via the CLI, closing the "raw-Edit a property" dogfooding gap.
  // Refuses state-machine-guarded properties (status/zone/parent/label/…) so their
  // dedicated `apply` commands are not bypassed.
  program.addCommand(setPropertyCommand());
  // repair-frontmatter — raw-text dedupe of duplicated top-level YAML keys
  // (keep-last). The dogfood-clean repair for the invisible/unrepairable
  // duplicate-key class (#3800): fixes a file the parser itself cannot read.
  program.addCommand(repairFrontmatterCommand());

  // RFC 9d20c91f Phase 4+1 — regression-detection audits
  program.addCommand(auditCommand());
  program.addCommand(scaffoldCommand());

  // RFC 22b50a17 Phase 1b — apply CLI scaffold (Phase 3 wires orchestrator)
  program.addCommand(applyProfileCommand());

  // RFC 13da049f Phase 6.2 + 6.3 — Bootstrap + Add AssetSpace CLI
  program.addCommand(bootstrapCommand());
  program.addCommand(assetSpaceAddCommand());
  // #e6b8827c — unmount a single AssetSpace (inverse of assetspace-add)
  program.addCommand(assetSpaceRemoveCommand());

  // Issue #3513 (builds on #3511) — registry-driven dependsOn resolution for
  // the per-AssetSpace SHACL CI gate.
  program.addCommand(resolveDepsCommand());

  // RFC 4e4dc453 Phase E (E1) — ExoSync M1/M2 parity report (read-only)
  program.addCommand(exosyncParityCommand());

  // RFC 4e4dc453 Phase B parity (EKA M3.7) — ExoSync sync/pull/push from the CLI
  program.addCommand(exosyncCommand());

  // RFC 0003 (requirements management) P1 — traceability checker
  program.addCommand(requirementsCommand());

  // Issue #3981 — SPARQL query-result cache maintenance (clear / stats).
  // Complements the automatic size/count-cap eviction in QueryResultCache.set.
  program.addCommand(cacheCommand());

  return program;
}
