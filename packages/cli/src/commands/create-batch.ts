import { Command } from "commander";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
  extractAssetReference,
  GenericAssetCreationService,
  liveClock,
  liveUidGenerator,
  type GenericAssetCreationConfig,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { PlanningFsAdapter } from "../adapters/PlanningFsAdapter.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { registerOrderSpecFromVault } from "../services/registerOrderSpec.js";
import {
  CreateContext,
  planCreate,
  type CreateCommandOptions,
  type ResolvedBody,
} from "./create.js";

/**
 * `create-batch` — create many assets from one JSON file in ONE invocation
 * (req 1848dff9-bb2e-43a9-95e7-d917d6cef552, issue #4347).
 *
 * The cost of `create` is not the process: it is the vault-wide scans inside
 * it (class index, TBox walk, shape load, anchor and status resolution) — every
 * vault file read 4 times per `create`, measured 2026-09-25 on vault-exodev
 * (34,935 files, 17-23 s each against 0.7 s of process start). So a batch is
 * not "a loop of create in one process": it is one {@link CreateContext}
 * shared by every item, over a {@link PlanningFsAdapter} that memoises reads,
 * so each scan runs once per invocation.
 *
 * Every item goes through {@link planCreate} — the function `create` itself
 * runs — so an item gets exactly the guarantees and refusals of `create`.
 *
 * All-or-nothing: every item is planned and built before the first write; one
 * failing item means nothing is written and EVERY failing item is reported.
 */

/** Optional item keys — `null` for any of them means "absent" (Python `None`). */
const OPTIONAL_ITEM_KEYS = [
  "uid",
  "aliases",
  "properties",
  "body",
  "status",
  "createdBy",
] as const;

/** The anchor key `create`'s co-location and range guard read (literal key). */
const IS_DEFINED_BY_KEY = "exo__Asset_isDefinedBy";

/** Keys an item may carry — each maps onto one `create` flag. */
const ITEM_KEYS = [
  "class",
  "label",
  "uid",
  "aliases",
  "properties",
  "body",
  "status",
  "createdBy",
] as const;

/** Canonical (lower-case) UUID — the form `create` itself generates. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The UID a vault filename is named after (`<uid>.md`, `<uid> …md`, `<uid>-…md`). */
const UID_NAMED_FILE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.md$| |-)/i;

interface CreateBatchOptions {
  vault: string;
  dryRun?: boolean;
  createdBy?: string;
  timezone?: string;
  skipWikilinkValidation?: boolean;
  yes?: boolean;
}

/** One input item after shape validation, ready for {@link planCreate}. */
interface BatchItem {
  index: number;
  label: string;
  uid?: string;
  options: CreateCommandOptions;
  body?: ResolvedBody;
}

/** One item planned and built — the exact bytes the write will produce. */
interface PlannedItem {
  index: number;
  label: string;
  uid: string;
  now: Date;
  path: string;
  content: string;
  config: GenericAssetCreationConfig;
}

interface ItemFailure {
  index: number;
  label: string;
  message: string;
}

/** A failure of the INPUT as a whole — reported before any item is planned. */
class BatchInputError extends Error {}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : typeof value;
}

/**
 * Map one raw item onto the `create` options the equivalent flags would give.
 *
 * `properties` becomes the `--property k=v` list — a string (or number /
 * boolean) value is one flag, an array the same key repeated — so it goes
 * through the very `parseProperties` `create` uses. Everything the raw shape
 * gets wrong is refused BY NAME: a misspelt key (`propeties`) would otherwise
 * drop data without a word, which is the failure `create`'s property-name
 * validation exists to prevent.
 */
function toBatchItem(
  raw: unknown,
  index: number,
  batch: CreateBatchOptions,
): BatchItem {
  const labelOf = (): string =>
    raw &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).label === "string"
      ? ((raw as Record<string, unknown>).label as string)
      : "";
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { itemLabel: labelOf() });
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`item must be a JSON object, got ${describeValue(raw)}`);
  }
  const item: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of OPTIONAL_ITEM_KEYS) {
    if (item[key] === null) delete item[key];
  }

  const unknownKeys = Object.keys(item).filter(
    (key) => !(ITEM_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    fail(
      `unknown key(s) ${unknownKeys.map((k) => JSON.stringify(k)).join(", ")} — ` +
        `an item may carry only: ${ITEM_KEYS.join(", ")}`,
    );
  }

  if (typeof item.class !== "string" || item.class.trim().length === 0) {
    fail(`"class" is required and must be a non-empty string`);
  }
  if (typeof item.label !== "string") {
    fail(`"label" is required and must be a string`);
  }

  let uid: string | undefined;
  if (item.uid !== undefined) {
    if (typeof item.uid !== "string" || !CANONICAL_UUID.test(item.uid)) {
      fail(
        `"uid" must be a canonical lower-case UUID (8-4-4-4-12 hex), got ${JSON.stringify(item.uid)}`,
      );
    }
    uid = item.uid as string;
  }

  let aliases: string[] | undefined;
  if (item.aliases !== undefined) {
    if (
      !Array.isArray(item.aliases) ||
      item.aliases.some((alias) => typeof alias !== "string")
    ) {
      fail(`"aliases" must be an array of strings`);
    }
    // An empty list is "no aliases", exactly like omitting --aliases.
    aliases =
      (item.aliases as string[]).length > 0
        ? (item.aliases as string[])
        : undefined;
  }

  const property: string[] = [];
  if (item.properties !== undefined) {
    if (
      item.properties === null ||
      typeof item.properties !== "object" ||
      Array.isArray(item.properties)
    ) {
      fail(`"properties" must be an object (key → value or key → [values])`);
    }
    for (const [key, value] of Object.entries(
      item.properties as Record<string, unknown>,
    )) {
      // `--property k=v` splits on the FIRST `=`, so a key containing one
      // cannot round-trip — refused rather than silently re-keyed.
      if (key.includes("=")) {
        fail(
          `property key ${JSON.stringify(key)} contains "=", which a property key cannot hold`,
        );
      }
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) {
        fail(
          `property ${JSON.stringify(key)} has an empty array — omit the key instead`,
        );
      }
      for (const v of values) {
        if (
          typeof v !== "string" &&
          typeof v !== "number" &&
          typeof v !== "boolean"
        ) {
          fail(
            `property ${JSON.stringify(key)} has a value of type ${describeValue(v)} — ` +
              `use a string, number, boolean, or an array of them`,
          );
        }
        // A JSON number is a double: an integer beyond 2^53 has already lost
        // digits by the time it is parsed (12345678901234567890 arrives as
        // …7000), and writing it would silently corrupt an id. Refused; the
        // exact text travels as a string.
        if (
          typeof v === "number" &&
          !Number.isSafeInteger(v) &&
          Number.isInteger(v)
        ) {
          fail(
            `property ${JSON.stringify(key)} has the number ${String(v)}, beyond the exactly representable integers — pass it as a string`,
          );
        }
        property.push(`${key}=${String(v)}`);
      }
    }
  }

  let body: ResolvedBody | undefined;
  if (item.body !== undefined) {
    if (typeof item.body !== "string") {
      fail(`"body" must be a string`);
    }
    // "file": taken verbatim — a JSON string already carries real newlines,
    // so a backslash-n in it is authored text, as for --body-file.
    body = { text: item.body as string, source: "file" };
  }

  let status: string | boolean | undefined;
  if (item.status !== undefined) {
    if (item.status === false) {
      status = false; // ⇔ --no-status
    } else if (typeof item.status === "string") {
      status = item.status; // ⇔ --status <name>
    } else {
      fail(
        `"status" must be a status name (string) or false (for --no-status)`,
      );
    }
  }

  if (item.createdBy !== undefined && typeof item.createdBy !== "string") {
    fail(`"createdBy" must be a string (a creator UUID)`);
  }

  return {
    index,
    label: item.label as string,
    uid,
    body,
    options: {
      vault: batch.vault,
      class: item.class as string,
      label: item.label as string,
      aliases,
      property,
      dryRun: batch.dryRun,
      createdBy: (item.createdBy as string | undefined) ?? batch.createdBy,
      status,
      timezone: batch.timezone,
      skipWikilinkValidation: batch.skipWikilinkValidation,
    },
  };
}

/** Parse the input document; every shape error is collected, not the first. */
function parseItems(
  text: string,
  batch: CreateBatchOptions,
): { items: BatchItem[]; failures: ItemFailure[] } {
  let doc: unknown;
  try {
    // A UTF-8 BOM (Windows editors) is not part of the document.
    doc = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new BatchInputError(
      `input is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (!Array.isArray(doc)) {
    throw new BatchInputError(
      `input must be a JSON array of items, got ${describeValue(doc)}`,
    );
  }
  if (doc.length === 0) {
    // A batch that creates nothing is almost always a generator defect.
    throw new BatchInputError("input is an empty array — nothing to create");
  }

  const items: BatchItem[] = [];
  const failures: ItemFailure[] = [];
  doc.forEach((raw, index) => {
    try {
      items.push(toBatchItem(raw, index, batch));
    } catch (error) {
      failures.push({
        index,
        label: (error as { itemLabel?: string }).itemLabel ?? "",
        message: (error as Error).message,
      });
    }
  });
  return { items, failures };
}

/**
 * Caller-supplied uids must be able to become the new assets' identities:
 * unique within the batch and not the uid of an asset already in the vault —
 * so re-running a file whose items carry uids is refused instead of creating
 * duplicates. "In the vault" means either a file named after the uid (UID-canon)
 * OR an asset whose frontmatter `exo__Asset_uid` is that uid — the label-named
 * assets (`pn__DailyNote`, `period__Week`) carry a uid their filename does not
 * show, and wikilink validation already treats them as the uid's owner. One
 * pass over the planning adapter's memoised listing and metadata for the whole
 * batch, not one walk per uid.
 */
async function checkCallerUids(
  items: BatchItem[],
  fsAdapter: PlanningFsAdapter,
): Promise<ItemFailure[]> {
  const failures: ItemFailure[] = [];
  const seen = new Map<string, number>();
  const withUid = items.filter((item) => item.uid !== undefined);
  if (withUid.length === 0) return failures;

  const onDisk = new Set<string>();
  for (const file of await fsAdapter.getMarkdownFiles()) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    const match = UID_NAMED_FILE.exec(base);
    if (match) onDisk.add(match[1].toLowerCase());
    let metadata: Record<string, unknown>;
    try {
      metadata = await fsAdapter.getFileMetadata(file);
    } catch {
      continue; // unreadable — its filename (above) is all there is to go on
    }
    const raw = metadata["exo__Asset_uid"];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      // The normalisation NodeFsAdapter.findFileByUID matches with.
      const normalised = String(value ?? "")
        .replace(/["'[\]]/g, "")
        .trim()
        .toLowerCase();
      if (normalised) onDisk.add(normalised);
    }
  }

  for (const item of withUid) {
    const uid = item.uid as string;
    const first = seen.get(uid);
    if (first !== undefined) {
      failures.push({
        index: item.index,
        label: item.label,
        message: `uid ${uid} repeats item[${first}]'s uid — every item needs its own`,
      });
      continue;
    }
    seen.set(uid, item.index);
    if (onDisk.has(uid)) {
      failures.push({
        index: item.index,
        label: item.label,
        message: `uid ${uid} already names an asset in the vault — was this batch already run?`,
      });
    }
  }
  return failures;
}

/**
 * An `exo__Asset_isDefinedBy` anchor must already exist on disk. The range
 * guard (anchor must be an exo__Ontology) and co-location both READ the anchor
 * file; an anchor that is another item of the same batch has no file yet, so
 * both would fail open and the item would land in `01 Inbox/` with nothing
 * checked — while `create` refuses the very same reference. Refused up front,
 * naming the item that creates the anchor.
 */
function checkAnchorsExist(
  items: BatchItem[],
  pendingIndex: Map<string, number>,
): ItemFailure[] {
  const failures: ItemFailure[] = [];
  for (const item of items) {
    for (const flag of item.options.property ?? []) {
      const eq = flag.indexOf("=");
      if (flag.slice(0, eq).trim() !== IS_DEFINED_BY_KEY) continue;
      // The range guard's own parser (`[[uid]]`, `[[uid|alias]]`, quoted, AND
      // a bare `uid`): a matcher of our own would recognise a subset of the
      // forms the guard resolves, and the rest would slip past both.
      const target = extractAssetReference(flag.slice(eq + 1))?.toLowerCase();
      const creator = target ? pendingIndex.get(target) : undefined;
      if (creator === undefined) continue;
      // A self-anchored item (a namespace ontology whose isDefinedBy is its own
      // uid) is refused for the same reason, but "which item[k] creates" would
      // name the item itself and send the caller looking for a sibling.
      const why =
        "an anchor must already exist on disk (the range guard and co-location read its file)";
      failures.push({
        index: item.index,
        label: item.label,
        message:
          creator === item.index
            ? `${IS_DEFINED_BY_KEY} names [[${target}]], this item's own uid — ` +
              `a self-anchored asset cannot be created by create-batch: ${why}`
            : `${IS_DEFINED_BY_KEY} names [[${target}]], which item[${creator}] of this same batch creates — ` +
              `${why}; create the ontology first, in its own run`,
      });
    }
  }
  return failures;
}

function reportFailures(failures: ItemFailure[], total: number): void {
  const sorted = [...failures].sort((a, b) => a.index - b.index);
  for (const failure of sorted) {
    process.stderr.write(
      `✗ item[${failure.index}] ${JSON.stringify(failure.label)}: ${failure.message}\n`,
    );
  }
  const failing = new Set(sorted.map((failure) => failure.index)).size;
  process.stderr.write(
    `❌ create-batch: ${failing} of ${total} item(s) failed validation — nothing was written\n`,
  );
}

/**
 * Read the whole of stdin. No total timeout (unlike `create --body -`): a
 * generator may legitimately take minutes to emit thousands of items, and a
 * clock cut would truncate the document mid-stream. A terminal on stdin is
 * refused instead of waiting forever for input that is not coming.
 */
async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new BatchInputError(
      "'-' reads the items from stdin, but stdin is a terminal — pipe the JSON array in, or pass a file",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * A reader that closes its end early (`| head -c 100`) makes the next write to
 * that stream fail with EPIPE — reported to the write's callback AND emitted as
 * an 'error' event, which with no listener is an uncaught exception: exit 1
 * after every file was already written. The batch's outcome is decided by then,
 * so EPIPE on stdio is ignored and the exit code keeps saying what the batch
 * did. Any other stdio error still surfaces. Installed once per process, as the
 * action's first statement.
 */
let stdioGuarded = false;
function guardStdioAgainstClosedReader(): void {
  if (stdioGuarded) return;
  stdioGuarded = true;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
}

/**
 * Exit only after everything written to stdout and stderr has been handed to
 * the OS. A pipe is asynchronous on macOS: `process.exit` right after a large
 * write drops whatever did not fit the pipe buffer — measured 2026-09-25 on a
 * 2,000-item dry run: 328,892 bytes into a file, 65,536 through `| wc -c`. The
 * caller then gets unparseable JSON, and an agent that reads that as a failed
 * run and retries creates every uid-less item a second time. An empty write's
 * callback fires only after every earlier write on the same stream.
 */
async function finish(code: number): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((flushed) => {
          stream.write("", () => flushed());
        }),
    ),
  );
  process.exit(code);
}

/**
 * Creates the 'create-batch' subcommand.
 *
 * @example
 * ```bash
 * exocortex create-batch items.json --vault ~/vault
 * generate-items | exocortex create-batch - --vault ~/vault --dry-run
 * ```
 */
export function createBatchCommand(): Command {
  return new Command("create-batch")
    .description(
      "Create many assets from a JSON array in one invocation — every item through the same pipeline as `create`, all-or-nothing",
    )
    .argument(
      "<file>",
      "JSON file holding an array of items ({class, label, uid?, aliases?, properties?, body?, status?, createdBy?}); '-' reads stdin",
    )
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--dry-run",
      "Plan and validate every item, preview each one's bytes on stderr, write nothing",
    )
    .option(
      "--created-by <uuid>",
      "Creator UUID for items that set no createdBy (defaults to ExoAssistant, as in create)",
    )
    .option(
      "--timezone <tz>",
      "Timezone for timestamps (defaults to Asia/Almaty, as in create)",
    )
    .option(
      "--skip-wikilink-validation",
      "Skip wikilink existence validation (as in create)",
    )
    .option(
      "--yes",
      "Accepted for symmetry with the apply subcommands (create-batch is non-interactive; no-op)",
    )
    .action(async (file: string, options: CreateBatchOptions) => {
      // First statement: planning writes warnings to stderr long before
      // finish(), and `2>&1 | head` closes that pipe too.
      guardStdioAgainstClosedReader();
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        let text: string;
        if (file === "-") {
          text = await readAllStdin();
        } else {
          if (!existsSync(file)) {
            throw new BatchInputError(`input file not found: ${file}`);
          }
          text = readFileSync(file, "utf-8");
        }

        const batchOptions: CreateBatchOptions = {
          ...options,
          vault: vaultPath,
        };
        const { items, failures } = parseItems(text, batchOptions);
        const total = items.length + failures.length;

        registerOrderSpecFromVault(vaultPath);

        // Diagnostics: prefixed with the item that raised them, each distinct
        // message printed once — 6,500 items of one class would otherwise
        // repeat the same co-location note 6,500 times — and followed, after
        // planning, by which other items raised it too.
        let currentIndex = -1;
        const warnedBy = new Map<string, number[]>();
        const warn = (text: string): void => {
          const raisedBy = warnedBy.get(text);
          if (raisedBy) {
            if (raisedBy[raisedBy.length - 1] !== currentIndex) {
              raisedBy.push(currentIndex);
            }
            return;
          }
          warnedBy.set(text, [currentIndex]);
          const prefix = currentIndex >= 0 ? `[item ${currentIndex}] ` : "";
          process.stderr.write(`${prefix}${text}`);
        };

        const pendingUids = new Set(
          items.flatMap((item) => (item.uid ? [item.uid] : [])),
        );
        const fsAdapter = new PlanningFsAdapter(vaultPath);
        const ctx = new CreateContext(vaultPath, {
          fsAdapter,
          warn,
          pendingUids,
        });

        failures.push(...(await checkCallerUids(items, fsAdapter)));
        const pendingIndex = new Map(
          items.flatMap((item) =>
            item.uid ? [[item.uid, item.index] as [string, number]] : [],
          ),
        );
        failures.push(...checkAnchorsExist(items, pendingIndex));

        // Phase 1 — plan and build every item; nothing touches the disk.
        const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
        // Every item is planned, including one already refused for its uid or
        // anchor, so the report carries each item's first planning failure
        // next to those.
        const planned: PlannedItem[] = [];
        for (const item of items) {
          currentIndex = item.index;
          try {
            const { config, label } = await planCreate(
              item.options,
              ctx,
              item.body,
            );
            const uid = item.uid ?? liveUidGenerator().next();
            const now = liveClock().now();
            // The same pinning `create --validate` uses: the uid and the
            // clock are frozen for this item, so the write in phase 2
            // produces exactly the bytes built here.
            const built = pinnedService(vaultAdapter, uid, now).buildAsset(
              config,
            );
            planned.push({
              index: item.index,
              label,
              uid,
              now,
              path: built.path,
              content: built.content,
              config,
            });
          } catch (error) {
            failures.push({
              index: item.index,
              label: item.label,
              message: (error as Error).message,
            });
          }
        }
        currentIndex = -1;
        for (const [text, raisedBy] of warnedBy) {
          if (raisedBy.length < 2) continue;
          const others = raisedBy.slice(1);
          const shown = others
            .slice(0, 5)
            .map((i) => `[item ${i}]`)
            .join(" ");
          const more = others.length > 5 ? ` +${others.length - 5} more` : "";
          process.stderr.write(
            `  … the diagnostic above (${text.split("\n")[0].slice(0, 60)}…) also applies to ${others.length} more item(s): ${shown}${more}\n`,
          );
        }

        if (failures.length > 0) {
          reportFailures(failures, total);
          await finish(ExitCodes.INVALID_ARGUMENTS);
          return;
        }

        if (options.dryRun) {
          for (const item of planned) {
            process.stderr.write(
              `--- DRY RUN PREVIEW [item ${item.index}] ${item.path} ---\n${item.content}--- END PREVIEW ---\n`,
            );
          }
          process.stdout.write(
            JSON.stringify(
              planned.map((item) => ({
                uuid: item.uid,
                path: item.path,
                label: item.label,
              })),
            ) + "\n",
          );
          await finish(0);
          return;
        }

        // Phase 2 — write. Validation was all-or-nothing; the filesystem is
        // not transactional, so an I/O failure here stops the remaining
        // writes and names what was already written.
        const output: { uuid: string; path: string; label: string }[] = [];
        for (const item of planned) {
          try {
            const file = await pinnedService(
              vaultAdapter,
              item.uid,
              item.now,
            ).createAsset(item.config);
            output.push({
              uuid: file.basename,
              path: file.path,
              label: item.label,
            });
          } catch (error) {
            process.stderr.write(
              `❌ create-batch: writing item[${item.index}] ${JSON.stringify(item.label)} failed: ${(error as Error).message}\n` +
                `   ${output.length} of ${planned.length} item(s) were written before the failure:\n` +
                output.map((written) => `   - ${written.path}\n`).join(""),
            );
            await finish(ExitCodes.OPERATION_FAILED);
            return;
          }
        }

        process.stdout.write(JSON.stringify(output) + "\n");
        await finish(0);
      } catch (error) {
        if (error instanceof BatchInputError) {
          process.stderr.write(`❌ create-batch: ${error.message}\n`);
          await finish(ExitCodes.INVALID_ARGUMENTS);
          return;
        }
        ErrorHandler.handle(error as Error);
      }
    });
}

/** A creation service whose uid and clock are frozen for one item. */
function pinnedService(
  vaultAdapter: FileSystemVaultAdapter,
  uid: string,
  now: Date,
): GenericAssetCreationService {
  return new GenericAssetCreationService(vaultAdapter).withDeterminism({
    uidGenerator: { next: () => uid },
    clock: { now: () => new Date(now.getTime()) },
  });
}
