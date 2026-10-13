import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as nodeFs from "fs";
import fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

/**
 * Ticket 0a7ddb0d — the CLI vault walk follows a directory SYMLINK that leads
 * OUT of the vault, so a vault whose `assetspaces/` is a link reads the files
 * behind it (before: a symlink's Dirent answers `false` to both `isDirectory()`
 * and `isFile()`, the link was dropped without a word, and `resolve-buttons`
 * printed 0 commands with rc 0 on such a copy).
 *
 * ⛔ REAL filesystem in a temp dir, NOT a stubbed `readdirSync`: the defect
 * lives in what a real `Dirent` of a symlink answers, so a stub would be
 * vacuous by construction.
 *
 * Literal @req token for requirements-trace's static scanner:
 * @req:<REQ-UID — assigned when the requirement asset is created (StageImplementation)>
 */

const { FileSystemVaultAdapter } =
  await import("../../src/adapters/FileSystemVaultAdapter.js");
const { resolveButtons } =
  await import("../../src/commands/resolve-buttons.js");
const { collectVaultSpecs } =
  await import("../../src/commands/exosync-parity.js");

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

function write(
  file: string,
  content = "---\nexo__Asset_label: x\n---\n",
): void {
  nodeFs.mkdirSync(path.dirname(file), { recursive: true });
  nodeFs.writeFileSync(file, content, "utf-8");
}

function walk(root: string): string[] {
  return new FileSystemVaultAdapter(root)
    .getAllFiles()
    .map((f: { path: string }) => f.path);
}

/** Each element exactly once (a loop or a diamond would repeat files). */
function counts(paths: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of paths) m.set(p, (m.get(p) ?? 0) + 1);
  return m;
}

describe("walkDirectory follows outward directory symlinks (ticket 0a7ddb0d)", () => {
  let base: string;

  beforeEach(() => {
    base = nodeFs.mkdtempSync(path.join(os.tmpdir(), "exo-walk-symlink-"));
  });

  afterEach(() => {
    if (base) nodeFs.rmSync(base, { recursive: true, force: true });
  });

  /** The external tree the link points to (outside every vault below). */
  function externalTree(): string {
    const ext = path.join(base, "external", "assetspaces");
    write(path.join(ext, "kitelev", "exoas-x", "x", "n1.md"));
    write(path.join(ext, "kitelev", "exoas-x", "x", "n2.md"));
    write(path.join(ext, "kitelev", "exoas-y", "y", "deep", "n3.md"));
    write(path.join(ext, ".hidden", "ignored.md"));
    return ext;
  }

  /** Root files sort BEFORE and AFTER `assetspaces`: order is part of the claim. */
  function vaultShell(name: string): string {
    const root = path.join(base, name);
    write(path.join(root, "aaa.md"));
    write(path.join(root, "zzz", "last.md"));
    return root;
  }

  it("S1 a vault whose assetspaces/ is an outward link walks the SAME relative paths in the SAME order as a real directory", () => {
    const ext = externalTree();
    const control = vaultShell("control");
    nodeFs.cpSync(ext, path.join(control, "assetspaces"), { recursive: true });
    const linked = vaultShell("linked");
    nodeFs.symlinkSync(ext, path.join(linked, "assetspaces"));

    const expected = walk(control);
    expect(expected.filter((p) => p.startsWith("assetspaces"))).toHaveLength(3);
    expect(walk(linked)).toEqual(expected);
  });

  it("S3 a loop inside the external tree terminates and yields each external file exactly once", () => {
    const extA = path.join(base, "extdir", "a");
    write(path.join(extA, "ext1.md"));
    write(path.join(extA, "b", "ext2.md"));
    nodeFs.symlinkSync(extA, path.join(extA, "b", "back-to-a"));
    const root = vaultShell("v");
    nodeFs.symlinkSync(extA, path.join(root, "zext"));

    const got = walk(root);
    // ⛔ Conjunct first: without it the axis is green on the pre-fix walk,
    // which follows no link at all and therefore repeats nothing.
    expect(got).toContain(path.join("zext", "ext1.md"));
    expect(got).toContain(path.join("zext", "b", "ext2.md"));
    for (const [, n] of counts(got)) expect(n).toBe(1);
    expect(got).toHaveLength(4);
  }, 10_000);

  /** An inside tree: `a-link` (sorts BEFORE `real`) points at `real`, `real/up` at the root. */
  function insideTree(): string {
    const realRoot = path.join(base, "realroot");
    write(path.join(realRoot, "real", "n1.md"));
    write(path.join(realRoot, "real", "sub", "n2.md"));
    // Absolute target through the REAL path: the inside test compares real paths.
    nodeFs.symlinkSync(
      path.join(nodeFs.realpathSync(realRoot), "real"),
      path.join(realRoot, "a-link"),
    );
    nodeFs.symlinkSync("..", path.join(realRoot, "real", "up"));
    return realRoot;
  }

  it("S4 a link that stays INSIDE the vault is not followed, even when it sorts before the real directory", () => {
    const realRoot = insideTree();

    expect(walk(nodeFs.realpathSync(realRoot))).toEqual([
      path.join("real", "n1.md"),
      path.join("real", "sub", "n2.md"),
    ]);
  });

  it("S13 the same inside link is still recognised when the vault ROOT itself is opened through a link", () => {
    const realRoot = insideTree();
    const rootLink = path.join(base, "rootlink");
    nodeFs.symlinkSync(realRoot, rootLink);

    expect(walk(rootLink)).toEqual([
      path.join("real", "n1.md"),
      path.join("real", "sub", "n2.md"),
    ]);
  });

  it("S5 several links into one external tree (diamond, link to a parent) yield each file once, under the first by order", () => {
    const ext = path.join(base, "extdir");
    write(path.join(ext, "top.md"));
    write(path.join(ext, "a", "ext1.md"));
    write(path.join(ext, "a", "b", "ext2.md"));
    const root = vaultShell("v");
    // Both orders on purpose: a link to the SUBDIR first, then a link to its
    // PARENT (whose plain child `a` must be recognised as already walked), then
    // a second link to the subdir (a diamond).
    nodeFs.symlinkSync(path.join(ext, "a"), path.join(root, "zext0"));
    nodeFs.symlinkSync(ext, path.join(root, "zext1"));
    nodeFs.symlinkSync(path.join(ext, "a"), path.join(root, "zext2"));

    expect(walk(root)).toEqual([
      "aaa.md",
      path.join("zext0", "b", "ext2.md"),
      path.join("zext0", "ext1.md"),
      path.join("zext1", "top.md"),
      path.join("zzz", "last.md"),
    ]);
  });

  it("S6 a dangling link and a self-referential link are skipped without an exception", () => {
    const root = vaultShell("v");
    nodeFs.symlinkSync(path.join(base, "nowhere"), path.join(root, "dangling"));
    nodeFs.symlinkSync(path.join(root, "self"), path.join(root, "self"));

    expect(walk(root)).toEqual(["aaa.md", path.join("zzz", "last.md")]);
  });

  it("S7 a HIDDEN outward link is not followed (same rule as hidden directories)", () => {
    const ext = externalTree();
    const root = vaultShell("v");
    nodeFs.symlinkSync(ext, path.join(root, ".assetspaces"));

    expect(walk(root)).toEqual(["aaa.md", path.join("zzz", "last.md")]);
  });

  it("S9 a link to an ANCESTOR of the vault is not followed — written as the ancestor, or reaching it through a hop", () => {
    const root = vaultShell("v");
    write(path.join(base, "outside.md"));
    nodeFs.symlinkSync(base, path.join(root, "up"));
    // The hop's TEXT names an unrelated folder; only the resolved target
    // reveals the ancestor — the resolved-target rule is the one under test.
    const hop = path.join(base, "hops", "to-base");
    nodeFs.mkdirSync(path.dirname(hop), { recursive: true });
    nodeFs.symlinkSync(base, hop);
    nodeFs.symlinkSync(hop, path.join(root, "zz-hop"));

    expect(walk(root)).toEqual(["aaa.md", path.join("zzz", "last.md")]);
  });

  it("S10 a FILE link stays skipped (the sanction covers directory links only)", () => {
    const root = vaultShell("v");
    write(path.join(base, "outside-note.md"));
    nodeFs.symlinkSync(
      path.join(base, "outside-note.md"),
      path.join(root, "file-link.md"),
    );

    expect(walk(root)).toEqual(["aaa.md", path.join("zzz", "last.md")]);
  });

  it("S11 a vault WITHOUT links costs the walk no extra stat/realpath call", () => {
    const root = vaultShell("v");
    write(path.join(root, "m", "n.md"));
    const statSpy = jest.spyOn(fs, "statSync");
    const realSpy = jest.spyOn(fs.realpathSync, "native");
    try {
      expect(walk(root)).toHaveLength(3);
      expect(statSpy).not.toHaveBeenCalled();
      expect(realSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      realSpy.mockRestore();
    }
  });

  it("S11b a FIFO in the vault is skipped without any stat/realpath call", () => {
    const root = vaultShell("v");
    execFileSync("mkfifo", [path.join(root, "pipe.md")]);
    const statSpy = jest.spyOn(fs, "statSync");
    const realSpy = jest.spyOn(fs.realpathSync, "native");
    try {
      expect(walk(root)).toEqual(["aaa.md", path.join("zzz", "last.md")]);
      expect(statSpy).not.toHaveBeenCalled();
      expect(realSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      realSpy.mockRestore();
    }
  });

  it("S12 a vault opened in ANOTHER letter case still treats an inside link as inside (case-insensitive FS only)", () => {
    const realRoot = path.join(base, "CaseRoot");
    write(path.join(realRoot, "real", "n1.md"));
    nodeFs.symlinkSync(
      path.join(nodeFs.realpathSync(realRoot), "real"),
      path.join(realRoot, "a-link"),
    );
    const swapped = path.join(base, "caseroot");
    // ⛤ On a case-SENSITIVE filesystem (Linux CI) the swapped path does not
    // exist and the case the axis guards cannot occur — stated, not hidden.
    if (!nodeFs.existsSync(swapped)) return;

    expect(walk(swapped)).toEqual([path.join("real", "n1.md")]);
  });

  it("S14 files right under an outward link are reported under the LOGICAL path", () => {
    const flat = path.join(base, "flat");
    write(path.join(flat, "f.md"));
    const root = vaultShell("v");
    nodeFs.symlinkSync(flat, path.join(root, "notes"));

    expect(walk(root)).toEqual([
      "aaa.md",
      path.join("notes", "f.md"),
      path.join("zzz", "last.md"),
    ]);
  });

  it("S15 no reported path leaves the vault, whatever links it holds", () => {
    const ext = externalTree();
    const flat = path.join(base, "flat");
    write(path.join(flat, "f.md"));
    const root = vaultShell("v");
    nodeFs.symlinkSync(ext, path.join(root, "assetspaces"));
    nodeFs.symlinkSync(flat, path.join(root, "notes"));
    nodeFs.symlinkSync(base, path.join(root, "up"));

    for (const p of walk(root)) {
      expect(
        p === ".." || p.startsWith(`..${path.sep}`) || path.isAbsolute(p),
      ).toBe(false);
    }
  });

  it("S16 links INSIDE the external tree are judged by the same rules: a hop back into the vault is not followed", () => {
    const root = vaultShell("v");
    write(path.join(root, "real", "n1.md"));
    const ext = path.join(base, "extdir");
    write(path.join(ext, "a", "ext1.md"));
    // `back`'s TEXT points at `hop` (outside the vault); `hop` resolves into
    // the vault — only the resolved-target rule can tell.
    nodeFs.symlinkSync(path.join(root, "real"), path.join(ext, "hop"));
    nodeFs.symlinkSync(path.join(ext, "hop"), path.join(ext, "a", "back"));
    nodeFs.symlinkSync(path.join(ext, "a"), path.join(root, "zext"));

    expect(walk(root)).toEqual([
      "aaa.md",
      path.join("real", "n1.md"),
      path.join("zext", "ext1.md"),
      path.join("zzz", "last.md"),
    ]);
  });

  it("S17 a link whose target is written in ANOTHER letter case still counts as inside (case-insensitive FS only)", () => {
    const realRoot = path.join(nodeFs.realpathSync(base), "CaseLink");
    write(path.join(realRoot, "real", "n1.md"));
    const swapped = path.join(nodeFs.realpathSync(base), "caselink");
    // ⛤ On a case-SENSITIVE filesystem the other spelling does not exist and
    // the case cannot occur — stated, not hidden.
    if (!nodeFs.existsSync(swapped)) return;
    nodeFs.symlinkSync(
      path.join(swapped, "real"),
      path.join(realRoot, "a-link"),
    );

    expect(walk(realRoot)).toEqual([path.join("real", "n1.md")]);
  });

  it("S18 a vault-relative link next to an outward assetspaces link does not take over the paths behind it", () => {
    const ext = externalTree();
    // Inside the external tree: a link whose text climbs to the vault's own
    // `inbox` — in the ORIGINAL vault it stays inside and is skipped.
    write(path.join(base, "external", "inbox", "i.md"));
    nodeFs.symlinkSync(
      path.join("..", "..", "inbox"),
      path.join(ext, "kitelev", "shortcut"),
    );
    const control = vaultShell("control");
    nodeFs.cpSync(ext, path.join(control, "assetspaces"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    nodeFs.symlinkSync(
      path.join("assetspaces", "kitelev", "exoas-x"),
      path.join(control, "0-short"),
    );
    const linked = vaultShell("linked");
    nodeFs.symlinkSync(ext, path.join(linked, "assetspaces"));
    nodeFs.symlinkSync(
      path.join("assetspaces", "kitelev", "exoas-x"),
      path.join(linked, "0-short"),
    );

    const expected = walk(control);
    expect(expected).toContain(
      path.join("assetspaces", "kitelev", "exoas-x", "x", "n1.md"),
    );
    expect(walk(linked)).toEqual(expected);
  });

  /** `readdirSync` that fails with `code` for one directory, real otherwise. */
  function failingReaddir(suffix: string, code: string) {
    const original = fs.readdirSync;
    return jest.spyOn(fs, "readdirSync").mockImplementation(((
      p: nodeFs.PathLike,
      o?: unknown,
    ) => {
      if (String(p).endsWith(suffix)) {
        throw Object.assign(new Error(`${code}: ${String(p)}`), { code });
      }
      return (original as (p: nodeFs.PathLike, o?: unknown) => unknown).call(
        fs,
        p,
        o,
      );
    }) as unknown as typeof fs.readdirSync);
  }

  it("S19a a read failure INSIDE a followed external tree skips that folder instead of failing the walk", () => {
    const ext = path.join(base, "extdir");
    write(path.join(ext, "ext1.md"));
    write(path.join(ext, "b", "ext2.md"));
    const root = vaultShell("v");
    nodeFs.symlinkSync(ext, path.join(root, "zext"));
    const spy = failingReaddir(path.join("zext", "b"), "ENAMETOOLONG");
    try {
      expect(walk(root)).toEqual([
        "aaa.md",
        path.join("zext", "ext1.md"),
        path.join("zzz", "last.md"),
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("S19b the same failure on a folder of the vault itself still fails the walk (unchanged)", () => {
    const root = vaultShell("v");
    const spy = failingReaddir(path.join("v", "zzz"), "ENAMETOOLONG");
    try {
      expect(() => walk(root)).toThrow("ENAMETOOLONG");
    } finally {
      spy.mockRestore();
    }
  });

  const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
  const declaration = (repo: string) =>
    `---\nexo__Asset_uid: decl-${repo}\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/test-owner/${repo}\n---\n\nDeclaration\n`;

  /** A registry declaration plus its materialized mount, under `<dir>`. */
  function spaceTree(dir: string): void {
    write(
      path.join(dir, "kitelev", "exoas-registry", "registry", "decl.md"),
      declaration("exoas-x"),
    );
    write(path.join(dir, "test-owner", "exoas-x", "a.md"));
  }

  /** The ticket's copy: `linked/assetspaces` → the external tree; and its real-folder control. */
  function syncCopies(): { control: string; linked: string } {
    const ext = path.join(base, "external", "assetspaces");
    spaceTree(ext);
    const control = vaultShell("control");
    spaceTree(path.join(control, "assetspaces"));
    const linked = vaultShell("linked");
    nodeFs.symlinkSync(ext, path.join(linked, "assetspaces"));
    return { control, linked };
  }

  it("S20a sync collection: declarations reached through an outward link are NOT sync units of the copy", () => {
    const { control, linked } = syncCopies();

    expect(collectVaultSpecs(control).specs.map((s) => s.localPath)).toEqual([
      path.join("assetspaces", "test-owner", "exoas-x"),
    ]);
    expect(collectVaultSpecs(linked).specs).toEqual([]);
  });

  it("S20c sync collection: the skip is named in the warnings, not silent", () => {
    const { control, linked } = syncCopies();

    expect(collectVaultSpecs(control).warnings.join("\n")).not.toContain(
      "symbolic link",
    );
    expect(collectVaultSpecs(linked).warnings.join("\n")).toContain(
      "1 space declaration(s) lie behind a symbolic link to outside this vault",
    );
  });

  it("S20b sync collection: a MOUNT folder that is itself a link, declared by a real file, is enumerated as before", () => {
    const root = vaultShell("v");
    write(path.join(root, "decl.md"), declaration("exoas-x"));
    write(path.join(base, "mounts", "exoas-x", "a.md"));
    nodeFs.mkdirSync(path.join(root, "assetspaces", "test-owner"), {
      recursive: true,
    });
    nodeFs.symlinkSync(
      path.join(base, "mounts", "exoas-x"),
      path.join(root, "assetspaces", "test-owner", "exoas-x"),
    );

    const got = collectVaultSpecs(root);
    expect(got.specs.map((s) => s.localPath)).toEqual([
      path.join("assetspaces", "test-owner", "exoas-x"),
    ]);
    expect(got.warnings.join("\n")).not.toContain("symbolic link");
  });
});

// ---------------------------------------------------------------------------
// S2 — the ticket's own symptom, end to end through `resolve-buttons`.
// ---------------------------------------------------------------------------

const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";
const CLASS_W = "0a7d0001-0000-0000-0000-000000000001";
const CMD_SHOWN = "0a7d0002-0000-0000-0000-000000000001";
const CMD_HIDDEN = "0a7d0002-0000-0000-0000-000000000002";
const GND = "0a7d0003-0000-0000-0000-000000000001";
const PRE_NEVER = "0a7d0004-0000-0000-0000-000000000001";
const BIND_SHOWN = "0a7d0005-0000-0000-0000-000000000001";
const BIND_HIDDEN = "0a7d0005-0000-0000-0000-000000000002";
const TARGET = "0a7d0006-0000-0000-0000-000000000001";

/** TBox and the target live under `assetspaces/`, as in the ticket's measurement. */
function writeAssetspaces(dir: string): void {
  const put = (uid: string, md: string) =>
    write(path.join(dir, "kitelev", "exoas-w", "w", `${uid}.md`), md);
  put(
    CLASS_W,
    fm([
      `exo__Asset_uid: ${CLASS_W}`,
      `exo__Asset_label: test__Widget`,
      `exo__Instance_class: ["[[exo__Class]]"]`,
    ]),
  );
  put(
    GND,
    fm([
      `exo__Asset_uid: ${GND}`,
      `exo__Asset_label: "g"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
      `exocmd__Grounding_serviceId: "noop"`,
    ]),
  );
  put(
    PRE_NEVER,
    fm([
      `exo__Asset_uid: ${PRE_NEVER}`,
      `exo__Asset_label: "never"`,
      `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
      `exocmd__Precondition_sparqlAsk: 'ASK { $target <urn:never> ?x }'`,
    ]),
  );
  const cmd = (uid: string, label: string, cli: string, pre?: string) =>
    fm([
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
      `exo__Instance_class: ["[[exocmd__Command]]"]`,
      `exocmd__Command_cliName: ${cli}`,
      `exocmd__Command_category: create`,
      `exocmd__Command_grounding: "[[${GND}|g]]"`,
      ...(pre ? [`exocmd__Command_precondition: "[[${pre}|p]]"`] : []),
    ]);
  put(CMD_SHOWN, cmd(CMD_SHOWN, "Shown", "shown"));
  put(CMD_HIDDEN, cmd(CMD_HIDDEN, "Hidden", "hidden", PRE_NEVER));
  const bind = (uid: string, c: string, order: number) =>
    fm([
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "binding ${uid}"`,
      `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
      `exocmd__CommandBinding_command: "[[${c}]]"`,
      `exocmd__CommandBinding_targetClass: test__Widget`,
      `exocmd__CommandBinding_position: inline`,
      `exocmd__CommandBinding_order: ${order}`,
    ]);
  put(BIND_SHOWN, bind(BIND_SHOWN, CMD_SHOWN, 10));
  put(BIND_HIDDEN, bind(BIND_HIDDEN, CMD_HIDDEN, 20));
  put(
    TARGET,
    fm([
      `exo__Asset_uid: ${TARGET}`,
      `exo__Asset_label: "w"`,
      `exo__Instance_class: ["[[${CLASS_W}]]"]`,
    ]),
  );
}

describe("S2 resolve-buttons on a vault whose assetspaces/ is an outward link (ticket 0a7ddb0d)", () => {
  let base: string;

  beforeEach(() => {
    base = nodeFs.mkdtempSync(path.join(os.tmpdir(), "exo-walk-symlink-rb-"));
  });

  afterEach(() => {
    if (base) nodeFs.rmSync(base, { recursive: true, force: true });
  });

  const target = path.join(
    "assetspaces",
    "kitelev",
    "exoas-w",
    "w",
    `${TARGET}.md`,
  );
  const names = (r: {
    visible: readonly { readonly cliName: string | null }[];
    hidden: readonly { readonly cliName: string | null }[];
  }) => ({
    visible: r.visible.map((e) => e.cliName).sort(),
    hidden: r.hidden.map((e) => e.cliName).sort(),
  });

  for (const useCache of [false, true]) {
    it(`S2${useCache ? "b" : "a"} visible/hidden equal the real-directory control and are non-empty (useCache=${useCache})`, async () => {
      const control = path.join(base, "control");
      writeAssetspaces(path.join(control, "assetspaces"));
      const ext = path.join(base, "external", "assetspaces");
      writeAssetspaces(ext);
      const linked = path.join(base, "linked");
      nodeFs.mkdirSync(linked);
      nodeFs.symlinkSync(ext, path.join(linked, "assetspaces"));

      const want = names(
        await resolveButtons(control, target, undefined, { useCache }),
      );
      expect(want).toEqual({ visible: ["shown"], hidden: ["hidden"] });
      expect(
        names(await resolveButtons(linked, target, undefined, { useCache })),
      ).toEqual(want);
    }, 30_000);
  }
});
