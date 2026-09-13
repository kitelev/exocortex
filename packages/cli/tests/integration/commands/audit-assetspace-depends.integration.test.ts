import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanAssetSpaceDepends,
  auditAssetSpaceDependsCommand,
  assetspaceOfPath,
  DEPENDENCY_KIND_TBOX_UID,
  DEPENDENCY_KIND_REFERENCE_UID,
} from "../../../src/commands/audit-assetspace-depends.js";
import { ASSET_SPACE_CLASS_UID } from "../../../src/services/CliProfileResolver.js";

const DESC_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DESC_B = "bbbbbbbb-0000-4000-8000-000000000002";
const DESC_C = "cccccccc-0000-4000-8000-000000000003";
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";
const ASSET_C = "33333333-3333-4333-8333-333333333333";

type Kind = "TBox" | "Reference" | "none";

function writeDescriptor(
  dir: string,
  uid: string,
  slug: string,
  dependsOn: string[],
  kind: Kind = "TBox",
): void {
  mkdirSync(dir, { recursive: true });
  const kindUid =
    kind === "TBox"
      ? DEPENDENCY_KIND_TBOX_UID
      : kind === "Reference"
        ? DEPENDENCY_KIND_REFERENCE_UID
        : null;
  writeFileSync(
    join(dir, `${uid}.md`),
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${slug}"`,
      "exo__Instance_class:",
      `  - "[[${ASSET_SPACE_CLASS_UID}]]"`,
      `exo__AssetSpace_source: https://github.com/${slug}`,
      `exo__AssetSpace_namespace: ${slug.split("/")[1]}`,
      ...(kindUid ? [`exo__AssetSpace_dependsOnKind: "[[${kindUid}]]"`] : []),
      ...(dependsOn.length > 0
        ? [
            "exo__AssetSpace_dependsOn:",
            ...dependsOn.map((d) => `  - "[[${d}]]"`),
          ]
        : []),
      "---",
      "",
      "Descriptor.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeAsset(
  dir: string,
  uid: string,
  label: string,
  extraFrontmatter: string[] = [],
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${uid}.md`),
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      ...extraFrontmatter,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

/**
 * Revert→fail / restore→pass proof for `audit assetspace-depends`
 * (req 04208713, RFC 306dcb5c frame). The verdict is driven purely by data:
 * a definition-tier cross-AssetSpace reference is uncovered exactly while the
 * source descriptor's declared `dependsOn` transitive closure does not contain
 * the target AssetSpace. The declaration is flipped on disk:
 * absent (FAIL) → declared (OK) → absent again (FAIL).
 */
describe("audit assetspace-depends — revert→fail / restore→pass (integration)", () => {
  let vault: string;
  let registry: string;
  const asA = () => join(vault, "assetspaces", "o", "a");
  const asB = () => join(vault, "assetspaces", "o", "b");
  const asC = () => join(vault, "assetspaces", "o", "c");

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `as-depends-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    registry = join(vault, "assetspaces", "o", "registry", "registry");
    mkdirSync(vault, { recursive: true });
    // Fact edge a→b: an exo__Property in AssetSpace a whose range is a class in b.
    writeAsset(asA(), ASSET_A, "a__Prop", [
      `exo__Property_range: "[[${ASSET_B}]]"`,
    ]);
    writeAsset(asB(), ASSET_B, "b__Class");
    writeAsset(asC(), ASSET_C, "c__Class");
    writeDescriptor(registry, DESC_B, "o/b", []);
    writeDescriptor(registry, DESC_C, "o/c", []);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("@req:04208713-cdd5-4438-b910-215c0cf52382 FAIL without the dependsOn declaration, OK with it, FAIL again without", async () => {
    // --- State 1: descriptor a declares nothing → fact a→b is uncovered ---
    writeDescriptor(registry, DESC_A, "o/a", []);
    let r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("FAIL");
    expect(r.clean).toBe(false);
    expect(r.facts.edgeCount).toBe(1);
    expect(r.facts.uncoveredByClosure).toBe(1);
    expect(r.facts.uncoveredDirect).toBe(1);
    const edge = r.facts.edges[0];
    expect(edge.source).toBe("o/a");
    expect(edge.target).toBe("o/b");
    expect(edge.coveredByClosure).toBe(false);
    expect(edge.predicates).toEqual({ exo__Property_range: 1 });

    // --- State 2: declare a → b → covered directly and by closure ---
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("OK");
    expect(r.clean).toBe(true);
    expect(r.facts.uncoveredByClosure).toBe(0);
    expect(r.facts.uncoveredDirect).toBe(0);
    expect(r.facts.coveredByClosure).toBe(1); // canary: the walk is alive

    // --- State 3: revert the declaration → uncovered returns ---
    writeDescriptor(registry, DESC_A, "o/a", []);
    r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("FAIL");
    expect(r.facts.uncoveredByClosure).toBe(1);
  });

  it("@req:04208713-cdd5-4438-b910-215c0cf52382 judges BY CLOSURE: a→c→b covers a→b transitively; the direct number is printed but not the verdict", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_C]);
    writeDescriptor(registry, DESC_C, "o/c", [DESC_B]);
    const r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("OK");
    expect(r.facts.uncoveredByClosure).toBe(0);
    expect(r.facts.uncoveredDirect).toBe(1); // informational, never the criterion
    expect(r.facts.edges[0].coveredDirect).toBe(false);
    expect(r.facts.edges[0].coveredByClosure).toBe(true);
    expect(r.vaultPath).toBe(vault); // the scope label every number belongs to
  });

  it("@req:04208713-cdd5-4438-b910-215c0cf52382 one-sided: a declaration without a fact is never a violation; Reference-kind targets are packaging and not listed", async () => {
    // a → b (fact) and a → c (no fact). c is TBox-kind → listed as declaredWithoutFact.
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B, DESC_C]);
    let r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("OK");
    expect(r.declaredWithoutFact.total).toBe(1);
    expect(r.declaredWithoutFact.edges[0]).toEqual({
      source: "o/a",
      target: "o/c",
      targetKind: "TBox",
      hasFact: false,
    });
    expect(r.packaging).toBe(0);

    // c re-kinded as Reference → packaging by definition (frame p.4): not listed.
    writeDescriptor(registry, DESC_C, "o/c", [], "Reference");
    r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("OK");
    expect(r.declaredWithoutFact.total).toBe(0);
    expect(r.packaging).toBe(1);

    // c without any kind → listed as unkinded AND named under targetsWithoutKind.
    writeDescriptor(registry, DESC_C, "o/c", [], "none");
    r = await scanAssetSpaceDepends({ vault });
    expect(r.declaredWithoutFact.byKind.unkinded).toBe(1);
    expect(r.targetsWithoutKind).toEqual(["o/c"]);
  });

  it("a declared-graph cycle is NOT a violation (dependsOn is packaging, frame p.1)", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    writeDescriptor(registry, DESC_B, "o/b", [DESC_A]); // a ⇄ b
    const r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("OK");
    expect(r.facts.uncoveredByClosure).toBe(0);
  });

  it("degenerate population is BROKEN, never clean: zero facts / zero descriptors", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    // Remove the only fact edge: the range now points inside a.
    writeAsset(asA(), ASSET_A, "a__Prop", [
      `exo__Property_range: "[[${ASSET_A}]]"`,
    ]);
    let r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("BROKEN");
    expect(r.clean).toBe(false);
    expect(r.brokenReason).toMatch(/zero definition-tier/);

    // Zero descriptors (registry dir wiped) with a real fact edge present.
    writeAsset(asA(), ASSET_A, "a__Prop", [
      `exo__Property_range: "[[${ASSET_B}]]"`,
    ]);
    rmSync(registry, { recursive: true, force: true });
    r = await scanAssetSpaceDepends({ vault });
    expect(r.verdict).toBe("BROKEN");
    expect(r.brokenReason).toMatch(/no exo__AssetSpace descriptor/);
  });

  it("--self judges only the self's outgoing facts; an unresolvable definition-tier ref counts as uncovered (N2)", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    // b also references c, undeclared — must NOT count when self = o/a.
    writeAsset(asB(), ASSET_B, "b__Class", [
      `exo__Class_superClass: "[[${ASSET_C}]]"`,
    ]);
    let r = await scanAssetSpaceDepends({ vault, self: "o/a" });
    expect(r.self).toBe("o/a");
    expect(r.verdict).toBe("OK");
    expect(r.facts.edgeCount).toBe(1);
    expect(r.facts.edges[0].source).toBe("o/a");

    // The same vault judged as self = o/b is red (b→c undeclared).
    r = await scanAssetSpaceDepends({ vault, self: "o/b" });
    expect(r.verdict).toBe("FAIL");
    expect(r.facts.edges[0]).toMatchObject({
      source: "o/b",
      target: "o/c",
      coveredByClosure: false,
    });

    // A reference from self that resolves nowhere = target absent from the merged vault = uncovered.
    writeAsset(asA(), ASSET_A, "a__Prop", [
      `exo__Property_range: "[[${ASSET_B}]]"`,
      `exo__Property_domain: "[[99999999-9999-4999-8999-999999999999]]"`,
    ]);
    r = await scanAssetSpaceDepends({ vault, self: "o/a" });
    expect(r.verdict).toBe("FAIL");
    expect(r.unresolved.count).toBe(1);
    expect(r.unresolved.countedAsUncovered).toBe(true);
    expect(r.facts.uncoveredByClosure).toBe(1);
    expect(r.unresolved.refs[0]).toMatchObject({
      source: "o/a",
      predicate: "exo__Property_domain",
    });

    // The same unresolved ref in vault mode is fail-open (listed, not counted).
    r = await scanAssetSpaceDepends({ vault });
    expect(r.unresolved.count).toBe(1);
    expect(r.unresolved.countedAsUncovered).toBe(false);
  });

  it("--self naming an unregistered AssetSpace is BROKEN; a registered leaf with zero foreign facts is OK", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    let r = await scanAssetSpaceDepends({ vault, self: "o/nope" });
    expect(r.verdict).toBe("BROKEN");
    expect(r.brokenReason).toMatch(/not a registered AssetSpace/);

    // self = o/c: registered, has an asset, references nothing foreign → OK (not BROKEN).
    r = await scanAssetSpaceDepends({ vault, self: "o/c" });
    expect(r.verdict).toBe("OK");
    expect(r.facts.edgeCount).toBe(0);
    expect(r.scannedSources).toBe(1);

    // A full git URL / github.repository form keys the same descriptor.
    r = await scanAssetSpaceDepends({
      vault,
      self: "https://github.com/o/a.git",
    });
    expect(r.self).toBe("o/a");
    expect(r.verdict).toBe("OK");
  });

  it("resolves the symbolic-label channel: a bare `prefix__Local` value is a reference", async () => {
    writeDescriptor(registry, DESC_A, "o/a", []);
    writeAsset(asA(), ASSET_A, "a__Prop", [
      "exo__Property_range: xsd:string", // literal — not a fact
      "exo__Property_domain: c__Class", // symbolic label → resolves to ASSET_C in o/c
    ]);
    const r = await scanAssetSpaceDepends({ vault });
    expect(r.facts.edgeCount).toBe(1);
    expect(r.facts.edges[0]).toMatchObject({ source: "o/a", target: "o/c" });
    expect(r.unresolved.count).toBe(0);
  });

  it("reads descriptors from an explicit --registry checkout outside the vault", async () => {
    const external = join(vault, "..", `as-depends-registry-${Date.now()}`);
    try {
      writeDescriptor(external, DESC_A, "o/a", [DESC_B]);
      writeDescriptor(external, DESC_B, "o/b", []);
      rmSync(registry, { recursive: true, force: true });
      const r = await scanAssetSpaceDepends({ vault, registry: external });
      expect(r.registrySource).toBe(external);
      expect(r.descriptors.count).toBe(2);
      expect(r.verdict).toBe("OK");
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("keys AssetSpaces by owner/repo from the path prefix", () => {
    expect(assetspaceOfPath("assetspaces/kitelev/exoas-exo/exo/x.md")).toBe(
      "kitelev/exoas-exo",
    );
    expect(assetspaceOfPath("assetspaces/Mudriy/exoas-tbank/tbank/x.md")).toBe(
      "mudriy/exoas-tbank",
    );
    expect(assetspaceOfPath("01 Inbox/x.md")).toBeNull();
    expect(assetspaceOfPath("assetspaces/kitelev/x.md")).toBeNull();
  });
});

/**
 * Command-action axis: the SAME flip driven through the Commander action
 * (`parseAsync`), so the exit code and the printed text are locked, not only
 * the scan result. Every number is printed with its scope label (AC4).
 */
describe("audit assetspace-depends — command action (exit code + text output)", () => {
  let vault: string;
  let registry: string;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;
  let prevExit: typeof process.exitCode;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `as-depends-action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    registry = join(vault, "assetspaces", "o", "registry", "registry");
    mkdirSync(vault, { recursive: true });
    writeAsset(join(vault, "assetspaces", "o", "a"), ASSET_A, "a__Prop", [
      `exo__Property_range: "[[${ASSET_B}]]"`,
    ]);
    writeAsset(join(vault, "assetspaces", "o", "b"), ASSET_B, "b__Class");
    writeDescriptor(registry, DESC_B, "o/b", []);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    prevExit = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExit;
    rmSync(vault, { recursive: true, force: true });
  });

  const output = () =>
    [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");

  it("@req:04208713-cdd5-4438-b910-215c0cf52382 exit 1 + FAIL line naming BOTH numbers with the vault scope label when the fact is uncovered", async () => {
    writeDescriptor(registry, DESC_A, "o/a", []);
    await auditAssetSpaceDependsCommand().parseAsync(["--vault", vault], {
      from: "user",
    });
    expect(process.exitCode).toBe(1);
    const out = output();
    expect(out).toMatch(/^FAIL /m);
    expect(out).toMatch(/uncovered by CLOSURE: 1 \(verdict\)/);
    expect(out).toMatch(/uncovered DIRECTLY: 1 \(informational/);
    // scope label = the measured vault's basename, tier named
    expect(out).toContain(`[${vault.split("/").pop()}, tier=definitions]`);
    expect(out).toMatch(/o\/a\s*→\s*o\/b/);
  });

  it("exit 0 + OK line once the declaration covers the fact; json output carries the same two numbers", async () => {
    writeDescriptor(registry, DESC_A, "o/a", [DESC_B]);
    await auditAssetSpaceDependsCommand().parseAsync(["--vault", vault], {
      from: "user",
    });
    expect(process.exitCode).toBeFalsy();
    expect(output()).toMatch(
      /^OK .*uncovered by CLOSURE: 0 \(verdict\), uncovered DIRECTLY: 0/m,
    );

    logSpy.mockClear();
    errSpy.mockClear();
    await auditAssetSpaceDependsCommand().parseAsync(
      ["--vault", vault, "--output", "json"],
      { from: "user" },
    );
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      verdict: string;
      vaultPath: string;
      facts: { uncoveredByClosure: number; uncoveredDirect: number };
    };
    expect(parsed.verdict).toBe("OK");
    expect(parsed.vaultPath).toBe(vault);
    expect(parsed.facts).toMatchObject({
      uncoveredByClosure: 0,
      uncoveredDirect: 0,
    });
  });

  it("exit 2 + BROKEN when there is no descriptor to judge against (never a clean zero)", async () => {
    rmSync(registry, { recursive: true, force: true });
    await auditAssetSpaceDependsCommand().parseAsync(["--vault", vault], {
      from: "user",
    });
    expect(process.exitCode).toBe(2);
    expect(output()).toMatch(/^BROKEN /m);
    expect(output()).toMatch(/no exo__AssetSpace descriptor found/);
  });
});
