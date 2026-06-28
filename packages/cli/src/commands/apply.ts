import { Command } from "commander";
import { existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
  ServiceRegistry,
  GenericAssetCreationService,
  ArchiveAssetService,
  FixMissingLabelService,
  FolderRepairService,
  PropertyCleanupService,
  RenameToUidService,
  EffortStatusWorkflow,
  StatusTimestampService,
  TaskStatusService,
  WorkflowResolver,
  NamedQueryRunner,
  stripTemplateFrontmatter,
  createVaultFrontmatterClassLabelResolver,
  createVaultFrontmatterRefToFolderResolver,
  registerDefaultHostFunctions,
  vaultPathToIRI,
  IRI,
  liveClock,
  frozenClock,
  liveUidGenerator,
  seededUidGenerator,
  type EvalContext,
  type IClock,
  type IFile,
  type IUidGenerator,
} from "@kitelev/exocortex-core";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { createIsInWrongFolderHostFunction } from "../precondition/createIsInWrongFolderHostFunction.js";
import { populateCliServiceRegistry } from "../services/CliServiceRegistryPopulator.js";
import { FsQueryBodyResolver } from "../services/FsQueryBodyResolver.js";
import { registerOrderSpecFromVault } from "../services/registerOrderSpec.js";

export interface ApplyOptions {
  vault: string;
  output?: OutputFormat;
  dryRun?: boolean;
  yes?: boolean;
  input?: string;
  seed?: string;
  frozenClock?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readStdinLines(): Promise<string[]> {
  if (process.stdin.isTTY) return [];
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Resolve a slug (exocmd__Command_cliName) to its UUID via SPARQL lookup.
 * Returns null if not found, throws on ambiguity.
 */
function nodeValue(node: { value: string } | unknown): string {
  if (
    node &&
    typeof node === "object" &&
    "value" in (node as Record<string, unknown>)
  ) {
    const v = (node as { value: unknown }).value;
    return typeof v === "string" ? v : String(v);
  }
  return String(node);
}

async function resolveSlugToUuid(
  tripleStore: InMemoryTripleStore,
  slug: string,
): Promise<string | null> {
  const cliNameURI = new IRI(
    "https://exocortex.my/ontology/exocmd#Command_cliName",
  );
  const triples = await tripleStore.match(undefined, cliNameURI, undefined);
  const matches: string[] = [];
  for (const t of triples) {
    const objStr = nodeValue(t.object);
    if (objStr === slug) {
      const subjStr = nodeValue(t.subject);
      const match = subjStr.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i,
      );
      if (match) matches.push(match[1]);
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new InvalidArgumentsError(
      `Ambiguous cliName "${slug}" — resolves to ${matches.length} commands: ${matches.join(", ")}`,
      `Use the UUID directly: exocortex apply <uuid> <path>`,
    );
  }
  return matches[0];
}

/**
 * Look up whether the command asset is marked destructive (exocmd__Command_destructive).
 */
async function isDestructive(
  tripleStore: InMemoryTripleStore,
  commandUid: string,
): Promise<boolean> {
  const destructiveURI = new IRI(
    "https://exocortex.my/ontology/exocmd#Command_destructive",
  );
  const triples = await tripleStore.match(undefined, destructiveURI, undefined);
  for (const t of triples) {
    const subjStr = nodeValue(t.subject);
    if (subjStr.includes(commandUid)) {
      const objStr = nodeValue(t.object);
      if (objStr === "true" || objStr === "True") return true;
    }
  }
  return false;
}

/**
 * Execute a command on a single target. Returns true on success.
 *
 * `clock` and `uidGen` are derived ONCE per `apply` invocation (in the action
 * handler) and threaded through here so multi-target stdin pipelines share the
 * same generator — `seededUidGenerator` increments its internal counter across
 * `.next()` calls, so per-target instantiation would restart at 0 and collide.
 */
async function executeOnTarget(
  vaultPath: string,
  tripleStore: InMemoryTripleStore,
  workflowResolver: WorkflowResolver,
  commandUid: string,
  targetRelative: string,
  options: ApplyOptions,
  clock: IClock,
  uidGen: IUidGenerator,
): Promise<boolean> {
  const targetPath = resolve(vaultPath, targetRelative);
  if (!existsSync(targetPath)) {
    console.error(`❌ Target file not found: ${targetRelative}`);
    return false;
  }

  // Issue #3788 — canonicalise the target to a vault-relative path before
  // deriving its IRI. The triple store is built by NoteToRDFConverter from
  // each note's VAULT-RELATIVE `file.path` (subject = `vaultPathToIRI(path)`),
  // so the precondition's `$target` only matches when it is bound to that same
  // vault-relative IRI. If the caller passes an ABSOLUTE path (or any path not
  // already relative to the vault root — common when a script resolves the
  // target to an absolute path), `vaultPathToIRI(targetRelative)` yields a
  // malformed `obsidian://vault//abs/...` IRI that no subject in the store
  // matches → `$target ems:Effort_status ?s` / `$target exo:Asset_uid ?u` bind
  // nothing → every SPARQL-ASK precondition returns false ("Precondition not
  // satisfied") even though the asset genuinely satisfies it, and the grounding
  // would mutate a phantom subject. The Obsidian plugin never hits this because
  // `TFile.path` is always vault-relative; the CLI is the only surface that
  // accepts a raw user-supplied path string, hence the parity gap.
  const vaultRelative = relative(vaultPath, targetPath);
  if (vaultRelative.startsWith("..") || isAbsolute(vaultRelative)) {
    console.error(
      `❌ Target is outside the vault: ${targetRelative} (vault: ${vaultPath})`,
    );
    return false;
  }

  const resolver = new CommandResolver(tripleStore);
  const command = await resolver.loadCommand(commandUid);

  if (!command) {
    console.error(`❌ Command with UID "${commandUid}" not found.`);
    return false;
  }

  // Destructive safety guard (T1.6)
  const destructive = await isDestructive(tripleStore, commandUid);
  if (destructive && !options.dryRun && !options.yes) {
    console.error(
      `❌ Command "${command.name}" is marked destructive. ` +
        `Add --dry-run to preview, or --yes to apply.`,
    );
    return false;
  }

  const targetIRI = vaultPathToIRI(vaultRelative);

  // Shared adapter + services used by both precondition host functions
  // and grounding execution. Built once per target — these services are
  // stateless so a single instance covers both phases.
  const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
  const folderRepairService = new FolderRepairService(vaultAdapter);

  // Precondition (Issue #3302 — register host functions so that
  // vault-declared `exocmd__Precondition_hostFunction` references resolve
  // instead of falling open via `evaluateHostFunction`'s `return true`
  // default. Mirrors plugin wiring in `ExocortexPlugin.ts`).
  const evaluator = new PreconditionEvaluator(tripleStore, undefined, {
    clock,
  });
  registerDefaultHostFunctions(evaluator);
  evaluator.registerHostFunction(
    "isInWrongFolder",
    createIsInWrongFolderHostFunction(vaultAdapter, folderRepairService),
  );

  // EvalContext populated with the fields the registered host functions
  // read — `filePath` for `isInWrongFolder`, `fileBasename` + `assetUid`
  // for `hasUidFilename` / `hasNonUidFilename`. Without these fields the
  // functions would fall closed on registered names, hiding commands the
  // CLI is otherwise meant to run.
  const targetNode = vaultAdapter.getAbstractFileByPath(vaultRelative);
  const targetFile =
    targetNode !== null && "basename" in targetNode
      ? (targetNode as IFile)
      : null;
  const targetFrontmatter = targetFile
    ? vaultAdapter.getFrontmatter(targetFile)
    : null;
  const assetUidRaw =
    targetFrontmatter && typeof targetFrontmatter === "object"
      ? (targetFrontmatter as Record<string, unknown>).exo__Asset_uid
      : undefined;
  const evalContext: EvalContext = {
    targetIRI,
    filePath: vaultRelative,
    fileBasename: targetFile?.basename,
    assetUid: typeof assetUidRaw === "string" ? assetUidRaw : undefined,
  };
  const preconditionPassed = await evaluator.evaluate(
    command.precondition,
    targetIRI,
    evalContext,
  );
  if (!preconditionPassed) {
    console.error(
      `❌ Precondition not satisfied for "${command.name}" on "${vaultRelative}".`,
    );
    return false;
  }

  // Dry-run
  if (options.dryRun) {
    console.log(
      `🔍 Dry-run: would apply "${command.name}" to "${vaultRelative}" (precondition passed).`,
    );
    return true;
  }

  // Execute grounding
  const serviceRegistry = new ServiceRegistry();
  const genericAssetCreationService = new GenericAssetCreationService(
    vaultAdapter,
  ).withDeterminism({ clock, uidGenerator: uidGen });
  const archiveAssetService = new ArchiveAssetService(vaultAdapter);
  const propertyCleanupService = new PropertyCleanupService(vaultAdapter);
  const fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
  const renameToUidService = new RenameToUidService(vaultAdapter);
  const taskStatusService = new TaskStatusService(
    vaultAdapter,
    new EffortStatusWorkflow(),
    new StatusTimestampService(vaultAdapter),
  );
  const nodeFsAdapter = new NodeFsAdapter(vaultPath);
  populateCliServiceRegistry(serviceRegistry, {
    vaultAdapter,
    fsAdapter: nodeFsAdapter,
    genericAssetCreationService,
    archiveAssetService,
    taskStatusService,
    propertyCleanupService,
    fixMissingLabelService,
    renameToUidService,
    folderRepairService,
  });
  // Issue #3258: wire a vault-frontmatter-backed ClassLabelToUidResolver so
  // CLI `apply` emits UID-form `exo__Instance_class` (parity with UI button
  // path, which wires `createObsidianClassLabelResolver(app)`). Without this,
  // label-form `grounding.targetClass` (e.g. `"ems__Task"`) passed through
  // untouched, producing `"[[ems__Task]]"` instead of `"[[1b20a8f0-...]]"` in
  // created frontmatter. Triple-store lookup is insufficient here because
  // NoteToRDFConverter substitutes class-shaped string literals with class
  // IRIs at predicate `exo:Asset_label` (Issue #2782/#2959), so a vault scan
  // by frontmatter is required.
  // RFC 36347daf Phase 3 — wire WorkflowResolver + GroundingLoader so the
  // workflow_transition grounding type resolves the active Workflow from
  // vault ABox (hydrated above into `tripleStore`) and dispatches
  // postActions through CommandResolver.loadGroundingByUid. Mirrors the
  // plugin's `ExocortexPlugin.ts` wiring (`WorkflowResolver(tripleStore)`
  // + `groundingLoader: (uid) => commandResolver.loadGroundingByUid(uid)`).
  // Without these the executor returns the fail-loud "workflow_transition
  // requires WorkflowResolver injection" error from
  // `GroundingExecutor.executeWorkflowTransition`.
  // RFC 78c2b7d0 C4 — read-side value-source for property_set targetValueQuery.
  // The NamedQuery body lives in the asset's ```sparql block, resolved by a
  // triple-store + fs backed resolver (no Obsidian metadataCache in the CLI).
  // Mirrors the plugin wiring (ObsidianQueryBodyResolver) so `apply` and the UI
  // share one read-side path.
  const namedQueryRunner = new NamedQueryRunner(
    new FsQueryBodyResolver(tripleStore, nodeFsAdapter),
    tripleStore,
  );
  const groundingExecutor = new GroundingExecutor(
    nodeFsAdapter,
    nodeFsAdapter,
    serviceRegistry,
    createVaultFrontmatterClassLabelResolver(nodeFsAdapter),
    {
      clock,
      uidGenerator: uidGen,
      workflowResolver,
      groundingLoader: (uid) => resolver.loadGroundingByUid(uid),
      // Subproject 17f58ebe Веха 3 — load an exotemplate__Template asset's body
      // by UID for `body_template` groundings that use `templateRef` (UI/CLI
      // parity, Issue #3417). Mirrors the plugin's templateLoader.
      templateLoader: async (uid) => {
        const path = await nodeFsAdapter.findFileByUID(uid);
        if (!path) return null;
        return stripTemplateFrontmatter(await nodeFsAdapter.readFile(path));
      },
      namedQueryRunner,
      // T1 "Create Instance" (project bbe40f8c) — co-locate new instances in
      // their chosen ontology's folder via `$isDefinedByFolder` (UI/CLI parity,
      // Issue #3417). Mirrors the plugin's createObsidianRefToFolderResolver.
      refToFolder: createVaultFrontmatterRefToFolderResolver(nodeFsAdapter),
    },
  );

  let userInput: Record<string, unknown> | undefined;
  if (options.input) {
    try {
      const parsed = JSON.parse(options.input);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("must be a JSON object");
      }
      userInput = parsed as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ --input: invalid JSON object (${msg})`);
      return false;
    }
  }

  const result = await groundingExecutor.execute(
    command.grounding,
    targetIRI,
    vaultRelative,
    userInput,
  );

  if (result.success) {
    const msg =
      command.successMessage ??
      `Applied "${command.name}" to "${vaultRelative}".`;
    console.log(`✅ ${msg}`);
    return true;
  } else {
    console.error(
      `❌ "${command.name}" failed on "${vaultRelative}": ${result.error}`,
    );
    return false;
  }
}

/**
 * RFC 8e83442b (CLI v16) T1.2 / T1.3 / T1.5 / T1.6:
 * `exocortex apply <cmd> [path]` — operation invoker.
 *
 *   <cmd>: UUID of exocmd__Command, or its cliName slug.
 *   [path]: optional vault-relative path; if omitted, read paths from stdin.
 */
export function applyCommand(): Command {
  return new Command("apply")
    .description(
      "Apply an exocmd__Command to one or more vault assets (RFC 8e83442b T1.2). " +
        "Pass a path arg or pipe paths via stdin.",
    )
    .argument("<cmd>", "Command UUID or cliName slug")
    .argument(
      "[path]",
      "Vault-relative path to target asset (omit to read paths from stdin)",
    )
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--dry-run", "Preview without writing")
    .option("--yes", "Skip destructive-command confirmation")
    .option("--input <json>", "JSON userInput for service_call groundings")
    .option(
      "--seed <uuid>",
      "Deterministic UID seed for test/replay (uses seededUidGenerator)",
    )
    .option(
      "--frozen-clock <iso>",
      "Freeze clock to ISO timestamp for test/replay (uses frozenClock)",
    )
    .action(
      async (
        cmdArg: string,
        pathArg: string | undefined,
        options: ApplyOptions,
      ) => {
        ErrorHandler.setFormat("text" as OutputFormat);

        try {
          const vaultPath = resolve(options.vault);
          if (!existsSync(vaultPath)) {
            throw new VaultNotFoundError(vaultPath);
          }
          registerOrderSpecFromVault(vaultPath);

          // Derive clock + UID generator ONCE for the whole apply invocation.
          // Multi-target stdin pipelines reuse the same generator so that
          // `seededUidGenerator`'s internal counter increments across targets
          // instead of restarting at 0 per file.
          const clock: IClock = options.frozenClock
            ? frozenClock(options.frozenClock)
            : liveClock();
          const uidGen: IUidGenerator = options.seed
            ? seededUidGenerator(options.seed)
            : liveUidGenerator();

          // Build triple store once for the whole batch
          const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
          const converter = new NoteToRDFConverter(vaultAdapter);
          const triples = await converter.convertVault();
          const tripleStore = new InMemoryTripleStore();
          await tripleStore.addAll(triples);

          // RFC 36347daf Phase 3 — construct WorkflowResolver once for the whole
          // batch so its per-class cache survives across stdin-piped targets
          // (mirrors the rationale documented for `clock` / `uidGen` threading).
          const workflowResolver = new WorkflowResolver(tripleStore);

          // Resolve cmdArg → UUID
          let commandUid: string;
          if (UUID_RE.test(cmdArg)) {
            commandUid = cmdArg;
          } else {
            const resolved = await resolveSlugToUuid(tripleStore, cmdArg);
            if (!resolved) {
              console.error(
                `❌ No command found with UUID or cliName "${cmdArg}".`,
              );
              process.exit(ExitCodes.FILE_NOT_FOUND);
            }
            commandUid = resolved;
          }

          // Build target list
          let targets: string[];
          if (pathArg) {
            targets = [pathArg];
          } else {
            targets = await readStdinLines();
            if (targets.length === 0) {
              throw new InvalidArgumentsError(
                "No target path provided and stdin is empty.",
                "exocortex apply <uuid> <path>  OR  exocortex find ... | exocortex apply <uuid>",
              );
            }
          }

          // Continue-on-error semantics
          let successCount = 0;
          let failCount = 0;
          for (const target of targets) {
            const ok = await executeOnTarget(
              vaultPath,
              tripleStore,
              workflowResolver,
              commandUid,
              target,
              options,
              clock,
              uidGen,
            );
            if (ok) successCount++;
            else failCount++;
          }

          if (targets.length > 1) {
            console.log(
              `\n📊 Applied to ${successCount}/${targets.length} target(s) (${failCount} failed).`,
            );
          }

          if (failCount > 0) {
            process.exit(ExitCodes.OPERATION_FAILED);
          }
        } catch (error) {
          ErrorHandler.handle(error as Error);
          process.exit(ExitCodes.OPERATION_FAILED);
        }
      },
    );
}
