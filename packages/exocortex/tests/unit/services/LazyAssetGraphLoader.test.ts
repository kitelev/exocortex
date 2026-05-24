import {
  LazyAssetGraphLoader,
  MAX_LAZY_DEPTH,
  type INoteConverter,
} from "../../../src/services/LazyAssetGraphLoader";
import type { IFileResolver } from "../../../src/interfaces/IFileResolver";
import type { IFile } from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("LazyAssetGraphLoader", () => {
  // Predicates
  const instanceClassPred = Namespace.EXO.term("Instance_class");
  const superClassPred = Namespace.EXO.term("Class_superClass");
  const prototypePred = Namespace.EXO.term("Asset_prototype");
  const labelPred = Namespace.EXO.term("Asset_label");

  /** Build the obsidian://vault/ IRI for a relative path. */
  const pathToIRI = (path: string): IRI =>
    new IRI(`obsidian://vault/${encodeURI(path)}`);

  /** Build a minimal IFile for tests. */
  const makeFile = (path: string): IFile => ({
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    name: path.split("/").pop()!,
    parent: null,
  });

  /**
   * Test-only converter: maps path → triples. Tracks call counts so
   * tests can assert idempotency.
   */
  class FakeConverter implements INoteConverter {
    private readonly triplesByPath = new Map<string, Triple[]>();
    public callCounts = new Map<string, number>();

    registerFile(file: IFile, triples: Triple[]): void {
      this.triplesByPath.set(file.path, triples);
    }

    async convertNote(file: IFile): Promise<Triple[]> {
      const count = this.callCounts.get(file.path) ?? 0;
      this.callCounts.set(file.path, count + 1);
      return this.triplesByPath.get(file.path) ?? [];
    }

    notePathToIRI(path: string): IRI {
      return pathToIRI(path);
    }
  }

  /**
   * Test-only resolver: maps IRI string → IFile. Returns null for
   * unregistered IRIs (simulates broken wikilinks).
   */
  class FakeFileResolver implements IFileResolver {
    private readonly filesByIRI = new Map<string, IFile>();

    register(file: IFile): void {
      this.filesByIRI.set(pathToIRI(file.path).value, file);
    }

    resolveByIRI(iri: IRI): IFile | null {
      return this.filesByIRI.get(iri.value) ?? null;
    }
  }

  let converter: FakeConverter;
  let resolver: FakeFileResolver;
  let store: InMemoryTripleStore;
  let loader: LazyAssetGraphLoader;

  beforeEach(() => {
    converter = new FakeConverter();
    resolver = new FakeFileResolver();
    store = new InMemoryTripleStore();
    loader = new LazyAssetGraphLoader(converter, resolver, store);
  });

  describe("ensureFileLoaded — base cases", () => {
    it("loads a single file's triples into the store", async () => {
      const file = makeFile("task.md");
      const subject = pathToIRI("task.md");
      converter.registerFile(file, [
        new Triple(subject, labelPred, new Literal("Task")),
      ]);

      await loader.ensureFileLoaded(file);

      expect(loader.loadedCount).toBe(1);
      expect(loader.isLoaded(subject)).toBe(true);
      const match = await store.match(subject, undefined, undefined);
      expect(match).toHaveLength(1);
    });

    it("is idempotent — second call does not re-invoke convertNote", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);

      await loader.ensureFileLoaded(file);
      await loader.ensureFileLoaded(file);
      await loader.ensureFileLoaded(file);

      expect(converter.callCounts.get("task.md")).toBe(1);
      expect(loader.loadedCount).toBe(1);
    });

    it("handles a file whose convertNote returns zero triples (empty asset)", async () => {
      const file = makeFile("empty.md");
      converter.registerFile(file, []);

      await loader.ensureFileLoaded(file);

      expect(loader.loadedCount).toBe(1);
      expect(loader.isLoaded(pathToIRI("empty.md"))).toBe(true);
    });
  });

  describe("class chain walk", () => {
    it("loads the asset's declared classes via exo:Instance_class", async () => {
      const taskFile = makeFile("my-task.md");
      const classFile = makeFile("ems__Task.md");

      converter.registerFile(taskFile, [
        new Triple(
          pathToIRI("my-task.md"),
          instanceClassPred,
          pathToIRI("ems__Task.md"),
        ),
      ]);
      converter.registerFile(classFile, [
        new Triple(
          pathToIRI("ems__Task.md"),
          labelPred,
          new Literal("ems__Task"),
        ),
      ]);
      resolver.register(classFile);

      await loader.ensureFileLoaded(taskFile);

      expect(loader.isLoaded(pathToIRI("my-task.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("ems__Task.md"))).toBe(true);
      expect(loader.loadedCount).toBe(2);
    });

    it("iterates ALL Instance_class values (multi-class)", async () => {
      const assetFile = makeFile("multi.md");
      const classAFile = makeFile("ClassA.md");
      const classBFile = makeFile("ClassB.md");

      converter.registerFile(assetFile, [
        new Triple(
          pathToIRI("multi.md"),
          instanceClassPred,
          pathToIRI("ClassA.md"),
        ),
        new Triple(
          pathToIRI("multi.md"),
          instanceClassPred,
          pathToIRI("ClassB.md"),
        ),
      ]);
      converter.registerFile(classAFile, []);
      converter.registerFile(classBFile, []);
      resolver.register(classAFile);
      resolver.register(classBFile);

      await loader.ensureFileLoaded(assetFile);

      expect(loader.isLoaded(pathToIRI("ClassA.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("ClassB.md"))).toBe(true);
      expect(loader.loadedCount).toBe(3);
    });

    it("walks the superclass chain transitively (Class → superClass → superSuperClass)", async () => {
      const taskFile = makeFile("my-task.md");
      const taskClass = makeFile("ems__Task.md");
      const effortClass = makeFile("ems__Effort.md");
      const assetClass = makeFile("exo__Asset.md");

      converter.registerFile(taskFile, [
        new Triple(
          pathToIRI("my-task.md"),
          instanceClassPred,
          pathToIRI("ems__Task.md"),
        ),
      ]);
      converter.registerFile(taskClass, [
        new Triple(
          pathToIRI("ems__Task.md"),
          superClassPred,
          pathToIRI("ems__Effort.md"),
        ),
      ]);
      converter.registerFile(effortClass, [
        new Triple(
          pathToIRI("ems__Effort.md"),
          superClassPred,
          pathToIRI("exo__Asset.md"),
        ),
      ]);
      converter.registerFile(assetClass, []);
      resolver.register(taskClass);
      resolver.register(effortClass);
      resolver.register(assetClass);

      await loader.ensureFileLoaded(taskFile);

      expect(loader.isLoaded(pathToIRI("ems__Task.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("ems__Effort.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("exo__Asset.md"))).toBe(true);
      expect(loader.loadedCount).toBe(4);
    });

    it("returns silently when a referenced class IRI has no resolver entry (broken wikilink)", async () => {
      const taskFile = makeFile("my-task.md");

      converter.registerFile(taskFile, [
        new Triple(
          pathToIRI("my-task.md"),
          instanceClassPred,
          pathToIRI("MissingClass.md"),
        ),
      ]);
      // Do NOT register MissingClass with resolver.

      await loader.ensureFileLoaded(taskFile);

      expect(loader.isLoaded(pathToIRI("my-task.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("MissingClass.md"))).toBe(false);
      expect(loader.loadedCount).toBe(1);
    });
  });

  describe("prototype chain walk", () => {
    it("loads the asset's prototype via exo:Asset_prototype", async () => {
      const instance = makeFile("instance.md");
      const proto = makeFile("Prototype.md");

      converter.registerFile(instance, [
        new Triple(
          pathToIRI("instance.md"),
          prototypePred,
          pathToIRI("Prototype.md"),
        ),
      ]);
      converter.registerFile(proto, []);
      resolver.register(proto);

      await loader.ensureFileLoaded(instance);

      expect(loader.isLoaded(pathToIRI("Prototype.md"))).toBe(true);
      expect(loader.loadedCount).toBe(2);
    });

    it("walks the prototype chain transitively (A → B → C)", async () => {
      const a = makeFile("A.md");
      const b = makeFile("B.md");
      const c = makeFile("C.md");

      converter.registerFile(a, [
        new Triple(pathToIRI("A.md"), prototypePred, pathToIRI("B.md")),
      ]);
      converter.registerFile(b, [
        new Triple(pathToIRI("B.md"), prototypePred, pathToIRI("C.md")),
      ]);
      converter.registerFile(c, []);
      resolver.register(b);
      resolver.register(c);

      await loader.ensureFileLoaded(a);

      expect(loader.isLoaded(pathToIRI("A.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("B.md"))).toBe(true);
      expect(loader.isLoaded(pathToIRI("C.md"))).toBe(true);
      expect(loader.loadedCount).toBe(3);
    });
  });

  describe("cycle safety", () => {
    it("does not loop on a 2-asset class cycle (A.class=B, B.superClass=A)", async () => {
      const a = makeFile("A.md");
      const b = makeFile("B.md");

      converter.registerFile(a, [
        new Triple(pathToIRI("A.md"), instanceClassPred, pathToIRI("B.md")),
      ]);
      converter.registerFile(b, [
        new Triple(pathToIRI("B.md"), superClassPred, pathToIRI("A.md")),
      ]);
      resolver.register(a);
      resolver.register(b);

      // Should complete without throwing or hanging
      await loader.ensureFileLoaded(a);

      expect(loader.loadedCount).toBe(2);
      expect(converter.callCounts.get("A.md")).toBe(1);
      expect(converter.callCounts.get("B.md")).toBe(1);
    });

    it("does not loop on a 3-asset prototype cycle (A → B → C → A)", async () => {
      const a = makeFile("A.md");
      const b = makeFile("B.md");
      const c = makeFile("C.md");

      converter.registerFile(a, [
        new Triple(pathToIRI("A.md"), prototypePred, pathToIRI("B.md")),
      ]);
      converter.registerFile(b, [
        new Triple(pathToIRI("B.md"), prototypePred, pathToIRI("C.md")),
      ]);
      converter.registerFile(c, [
        new Triple(pathToIRI("C.md"), prototypePred, pathToIRI("A.md")),
      ]);
      resolver.register(a);
      resolver.register(b);
      resolver.register(c);

      await loader.ensureFileLoaded(a);

      expect(loader.loadedCount).toBe(3);
      expect(converter.callCounts.get("A.md")).toBe(1);
    });

    it("does not loop on a self-prototype (A.prototype=A)", async () => {
      const a = makeFile("A.md");
      converter.registerFile(a, [
        new Triple(pathToIRI("A.md"), prototypePred, pathToIRI("A.md")),
      ]);
      resolver.register(a);

      await loader.ensureFileLoaded(a);

      expect(loader.loadedCount).toBe(1);
      expect(converter.callCounts.get("A.md")).toBe(1);
    });
  });

  describe("bounded depth", () => {
    it("terminates a pathological chain at MAX_LAZY_DEPTH", async () => {
      // Build a linear chain A0 → A1 → A2 → ... → A20 via prototype
      const chainLength = MAX_LAZY_DEPTH + 10; // 20 levels
      const files: IFile[] = [];
      for (let i = 0; i < chainLength; i++) {
        files.push(makeFile(`A${i}.md`));
      }
      for (let i = 0; i < chainLength - 1; i++) {
        converter.registerFile(files[i], [
          new Triple(
            pathToIRI(`A${i}.md`),
            prototypePred,
            pathToIRI(`A${i + 1}.md`),
          ),
        ]);
        resolver.register(files[i]);
      }
      converter.registerFile(files[chainLength - 1], []);
      resolver.register(files[chainLength - 1]);

      await loader.ensureFileLoaded(files[0]);

      // The depth bound caps the chain — exact reachable depth depends on
      // how depth is incremented; the contract is "≤ MAX_LAZY_DEPTH + 1
      // distinct files for a starting file at depth 0".
      expect(loader.loadedCount).toBeLessThanOrEqual(MAX_LAZY_DEPTH + 1);
      expect(loader.loadedCount).toBeGreaterThanOrEqual(MAX_LAZY_DEPTH - 1);
    });
  });

  describe("ensureLoadedByIRI", () => {
    it("loads via IRI when resolver knows the file", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);
      resolver.register(file);

      await loader.ensureLoadedByIRI(pathToIRI("task.md"));

      expect(loader.isLoaded(pathToIRI("task.md"))).toBe(true);
    });

    it("returns silently when resolver returns null", async () => {
      // No registration of any file
      await loader.ensureLoadedByIRI(pathToIRI("nonexistent.md"));

      expect(loader.loadedCount).toBe(0);
    });

    it("is idempotent — second call is no-op", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);
      resolver.register(file);

      await loader.ensureLoadedByIRI(pathToIRI("task.md"));
      await loader.ensureLoadedByIRI(pathToIRI("task.md"));

      expect(converter.callCounts.get("task.md")).toBe(1);
    });
  });

  describe("clearForTests", () => {
    it("resets the loaded set so subsequent loads re-fetch", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);

      await loader.ensureFileLoaded(file);
      expect(converter.callCounts.get("task.md")).toBe(1);

      loader.clearForTests();
      expect(loader.loadedCount).toBe(0);

      await loader.ensureFileLoaded(file);
      expect(converter.callCounts.get("task.md")).toBe(2);
    });
  });
});
