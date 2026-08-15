/**
 * `create_instance` may DELIBERATELY omit `exo__Asset_label`
 * (`exocmd__Grounding_omitLabel`).
 *
 * Default behaviour, unchanged: when nothing supplies a label the executor writes
 * the literal `"Untitled"` and flags `exo__Asset_label` in `missing[]`, which logs
 * "Vault may be in an unhealthy state". That is right for an ACCIDENTAL blank.
 *
 * It is wrong for a class whose name is DERIVED at render time from an
 * `exo__DisplayNameSpec` (e.g. `ems__Action`: prototype label + action timestamp).
 * There a stored label is not missing data — it is duplicated, stale-prone data
 * sitting next to a spec that recomputes the name on every render.
 *
 * The flag is opt-in BY SHAPE and only ever changes the FALLBACK: an explicit
 * `userInput.label`, or a `labelTemplate` that substitutes non-blank, still wins.
 *
 * Production-shape: the executor axes drive the REAL `GroundingExecutor.execute`
 * over a real `create_instance` grounding with an in-memory fs honouring
 * read-after-write; the loader axis drives the REAL
 * `CommandResolver.loadGroundingByUid` over a real `InMemoryTripleStore` seeded
 * with the `exocmd__Grounding_omitLabel` triple — nothing hand-injected.
 *
 * ⛔ The loader axis is NOT redundant with the executor ones: `GroundingExecutor`
 * receives an already-built `GroundingDefinition`, so an executor-only suite stays
 * green even when the production loader never reads the triple and the flag is
 * inert in every real apply (plugin button and CLI both go through
 * `CommandResolver.loadCommand`; the sibling `GroundingFrontmatterParser` has no
 * production consumers).
 *
 * Revert-verify (each mutation in isolation):
 *   - drop the executor `omitLabelWins` branch  → the 2 omit axes RED, controls GREEN
 *   - drop the CommandResolver read             → the loader axis RED, rest GREEN
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";

/** In-memory fs that honours read-after-write (mirrors the real contract). */
function makeFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const reader = {
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    }),
    fileExists: jest.fn(async (path: string) => files.has(path)),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
  const writer = {
    createFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return "";
    }),
    updateFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteFile: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
  return { files, reader, writer };
}

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-omit-label",
    label: "omit-label",
    ...overrides,
  } as unknown as GroundingDefinition;
}

const TARGET_IRI = "https://exocortex.my/assets/proto-omit";
const TARGET_PATH = "/vault/protos/proto-omit.md";
const TARGET_SEED =
  "---\nexo__Asset_uid: proto-omit\nexo__Asset_label: Выпить Пантокальцин после обеда\n---\nProto body";

function createInstance(overrides: Record<string, unknown> = {}) {
  return gnd({
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ems__Action",
    targetFolder: "/vault/actions",
    ...overrides,
  });
}

/** The single created file (the only entry outside the seeded click-target). */
function createdContent(files: Map<string, string>): string {
  const created = [...files.entries()].find(([p]) => p !== TARGET_PATH);
  expect(created).toBeDefined();
  return (created as [string, string])[1];
}

/** The frontmatter block only — so `toContain` cannot match body text. */
function frontmatter(content: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[1];
}

async function run(grounding: GroundingDefinition, userInput?: unknown) {
  const { files, reader, writer } = makeFs({ [TARGET_PATH]: TARGET_SEED });
  const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
  const res = await exec.execute(
    grounding,
    TARGET_IRI,
    TARGET_PATH,
    userInput as never,
  );
  expect(res.success).toBe(true);
  return { files, content: createdContent(files) };
}

describe("GroundingExecutor — create_instance omitLabel", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("omits exo__Asset_label entirely when the flag is set and nothing supplied one", async () => {
    const errorSpy = jest
      .spyOn(
        require("../../../src/services/LoggingService").LoggingService,
        "error",
      )
      .mockImplementation();

    const { content } = await run(createInstance({ omitLabel: true }));
    const fm = frontmatter(content);

    // No key at all — NOT "Untitled", and NOT an empty literal (which would be
    // worse than either: it renders as a blank name rather than falling through
    // to the DisplayNameSpec).
    expect(fm).not.toContain("exo__Asset_label");
    expect(fm).not.toContain("Untitled");
    // No label-derived aliases either.
    expect(fm).not.toContain("aliases");

    // …and the label must NOT be reported as missing. Scoped to the label on
    // purpose: this bare fixture carries no Universal Default Template
    // PropertyDefaults, so `exo__Asset_uid` / `exo__Asset_createdAt` /
    // `exo__Instance_class` are legitimately filled by the TS safety net and DO
    // appear in the same ERROR. Asserting "no unhealthy ERROR at all" would be a
    // claim this fixture cannot support — the discriminating fact is that
    // `exo__Asset_label` is absent from it (and present in the control below).
    const calls = errorSpy.mock.calls.flat().map(String);
    const unhealthy = calls.filter((s) =>
      s.includes("did not cover essential scalar primitives"),
    );
    expect(unhealthy.some((s) => s.includes("exo__Asset_label"))).toBe(false);

    errorSpy.mockRestore();
  });

  it("still writes exo__Instance_class under omitLabel (the top-up below the label block must not be skipped)", async () => {
    // Pins the shape of the fix: the label block is BRANCHED, not early-returned.
    // An early return would silently skip this top-up — and the created asset
    // would have no class at all, which is far worse than a missing label.
    const { content } = await run(createInstance({ omitLabel: true }));
    const fm = frontmatter(content);
    expect(fm).toContain("exo__Instance_class");
    expect(fm).toContain("exo__Asset_uid");
  });

  it("control: WITHOUT the flag the Untitled fallback and its unhealthy-state ERROR are unchanged", async () => {
    const errorSpy = jest
      .spyOn(
        require("../../../src/services/LoggingService").LoggingService,
        "error",
      )
      .mockImplementation();

    const { content } = await run(createInstance());
    expect(frontmatter(content)).toContain("exo__Asset_label: Untitled");

    const calls = errorSpy.mock.calls.flat().map(String);
    expect(
      calls.some(
        (s) =>
          s.includes("did not cover essential scalar primitives") &&
          s.includes("exo__Asset_label"),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
  });

  it("control: an explicit userInput.label WINS over the flag (it only changes the fallback)", async () => {
    const { content } = await run(createInstance({ omitLabel: true }), {
      label: "Явное имя",
    });
    const fm = frontmatter(content);
    expect(fm).toContain("exo__Asset_label: Явное имя");
    expect(fm).toContain("aliases");
  });

  it("control: a labelTemplate that substitutes non-blank WINS over the flag", async () => {
    const { content } = await run(
      createInstance({
        omitLabel: true,
        labelTemplate: "$target.exo__Asset_label",
      }),
    );
    expect(frontmatter(content)).toContain(
      "exo__Asset_label: Выпить Пантокальцин после обеда",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Loader axis — the flag must be read by the PRODUCTION loader, or it is inert.
// ────────────────────────────────────────────────────────────────────────────

function silentLogger(): ILogger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

/** `create_instance` grounding, optionally carrying the omitLabel triple. */
async function seedGrounding(
  store: InMemoryTripleStore,
  uid: string,
  omitLabel?: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(uid)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      // Wikilink-form UID ref into the exocmd__GroundingType catalog
      // (create_instance → 4367e2d6); a bare string resolves to null.
      new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
    ),
  ];
  if (omitLabel !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("Grounding_omitLabel"),
        new Literal(omitLabel),
      ),
    );
  }
  await store.addAll(triples);
}

describe("CommandResolver — reads exocmd__Grounding_omitLabel", () => {
  it("loads omitLabel: true from the triple store", async () => {
    const store = new InMemoryTripleStore();
    await seedGrounding(store, "gnd-omit-true", "true");
    const resolver = new CommandResolver(store, silentLogger());

    const grounding = await resolver.loadGroundingByUid("gnd-omit-true");
    expect(grounding).not.toBeNull();
    expect(grounding?.omitLabel).toBe(true);
  });

  it("control: absent triple → undefined (byte-identical to every existing grounding)", async () => {
    const store = new InMemoryTripleStore();
    await seedGrounding(store, "gnd-omit-absent");
    const resolver = new CommandResolver(store, silentLogger());

    const grounding = await resolver.loadGroundingByUid("gnd-omit-absent");
    expect(grounding).not.toBeNull();
    expect(grounding?.omitLabel).toBeUndefined();
  });

  it("control: an explicit 'false' literal does NOT enable the flag", async () => {
    const store = new InMemoryTripleStore();
    await seedGrounding(store, "gnd-omit-false", "false");
    const resolver = new CommandResolver(store, silentLogger());

    const grounding = await resolver.loadGroundingByUid("gnd-omit-false");
    expect(grounding?.omitLabel).toBeUndefined();
  });
});
