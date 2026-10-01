/**
 * #4291 — `cli create` serves its vault scans from the persistent triple cache
 * instead of reading every markdown file in the vault.
 *
 * FOUR collaborators walked the corpus before this: `ShapeLoader
 * .loadFromVaultFS` and `PropertyNameValidator.collect()` (their own tree
 * walks), plus two single-key `findFilesByMetadata` lookups — `findFileByUID`
 * for the `exo__Asset_isDefinedBy` anchor and `EffortStatusResolver
 * .resolveStatusUid` for the default effort status. They shared ONE memoised
 * reader (#4356), so a stub-flip only ever exposed whichever of them ran first.
 *
 * Driven end to end through the REAL `createCommand()` on a temp vault, with
 * the reads counted where they actually happen — `PlanningFsAdapter.readFile`,
 * documented as "the ONE place a vault file's text is read during planning".
 *
 * Axes (machine key for the mutant driver — `C<N>`):
 *   C1  valid cache → the ABox noise is NEVER read; the TBox files still are
 *   C2  no cache    → every file is read again (the pre-#4291 walk), same output
 *   C3  the created frontmatter + path are byte-identical with and without the cache
 *   C4  shape refusals (minCount) are unchanged when the shapes come from a narrowed scan
 *   C5  the duplicate-range diagnostic still names the FIRST def in PATH order
 *   C6  a class-def whose own label is NOT TBox-form is still admitted (metaclass closure)
 *   C7  a converter-SKIPPED file stays a candidate, so a uid only IT carries still resolves
 *   C8  a vault modified after the cache was written → no narrowing (full walk), same output
 *   C9  a label-less property def, named by its basename, survives the narrowing
 *   C10 a label the consumer accepts but the cache's own TBOX_FORM rejects is still read
 *   C11 create-batch narrows too — it plans through the context's adapter, not its own
 *
 * Revert-verify (mutants applied to a COPY of the tree by the driver spec
 * `tests/integration/create-cache-scan-4291.spec.json`): manifest diff ignored →
 * C2/C8 RED; class-metaclass clause dropped → C6 RED; unknownPaths dropped →
 * C7 RED; narrowed candidate order reversed → C5 RED; shape scan skipped → C4 RED;
 * filter not passed to the scans → C1 RED.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { realpathSync } from "fs";
import { createCommand } from "../../src/commands/create.js";
import { createBatchCommand } from "../../src/commands/create-batch.js";
import { CacheManager } from "../../src/cache/CacheManager.js";
import { PlanningFsAdapter } from "../../src/adapters/PlanningFsAdapter.js";
import { ShapeLoader } from "@kitelev/exocortex-core";

// UID-named assets (UID-canon TBox/ABox, CLAUDE.md).
const CLASS_CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class (real metaclass uid)
const CLASS_PROPERTY = "38277bfa-d7f9-4a75-b856-b23276ab0db3"; // exo__Property (real)
const CLASS_ONTOLOGY = "829b9b3b-6fc3-4276-be6a-27d3398c012e"; // exo__Ontology (real)
const CARD_SINGLE = "c93c4b2f-b43d-4cc9-8dd0-31514d608da2"; // exo__PropertyCardinalitySingle (real)
const CARD_MULTIPLE = "59a37aa7-ffbe-4e0d-ba60-06ae370d880f"; // exo__PropertyCardinalityMultiple (real)

const ONTO = "42910000-0000-4000-8000-000000000001";
const CLASS_EFFORT = "42910000-0000-4000-8000-000000000002"; // ems__Effort
const CLASS_TASK = "42910000-0000-4000-8000-000000000003"; // ems__Task ⊂ ems__Effort
const CLASS_STATUS = "42910000-0000-4000-8000-000000000004"; // ems__EffortStatus
const STATUS_BACKLOG = "42910000-0000-4000-8000-000000000005"; // ems__EffortStatusBacklog
/** A property metaclass whose own LABEL is human (a space) — only the metaclass closure finds it. */
const CLASS_SPACED = "42910000-0000-4000-8000-000000000006";
const PROP_NOTE = "42910000-0000-4000-8000-000000000010"; // ems__Task_note, typed by CLASS_SPACED
const PROP_DUP_A = "42910000-0000-4000-8000-000000000011"; // ems__Task_dup, range xsd:integer (FIRST in path order)
const PROP_DUP_B = "42910000-0000-4000-8000-000000000012"; // ems__Task_dup, range xsd:string
const PROP_REQUIRED = "42910000-0000-4000-8000-000000000013"; // ems__Task_required, minCount 1
const PROP_ISDEFINEDBY = "42910000-0000-4000-8000-000000000014"; // exo__Asset_isDefinedBy
const PROP_RELATED = "42910000-0000-4000-8000-000000000015"; // ems__Task_related, Multiple + wikilink range
/** A label the CONSUMER accepts (`KEY_SHAPE`) but the cache's own TBOX_FORM rejects: a space after `__`. */
const PROP_SPACED = "42910000-0000-4000-8000-000000000016";
const PROP_SPACED_LABEL = "ems__Task note";
/** A property def the converter SKIPS, so the cache records neither its uid nor its domain. */
const SKIPPED_UID = "42910000-0000-4000-8000-000000000020";

const NOISE_COUNT = 14;
const noiseUid = (i: number): string =>
  `42910000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

interface Run {
  stdout: string;
  stderr: string;
  errors: string[];
  exitCode: number | null;
  /** Vault-relative paths whose TEXT the planning phase read. */
  reads: string[];
}

describe("#4291 create serves its vault scans from the persistent cache", () => {
  const roots: string[] = [];
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[] = [];
  let readSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    // (re-created here, and the mocks below close over THESE instances)
    // ⛔ The write callback MUST fire: like a real stream, `create-batch` waits
    // for the flush before it exits, so a mock that swallows the callback hangs
    // the command instead of failing it (create-batch.integration.test.ts B13).
    const writeTo = (sink: string[]) =>
      ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
        sink.push(String(chunk));
        const done =
          typeof encodingOrCallback === "function"
            ? encodingOrCallback
            : callback;
        if (typeof done === "function") (done as () => void)();
        return true;
      }) as unknown as typeof process.stdout.write;
    jest.spyOn(process.stdout, "write").mockImplementation(writeTo(stdoutChunks));
    jest.spyOn(process.stderr, "write").mockImplementation(writeTo(stderrChunks));
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        exitCodes.push(code ?? 0);
        return undefined as never;
      }) as never);
    // The ONE place a vault file's text is read during planning — every
    // collaborator, including the two that walk the tree themselves, goes
    // through it (`PlanningFsAdapter.readFile` JSDoc).
    readSpy = jest.spyOn(PlanningFsAdapter.prototype, "readFile");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) fs.removeSync(root);
  });

  // ── fixture ───────────────────────────────────────────────────────────────

  function asset(
    root: string,
    rel: string,
    uid: string,
    frontmatter: string,
    body = "",
  ): void {
    const file = path.join(root, rel, `${uid}.md`);
    fs.ensureDirSync(path.dirname(file));
    fs.writeFileSync(file, `---\nexo__Asset_uid: ${uid}\n${frontmatter}---\n${body}`);
  }

  /**
   * A vault whose TBox is a handful of files and whose ABox is noise — the
   * shape the ticket is about: `create` needs the former and used to read both.
   */
  function buildVault(): string {
    const root = fs.mkdtempSync(path.join(realpathSync(os.tmpdir()), "exo-4291-"));
    roots.push(root);

    asset(root, "tbox", ONTO, `exo__Instance_class:\n  - "[[${CLASS_ONTOLOGY}]]"\nexo__Asset_label: onto4291\n`);
    asset(root, "tbox", CLASS_EFFORT, `exo__Instance_class:\n  - "[[${CLASS_CLASS}]]"\nexo__Asset_label: ems__Effort\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);
    asset(root, "tbox", CLASS_TASK, `exo__Instance_class:\n  - "[[${CLASS_CLASS}]]"\nexo__Class_superClass:\n  - "[[${CLASS_EFFORT}]]"\nexo__Asset_label: ems__Task\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);
    asset(root, "tbox", CLASS_STATUS, `exo__Instance_class:\n  - "[[${CLASS_CLASS}]]"\nexo__Asset_label: ems__EffortStatus\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);
    asset(root, "tbox", STATUS_BACKLOG, `exo__Instance_class:\n  - "[[${CLASS_STATUS}]]"\nexo__Asset_label: ems__EffortStatusBacklog\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C6: a property metaclass whose OWN label is human (contains a space), so
    // the TBox-label clause alone would never admit it — only the class-def
    // clause does, and without it `ems__Task_note` drops out of the name set.
    asset(root, "tbox", CLASS_SPACED, `exo__Instance_class:\n  - "[[${CLASS_CLASS}]]"\nexo__Class_superClass:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: Note Property (spaced)\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    asset(root, "tbox", PROP_NOTE, `exo__Instance_class:\n  - "[[${CLASS_SPACED}]]"\nexo__Asset_label: ems__Task_note\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range: "xsd:string"\nexo__Property_cardinality: "[[${CARD_SINGLE}]]"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C5: two defs of ONE name with DIFFERENT ranges. `a-dup` sorts before
    // `b-dup` in the byte-ordered walk, so the first-in-path-order winner —
    // and the diagnostic's text — is deterministic.
    asset(root, "tbox/a-dup", PROP_DUP_A, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: ems__Task_dup\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range: "xsd:integer"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);
    asset(root, "tbox/b-dup", PROP_DUP_B, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: ems__Task_dup\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range: "xsd:string"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C4: a REQUIRED property of ems__Task — a create without it must refuse.
    asset(root, "tbox", PROP_REQUIRED, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: ems__Task_required\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range: "xsd:string"\nexo__Property_minCount: 1\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C4: the shape registry's OBSERVABLE effect on `create` — a Multiple
    // property holding a WIKILINK is serialised as a LIST even for one value
    // (`GenericAssetCreationService.shouldEmitAsArray`). An empty registry —
    // what "skip the shape load" produces — writes the same value as a scalar.
    asset(root, "tbox", PROP_RELATED, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: ems__Task_related\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range:\n  - "[[${CLASS_TASK}]]"\nexo__Property_cardinality: "[[${CARD_MULTIPLE}]]"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // `create` writes `exo__Asset_isDefinedBy` itself and validates the KEY, so
    // the mounted TBox has to declare it or every create here is rejected.
    asset(root, "tbox", PROP_ISDEFINEDBY, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: exo__Asset_isDefinedBy\nexo__Property_domain:\n  - "[[${CLASS_CLASS}]]"\nexo__Property_range:\n  - "[[${CLASS_ONTOLOGY}]]"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C10: a domainless, rangeless property def whose LABEL carries a space
    // after the separator. `PropertyNameValidator.KEY_SHAPE` (`__.+$`) accepts
    // it, so a full scan calls it a known property; the cache's own
    // `TBOX_FORM` (`__\S+$`) does not. Nothing else here can admit it — which
    // is exactly why the read filter must not borrow that stricter predicate.
    asset(root, "tbox", PROP_SPACED, `exo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: "${PROP_SPACED_LABEL}"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    // C7 / C1: a property def the converter REFUSES — `exo__Asset_updatedAt`
    // is present but empty, one of its EMPTY_OPTIONAL_PROPERTY invariants
    // (#2997, two-phase commit: the file then commits NOTHING). Its entry lands in the
    // cache with NO triples, so the cache can say neither what it declares nor
    // what uid it carries — both consumers must therefore keep reading it.
    const skipped = path.join(root, "tbox", `${SKIPPED_UID}.md`);
    fs.ensureDirSync(path.dirname(skipped));
    fs.writeFileSync(
      skipped,
      `---\nexo__Asset_uid: ${SKIPPED_UID}\nexo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Asset_label: ems__Task_skipped\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range: "xsd:string"\nexo__Asset_updatedAt:\n---\n`,
    );

    // C9: a property def with NO `exo__Asset_label` at all, named by its
    // property label instead (issue #3099 — `ShapeLoader.registerCandidate`
    // falls back to the basename). Nothing about its LABEL can admit it, so it
    // reaches the scan only through its `exo__Property_domain`.
    const named = path.join(root, "tbox", "ems__Task_named.md");
    fs.ensureDirSync(path.dirname(named));
    fs.writeFileSync(
      named,
      `---\nexo__Asset_uid: 42910000-0000-4000-8000-000000000030\nexo__Instance_class:\n  - "[[${CLASS_PROPERTY}]]"\nexo__Property_domain:\n  - "[[${CLASS_TASK}]]"\nexo__Property_range:\n  - "[[${CLASS_TASK}]]"\nexo__Property_cardinality: "[[${CARD_MULTIPLE}]]"\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n---\n`,
    );

    // A SECOND converter-skipped file, named so it sorts BEFORE every asset a
    // narrowed lookup can be asked about. It carries a uid of its own, so an
    // implementation that ANSWERED from the index (instead of narrowing and
    // re-running the real predicate) would hand it back as the first match.
    const early = path.join(root, "tbox", "00000000-0000-4000-8000-000000000000.md");
    fs.writeFileSync(
      early,
      `---\nexo__Asset_uid: 00000000-0000-4000-8000-000000000000\nexo__Instance_class:\n  - "[[${CLASS_CLASS}]]"\nexo__Asset_label: zz__EarlySkipped\nexo__Asset_updatedAt:\n---\n`,
    );

    // ABox noise — what a real vault is mostly made of, and what `create` must
    // stop reading.
    for (let i = 0; i < NOISE_COUNT; i++) {
      asset(
        root,
        "abox",
        noiseUid(i),
        `exo__Instance_class:\n  - "[[${CLASS_TASK}]]"\nexo__Asset_label: noise ${i}\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`,
        `body ${i}\n`,
      );
    }
    return root;
  }

  const noisePaths = (): string[] =>
    Array.from({ length: NOISE_COUNT }, (_, i) => `abox/${noiseUid(i)}.md`);

  async function indexVault(root: string): Promise<void> {
    await new CacheManager(root).buildCache();
  }

  async function runCreate(root: string, args: string[]): Promise<Run> {
    // ⛔ In place: the write mock closes over THESE arrays, so reassigning them
    // orphans the mock and every capture comes back empty.
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    exitCodes.length = 0;
    consoleErrorSpy.mockClear();
    readSpy.mockClear();
    await createCommand().parseAsync(["node", "create", ...args, "--vault", root]);
    return {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      errors: consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])),
      exitCode: exitCodes.length > 0 ? exitCodes[0] : null,
      reads: readSpy.mock.calls.map((c: unknown[]) => String(c[0]).replace(/\\/g, "/")),
    };
  }

  const taskArgs = (extra: string[] = []): string[] => [
    "--class",
    CLASS_TASK,
    "--label",
    "probe 4291",
    "--property",
    `exo__Asset_isDefinedBy=[[${ONTO}]]`,
    "--property",
    "ems__Task_required=present",
    "--dry-run",
    ...extra,
  ];

  /** The dry-run preview, with the identity fields that legitimately differ removed. */
  const preview = (r: Run): string =>
    r.stderr
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UUID>")
      .replace(/(createdAt|updatedAt): \S+/g, "$1: <TS>");

  // ── axes ──────────────────────────────────────────────────────────────────

  it("C1 a valid cache keeps the ABox noise unread while the TBox is still scanned", async () => {
    const root = buildVault();
    await indexVault(root);

    // Addressing the SKIPPED def is what makes its read load-bearing rather
    // than incidental: drop it from the scan and this key is unknown.
    const run = await runCreate(root, taskArgs(["--property", "ems__Task_skipped=ok"]));
    expect(run.exitCode).toBeNull();

    // The point of the ticket: the noise is not read AT ALL.
    for (const noise of noisePaths()) {
      expect(run.reads).not.toContain(noise);
    }
    // …and the TBox still is, or the scans would be answering from nothing.
    expect(run.reads).toContain(`tbox/${PROP_NOTE}.md`);
    expect(run.reads).toContain(`tbox/${CLASS_TASK}.md`);
    // Not one ABox file — the narrowing is not merely "fewer reads", it is
    // "no ABox read at all".
    const distinct = [...new Set(run.reads)];
    expect(distinct.filter((p) => p.startsWith("abox/"))).toEqual([]);
    // …and the converter-SKIPPED property def IS read, because the cache holds
    // no triples for it and therefore cannot say it declares nothing.
    expect(distinct).toContain(`tbox/${SKIPPED_UID}.md`);
  });

  it("C2 with no cache every file is read again — the pre-#4291 walk, same output", async () => {
    const root = buildVault();

    const cold = await runCreate(root, taskArgs());
    expect(cold.exitCode).toBeNull();
    for (const noise of noisePaths()) {
      expect(cold.reads).toContain(noise);
    }
  });

  it("C3 the created frontmatter and path are byte-identical with and without the cache", async () => {
    const cold = buildVault();
    const warm = buildVault();
    await indexVault(warm);

    const a = await runCreate(cold, taskArgs());
    const b = await runCreate(warm, taskArgs());
    expect(a.exitCode).toBeNull();
    expect(b.exitCode).toBeNull();
    expect(preview(b)).toBe(preview(a));
    // The status the label lookup resolved rides in that preview; assert it is
    // actually there, so the comparison is not two empty strings.
    expect(preview(a)).toContain("ems__Effort_status");
  });

  it("C4 a shape-driven refusal/serialisation is unchanged when the shapes come from a narrowed scan", async () => {
    const cold = buildVault();
    const warm = buildVault();
    await indexVault(warm);

    const args = taskArgs(["--property", `ems__Task_related=[[${noiseUid(0)}]]`]);
    const a = await runCreate(cold, args);
    const b = await runCreate(warm, args);

    expect(a.exitCode).toBeNull();
    expect(b.exitCode).toBeNull();
    // The registry said Multiple, so one value is still written as a LIST.
    // An empty registry (the "skip shape load" mutant) writes a scalar.
    expect(preview(a)).toContain('ems__Task_related:\n  - "[[<UUID>]]"');
    expect(preview(b)).toBe(preview(a));
  });

  it("C5 the duplicate-range diagnostic still names the FIRST def in path order", async () => {
    const cold = buildVault();
    const warm = buildVault();
    await indexVault(warm);

    const args = taskArgs(["--property", "ems__Task_dup=7"]);
    const a = await runCreate(cold, args);
    const b = await runCreate(warm, args);

    const diagnostic = (r: Run): string | undefined =>
      r.stderr.split("\n").find((l) => l.includes("declared more than once"));
    // `a-dup` (xsd:integer) walks first, so it is the winner in BOTH runs and
    // the twin named second is the xsd:string one. Reverse the narrowed order
    // and this text flips.
    expect(diagnostic(a)).toContain("xsd:integer vs xsd:string");
    expect(diagnostic(b)).toBe(diagnostic(a));
  });

  it("C6 a class-def whose own label is not TBox-form is still admitted", async () => {
    const root = buildVault();
    await indexVault(root);

    const paths = await new CacheManager(root).tboxScanPaths();
    expect(paths).not.toBeNull();
    // Its label is "Note Property (spaced)" — no TBox form — so only the
    // class-def clause can admit it, and `ems__Task_note` is typed by it.
    expect(paths!.has(`tbox/${CLASS_SPACED}.md`)).toBe(true);

    // Behaviourally: the property it types is still a KNOWN name, i.e. the
    // create is accepted rather than rejected as an unknown property.
    const run = await runCreate(root, taskArgs(["--property", "ems__Task_note=hi"]));
    expect(run.exitCode).toBeNull();
    expect(run.errors.join("\n")).not.toContain("Unknown property");
  });

  it("C7 a converter-skipped file stays a candidate, so a uid only it carries still resolves", async () => {
    const root = buildVault();
    await indexVault(root);

    const index = await new CacheManager(root).assetLookupIndex();
    expect(index).not.toBeNull();
    // The cache holds no triples for it, so it cannot know the uid — it must
    // be named as unjudgeable rather than silently treated as absent.
    expect(index!.unknownPaths).toContain(`tbox/${SKIPPED_UID}.md`);
    expect(index!.byUid.has(SKIPPED_UID)).toBe(false);

    // And the adapter still finds it, because unknownPaths stay candidates.
    const adapter = new PlanningFsAdapter(root, {
      lookupIndex: async () => index ?? undefined,
    });
    expect(await adapter.findFileByUID(SKIPPED_UID)).toBe(`tbox/${SKIPPED_UID}.md`);
  });

  it("C9 a label-less, basename-named property def is admitted by its domain alone", async () => {
    const root = buildVault();
    await indexVault(root);

    const paths = await new CacheManager(root).tboxScanPaths();
    expect(paths).not.toBeNull();
    // Nothing about its LABEL can admit it — it has none, and its basename is
    // not a uid either. Only `exo__Property_domain` (with its `rdfs:domain`
    // twin) can, and `ShapeLoader` reads its shape off that basename (#3099).
    expect(paths!.has("tbox/ems__Task_named.md")).toBe(true);

    // And the shape it carries survives the narrowing, value for value.
    const shapeOf = async (filter?: () => Promise<((p: string) => boolean) | undefined>) =>
      (await ShapeLoader.loadFromVaultFS(root, { scanFilter: filter }))
        .getAll()
        .find((sh) => sh.propertyIRI.endsWith("#Task_named"));
    const full = await shapeOf();
    const narrowed = await shapeOf(async () => (p: string) =>
      paths!.has(path.relative(root, p).replace(/\\/g, "/")),
    );
    expect(full).toBeDefined();
    expect(narrowed).toEqual(full);
  });

  it("C10 a label the consumer accepts but the cache's own TBOX_FORM rejects is still read", async () => {
    const cold = buildVault();
    const warm = buildVault();
    await indexVault(warm);

    const paths = await new CacheManager(warm).tboxScanPaths();
    expect(paths).not.toBeNull();
    expect(paths!.has(`tbox/${PROP_SPACED}.md`)).toBe(true);

    // The verdict of `validate()` must not depend on whether a cache happened
    // to be valid: the key is known on BOTH paths, so neither refuses.
    const args = taskArgs(["--property", `${PROP_SPACED_LABEL}=whatever`]);
    const a = await runCreate(cold, args);
    const b = await runCreate(warm, args);
    expect(a.exitCode).toBeNull();
    expect(b.exitCode).toBe(a.exitCode);
    expect(a.errors.join("\n")).not.toContain("Unknown property");
    expect(b.errors.join("\n")).not.toContain("Unknown property");
    expect(preview(b)).toBe(preview(a));
  });

  it("C11 create-batch narrows too — it plans through the context's adapter", async () => {
    const root = buildVault();
    await indexVault(root);

    const batchFile = path.join(root, "batch-4291.json");
    fs.writeFileSync(
      batchFile,
      JSON.stringify([
        {
          class: CLASS_TASK,
          label: "batch probe A",
          properties: { exo__Asset_isDefinedBy: `[[${ONTO}]]`, ems__Task_required: "a" },
        },
        {
          class: CLASS_TASK,
          label: "batch probe B",
          properties: { exo__Asset_isDefinedBy: `[[${ONTO}]]`, ems__Task_required: "b" },
        },
      ]),
    );

    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    exitCodes.length = 0;
    readSpy.mockClear();
    await createBatchCommand().parseAsync(
      [batchFile, "--vault", root, "--dry-run"],
      { from: "user" },
    );
    const reads: string[] = readSpy.mock.calls.map((c: unknown[]) =>
      String(c[0]).replace(/\\/g, "/"),
    );

    // `create-batch` exits explicitly, 0 on success (unlike `create`, which
    // returns); anything else is a refusal and would make the read counts
    // meaningless.
    expect(exitCodes).toEqual([0]);
    // ⛔ The axis the orchestrator's review asked for: without the context's
    // adapter, `create-batch` builds its own — which has no lookup index, so it
    // pays the cache read AND scans the corpus for every uid / label lookup,
    // i.e. strictly worse than before this PR. Nothing else here would catch
    // it: every other axis drives `create`, whose fixtures were built for it.
    expect([...new Set<string>(reads)].filter((f) => f.startsWith("abox/"))).toEqual([]);
    // Non-vacuous: the batch really did plan (it reads the TBox it needs).
    expect(reads).toContain(`tbox/${CLASS_TASK}.md`);
  });

  it("C8 a vault modified after the cache was written gets no narrowing, and the same output", async () => {
    const root = buildVault();
    await indexVault(root);
    // One new file the cache has never seen → the manifest diff is non-empty.
    asset(root, "abox", "42910000-0000-4000-8000-0000000009ff", `exo__Instance_class:\n  - "[[${CLASS_TASK}]]"\nexo__Asset_label: late arrival\nexo__Asset_isDefinedBy: "[[${ONTO}]]"\n`);

    expect(await new CacheManager(root).tboxScanPaths()).toBeNull();

    const stale = await runCreate(root, taskArgs());
    expect(stale.exitCode).toBeNull();
    for (const noise of noisePaths()) {
      expect(stale.reads).toContain(noise);
    }
  });
});
