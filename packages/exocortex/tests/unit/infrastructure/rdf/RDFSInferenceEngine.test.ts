import { RDFSInferenceEngine } from "../../../../src/infrastructure/rdf/RDFSInferenceEngine";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";

describe("RDFSInferenceEngine", () => {
  let engine: RDFSInferenceEngine;
  let store: InMemoryTripleStore;

  // Predicates
  const superClass = new IRI("https://exocortex.my/ontology/exo#Class_superClass");
  const instanceClass = new IRI("https://exocortex.my/ontology/exo#Instance_class");

  // Classes
  const asset = new IRI("http://example.com/Asset");
  const note = new IRI("http://example.com/Note");
  const fleetingNote = new IRI("http://example.com/FleetingNote");
  const permanentNote = new IRI("http://example.com/PermanentNote");
  const literatureNote = new IRI("http://example.com/LiteratureNote");
  const task = new IRI("http://example.com/Task");

  // Instances
  const myNote1 = new IRI("http://example.com/myNote1");
  const myNote2 = new IRI("http://example.com/myNote2");
  const myTask = new IRI("http://example.com/myTask");

  beforeEach(() => {
    engine = new RDFSInferenceEngine();
    store = new InMemoryTripleStore();
  });

  describe("materialize", () => {
    it("should return 0 for empty store", async () => {
      const count = await engine.materialize(store);
      expect(count).toBe(0);
    });

    it("should return 0 when no Class_superClass triples exist", async () => {
      await store.add(new Triple(myNote1, instanceClass, note));

      const count = await engine.materialize(store);
      expect(count).toBe(0);
    });

    it("should return 0 when no Instance_class triples exist", async () => {
      await store.add(new Triple(note, superClass, asset));

      const count = await engine.materialize(store);
      expect(count).toBe(0);
    });

    it("should materialize single parent (A → B)", async () => {
      // FleetingNote → Note
      await store.add(new Triple(fleetingNote, superClass, note));
      // myNote1 is a FleetingNote
      await store.add(new Triple(myNote1, instanceClass, fleetingNote));

      const count = await engine.materialize(store);

      expect(count).toBe(1);
      // myNote1 should now also be Instance_class Note
      const results = await store.match(myNote1, instanceClass, note);
      expect(results.length).toBe(1);
    });

    it("should materialize linear chain (A → B → C)", async () => {
      // FleetingNote → Note → Asset
      await store.add(new Triple(fleetingNote, superClass, note));
      await store.add(new Triple(note, superClass, asset));
      // myNote1 is a FleetingNote
      await store.add(new Triple(myNote1, instanceClass, fleetingNote));

      const count = await engine.materialize(store);

      expect(count).toBe(2);
      // myNote1 should be Instance_class Note AND Asset
      const noteResults = await store.match(myNote1, instanceClass, note);
      expect(noteResults.length).toBe(1);
      const assetResults = await store.match(myNote1, instanceClass, asset);
      expect(assetResults.length).toBe(1);
    });

    it("should materialize diamond inheritance", async () => {
      //   Asset
      //   /   \
      // Note  Task
      //   \   /
      // LiteratureNote
      await store.add(new Triple(note, superClass, asset));
      await store.add(new Triple(task, superClass, asset));
      await store.add(new Triple(literatureNote, superClass, note));
      await store.add(new Triple(literatureNote, superClass, task));
      // myNote1 is a LiteratureNote
      await store.add(new Triple(myNote1, instanceClass, literatureNote));

      const count = await engine.materialize(store);

      // Should add: Note, Task, Asset (3 ancestors, Asset reached via both paths but counted once)
      expect(count).toBe(3);
      expect((await store.match(myNote1, instanceClass, note)).length).toBe(1);
      expect((await store.match(myNote1, instanceClass, task)).length).toBe(1);
      expect((await store.match(myNote1, instanceClass, asset)).length).toBe(1);
    });

    it("should handle cycle detection (A → B → A)", async () => {
      // Note → Asset → Note (cycle)
      await store.add(new Triple(note, superClass, asset));
      await store.add(new Triple(asset, superClass, note));
      // myNote1 is a Note
      await store.add(new Triple(myNote1, instanceClass, note));

      // Should not hang — cycle detection prevents infinite BFS
      const count = await engine.materialize(store);

      // Should add: Asset (parent of Note)
      expect(count).toBe(1);
      expect((await store.match(myNote1, instanceClass, asset)).length).toBe(1);
    });

    it("should handle self-referential cycle (A → A)", async () => {
      await store.add(new Triple(note, superClass, note));
      await store.add(new Triple(myNote1, instanceClass, note));

      // Should not hang
      const count = await engine.materialize(store);

      // note is already the direct class, self-reference adds nothing new
      expect(count).toBe(0);
    });

    it("should materialize for multiple instances", async () => {
      // FleetingNote → Note → Asset
      await store.add(new Triple(fleetingNote, superClass, note));
      await store.add(new Triple(note, superClass, asset));
      // Two fleeting notes
      await store.add(new Triple(myNote1, instanceClass, fleetingNote));
      await store.add(new Triple(myNote2, instanceClass, fleetingNote));

      const count = await engine.materialize(store);

      // Each gets 2 inferred triples (Note, Asset)
      expect(count).toBe(4);
    });

    it("should not duplicate already-existing triples", async () => {
      // FleetingNote → Note
      await store.add(new Triple(fleetingNote, superClass, note));
      // myNote1 is FleetingNote AND already explicitly a Note
      await store.add(new Triple(myNote1, instanceClass, fleetingNote));
      await store.add(new Triple(myNote1, instanceClass, note));

      const count = await engine.materialize(store);

      // Note triple already exists, so 0 new triples added
      expect(count).toBe(0);
    });

    it("should be idempotent (running twice gives same result)", async () => {
      await store.add(new Triple(fleetingNote, superClass, note));
      await store.add(new Triple(note, superClass, asset));
      await store.add(new Triple(myNote1, instanceClass, fleetingNote));

      const count1 = await engine.materialize(store);
      expect(count1).toBe(2);

      const count2 = await engine.materialize(store);
      expect(count2).toBe(0); // No new triples on second run
    });

    it("should handle multiple class hierarchies independently", async () => {
      // Note hierarchy: FleetingNote → Note → Asset
      await store.add(new Triple(fleetingNote, superClass, note));
      await store.add(new Triple(note, superClass, asset));
      // Task hierarchy: Task → Asset
      await store.add(new Triple(task, superClass, asset));

      await store.add(new Triple(myNote1, instanceClass, fleetingNote));
      await store.add(new Triple(myTask, instanceClass, task));

      const count = await engine.materialize(store);

      // myNote1: +Note, +Asset (2)
      // myTask: +Asset (1)
      expect(count).toBe(3);
      expect((await store.match(myNote1, instanceClass, note)).length).toBe(1);
      expect((await store.match(myNote1, instanceClass, asset)).length).toBe(1);
      expect((await store.match(myTask, instanceClass, asset)).length).toBe(1);
    });

    it("should handle instances with class not in hierarchy", async () => {
      await store.add(new Triple(fleetingNote, superClass, note));
      // myTask is a Task, but Task has no superclass
      await store.add(new Triple(myTask, instanceClass, task));

      const count = await engine.materialize(store);

      expect(count).toBe(0);
    });

    it("should work with vault-style obsidian:// IRIs", async () => {
      const vaultNote = new IRI("obsidian://vault/03%20Knowledge/ztlk/ztlk__Note");
      const vaultFleeting = new IRI("obsidian://vault/03%20Knowledge/ztlk/ztlk__FleetingNote");
      const vaultInstance = new IRI("obsidian://vault/03%20Knowledge/ztlk/my-fleeting-note");

      await store.add(new Triple(vaultFleeting, superClass, vaultNote));
      await store.add(new Triple(vaultInstance, instanceClass, vaultFleeting));

      const count = await engine.materialize(store);

      expect(count).toBe(1);
      const results = await store.match(vaultInstance, instanceClass, vaultNote);
      expect(results.length).toBe(1);
    });
  });
});
