/**
 * Integration test (req 960d7a3f, ticket da0f73a3 / S7): the archive flag's
 * canonical frontmatter key is the TBox-declared `exo__Asset_archived`; the
 * legacy bare `archived:` is READ (indexed under the SAME predicate
 * `exo:Asset_archived`) but never WRITTEN — every writer emits the declared key
 * and drops the bare one, and removing the flag clears both spellings.
 *
 * Production-shape: markdown fixtures run through the REAL
 * `NoteToRDFConverter.convertVault()` (Scenarios A/B), the REAL
 * `ArchiveAssetService` (Scenario C) and the REAL
 * `CommandResolver.loadCommand()` → `GroundingExecutor.execute()` pipeline for
 * the homoiconic `property_set` / `property_delete` groundings whose
 * `targetProperty` is still the bare name (Scenarios C/D) — the exact path the
 * `archive` / `un-archive` exocmd commands take in the CLI and the plugin.
 *
 * @req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee
 *
 * REVERT-VERIFY (integration-test-revert-verify) — each axis has a mutant that
 * reddens ONLY it (flip results recorded in the PR body):
 *  - A  drop `archived` from LEGACY_UNPREFIXED_ASSET_FIELDS (converter read) →
 *       "legacy bare key indexes as exo:Asset_archived" RED.
 *  - B  put `archived` back into UNPREFIXED_ASSET_FIELDS (canonical = bare) →
 *       "canonicalYamlKey keeps exo__Asset_archived prefixed" RED.
 *  - C1 make `canonicalYamlKey` return bare `archived` unchanged →
 *       "writer upgrades a bare input" + grounding property_set axes RED.
 *  - C2 drop the `removeLegacyKeys` call from `updateProperty` →
 *       "pre-existing bare key is dropped by the write" RED.
 *  - D  drop the `removeLegacyKeys` call from `removeProperty` →
 *       "removal clears the legacy carrier" RED.
 *  - R  reorder / drop a key in `MetadataHelpers.ARCHIVED_FLAG_KEYS` →
 *       the reader axis RED.
 *  - M1 drop the "skip legacy when canonical present" guard in the converter
 *       emission loop → "both keys, different values → ONE triple" RED.
 *  - L2 drop the leading-blank-line strip in `removeLegacyKeys` → "legacy key
 *       on the first line leaves no blank line" RED.
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../src/services/GroundingExecutor";
import {
  NoteToRDFConverter,
  canonicalYamlKey,
  LEGACY_UNPREFIXED_ASSET_FIELDS,
  UNPREFIXED_ASSET_FIELDS,
} from "../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../src/services/CommandResolver";
import { ArchiveAssetService } from "../../src/services/ArchiveAssetService";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { installDefaultResolvers } from "../../src/services/SubstitutionResolverRegistry";
import { Namespace } from "../../src/domain/models/rdf/Namespace";
import { IRI } from "../../src/domain/models/rdf/IRI";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../src/interfaces/IFileSystemAdapter";
import {
  IVaultAdapter,
  IFile,
  IFolder,
  IFrontmatter,
} from "../../src/interfaces/IVaultAdapter";

// ---------------------------------------------------------------------------
// In-memory fs + vault adapter (mirrors unarchive-grounding.integration)
// ---------------------------------------------------------------------------

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).filter((p) => p.endsWith(".md"));
  }
  async createFile(path: string, content: string): Promise<string> {
    this.files.set(path, content);
    return path;
  }
  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
  getContent(path: string): string | undefined {
    return this.files.get(path);
  }
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.substring(0, colonIndex).trim();
    const rawValue = line.substring(colonIndex + 1).trim();
    if (rawValue === "") {
      const arrayValues: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.startsWith("  - ")) {
          arrayValues.push(nextLine.substring(4).trim());
        } else {
          break;
        }
      }
      frontmatter[key] = arrayValues.length > 0 ? arrayValues : "";
    } else {
      frontmatter[key] = rawValue;
    }
  }
  return frontmatter;
}

class InMemoryVaultAdapter implements IVaultAdapter {
  constructor(private readonly fs: InMemoryFileSystem) {}
  async read(file: IFile): Promise<string> {
    return this.fs.readFile(file.path);
  }
  async exists(path: string): Promise<boolean> {
    return this.fs.fileExists(path);
  }
  getAllFiles(): IFile[] {
    return this.fs
      .getAllPaths()
      .filter((p) => p.endsWith(".md"))
      .map((p) => this.makeFile(p));
  }
  getAbstractFileByPath(path: string): IFile | IFolder | null {
    return this.fs.getContent(path) !== undefined ? this.makeFile(path) : null;
  }
  async create(path: string, content: string): Promise<IFile> {
    await this.fs.createFile(path, content);
    return this.makeFile(path);
  }
  async modify(file: IFile, newContent: string): Promise<void> {
    await this.fs.updateFile(file.path, newContent);
  }
  async delete(file: IFile): Promise<void> {
    await this.fs.deleteFile(file.path);
  }
  async process(file: IFile, fn: (content: string) => string): Promise<string> {
    const content = await this.fs.readFile(file.path);
    const updated = fn(content);
    await this.fs.updateFile(file.path, updated);
    return updated;
  }
  async rename(file: IFile, newPath: string): Promise<void> {
    await this.fs.renameFile(file.path, newPath);
  }
  async updateLinks(): Promise<void> {}
  async createFolder(): Promise<void> {}
  getDefaultNewFileParent(): IFolder | null {
    return null;
  }
  getFrontmatter(file: IFile): IFrontmatter | null {
    const content = this.fs.getContent(file.path);
    if (!content) return null;
    return parseFrontmatter(content);
  }
  async updateFrontmatter(): Promise<void> {}
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): IFile | null {
    const bare = linkpath.includes("|") ? linkpath.split("|")[0] : linkpath;
    const withMd = bare.endsWith(".md") ? bare : `${bare}.md`;
    for (const path of this.fs.getAllPaths()) {
      const basename = path.split("/").pop()?.replace(".md", "") ?? "";
      if (basename === bare || path === withMd || path.endsWith(`/${withMd}`)) {
        return this.makeFile(path);
      }
    }
    return null;
  }
  makeFile(path: string): IFile {
    const name = path.split("/").pop() || path;
    const basename = name.replace(".md", "");
    const parentPath = path.split("/").slice(0, -1).join("/");
    return {
      path,
      name,
      basename,
      parent: parentPath
        ? { path: parentPath, name: parentPath.split("/").pop() || "" }
        : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture UIDs — the REAL production grounding-type UIDs (exoas-exocmd).
// ---------------------------------------------------------------------------

const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";
const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";

// Fixture-owned command chain — mirrors the production `archive` (e31de8e5)
// and `un-archive` (ec4b6e20) groundings, whose targetProperty is the BARE
// name `archived` (vault data not yet migrated — that is the point of C/D).
const CMD_ARCHIVE = "a1a1a1a1-0000-4000-8000-00000000a001";
const G_ARCHIVE = "a1a1a1a1-0000-4000-8000-00000000a002";
const CMD_UNARCHIVE = "a1a1a1a1-0000-4000-8000-00000000a003";
const G_UNARCHIVE = "a1a1a1a1-0000-4000-8000-00000000a004";

const LEGACY_TASK = "b1b1b1b1-1111-4111-8111-111111111111"; // archived: true
const CANONICAL_TASK = "b2b2b2b2-2222-4222-8222-222222222222"; // exo__Asset_archived: true
const ALIAS_TASK = "b3b3b3b3-3333-4333-8333-333333333333"; // exo__Asset_isArchived: true (0 real carriers)
const ACTIVE_TASK = "b4b4b4b4-4444-4444-8444-444444444444"; // no flag
const BOTH_TASK = "b5b5b5b5-5555-4555-8555-555555555555"; // exo__Asset_archived: false + archived: true (past the chokepoint)

const DIR = "assetspaces/my";
const path = (uid: string): string => `${DIR}/${uid}.md`;
const iri = (uid: string): string => `obsidian://vault/${path(uid)}`;
const ARCHIVED_PRED = Namespace.EXO.term("Asset_archived").value;
const IS_ARCHIVED_PRED = Namespace.EXO.term("Asset_isArchived").value;

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

function task(uid: string, label: string, ...flagLines: string[]): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    'exo__Asset_isDefinedBy: "[[!kitelev]]"',
    "exo__Instance_class:",
    `  - "[[${CLS_TASK}]]"`,
    `exo__Asset_label: "${label}"`,
    ...flagLines,
    "aliases:",
    `  - "${label}"`,
    "---",
    "",
    "Body notes.",
  ].join("\n");
}

async function seedVault(fs: InMemoryFileSystem): Promise<void> {
  const files: Array<[string, string]> = [
    [
      path(CLS_TASK),
      fm(
        `exo__Asset_uid: ${CLS_TASK}`,
        "exo__Asset_label: ems__Task",
        'exo__Instance_class:\n  - "[[exo__Class]]"',
      ),
    ],
    // ---- archive: property_set on the BARE name (production data shape) ----
    [
      path(G_ARCHIVE),
      fm(
        `exo__Asset_uid: ${G_ARCHIVE}`,
        'exo__Asset_label: "Archive: set the archived flag"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
        "exocmd__Grounding_targetProperty: archived",
        'exocmd__Grounding_targetValueLiteral: "true"',
      ),
    ],
    [
      path(CMD_ARCHIVE),
      fm(
        `exo__Asset_uid: ${CMD_ARCHIVE}`,
        'exo__Asset_label: "Archive"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${G_ARCHIVE}]]"`,
        "exocmd__Command_cliName: archive",
        "exocmd__Command_category: status",
      ),
    ],
    // ---- un-archive: property_delete on the BARE name ----
    [
      path(G_UNARCHIVE),
      fm(
        `exo__Asset_uid: ${G_UNARCHIVE}`,
        'exo__Asset_label: "Un-archive: remove the archived flag"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
        "exocmd__Grounding_targetProperty: archived",
      ),
    ],
    [
      path(CMD_UNARCHIVE),
      fm(
        `exo__Asset_uid: ${CMD_UNARCHIVE}`,
        'exo__Asset_label: "Un-archive"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${G_UNARCHIVE}]]"`,
        "exocmd__Command_cliName: un-archive",
        "exocmd__Command_category: status",
      ),
    ],
    // ---- carriers: one per spelling + one active ----
    [path(LEGACY_TASK), task(LEGACY_TASK, "Legacy carrier", "archived: true")],
    [
      path(CANONICAL_TASK),
      task(CANONICAL_TASK, "Canonical carrier", "exo__Asset_archived: true"),
    ],
    [
      path(ALIAS_TASK),
      task(ALIAS_TASK, "Alias carrier", "exo__Asset_isArchived: true"),
    ],
    [path(ACTIVE_TASK), task(ACTIVE_TASK, "Active task")],
    // Both spellings with DIFFERENT values — reachable only past the chokepoint
    // (Obsidian Properties panel, external tools); canonical must win everywhere.
    [
      path(BOTH_TASK),
      task(BOTH_TASK, "Both carrier", "exo__Asset_archived: false", "archived: true"),
    ],
  ];
  for (const [p, content] of files) {
    await fs.createFile(p, content);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration (req 960d7a3f): exo__Asset_archived is the canonical archive-flag key", () => {
  let fs: InMemoryFileSystem;
  let vault: InMemoryVaultAdapter;
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(async () => {
    installDefaultResolvers();
    fs = new InMemoryFileSystem();
    await seedVault(fs);
    vault = new InMemoryVaultAdapter(fs);
    const converter = new NoteToRDFConverter(vault);
    store = new InMemoryTripleStore();
    await store.addAll(await converter.convertVault());
    resolver = new CommandResolver(store);
  });

  const objectsOf = async (
    from: InMemoryTripleStore,
    uid: string,
    predicate: string,
  ): Promise<string[]> => {
    const triples = await from.match(new IRI(iri(uid)), new IRI(predicate), undefined);
    // Literal.toString() renders the N-Triples form (`"true"`); compare the
    // lexical value, which is what the SPARQL preconditions match on.
    return triples.map((t) => ("value" in t.object ? String(t.object.value) : t.object.toString()));
  };
  const archivedObjects = (uid: string, predicate: string) =>
    objectsOf(store, uid, predicate);

  // ── Scenario A ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee legacy bare `archived: true` still indexes as exo:Asset_archived \"true\"", async () => {
    expect(await archivedObjects(LEGACY_TASK, ARCHIVED_PRED)).toEqual(["true"]);
    expect(await archivedObjects(LEGACY_TASK, IS_ARCHIVED_PRED)).toEqual([]);
    // The whitelist split that carries this: `archived` is LEGACY-read, not canonical-bare.
    expect(LEGACY_UNPREFIXED_ASSET_FIELDS.has("archived")).toBe(true);
    expect(UNPREFIXED_ASSET_FIELDS.has("archived")).toBe(false);
  });

  // ── Scenario B ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee canonical `exo__Asset_archived: true` indexes under the SAME predicate and keeps its prefixed key", async () => {
    expect(await archivedObjects(CANONICAL_TASK, ARCHIVED_PRED)).toEqual(["true"]);
    // Byte-identical predicate + literal to the legacy carrier (Scenario A).
    expect(await archivedObjects(CANONICAL_TASK, ARCHIVED_PRED)).toEqual(
      await archivedObjects(LEGACY_TASK, ARCHIVED_PRED),
    );
    expect(canonicalYamlKey("exo__Asset_archived")).toBe("exo__Asset_archived");
    // Negative controls: the remaining whitelist still canonicalises to bare;
    // the alias spelling is NOT rewritten either way.
    expect(canonicalYamlKey("exo__Asset_draft")).toBe("draft");
    expect(canonicalYamlKey("exo__Asset_aliases")).toBe("aliases");
    expect(canonicalYamlKey("exo__Asset_isArchived")).toBe("exo__Asset_isArchived");
    // The alias spelling is a DIFFERENT predicate — preconditions do not see it.
    expect(await archivedObjects(ALIAS_TASK, ARCHIVED_PRED)).toEqual([]);
    expect(await archivedObjects(ALIAS_TASK, IS_ARCHIVED_PRED)).toEqual(["true"]);
  });

  // ── M1: both spellings coexist → canonical wins in the GRAPH too ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee both keys with DIFFERENT values emit exactly ONE exo:Asset_archived triple = the canonical value", async () => {
    // Graph: one triple, the canonical `false` — the legacy `true` is skipped,
    // mirroring MetadataHelpers.ARCHIVED_FLAG_KEYS priority so readers,
    // exocmd preconditions and GraphQueryService agree.
    expect(await archivedObjects(BOTH_TASK, ARCHIVED_PRED)).toEqual(["false"]);
    // Reader agrees (canonical false is not overridden by legacy true).
    const meta = vault.getFrontmatter(vault.makeFile(path(BOTH_TASK)))!;
    expect(MetadataHelpers.isAssetArchived(meta)).toBe(false);
    // Control: a legacy-only carrier still emits its own value (guard is scoped).
    expect(await archivedObjects(LEGACY_TASK, ARCHIVED_PRED)).toEqual(["true"]);
  });

  // ── L2: migrating a legacy key that LEADS the frontmatter leaves no blank line ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee a legacy `archived` on the first frontmatter line migrates without leaving a blank first line (exact bytes)", () => {
    const fmService = new FrontmatterService();
    const legacyFirst = "---\narchived: true\nfoo: bar\n---\nBody";
    expect(fmService.updateProperty(legacyFirst, "exo__Asset_archived", "true")).toBe(
      "---\nfoo: bar\nexo__Asset_archived: true\n---\nBody",
    );
    expect(fmService.removeProperty(legacyFirst, "exo__Asset_archived")).toBe(
      "---\nfoo: bar\n---\nBody",
    );
    // A legacy key in the middle keeps the surrounding lines byte-identical.
    expect(
      fmService.updateProperty("---\nfoo: bar\narchived: true\nbaz: 1\n---\nBody", "exo__Asset_archived", "true"),
    ).toBe("---\nfoo: bar\nbaz: 1\nexo__Asset_archived: true\n---\nBody");
  });

  // ── Reader (A + B + alias) ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee MetadataHelpers.isAssetArchived reads canonical → alias → legacy, first present decides", () => {
    for (const uid of [LEGACY_TASK, CANONICAL_TASK, ALIAS_TASK]) {
      const meta = vault.getFrontmatter(vault.makeFile(path(uid)))!;
      expect(MetadataHelpers.isAssetArchived(meta)).toBe(true);
    }
    expect(
      MetadataHelpers.isAssetArchived(
        vault.getFrontmatter(vault.makeFile(path(ACTIVE_TASK)))!,
      ),
    ).toBe(false);
    // Priority: a canonical `false` is not overridden by a legacy `true`.
    expect(
      MetadataHelpers.isAssetArchived({ exo__Asset_archived: false, archived: true }),
    ).toBe(false);
    expect(MetadataHelpers.ARCHIVED_FLAG_KEYS).toEqual([
      "exo__Asset_archived",
      "exo__Asset_isArchived",
      "archived",
    ]);
  });

  // ── Scenario C: ArchiveAssetService ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee ArchiveAssetService writes exo__Asset_archived and drops a pre-existing bare `archived` key", async () => {
    const service = new ArchiveAssetService(vault);

    // Fresh asset → canonical key only.
    await service.archiveAsset(vault.makeFile(path(ACTIVE_TASK)));
    const fresh = fs.getContent(path(ACTIVE_TASK))!;
    expect(fresh).toMatch(/^exo__Asset_archived: true$/m);
    expect(fresh).not.toMatch(/^archived:/m);
    expect(fresh).not.toMatch(/^aliases:/m);

    // Legacy carrier → migrated by the same write (no dual keys).
    await service.archiveAsset(vault.makeFile(path(LEGACY_TASK)));
    const migrated = fs.getContent(path(LEGACY_TASK))!;
    expect(migrated).toMatch(/^exo__Asset_archived: true$/m);
    expect(migrated).not.toMatch(/^archived:/m);
    expect(migrated).toContain("Body notes.");
    // Reader agrees.
    expect(
      MetadataHelpers.isAssetArchived(parseFrontmatter(migrated)!),
    ).toBe(true);
  });

  // ── Scenario C: bare-keyed writer input is UPGRADED, never downgraded ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee canonicalYamlKey upgrades a bare `archived` writer input to exo__Asset_archived", () => {
    expect(canonicalYamlKey("archived")).toBe("exo__Asset_archived");
    const fmService = new FrontmatterService();
    const written = fmService.updateProperty(
      "---\nfoo: bar\narchived: true\n---\nBody",
      "archived",
      "true",
    );
    expect(written).toBe("---\nfoo: bar\nexo__Asset_archived: true\n---\nBody");
  });

  // ── Scenario C: homoiconic `archive` grounding (property_set on the bare name) ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee the `archive` grounding (targetProperty: archived) writes exo__Asset_archived through the real executor", async () => {
    const command = await resolver.loadCommand(CMD_ARCHIVE);
    expect(command).not.toBeNull();
    expect(command!.grounding.type).toBe("property_set");
    expect(command!.grounding.targetProperty).toBe("archived"); // vault data unchanged

    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
    const result = await executor.execute(
      command!.grounding,
      iri(ACTIVE_TASK),
      path(ACTIVE_TASK),
    );
    expect(result.success).toBe(true);

    const after = fs.getContent(path(ACTIVE_TASK))!;
    expect(after).toMatch(/^exo__Asset_archived: true$/m);
    expect(after).not.toMatch(/^archived:/m);
    // Re-indexing the written file emits the SAME predicate the preconditions test.
    const converter = new NoteToRDFConverter(vault);
    const reindexed = new InMemoryTripleStore();
    await reindexed.addAll(await converter.convertVault());
    expect(await objectsOf(reindexed, ACTIVE_TASK, ARCHIVED_PRED)).toEqual(["true"]);
  });

  // ── Scenario D: removal clears BOTH spellings ──
  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee removing exo__Asset_archived clears the legacy bare key too (FrontmatterService)", () => {
    const fmService = new FrontmatterService();
    const both = "---\nfoo: bar\narchived: true\nexo__Asset_archived: true\n---\nBody";
    const cleared = fmService.removeProperty(both, "exo__Asset_archived");
    expect(cleared).not.toMatch(/^archived:/m);
    expect(cleared).not.toMatch(/^exo__Asset_archived:/m);
    expect(cleared).toContain("foo: bar");

    // Legacy-only carrier: the canonical name still reaches the bare key.
    const legacyOnly = "---\nfoo: bar\narchived: true\n---\nBody";
    expect(fmService.removeProperty(legacyOnly, "exo__Asset_archived")).toBe(
      "---\nfoo: bar\n---\nBody",
    );
    // Absent → byte-identical passthrough (idempotent no-op).
    const none = "---\nfoo: bar\n---\nBody";
    expect(fmService.removeProperty(none, "exo__Asset_archived")).toBe(none);
  });

  it("@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee the `un-archive` grounding (property_delete on the bare name) clears a legacy carrier AND a canonical carrier", async () => {
    const command = await resolver.loadCommand(CMD_UNARCHIVE);
    expect(command).not.toBeNull();
    expect(command!.grounding.type).toBe("property_delete");

    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
    for (const uid of [LEGACY_TASK, CANONICAL_TASK]) {
      const result = await executor.execute(command!.grounding, iri(uid), path(uid));
      expect(result.success).toBe(true);
      const after = fs.getContent(path(uid))!;
      expect(after).not.toMatch(/^archived:/m);
      expect(after).not.toMatch(/^exo__Asset_archived:/m);
      expect(MetadataHelpers.isAssetArchived(parseFrontmatter(after)!)).toBe(false);
      expect(after).toContain("Body notes.");
    }
  });
});
