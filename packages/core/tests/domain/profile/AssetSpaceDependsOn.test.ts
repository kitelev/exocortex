import { transitiveDependsOnClosure } from "../../../src/domain/profile/AssetSpaceDependsOn";

describe("transitiveDependsOnClosure (EKA Alpha D18 DAG, issue #3511)", () => {
  it("includes each root even with no edges", () => {
    const closure = transitiveDependsOnClosure(["a"], new Map());
    expect([...closure].sort()).toEqual(["a"]);
  });

  it("walks the EKA chain exodev → shared-private → public → exo → w3c", () => {
    const dependsOn = new Map<string, string[]>([
      ["exodev", ["shared-private"]],
      ["shared-private", ["public"]],
      ["public", ["exo"]],
      ["exo", ["w3c"]],
      // w3c is a leaf (absent from the map)
    ]);
    const closure = transitiveDependsOnClosure(["exodev"], dependsOn);
    expect([...closure].sort()).toEqual([
      "exo",
      "exodev",
      "public",
      "shared-private",
      "w3c",
    ]);
  });

  it("is cycle-safe (a → b → a terminates)", () => {
    const dependsOn = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    const closure = transitiveDependsOnClosure(["a"], dependsOn);
    expect([...closure].sort()).toEqual(["a", "b"]);
  });

  it("merges multiple roots and diamond dependencies without duplication", () => {
    const dependsOn = new Map<string, string[]>([
      ["a", ["c"]],
      ["b", ["c"]],
      ["c", ["d"]],
    ]);
    const closure = transitiveDependsOnClosure(["a", "b"], dependsOn);
    expect([...closure].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("tolerates a self-edge", () => {
    const dependsOn = new Map<string, string[]>([["a", ["a", "b"]]]);
    const closure = transitiveDependsOnClosure(["a"], dependsOn);
    expect([...closure].sort()).toEqual(["a", "b"]);
  });
});
