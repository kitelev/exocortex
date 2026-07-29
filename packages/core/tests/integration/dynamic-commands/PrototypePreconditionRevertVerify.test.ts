/**
 * Revert-verify (req @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62) — a prototype-class
 * asset hides instance-lifecycle commands via the homoiconic "not-a-prototype"
 * precondition, while concrete instances keep them. Design node f853eadd.
 *
 * ⚠ REAL STORE SHAPE (dual-IRI). The fixtures mirror the production triple store:
 *   - an asset's `exo:Instance_class` object is the SYMBOLIC class IRI
 *     (`https://exocortex.my/ontology/ems#TaskPrototype`);
 *   - `exo:Class_superClass` triples live under the class FILE IRI
 *     (`obsidian://vault/<uid>.md`), NOT on the symbolic IRI.
 * These two representations were unconnected in raw SPARQL. The shipped
 * precondition now uses the SEMANTIC native walk
 * `FILTER NOT EXISTS { $target exo:Instance_class ?c . ?c exo:Class_superClass* exo:Prototype }`
 * — DE-HACKED (req 5579ffa1) from the interim STRENDS name-suffix check. It fires
 * because the query-time class-hierarchy resolver (`ClassHierarchyResolvingStore`,
 * req 9fddda62, default ON in `ExoQLQueryExecutor` / `PreconditionEvaluator`) heals
 * the symbolic↔file-IRI seam at match-time, so the transitive super-class walk
 * resolves for symbolic-form instances (see class-hierarchy-resolver.test.ts). The
 * fixture therefore carries `TaskPrototype-file → exo:Prototype` (a real superClass
 * edge on the class FILE IRI) so the walk reaches exo:Prototype exactly as in prod.
 *
 * Both layers run against the REAL `exoas-exocmd` submodule precondition strings.
 *
 * @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62
 */
import * as fs from "fs";
import * as path from "path";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";

const SUBMODULE_EXOCMD = path.resolve(__dirname, "../../../../exoas-exocmd/exocmd");

const START_EFFORT_PRECONDITION_UID = "575404fc"; // augmented status gate
const STANDALONE_PRECONDITION_UID = "847c37e0"; // "Target is not a prototype"

// The shipped native not-a-prototype clause: a transitive exo:Class_superClass*
// walk from the target's instance_class up to exo:Prototype (de-hacked from the
// STRENDS suffix check). Requires `Class_superClass` in the NOT-EXISTS block.
const NOT_A_PROTOTYPE_CLAUSE_RE =
  /FILTER\s+NOT\s+EXISTS\s*\{[^}]*Instance_class[^}]*Class_superClass[^}]*Prototype[^}]*\}\s*/i;

const PROTO_ASSET = "obsidian://vault/my-task-template.md";
const CONCRETE_ASSET = "obsidian://vault/buy-milk.md";
const TASK_PROTOTYPE_FILE = "obsidian://vault/ems-taskprototype-class.md";

function readSparqlAsk(uidPrefix: string): string {
  const file = fs
    .readdirSync(SUBMODULE_EXOCMD)
    .find((f) => f.startsWith(uidPrefix) && f.endsWith(".md"));
  if (!file) throw new Error(`precondition ${uidPrefix} not found in ${SUBMODULE_EXOCMD}`);
  const txt = fs.readFileSync(path.join(SUBMODULE_EXOCMD, file), "utf8");
  const m = txt.match(/exocmd__Precondition_sparqlAsk:\s*[>|][-]?\n((?:  .*\n?)+)/);
  if (!m) throw new Error(`no sparqlAsk block in ${file}`);
  return m[1].replace(/^ {2}/gm, "").trim();
}

/**
 * Production-shape store. ABox instance_class → SYMBOLIC class IRI. The
 * TaskPrototype CLASS file (file IRI) carries Asset_label/uid + file-IRI
 * `Class_superClass` edges → symbolic `ems#Task` (so the resolver's subclass-closure
 * expands `ems__TaskPrototype` → `ems__Task` for the lifecycle binding) AND →
 * `exo#Prototype` (so the native not-a-prototype walk reaches it) — exactly the
 * multi-valued superClass shape of the real ems__TaskPrototype class.
 */
function buildRealStore(): InMemoryTripleStore {
  const store = new InMemoryTripleStore();
  const I = (s: string) => new IRI(s);
  const instanceClass = I(`${EXO}Instance_class`);
  const superClass = I(`${EXO}Class_superClass`);
  const status = I(`${EMS}Effort_status`);

  // TaskPrototype class FILE (the resolver seeds the hierarchy walk from here,
  // resolved via label→uid→file). superClass objects are the SYMBOLIC ems#Task
  // (lifecycle binding) AND exo#Prototype (not-a-prototype walk target).
  store.add(new Triple(I(TASK_PROTOTYPE_FILE), Namespace.EXO.term("Asset_uid"), new Literal("tp-uid")));
  store.add(new Triple(I(TASK_PROTOTYPE_FILE), Namespace.EXO.term("Asset_label"), new Literal("ems__TaskPrototype")));
  store.add(new Triple(I(TASK_PROTOTYPE_FILE), superClass, I(`${EMS}Task`)));
  store.add(new Triple(I(TASK_PROTOTYPE_FILE), superClass, I(`${EXO}Prototype`)));

  // Prototype-TEMPLATE asset — instance_class is the SYMBOLIC prototype IRI.
  // Status set so a status gate would otherwise pass; the not-a-prototype clause
  // must still veto.
  store.add(new Triple(I(PROTO_ASSET), instanceClass, I(`${EMS}TaskPrototype`)));
  store.add(new Triple(I(PROTO_ASSET), status, I(`${EMS}EffortStatusBacklog`)));

  // Concrete task — instance_class is the SYMBOLIC concrete class IRI.
  store.add(new Triple(I(CONCRETE_ASSET), instanceClass, I(`${EMS}Task`)));
  store.add(new Triple(I(CONCRETE_ASSET), status, I(`${EMS}EffortStatusBacklog`)));
  return store;
}

describe("prototype precondition — revert-verify on REAL store shape (@req:5579ffa1-a829-4fcf-b93d-4fb664b02d62)", () => {
  describe("A. PreconditionEvaluator on real augmented submodule strings", () => {
    it("the shipped preconditions carry the native exo:Class_superClass* not-a-prototype clause (de-hacked from STRENDS)", () => {
      expect(readSparqlAsk(START_EFFORT_PRECONDITION_UID)).toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
      expect(readSparqlAsk(STANDALONE_PRECONDITION_UID)).toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
      // The interim STRENDS suffix hack is gone from the shipped sparqlAsk.
      expect(readSparqlAsk(START_EFFORT_PRECONDITION_UID)).not.toMatch(/STRENDS/i);
      expect(readSparqlAsk(STANDALONE_PRECONDITION_UID)).not.toMatch(/STRENDS/i);
    });

    it("GREEN: augmented Start-Effort precondition HIDES on a status-bearing prototype-template", async () => {
      const ev = new PreconditionEvaluator(buildRealStore());
      const ask = readSparqlAsk(START_EFFORT_PRECONDITION_UID);
      expect(await ev.evaluate({ id: "x", label: "x", sparqlAsk: ask }, PROTO_ASSET)).toBe(false);
    });

    it("GREEN: augmented Start-Effort precondition SHOWS on a concrete Backlog task (status gate preserved)", async () => {
      const ev = new PreconditionEvaluator(buildRealStore());
      const ask = readSparqlAsk(START_EFFORT_PRECONDITION_UID);
      expect(await ev.evaluate({ id: "x", label: "x", sparqlAsk: ask }, CONCRETE_ASSET)).toBe(true);
    });

    it("RED on revert: stripping the not-a-prototype clause makes the prototype show Start (leak)", async () => {
      const ev = new PreconditionEvaluator(buildRealStore());
      const augmented = readSparqlAsk(START_EFFORT_PRECONDITION_UID);
      const reverted = augmented.replace(NOT_A_PROTOTYPE_CLAUSE_RE, "");
      expect(reverted).not.toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
      // prototype-template has status Backlog → without the prototype gate the
      // status gate alone passes → Start LEAKS onto the template (the regression).
      expect(await ev.evaluate({ id: "x", label: "x", sparqlAsk: reverted }, PROTO_ASSET)).toBe(true);
    });

    it("DE-HACK: the native exo:Class_superClass* walk HIDES the prototype and SHOWS the concrete (resolver 9fddda62 bridges symbolic↔file)", async () => {
      // The de-hack: on the real dual-IRI store, the query-time class-hierarchy
      // resolver (default ON in PreconditionEvaluator's ExoQLQueryExecutor) heals
      // the symbolic↔file seam so the transitive super-class walk fires. The
      // two-triple form (matching the shipped preconditions) reaches exo:Prototype
      // via the TaskPrototype-file's superClass edge → the template is hidden.
      const ev = new PreconditionEvaluator(buildRealStore());
      const walk = `ASK { FILTER NOT EXISTS { $target <${EXO}Instance_class> ?c . ?c <${EXO}Class_superClass>* <${EXO}Prototype> } }`;
      expect(await ev.evaluate({ id: "x", label: "x", sparqlAsk: walk }, PROTO_ASSET)).toBe(false); // hidden
      expect(await ev.evaluate({ id: "x", label: "x", sparqlAsk: walk }, CONCRETE_ASSET)).toBe(true); // shown
    });
  });

  describe("B. full CommandResolver + precondition-filter pipeline (real dual-IRI shape)", () => {
    const CMD_UID = "e941b3bb-d375-40d2-b271-e1d71deb014c"; // Start Effort
    const BIND_UID = "11111111-1111-1111-1111-111111111111";
    const PRE_UID = "575404fc-9085-4f4a-a3e4-bfebb49c42a4";

    async function resolveVisible(
      store: InMemoryTripleStore,
      subjectIRI: string,
      classes: string[],
    ): Promise<string[]> {
      const resolver = new CommandResolver(store);
      const evaluator = new PreconditionEvaluator(store);
      const resolved = await resolver.resolveForAssetMulti(subjectIRI, classes);
      const checks = await Promise.all(
        resolved.map(async (rc) => ({
          name: rc.command.name,
          available: await evaluator.evaluate(rc.command.precondition, subjectIRI, { targetIRI: subjectIRI }),
        })),
      );
      return checks.filter((c) => c.available).map((c) => c.name);
    }

    async function mountStartEffort(store: InMemoryTripleStore, preconditionAsk: string): Promise<void> {
      const cmd = new IRI(`obsidian://vault/${CMD_UID}.md`);
      const bind = new IRI(`obsidian://vault/${BIND_UID}.md`);
      const pre = new IRI(`obsidian://vault/${PRE_UID}.md`);
      const gnd = new IRI("obsidian://vault/gnd.md");
      await store.addAll([
        new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
        new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
        new Triple(cmd, Namespace.EXO.term("Asset_label"), new Literal("Start Effort")),
        new Triple(cmd, Namespace.EXOCMD.term("Command_grounding"), gnd),
        new Triple(cmd, Namespace.EXOCMD.term("Command_precondition"), pre),
        // Grounding — production-shape so loadLinkedGrounding succeeds.
        new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal("gnd")),
        new Triple(gnd, Namespace.EXO.term("Asset_label"), new Literal("Start effort")),
        new Triple(gnd, Namespace.EXOCMD.term("Grounding_type"), new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]")),
        new Triple(gnd, Namespace.EXOCMD.term("Grounding_targetClass"), new Literal("1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task")),
        // Precondition asset carrying the (real, augmented) sparqlAsk.
        new Triple(pre, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
        new Triple(pre, Namespace.EXO.term("Asset_uid"), new Literal(PRE_UID)),
        new Triple(pre, Namespace.EXOCMD.term("Precondition_sparqlAsk"), new Literal(preconditionAsk)),
        // Binding targetClass=ems__Task.
        new Triple(bind, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
        new Triple(bind, Namespace.EXO.term("Asset_uid"), new Literal(BIND_UID)),
        new Triple(bind, Namespace.EXOCMD.term("CommandBinding_command"), cmd),
        new Triple(bind, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal("ems__Task")),
        new Triple(bind, Namespace.EXOCMD.term("CommandBinding_position"), new Literal("inline")),
        new Triple(bind, Namespace.EXOCMD.term("CommandBinding_order"), new Literal("100")),
      ]);
    }

    it("sanity: resolver expands ems__TaskPrototype → ems__Task via file-IRI superClass (binding matches)", async () => {
      // No precondition on the command → proves the binding actually resolves
      // for the prototype class (so the GREEN 'not shown' below is meaningful,
      // not a false-positive from non-resolution).
      const store = buildRealStore();
      const resolver = new CommandResolver(store);
      await mountStartEffort(store, "PREFIX e: <x:> ASK { }"); // always-true precondition
      const names = (await resolver.resolveForAssetMulti(PROTO_ASSET, ["ems__TaskPrototype", "exo__Asset"])).map((r) => r.command.name);
      expect(names).toContain("Start Effort");
    });

    it("GREEN: TaskPrototype-template does NOT show Start Effort; concrete Task does", async () => {
      const ask = readSparqlAsk(START_EFFORT_PRECONDITION_UID);

      const protoStore = buildRealStore();
      await mountStartEffort(protoStore, ask);
      expect(await resolveVisible(protoStore, PROTO_ASSET, ["ems__TaskPrototype", "exo__Asset"])).not.toContain("Start Effort");

      const concreteStore = buildRealStore();
      await mountStartEffort(concreteStore, ask);
      expect(await resolveVisible(concreteStore, CONCRETE_ASSET, ["ems__Task", "exo__Asset"])).toContain("Start Effort");
    });

    it("RED on revert: with the not-a-prototype clause stripped, the TaskPrototype-template shows Start Effort (leak)", async () => {
      const reverted = readSparqlAsk(START_EFFORT_PRECONDITION_UID).replace(NOT_A_PROTOTYPE_CLAUSE_RE, "");
      const store = buildRealStore();
      await mountStartEffort(store, reverted);
      expect(await resolveVisible(store, PROTO_ASSET, ["ems__TaskPrototype", "exo__Asset"])).toContain("Start Effort");
    });
  });
});
