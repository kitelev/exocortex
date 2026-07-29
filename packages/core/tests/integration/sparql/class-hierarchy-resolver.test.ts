/**
 * Production-shape integration test for the query-time class-hierarchy resolver
 * (RFC 78572fa9 Candidate B Phase 0, req 9fddda62).
 *
 * The store is built by the REAL {@link NoteToRDFConverter} over a fixture vault
 * (NOT hand-authored triples) so the symbolic↔file-IRI seam the decorator heals is
 * exactly the shape the converter emits in production: instances carry
 * `exo__Instance_class` as the SYMBOLIC class IRI, while class files carry
 * `exo__Class_superClass` / `rdfs:subClassOf` hierarchy edges on their FILE IRI.
 *
 * Revert-verify axis = the `resolveClassHierarchy` config toggle on
 * ExoQLQueryExecutor (type-preserving, NOT a git-checkout): resolver ON → the
 * transitive walk resolves for symbolic-form instances (GREEN); resolver OFF →
 * only the zero-length seed (RED). See ~/dotfiles/.claude/rules/integration-test-revert-verify.md.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { AskOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// Symbolic class IRIs the walk queries — derived by the SAME rule the converter
// uses (Namespace.forPrefix("test").term("Cx")). The `test` prefix is a valid
// ad-hoc namespace (Namespace.forPrefix: /^[a-z][a-zA-Z0-9]*$/).
const C1 = Namespace.forPrefix("test")!.term("C1").value; // .../ontology/test#C1
const C2 = Namespace.forPrefix("test")!.term("C2").value;
const C3 = Namespace.forPrefix("test")!.term("C3").value;
const CY_A = Namespace.forPrefix("test")!.term("CyA").value;
const CY_B = Namespace.forPrefix("test")!.term("CyB").value;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}

function makeFile(uid: string): IFile {
  return {
    path: `${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    extension: "md",
    parent: null,
  } as unknown as IFile;
}

/**
 * Convert fixture notes to triples through the real NoteToRDFConverter — the
 * production emission path (converts each note's frontmatter + resolves its
 * wikilinks via a mock vault). The mock resolves ANY of `notes` (so a class ref
 * from one note resolves to its target note).
 */
async function convertNotes(notes: FixtureNote[]) {
  const files = notes.map((n) => makeFile(n.uid));
  const fmByPath = new Map<string, IFrontmatter>();
  const fileByBasename = new Map<string, IFile>();
  notes.forEach((n, i) => {
    fmByPath.set(files[i].path, n.frontmatter);
    fileByBasename.set(n.uid, files[i]);
  });

  const mockVault = {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fmByPath.get(f.path) ?? null),
    getFirstLinkpathDest: jest.fn(
      (linkpath: string) => fileByBasename.get(linkpath) ?? null,
    ),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;

  const converter = new NoteToRDFConverter(mockVault);
  const out = [];
  for (const file of files) {
    out.push(...(await converter.convertNote(file)));
  }
  return out;
}

/**
 * Build a real store from fixture notes (aggregate `convertNotes` into an
 * InMemoryTripleStore).
 */
async function buildStore(notes: FixtureNote[]): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  await store.addAll(await convertNotes(notes));
  return store;
}

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();

async function runSelect(
  store: InMemoryTripleStore,
  sparql: string,
  variable: string,
  resolveClassHierarchy: boolean,
): Promise<string[]> {
  const algebra = translator.translate(parser.parse(sparql));
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy });
  const solutions = await executor.executeAll(algebra);
  return solutions
    .map((s) => {
      const v = s.get(variable);
      return v instanceof IRI ? v.value : undefined;
    })
    .filter((v): v is string => v !== undefined);
}

async function runAsk(
  store: InMemoryTripleStore,
  sparql: string,
  resolveClassHierarchy: boolean,
): Promise<boolean> {
  const algebra = translator.translate(parser.parse(sparql));
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy });
  // Mirrors PreconditionEvaluator.evaluateSparqlAsk → executor.executeAsk.
  return executor.executeAsk(algebra as AskOperation);
}

const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>`;

// C1 ⊑ C2 ⊑ C3. Instance A → C1 via UID-form ref to a LABELED class (converter
// emits the SYMBOLIC class IRI — the ~99.8% real-vault shape). Instance B → a
// LABELLESS class C1b (whose Instance_class value the converter emits as the FILE
// IRI, the #3242 form) that itself ⊑ C2, exercising the symmetric first-hop-native
// / subsequent-hop-bridged path.
const HIERARCHY_NOTES: FixtureNote[] = [
  { uid: "c3000000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c3000000-0000-4000-8000-000000000000", exo__Asset_label: "test__C3" } },
  { uid: "c2000000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c2000000-0000-4000-8000-000000000000", exo__Asset_label: "test__C2", exo__Class_superClass: "[[c3000000-0000-4000-8000-000000000000]]" } },
  { uid: "c1000000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c1000000-0000-4000-8000-000000000000", exo__Asset_label: "test__C1", exo__Class_superClass: "[[c2000000-0000-4000-8000-000000000000]]" } },
  // A — symbolic-form instance (Instance_class object = <test#C1>)
  { uid: "aaaa0000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "aaaa0000-0000-4000-8000-000000000000", exo__Asset_label: "Instance A", exo__Instance_class: "[[c1000000-0000-4000-8000-000000000000]]" } },
  // C1b — LABELLESS class ⊑ C2 (its Instance_class value emits as a FILE IRI)
  { uid: "c1b00000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c1b00000-0000-4000-8000-000000000000", exo__Class_superClass: "[[c2000000-0000-4000-8000-000000000000]]" } },
  // B — file-IRI-form instance (Instance_class object = <obsidian://vault/c1b....md>)
  { uid: "bbbb0000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "bbbb0000-0000-4000-8000-000000000000", exo__Asset_label: "Instance B", exo__Instance_class: "[[c1b00000-0000-4000-8000-000000000000]]" } },
];

describe("query-time class-hierarchy resolver (req 9fddda62)", () => {
  describe("CQ1 — transitive walk resolves at match-time for symbolic-form instances", () => {
    // The walk `?s exo:Instance_class ?c . ?c exo:Class_superClass* <C3>` — the two
    // BGP-triple form. Both `?s Instance_class ?c` (BGPExecutor) and the property
    // path (PropertyPathExecutor) route through the single decorated store.match.
    const cq1 = `${PREFIX}
      SELECT ?s WHERE {
        ?s exo:Instance_class ?c .
        ?c exo:Class_superClass* <${C3}> .
      }`;

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c returns the symbolic-form instance A when the resolver is ON (GREEN)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const instances = await runSelect(store, cq1, "s", true);
      expect(instances).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
    });

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c does NOT return A when the resolver is OFF (RED — revert-verify)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const instances = await runSelect(store, cq1, "s", false);
      // Without the decorator, the walk truncates at the first symbolic node —
      // A is unreachable (the zero-length `*` seed only matches ?c = <C3> itself,
      // and no instance is directly Instance_class = <C3>).
      expect(instances).not.toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
    });

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c also resolves the DIRECT-parent walk (C1 ⊑ C2) for symbolic instances", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const cq = `${PREFIX}
        SELECT ?s WHERE {
          ?s exo:Instance_class ?c .
          ?c exo:Class_superClass* <${C2}> .
        }`;
      expect(await runSelect(store, cq, "s", true)).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
      expect(await runSelect(store, cq, "s", false)).not.toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
    });
  });

  describe("CQ2 — file-IRI-form instances heal too (symmetric bridge)", () => {
    const cq = `${PREFIX}
      SELECT ?s WHERE {
        ?s exo:Instance_class ?c .
        ?c exo:Class_superClass* <${C3}> .
      }`;

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c returns the file-IRI-form instance B when the resolver is ON (first hop native, ancestor hops bridged)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const instances = await runSelect(store, cq, "s", true);
      expect(instances).toContain("obsidian://vault/bbbb0000-0000-4000-8000-000000000000.md");
    });

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c does NOT return B when the resolver is OFF (its C2→C3 hop truncates at the symbolic node)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const instances = await runSelect(store, cq, "s", false);
      expect(instances).not.toContain("obsidian://vault/bbbb0000-0000-4000-8000-000000000000.md");
    });
  });

  describe("ZERO store growth — the anti-A2 guarantee", () => {
    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c the store triple-count is identical before/after the resolver-enabled query and equal whether the resolver is ON or OFF", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const cq = `${PREFIX}
        SELECT ?s WHERE {
          ?s exo:Instance_class ?c .
          ?c exo:Class_superClass* <${C3}> .
        }`;

      const before = await store.count();
      // Sanity: the resolver actually did something (A resolved) — otherwise the
      // count-equality below would be vacuous.
      expect(await runSelect(store, cq, "s", true)).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
      const afterOn = await store.count();
      await runSelect(store, cq, "s", false);
      const afterOff = await store.count();

      expect(afterOn).toBe(before); // nothing materialized during the resolved walk
      expect(afterOff).toBe(before);
      // No inferred/ancestor Instance_class triple ever entered the store: A's
      // rdf:type / Instance_class edges point ONLY at its direct class <C1>.
      const ancestorTypeTriples = await store.match(
        new IRI("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md"),
        new IRI(Namespace.EXO.term("Instance_class").value),
        undefined,
      );
      const objects = ancestorTypeTriples.map((t) => (t.object as IRI).value);
      expect(objects).toEqual([C1]);
      expect(objects).not.toContain(C2);
      expect(objects).not.toContain(C3);
    });
  });

  describe("predicate-scoped — non-hierarchy queries are byte-identical", () => {
    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c a query that never references the hierarchy predicates returns an identical result set ON vs OFF (pure pass-through)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const cq = `${PREFIX}
        SELECT ?s WHERE { ?s exo:Instance_class ?c }`;
      const on = (await runSelect(store, cq, "s", true)).sort();
      const off = (await runSelect(store, cq, "s", false)).sort();
      expect(on).toEqual(off);
      expect(on).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
    });
  });

  describe("both surfaces resolve — ASK precondition (PreconditionEvaluator.executeAsk path) + SELECT", () => {
    // CQ3 — the precondition shape: a sequence path Instance_class/Class_superClass*.
    // Runs through executor.executeAsk, exactly as PreconditionEvaluator does.
    const askFor = (target: string, ancestor: string) => `${PREFIX}
      ASK { <${target}> exo:Instance_class/exo:Class_superClass* <${ancestor}> }`;
    const A_IRI = "obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md";

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c ASK gates TRUE for a symbolic-form instance when the resolver is ON, FALSE when OFF", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      expect(await runAsk(store, askFor(A_IRI, C3), true)).toBe(true);
      expect(await runAsk(store, askFor(A_IRI, C3), false)).toBe(false);
    });

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c ASK is FALSE for a NON-ancestor class even with the resolver ON (negative control — non-vacuity)", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      const unrelated = Namespace.forPrefix("test")!.term("Unrelated").value;
      expect(await runAsk(store, askFor(A_IRI, unrelated), true)).toBe(false);
    });
  });

  describe("cycle-safe walk", () => {
    // Malformed hierarchy: CyA ⊑ CyB ⊑ CyA. The transitive walk must terminate
    // (PropertyPathExecutor's visited-set / MAX_DEPTH holds across the bridge).
    // UIDs are valid-hex so the class refs resolve to SYMBOLIC parents (the
    // UID-canon shape) — `isUUID` gates the symbolic-emission path in the converter.
    const CYCLE_NOTES: FixtureNote[] = [
      { uid: "ca100000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "ca100000-0000-4000-8000-000000000000", exo__Asset_label: "test__CyA", exo__Class_superClass: "[[cb100000-0000-4000-8000-000000000000]]" } },
      { uid: "cb100000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "cb100000-0000-4000-8000-000000000000", exo__Asset_label: "test__CyB", exo__Class_superClass: "[[ca100000-0000-4000-8000-000000000000]]" } },
      { uid: "c1100000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c1100000-0000-4000-8000-000000000000", exo__Asset_label: "Cycle instance", exo__Instance_class: "[[ca100000-0000-4000-8000-000000000000]]" } },
    ];

    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c terminates and resolves CyA ⊑ CyB across the cyclic bridge", async () => {
      const store = await buildStore(CYCLE_NOTES);
      const cq = `${PREFIX}
        SELECT ?s WHERE {
          ?s exo:Instance_class ?c .
          ?c exo:Class_superClass* <${CY_B}> .
        }`;
      // If the visited-set were not honoured across the bridge this would hang.
      const instances = await runSelect(store, cq, "s", true);
      expect(instances).toContain("obsidian://vault/c1100000-0000-4000-8000-000000000000.md");
      // And a walk to a class OUTSIDE the cycle still terminates (returns nothing).
      const outside = `${PREFIX}
        SELECT ?s WHERE {
          ?s exo:Instance_class ?c .
          ?c exo:Class_superClass* <${Namespace.forPrefix("test")!.term("Outside").value}> .
        }`;
      expect(await runSelect(store, outside, "s", true)).toEqual([]);
      void [CY_A]; // referenced for symmetry / documentation
    });
  });

  describe("index invalidates on store mutation — a LONG-LIVED executor survives a reindex", () => {
    // The plugin's SPARQLQueryService constructs the executor ONCE and mutates the
    // SAME store in place on reindex (clear/removeAll + addAll). A class added after
    // the first hierarchy match (which builds the index) MUST become visible without
    // reconstructing the executor — the store-scoped, count-invalidated index cache.
    it("@req:9fddda62-be7f-453f-9f69-94f7d6835f1c a class added to the store after the index was built resolves through the SAME executor", async () => {
      const store = await buildStore(HIERARCHY_NOTES);
      // ONE long-lived executor, reused across queries (the SPARQLQueryService shape).
      const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy: true });
      const cq = translator.translate(
        parser.parse(`${PREFIX}
          SELECT ?s WHERE {
            ?s exo:Instance_class ?c .
            ?c exo:Class_superClass* <${C3}> .
          }`),
      );
      const values = async () =>
        (await executor.executeAll(cq))
          .map((s) => (s.get("s") instanceof IRI ? (s.get("s") as IRI).value : undefined))
          .filter((v): v is string => v !== undefined);

      // First query builds the index (count = N).
      expect(await values()).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
      const A0 = "obsidian://vault/a0000000-0000-4000-8000-000000000000.md";
      expect(await values()).not.toContain(A0);

      // Mid-session reindex-add: a NEW class C0 ⊑ C1 + instance A0 → C0, mutated into
      // the SAME store (count changes). The C1 note is included only so C0's parent
      // ref resolves (its triples dedup on addAll).
      const delta = await convertNotes([
        HIERARCHY_NOTES[2], // C1 (for resolution; dedup)
        { uid: "c0000000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "c0000000-0000-4000-8000-000000000000", exo__Asset_label: "test__C0", exo__Class_superClass: "[[c1000000-0000-4000-8000-000000000000]]" } },
        { uid: "a0000000-0000-4000-8000-000000000000", frontmatter: { exo__Asset_uid: "a0000000-0000-4000-8000-000000000000", exo__Asset_label: "Instance A0", exo__Instance_class: "[[c0000000-0000-4000-8000-000000000000]]" } },
      ]);
      await store.addAll(delta);

      // The SAME executor now resolves A0 (index rebuilt because count changed).
      // Without count-invalidation the stale index would omit C0 → A0 missing (RED).
      expect(await values()).toContain(A0);
      // ...and the original instance A still resolves.
      expect(await values()).toContain("obsidian://vault/aaaa0000-0000-4000-8000-000000000000.md");
    });
  });
});
