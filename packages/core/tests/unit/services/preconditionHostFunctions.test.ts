import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import {
  hasNonUidFilename,
  hasUidFilename,
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

describe("hasUidFilename host function", () => {
  it("returns true when basename equals assetUid", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: UID,
        assetUid: UID,
      }),
    ).toBe(true);
  });

  it("returns false when basename differs from assetUid (label-named)", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Human Readable Name",
        assetUid: UID,
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is missing (no exo__Asset_uid in frontmatter)", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "Some Name",
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is empty string", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "",
        assetUid: "",
      }),
    ).toBe(false);
  });

  it("returns false when assetUid is whitespace-only", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        fileBasename: "   ",
        assetUid: "   ",
      }),
    ).toBe(false);
  });

  it("returns false when fileBasename is missing", () => {
    expect(
      hasUidFilename({
        targetIRI: TARGET_IRI,
        assetUid: UID,
      }),
    ).toBe(false);
  });

  it("daily-note shape (basename=YYYY-MM-DD, uid=UUID): returns false (palette hidden)", () => {
    expect(
      hasUidFilename({
        targetIRI: "obsidian://vault/Daily/2026-05-29.md",
        fileBasename: "2026-05-29",
        assetUid: UID,
      }),
    ).toBe(false);
  });

  it("weekly-note shape (basename=YYYY-Www, uid=UUID): returns false (palette hidden)", () => {
    expect(
      hasUidFilename({
        targetIRI: "obsidian://vault/Weekly/2026-W22.md",
        fileBasename: "2026-W22",
        assetUid: UID,
      }),
    ).toBe(false);
  });

  it("is the strict logical inverse of hasNonUidFilename for valid uid+basename pairs", () => {
    const ctx = {
      targetIRI: TARGET_IRI,
      fileBasename: UID,
      assetUid: UID,
    };
    expect(hasUidFilename(ctx)).toBe(!hasNonUidFilename(ctx));

    const ctx2 = {
      targetIRI: TARGET_IRI,
      fileBasename: "Some Label",
      assetUid: UID,
    };
    expect(hasUidFilename(ctx2)).toBe(!hasNonUidFilename(ctx2));
  });
});

describe("registerDefaultHostFunctions", () => {
  it("registers hasNonUidFilename on the evaluator", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());

    expect(evaluator.hasHostFunction("hasNonUidFilename")).toBe(false);

    registerDefaultHostFunctions(evaluator);

    expect(evaluator.hasHostFunction("hasNonUidFilename")).toBe(true);
  });

  it("registers hasUidFilename on the evaluator", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());

    expect(evaluator.hasHostFunction("hasUidFilename")).toBe(false);

    registerDefaultHostFunctions(evaluator);

    expect(evaluator.hasHostFunction("hasUidFilename")).toBe(true);
  });

  it("evaluator routes hasUidFilename precondition through the registered fn", async () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
    registerDefaultHostFunctions(evaluator);

    const precondition = {
      id: "pre-duplicate-asset",
      label: "Has UID filename",
      hostFunction: "hasUidFilename",
    };

    const visibleWhenUidNamed = await evaluator.evaluate(
      precondition,
      TARGET_IRI,
      {
        targetIRI: TARGET_IRI,
        fileBasename: UID,
        assetUid: UID,
      },
    );
    expect(visibleWhenUidNamed).toBe(true);

    const hiddenWhenLabelNamed = await evaluator.evaluate(
      precondition,
      TARGET_IRI,
      {
        targetIRI: TARGET_IRI,
        fileBasename: "Human Readable Name",
        assetUid: UID,
      },
    );
    expect(hiddenWhenLabelNamed).toBe(false);
  });

  it("evaluateHostFunctionSync returns true for registered fn with passing context", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
    registerDefaultHostFunctions(evaluator);

    const result = evaluator.evaluateHostFunctionSync(
      "hasUidFilename",
      TARGET_IRI,
      { targetIRI: TARGET_IRI, fileBasename: UID, assetUid: UID },
    );
    expect(result).toBe(true);
  });

  it("evaluateHostFunctionSync returns false for registered fn with failing context", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
    registerDefaultHostFunctions(evaluator);

    const result = evaluator.evaluateHostFunctionSync(
      "hasUidFilename",
      TARGET_IRI,
      { targetIRI: TARGET_IRI, fileBasename: "Label", assetUid: UID },
    );
    expect(result).toBe(false);
  });

  it("evaluateHostFunctionSync returns null for unregistered host function (fail-closed signal)", () => {
    const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
    // Do NOT register defaults — simulate misconfiguration.

    const result = evaluator.evaluateHostFunctionSync(
      "hasUidFilename",
      TARGET_IRI,
      { targetIRI: TARGET_IRI, fileBasename: UID, assetUid: UID },
    );
    expect(result).toBeNull();
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
