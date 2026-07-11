import { Command } from "commander";
import { existsSync } from "fs";
import { resolve, relative, dirname, isAbsolute, sep as pathSep } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  CommandResolver,
  PreconditionEvaluator,
  FolderRepairService,
  registerDefaultHostFunctions,
  vaultPathToIRI,
  IRI,
  Namespace,
  liveClock,
  type EvalContext,
  type IClock,
  type IFile,
  type ResolvedCommand,
} from "@kitelev/exocortex-core";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { createIsInWrongFolderHostFunction } from "../precondition/createIsInWrongFolderHostFunction.js";
import { createHasEmptyPropertiesHostFunction } from "../precondition/createHasEmptyPropertiesHostFunction.js";

/**
 * Issue #3833 — `resolve-inline-buttons <target>` prints the command button-set the
 * plugin resolves for an asset's page BEFORE the (downstream, out-of-scope)
 * RFC-024 class-panel filter: **Layer A** (binding-match via the class
 * hierarchy, `CommandResolver.resolveForAssetMulti`) **∩ Layer B**
 * (precondition-eval, `PreconditionEvaluator.evaluate` per command). For the
 * common case (no `exo__Layout` panel) this equals the live rendered set.
 *
 * This is the authoritative button-visibility oracle for layout auditing — it
 * mirrors the plugin caller `DynamicCommandButtonGroupBuilder.resolveViaFullPath`
 * exactly (`resolveForAssetMulti` then per-command `evaluate`, keeping the
 * resolver's `(priority, depth, order)` ordering). ⚠ It is STRICTLY more complete
 * than `apply <cliName> --dry-run`, which checks ONLY the precondition (Layer B),
 * never the binding targetClass-match (Layer A) — a bound-but-hidden command and
 * a never-bound command are indistinguishable under dry-run but distinct here
 * (`--show-hidden` surfaces the bound-but-hidden ones with reason
 * `precondition-false`).
 *
 * Scope: reflects the inline-button layout surface. The command palette is a
 * separate path (`findPaletteEnabledCommands`) and the RFC-024 class panel
 * filter (`exo__Layout` include/exclude) is applied downstream of this in the
 * plugin — both are deliberately out of scope; the binding ∩ precondition
 * intersection is what layout curation (e.g. the D2 not-a-prototype gating)
 * operates on. Zero engine changes — a thin wrapper over public core services.
 */

export interface ResolveButtonsOptions {
  vault: string;
  json?: boolean;
  showHidden?: boolean;
}

/** One command in the resolved button-set. */
export interface ButtonEntry {
  /** Command asset UID. */
  readonly id: string;
  /** Human-readable button label (`exo__Asset_label`). */
  readonly label: string;
  /** `exocmd__Command_cliName` slug — `null` for inline-only commands. */
  readonly cliName: string | null;
  /** `exocmd__Command_category` — `null` when uncategorised. */
  readonly category: string | null;
  /** Only on `hidden` entries: why the command did not render. */
  readonly reason?: "precondition-false";
}

/** Structured result of {@link resolveButtons}. Deterministic ordering. */
export interface ResolveButtonsResult {
  /** Vault-relative path of the target asset. */
  readonly target: string;
  /** Declared `exo__Instance_class` leaves fed to the binding resolver. */
  readonly classes: string[];
  /** Direct `exo__Asset_prototype` ref, or `null`. */
  readonly prototype: string | null;
  /**
   * Commands that BIND (targetClass matched via class hierarchy) AND pass their
   * precondition — the actual button-set, in the plugin's render order.
   */
  readonly visible: ButtonEntry[];
  /**
   * Commands that BIND but whose precondition evaluated `false`
   * (`reason: "precondition-false"`) — the layout-curation diagnostic. Empty
   * unless `--show-hidden`. (Never-bound commands are not enumerated — a
   * bound-but-hidden command is the layout-relevant case.)
   */
  readonly hidden: ButtonEntry[];
}

const UUID_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

/**
 * Clean a frontmatter class / prototype ref the same way the plugin's
 * `DynamicCommandButtonGroupBuilder.extractAssetClasses` does: strip
 * quote/bracket noise and keep only the wikilink TARGET (everything before the
 * first `|` display alias). Returns `null` for non-string / empty values.
 */
function cleanRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let cleaned = value.replace(/["'[\]]/g, "").trim();
  const pipe = cleaned.indexOf("|");
  if (pipe !== -1) cleaned = cleaned.slice(0, pipe).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extract the raw `exo__Instance_class` leaves from frontmatter (UUID-canon
 * refs in production). These UID leaves drive `resolveForAssetMulti`'s
 * `exo__Class_superClass` ancestor walk (`getClassAncestors(<uid>)` resolves the
 * class file by UID → walks superClass).
 */
function extractClasses(frontmatter: Record<string, unknown> | null): string[] {
  if (!frontmatter) return [];
  const raw = frontmatter["exo__Instance_class"];
  const out: string[] = [];
  const collect = (v: unknown): void => {
    const c = cleanRef(v);
    if (c && !out.includes(c)) out.push(c);
  };
  if (typeof raw === "string") collect(raw);
  else if (Array.isArray(raw)) for (const item of raw) collect(item);
  return out;
}

/**
 * Convert an ontology IRI (`https://exocortex.my/ontology/<prefix>#<Local>`) to
 * its symbolic class name (`<prefix>__<Local>`); `null` for non-ontology IRIs
 * (e.g. `obsidian://vault/...md` file IRIs).
 */
function ontologyIriToSymbolic(value: string): string | null {
  const m = value.match(/\/ontology\/([^#/]+)#(.+)$/);
  return m ? `${m[1]}__${m[2]}` : null;
}

/**
 * Derive the SYMBOLIC class names of the target's `exo__Instance_class` from the
 * store. `NoteToRDFConverter` resolves a UID-canon `[[<class-uid>]]` ref to the
 * class's symbolic IRI (`ems#Task`) at the `exo__Instance_class` predicate, so
 * the store already holds the symbolic form the CommandBindings are authored
 * against. This is the CLI's equivalent of the plugin's metadata-cache
 * UID→symbolic expansion (`extractAssetClasses` #3141) — necessary because the
 * converter substitutes class-shaped `exo__Asset_label` literals to IRIs too,
 * which breaks the resolver's triple-store `resolveLabelByUID`/`findUidByLabel`
 * (the plugin sidesteps this via metadataCache; the CLI reads the already-
 * resolved symbolic instance_class IRIs instead).
 */
async function deriveStoreSymbolicClasses(
  tripleStore: InMemoryTripleStore,
  subjectIRI: string,
): Promise<string[]> {
  const triples = await tripleStore.match(
    new IRI(subjectIRI),
    Namespace.EXO.term("Instance_class"),
    undefined,
  );
  const out: string[] = [];
  for (const t of triples) {
    const v =
      typeof (t.object as { value?: unknown }).value === "string"
        ? (t.object as { value: string }).value
        : String(t.object);
    const sym = ontologyIriToSymbolic(v);
    if (sym && !out.includes(sym)) out.push(sym);
  }
  return out;
}

/**
 * Build a `commandUid → cliName` map from `exocmd__Command_cliName` triples so
 * the button-set can carry the CLI slug alongside the human label.
 */
async function buildCliNameMap(
  tripleStore: InMemoryTripleStore,
): Promise<Map<string, string>> {
  const cliNameURI = new IRI(
    "https://exocortex.my/ontology/exocmd#Command_cliName",
  );
  const triples = await tripleStore.match(undefined, cliNameURI, undefined);
  const map = new Map<string, string>();
  for (const t of triples) {
    const subj =
      typeof (t.subject as { value?: unknown }).value === "string"
        ? (t.subject as { value: string }).value
        : String(t.subject);
    const obj =
      typeof (t.object as { value?: unknown }).value === "string"
        ? (t.object as { value: string }).value
        : String(t.object);
    const m = subj.match(UUID_RE);
    if (m && obj.length > 0) map.set(m[1], obj);
  }
  return map;
}

/**
 * Resolve the actual command button-set for a target asset — the core of the
 * `resolve-buttons` command, exported for production-shape testing (real vault
 * → NoteToRDFConverter → CommandResolver → PreconditionEvaluator, no mocks).
 *
 * @throws {VaultNotFoundError} when `vaultPath` does not exist.
 * @throws {Error} when the target is missing or resolves outside the vault.
 */
export async function resolveButtons(
  vaultPath: string,
  targetRelative: string,
  clock: IClock = liveClock(),
): Promise<ResolveButtonsResult> {
  const resolvedVault = resolve(vaultPath);
  if (!existsSync(resolvedVault)) {
    throw new VaultNotFoundError(resolvedVault);
  }

  const targetPath = resolve(resolvedVault, targetRelative);
  if (!existsSync(targetPath)) {
    throw new Error(`Target file not found: ${targetRelative}`);
  }
  // Issue #3788 parity — canonicalise to a vault-relative path before deriving
  // the subject IRI. The store is keyed by each note's vault-relative
  // `vaultPathToIRI(path)`; an absolute / escaping path yields a malformed IRI
  // no subject matches, so every precondition ASK binds nothing (false).
  const vaultRelative = relative(resolvedVault, targetPath);
  if (
    vaultRelative === ".." ||
    vaultRelative.startsWith(`..${pathSep}`) ||
    isAbsolute(vaultRelative)
  ) {
    throw new Error(
      `Target is outside the vault: ${targetRelative} (vault: ${resolvedVault})`,
    );
  }

  // Build the triple store from the whole vault (same machinery as `apply`).
  const vaultAdapter = new FileSystemVaultAdapter(resolvedVault);
  const converter = new NoteToRDFConverter(vaultAdapter);
  const triples = await converter.convertVault();
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(triples);

  const subjectIRI = vaultPathToIRI(vaultRelative);

  // Read the target's frontmatter → declared classes + prototype (mirrors the
  // plugin's extractAssetClasses / extractPrototypeIRI inputs).
  const targetNode = vaultAdapter.getAbstractFileByPath(vaultRelative);
  const targetFile =
    targetNode !== null && "basename" in targetNode
      ? (targetNode as IFile)
      : null;
  const targetFrontmatter = targetFile
    ? vaultAdapter.getFrontmatter(targetFile)
    : null;
  const frontmatterClasses = extractClasses(
    targetFrontmatter as Record<string, unknown> | null,
  );
  // Union the raw UID leaves (drive the superClass ancestor walk) with the
  // store's resolved SYMBOLIC instance_class (match class-targeted bindings
  // directly) — see deriveStoreSymbolicClasses. `resolveForAssetMulti` dedups
  // and is idempotent under this pre-expansion.
  const storeSymbolicClasses = await deriveStoreSymbolicClasses(
    tripleStore,
    subjectIRI,
  );
  const assetClasses = [
    ...new Set([...frontmatterClasses, ...storeSymbolicClasses]),
  ];
  const prototypeIRI = cleanRef(
    (targetFrontmatter as Record<string, unknown> | null)?.[
      "exo__Asset_prototype"
    ],
  );
  const assetUidRaw = (targetFrontmatter as Record<string, unknown> | null)?.[
    "exo__Asset_uid"
  ];
  const assetUid = typeof assetUidRaw === "string" ? assetUidRaw : undefined;

  // Layer A — binding-match via class hierarchy (nearest-wins, sorted by the
  // resolver's (priority, depth, order); this ordering IS the button order).
  const resolver = new CommandResolver(tripleStore);
  const resolved: ResolvedCommand[] = await resolver.resolveForAssetMulti(
    subjectIRI,
    assetClasses,
    prototypeIRI ?? undefined,
  );

  // Precondition evaluator wired with the same host functions as `apply` so
  // vault-declared `exocmd__Precondition_hostFunction` references resolve
  // (mirrors ExocortexPlugin.ts / apply.ts).
  const folderRepairService = new FolderRepairService(vaultAdapter);
  const evaluator = new PreconditionEvaluator(tripleStore, undefined, { clock });
  registerDefaultHostFunctions(evaluator);
  evaluator.registerHostFunction(
    "isInWrongFolder",
    createIsInWrongFolderHostFunction(vaultAdapter, folderRepairService),
  );
  evaluator.registerHostFunction(
    "hasObsoleteProperties",
    createHasEmptyPropertiesHostFunction(vaultAdapter),
  );

  const parent = dirname(vaultRelative);
  const evalContext: EvalContext = {
    targetIRI: subjectIRI,
    filePath: vaultRelative,
    fileBasename: targetFile?.basename,
    currentFolder: parent === "." ? "" : parent,
    assetUid,
  };

  const cliNames = await buildCliNameMap(tripleStore);

  // Layer B — per-command precondition filter (parallel, matching the plugin).
  const evaluated = await Promise.all(
    resolved.map(async (rc) => {
      let available: boolean;
      try {
        available = await evaluator.evaluate(
          rc.command.precondition,
          subjectIRI,
          evalContext,
        );
      } catch {
        available = false; // fail-closed on evaluator error (plugin parity)
      }
      return { rc, available };
    }),
  );

  const toEntry = (rc: ResolvedCommand): ButtonEntry => ({
    id: rc.command.id,
    label: rc.command.name,
    cliName: cliNames.get(rc.command.id) ?? null,
    category: rc.command.category ?? null,
  });

  const visible = evaluated.filter((e) => e.available).map((e) => toEntry(e.rc));
  const hidden = evaluated
    .filter((e) => !e.available)
    .map((e) => ({ ...toEntry(e.rc), reason: "precondition-false" as const }));

  return {
    target: vaultRelative,
    classes: assetClasses,
    prototype: prototypeIRI,
    visible,
    hidden,
  };
}

function printHuman(result: ResolveButtonsResult, showHidden: boolean): void {
  const fmt = (e: ButtonEntry): string =>
    `${e.label}${e.cliName ? `  (${e.cliName})` : ""}`;
  console.log(
    `Command buttons on "${result.target}" (${result.visible.length} visible):`,
  );
  if (result.visible.length === 0) {
    console.log("  (none)");
  } else {
    for (const e of result.visible) console.log(`  ✓ ${fmt(e)}`);
  }
  if (showHidden) {
    console.log(
      `\nHidden by precondition (${result.hidden.length}):`,
    );
    if (result.hidden.length === 0) {
      console.log("  (none)");
    } else {
      for (const e of result.hidden) {
        console.log(`  ✗ ${fmt(e)} — precondition not satisfied`);
      }
    }
  }
}

/**
 * `exocortex resolve-inline-buttons <target> [--vault <v>] [--json] [--show-hidden]`
 * — Issue #3833. The authoritative inline-button-visibility oracle.
 * (Aliased `resolve-buttons` for back-compat.)
 */
export function resolveButtonsCommand(): Command {
  return new Command("resolve-inline-buttons")
    .alias("resolve-buttons")
    .description(
      "Print the actual command button-set for an asset — binding-match ∩ " +
        "precondition-eval (Issue #3833). The authoritative button-visibility " +
        "oracle; strictly more complete than `apply --dry-run` (precondition-only).",
    )
    .argument("<target>", "Vault-relative path to the target asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--json", "Emit structured JSON instead of human-readable text")
    .option(
      "--show-hidden",
      "Also list commands that bind but are hidden by their precondition",
    )
    .action(async (targetArg: string, options: ResolveButtonsOptions) => {
      // LOW#4 (#3833) — honour --json on the error path too, so a failing
      // resolve-inline-buttons emits a structured JSON error (ErrorHandler json mode)
      // instead of human text. Mirrors the resolve/validate-* convention.
      ErrorHandler.setFormat((options.json ? "json" : "text") as OutputFormat);
      try {
        const result = await resolveButtons(options.vault, targetArg);
        if (options.json) {
          const payload = options.showHidden
            ? result
            : { ...result, hidden: [] };
          console.log(JSON.stringify(payload, null, 2));
        } else {
          printHuman(result, options.showHidden ?? false);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
        process.exit(ExitCodes.OPERATION_FAILED);
      }
    });
}
