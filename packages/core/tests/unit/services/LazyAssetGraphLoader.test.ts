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

  // RFC 93a0b2ee Task 1.2 — public delegation so a consumer (the Relations
  // read-path) can key an asset by the SAME IRI form the converter emits.
  describe("notePathToIRI", () => {
    it("delegates to the converter's notePathToIRI (matches the load-mark form)", () => {
      const path = "assetspaces/kitelev/exoas-my/my/some-uid.md";
      expect(loader.notePathToIRI(path).value).toBe(pathToIRI(path).value);
    });

    it("is consistent with the IRI form ensureFileLoaded keys its load-mark by", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);
      await loader.ensureFileLoaded(file);
      // The loaded-set is keyed by converter.notePathToIRI — so the public
      // accessor must return the IRI that isLoaded() recognises.
      expect(loader.isLoaded(loader.notePathToIRI("task.md"))).toBe(true);
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
      // Entry at depth 0 increments to depth 1 → 2 → ... up to MAX_LAZY_DEPTH.
      // At depth === MAX_LAZY_DEPTH, ensureFileLoaded returns before adding,
      // so exactly MAX_LAZY_DEPTH distinct files end up loaded.
      expect(loader.loadedCount).toBe(MAX_LAZY_DEPTH);
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

  describe("throw recovery", () => {
    it("rolls back loadedIRIs on convertNote throw, allowing successful retry", async () => {
      const file = makeFile("flaky.md");
      const subject = pathToIRI("flaky.md");
      let callCount = 0;

      // Custom converter: throws on first call, succeeds on second.
      const flakyConverter: INoteConverter = {
        convertNote: async (_f: IFile): Promise<Triple[]> => {
          callCount += 1;
          if (callCount === 1) {
            throw new Error("simulated transient parse error");
          }
          return [new Triple(subject, labelPred, new Literal("Flaky"))];
        },
        notePathToIRI: pathToIRI,
      };
      const flakyLoader = new LazyAssetGraphLoader(
        flakyConverter,
        resolver,
        store,
      );

      // First call: throws; loadedIRIs must NOT retain the IRI.
      await expect(flakyLoader.ensureFileLoaded(file)).rejects.toThrow(
        "simulated transient parse error",
      );
      expect(flakyLoader.isLoaded(subject)).toBe(false);
      expect(flakyLoader.loadedCount).toBe(0);

      // Second call: succeeds; store now has the triples.
      await flakyLoader.ensureFileLoaded(file);
      expect(flakyLoader.isLoaded(subject)).toBe(true);
      expect(flakyLoader.loadedCount).toBe(1);
      const match = await store.match(subject, undefined, undefined);
      expect(match).toHaveLength(1);
      expect(callCount).toBe(2);
    });
  });

  describe("forget", () => {
    it("drops the IRI from the loaded set so the next ensure re-walks", async () => {
      const file = makeFile("task.md");
      const subject = pathToIRI("task.md");
      converter.registerFile(file, []);

      await loader.ensureFileLoaded(file);
      expect(loader.isLoaded(subject)).toBe(true);
      expect(converter.callCounts.get("task.md")).toBe(1);

      loader.forget(subject);
      expect(loader.isLoaded(subject)).toBe(false);
      expect(loader.loadedCount).toBe(0);

      // Re-ensure: convertNote is invoked again, IRI is back in the set.
      await loader.ensureFileLoaded(file);
      expect(loader.isLoaded(subject)).toBe(true);
      expect(converter.callCounts.get("task.md")).toBe(2);
    });

    it("is a no-op for an IRI that was never loaded", () => {
      const subject = pathToIRI("never-loaded.md");
      loader.forget(subject);
      expect(loader.loadedCount).toBe(0);
      expect(loader.isLoaded(subject)).toBe(false);
    });

    it("does NOT cascade to prototype chain entries", async () => {
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
      expect(loader.loadedCount).toBe(2);
      expect(loader.isLoaded(pathToIRI("Prototype.md"))).toBe(true);

      // Forget only the instance; the prototype's mark must survive.
      loader.forget(pathToIRI("instance.md"));
      expect(loader.isLoaded(pathToIRI("instance.md"))).toBe(false);
      expect(loader.isLoaded(pathToIRI("Prototype.md"))).toBe(true);
      expect(loader.loadedCount).toBe(1);
    });

    it("does NOT cascade to class chain entries", async () => {
      const taskFile = makeFile("my-task.md");
      const classFile = makeFile("ems__Task.md");

      converter.registerFile(taskFile, [
        new Triple(
          pathToIRI("my-task.md"),
          instanceClassPred,
          pathToIRI("ems__Task.md"),
        ),
      ]);
      converter.registerFile(classFile, []);
      resolver.register(classFile);

      await loader.ensureFileLoaded(taskFile);
      expect(loader.loadedCount).toBe(2);
      expect(loader.isLoaded(pathToIRI("ems__Task.md"))).toBe(true);

      // Forget only the task instance; the class file's mark must survive.
      loader.forget(pathToIRI("my-task.md"));
      expect(loader.isLoaded(pathToIRI("my-task.md"))).toBe(false);
      expect(loader.isLoaded(pathToIRI("ems__Task.md"))).toBe(true);
      expect(loader.loadedCount).toBe(1);
    });
  });

  describe("clearAll", () => {
    it("wipes every IRI from the loaded set", async () => {
      const a = makeFile("A.md");
      const b = makeFile("B.md");
      converter.registerFile(a, []);
      converter.registerFile(b, []);

      await loader.ensureFileLoaded(a);
      await loader.ensureFileLoaded(b);
      expect(loader.loadedCount).toBe(2);

      loader.clearAll();
      expect(loader.loadedCount).toBe(0);
      expect(loader.isLoaded(pathToIRI("A.md"))).toBe(false);
      expect(loader.isLoaded(pathToIRI("B.md"))).toBe(false);
    });

    it("permits a fresh ensure cycle after clearing", async () => {
      const file = makeFile("task.md");
      converter.registerFile(file, []);

      await loader.ensureFileLoaded(file);
      expect(converter.callCounts.get("task.md")).toBe(1);

      loader.clearAll();
      await loader.ensureFileLoaded(file);
      expect(converter.callCounts.get("task.md")).toBe(2);
      expect(loader.loadedCount).toBe(1);
    });

    it("is a no-op when the set is already empty", () => {
      expect(loader.loadedCount).toBe(0);
      loader.clearAll();
      expect(loader.loadedCount).toBe(0);
    });
  });

  describe("race — forget/clearAll during in-flight ensureFileLoaded", () => {
    type Deferred<T> = {
      promise: Promise<T>;
      resolve: (v: T) => void;
      reject: (err: unknown) => void;
    };
    const makeDeferred = <T,>(): Deferred<T> => {
      let resolve!: (v: T) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it("forget during await convertNote skips post-await store write", async () => {
      const subject = pathToIRI("racing.md");
      const file = makeFile("racing.md");
      const deferred = makeDeferred<Triple[]>();

      const slowConverter: INoteConverter = {
        convertNote: () => deferred.promise,
        notePathToIRI: pathToIRI,
      };
      const racingLoader = new LazyAssetGraphLoader(
        slowConverter,
        resolver,
        store,
      );

      const inflight = racingLoader.ensureFileLoaded(file);
      expect(racingLoader.isLoaded(subject)).toBe(true);

      racingLoader.forget(subject);
      expect(racingLoader.isLoaded(subject)).toBe(false);

      deferred.resolve([new Triple(subject, labelPred, new Literal("Racing"))]);
      await inflight;

      const storeContents = await store.match(subject, undefined, undefined);
      expect(storeContents).toHaveLength(0);
      expect(racingLoader.isLoaded(subject)).toBe(false);
      expect(racingLoader.loadedCount).toBe(0);
    });

    it("clearAll during await convertNote skips post-await store write", async () => {
      const subject = pathToIRI("clearracing.md");
      const file = makeFile("clearracing.md");
      const deferred = makeDeferred<Triple[]>();

      const slowConverter: INoteConverter = {
        convertNote: () => deferred.promise,
        notePathToIRI: pathToIRI,
      };
      const racingLoader = new LazyAssetGraphLoader(
        slowConverter,
        resolver,
        store,
      );

      const inflight = racingLoader.ensureFileLoaded(file);
      expect(racingLoader.isLoaded(subject)).toBe(true);

      racingLoader.clearAll();
      expect(racingLoader.loadedCount).toBe(0);

      deferred.resolve([new Triple(subject, labelPred, new Literal("Cleared"))]);
      await inflight;

      const storeContents = await store.match(subject, undefined, undefined);
      expect(storeContents).toHaveLength(0);
      expect(racingLoader.loadedCount).toBe(0);
    });

    it("forget(other-IRI) during in-flight child ensureFileLoaded does NOT orphan-mark the child (PR #3257 reviewer regression)", async () => {
      // Setup: F (parent file) has class G. ensureFileLoaded(F) walks
      // into ensureLoadedByIRI(G). While G's convertNote is in-flight,
      // forget(F) fires (e.g. user edits F). Earlier generation-counter
      // design tripped G's post-await check too — leaving G marked
      // loaded with zero triples in the store. The mark-presence
      // check (only bail when OUR mark is gone) prevents this orphan.
      const fIri = pathToIRI("F.md");
      const gIri = pathToIRI("G.md");
      const fFile = makeFile("F.md");
      const gFile = makeFile("G.md");

      const gDeferred = makeDeferred<Triple[]>();
      let gConvertStarted = false;
      const racingConverter: INoteConverter = {
        convertNote: (file: IFile) => {
          if (file.path === "G.md") {
            gConvertStarted = true;
            return gDeferred.promise;
          }
          // F's triples — emits the class link to G
          return Promise.resolve([
            new Triple(fIri, instanceClassPred, gIri),
          ]);
        },
        notePathToIRI: pathToIRI,
      };
      const racingResolver = new (class implements IFileResolver {
        resolveByIRI(iri: IRI): IFile | null {
          if (iri.value === gIri.value) return gFile;
          return null;
        }
      })();
      const racingLoader = new LazyAssetGraphLoader(
        racingConverter,
        racingResolver,
        store,
      );

      // Kick off F's load. F's convertNote resolves synchronously
      // (returns a resolved promise), so the walk proceeds into G.
      const inflight = racingLoader.ensureFileLoaded(fFile);

      // Wait for G's convertNote to be in flight.
      await new Promise<void>((r) => {
        const tick = () => (gConvertStarted ? r() : setImmediate(tick));
        tick();
      });

      // Both F and G are now marked loaded (F is done, G is pre-await).
      expect(racingLoader.isLoaded(fIri)).toBe(true);
      expect(racingLoader.isLoaded(gIri)).toBe(true);

      // Race: forget F (NOT G). With the buggy generation-counter
      // design, G's post-await check would trip even though only F
      // was forgotten — G would orphan-mark.
      racingLoader.forget(fIri);
      expect(racingLoader.isLoaded(fIri)).toBe(false);
      expect(racingLoader.isLoaded(gIri)).toBe(true);

      // Let G's convertNote complete.
      gDeferred.resolve([new Triple(gIri, labelPred, new Literal("G"))]);
      await inflight;

      // The fix: G's mark survives AND G's triples landed in the store.
      // Under the buggy generation-counter design, this assertion fails:
      // the check tripped, G short-circuited at line 147 without
      // store.addAll — G is marked loaded but has 0 triples.
      expect(racingLoader.isLoaded(gIri)).toBe(true);
      const gContents = await store.match(gIri, undefined, undefined);
      expect(gContents.length).toBeGreaterThan(0);
    });

    it("no race → triples are still written normally (sanity)", async () => {
      const file = makeFile("clean.md");
      const subject = pathToIRI("clean.md");
      converter.registerFile(file, [
        new Triple(subject, labelPred, new Literal("Clean")),
      ]);

      await loader.ensureFileLoaded(file);

      const storeContents = await store.match(subject, undefined, undefined);
      expect(storeContents).toHaveLength(1);
      expect(loader.isLoaded(subject)).toBe(true);
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

  // @req:044a6890-414e-452f-9870-b6ed67b0bf92 — ontology hop (exo:Asset_isDefinedBy) in the lazy walk.
  //
  // Measured live on desktop 2026-08-29 (plugin 16.235.2): four command buttons
  // stayed hidden for the whole cold-start window (~25 s) because precondition
  // 38ff3c61 is `ASK { $target exo:Asset_isDefinedBy ?onto .
  // ?onto exo:Ontology_archiveOntology ?a . }` and the ontology never reached
  // the store — neither via this walk (the predicate was absent) nor via the
  // TBox bootstrap (lazyBootstrapFolders lists exo/ ems/ ims/ exocmd/, while a
  // personal ontology lives in assetspaces/<owner>/exoas-my/<ns>/ — zero match).
  describe("ensureFileLoaded — ontology hop (isDefinedBy)", () => {
    const isDefinedByPred = Namespace.EXO.term("Asset_isDefinedBy");
    const archiveOntologyPred = Namespace.EXO.term("Ontology_archiveOntology");
    const relatesPred = Namespace.EXO.term("Asset_relates");

    it("walks exo:Asset_isDefinedBy so the ontology's own triples enter the store", async () => {
      const asset = makeFile("my-efforts/asset.md");
      const ontology = makeFile("my-efforts/ontology.md");
      const assetIRI = pathToIRI(asset.path);
      const ontologyIRI = pathToIRI(ontology.path);
      const archiveIRI = pathToIRI("my-efforts/archived.md");

      converter.registerFile(asset, [
        new Triple(assetIRI, isDefinedByPred, ontologyIRI),
      ]);
      // The second hop of the ASK lives INSIDE the ontology asset.
      converter.registerFile(ontology, [
        new Triple(ontologyIRI, archiveOntologyPred, archiveIRI),
      ]);
      resolver.register(ontology);

      await loader.ensureFileLoaded(asset);

      // Proves the WIRING, not a helper: the ontology file was converted…
      expect(converter.callCounts.get(ontology.path)).toBe(1);
      // …and its own triple — the ASK's second hop — is queryable.
      const hop2 = await store.match(ontologyIRI, archiveOntologyPred, undefined);
      expect(hop2).toHaveLength(1);
    });

    it("control: a predicate outside the walk list does NOT pull its target", async () => {
      const asset = makeFile("my-efforts/other.md");
      const neighbour = makeFile("my-efforts/neighbour.md");

      converter.registerFile(asset, [
        new Triple(pathToIRI(asset.path), relatesPred, pathToIRI(neighbour.path)),
      ]);
      converter.registerFile(neighbour, []);
      resolver.register(neighbour);

      await loader.ensureFileLoaded(asset);

      // The radius stays bounded — adding isDefinedBy must not turn the walk
      // into "follow every IRI object".
      expect(converter.callCounts.get(neighbour.path)).toBeUndefined();
      expect(loader.loadedCount).toBe(1);
    });
  });

});
