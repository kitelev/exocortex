import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import {
  hasNonUidFilename,
  registerDefaultHostFunctions,
} from "../../../src/services/preconditionHostFunctions";

const TARGET_IRI = "obsidian://vault/03%20Knowledge/some-file.md";
const UID = "b610b0e5-beb2-43b0-b2fd-1601c7a5d160";

describe("hasNonUidFilename host function", () => {
  it("returns true when basename differs from assetUid", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Human Readable Name",
        assetUid: UID,
      }),
    ).toBe(true);
  });

  it("returns false when basename equals assetUid", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: UID,
        assetUid: UID,
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is missing", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Some Name",
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is empty string", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Some Name",
        assetUid: "",
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is whitespace-only", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Some Name",
        assetUid: "   ",
      }),
    ).toBe(false);
  });

  it("returns false when fileBasename is missing", () => {
    expect(
      hasNonUidFilename({
        targetIRI: TARGET_IRI,
        assetUid: UID,
      }),
    ).toBe(false);
  });
});

describe("registerDefaultHostFunctions", () => {
  it("registers hasNonUidFilename on the evaluator", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());

    expect(evaluator.hasHostFunction("hasNonUidFilename")).toBe(false);

    registerDefaultHostFunctions(evaluator);

    expect(evaluator.hasHostFunction("hasNonUidFilename")).toBe(true);
  });

  it("evaluator routes hasNonUidFilename precondition through the registered fn", async () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
    registerDefaultHostFunctions(evaluator);

    const precondition = {
      id: "pre-rename-to-uid",
      label: "Has non-UID filename",
      hostFunction: "hasNonUidFilename",
    };

    const visibleWhenLabelNamed = await evaluator.evaluate(
      precondition,
      TARGET_IRI,
      {
        targetIRI: TARGET_IRI,
        fileBasename: "Human Readable Name",
        assetUid: UID,
      },
    );
    expect(visibleWhenLabelNamed).toBe(true);

    const hiddenWhenUidNamed = await evaluator.evaluate(
      precondition,
      TARGET_IRI,
      {
        targetIRI: TARGET_IRI,
        fileBasename: UID,
        assetUid: UID,
      },
    );
    expect(hiddenWhenUidNamed).toBe(false);
  });
});
