import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  ArchiveAssetService,
  EffortStatusWorkflow,
  FixMissingLabelService,
  FolderRepairService,
  GenericAssetCreationService,
  PropertyCleanupService,
  RenameToUidService,
  ServiceRegistry,
  StatusTimestampService,
  TaskStatusService,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createRenameToUidService,
  populateCliServiceRegistry,
  CliServiceNotImplementedError,
} from "../../../src/services/CliServiceRegistryPopulator.js";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

type Frontmatter = Record<string, unknown>;

function readFrontmatter(filePath: string): Frontmatter {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`No frontmatter in ${filePath}`);
  return parseFrontmatterAsReader(content) as Frontmatter;
}

function writeRaw(vaultRoot: string, relPath: string, content: string): string {
  const fullPath = path.join(vaultRoot, relPath);
  fs.ensureDirSync(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

describe("renameToUid (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let renameToUidService: RenameToUidService;
  let fixMissingLabelService: FixMissingLabelService;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let taskStatusService: TaskStatusService;
  let folderRepairService: FolderRepairService;
  let service: ReturnType<typeof createRenameToUidService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-renametouid-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    renameToUidService = new RenameToUidService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    folderRepairService = new FolderRepairService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createRenameToUidService(vaultAdapter, renameToUidService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("renames file to match exo__Asset_uid when filename differs", async () => {
    writeRaw(
      vaultRoot,
      "tasks/My Task.md",
      "---\nexo__Asset_uid: a1b2c3d4-renamed-uid\nexo__Asset_label: My Task\n---\nBody\n",
    );

    await service.execute("tasks/My Task");

    expect(fs.existsSync(path.join(vaultRoot, "tasks/a1b2c3d4-renamed-uid.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "tasks/My Task.md"))).toBe(false);
  });

  it("preserves frontmatter properties after rename", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Original.md",
      "---\nexo__Asset_uid: xyz-789\nexo__Asset_label: Original\nems__Effort_status: '\"[[ems__EffortStatusDoing]]\"'\n---\nBody\n",
    );

    await service.execute("tasks/Original");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/xyz-789.md"));
    expect(fm.exo__Asset_uid).toBe("xyz-789");
    expect(fm.exo__Asset_label).toBe("Original");
  });

  it("appends old basename to aliases even when label is preset (decoupled from label-gate)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Preset Label.md",
      "---\nexo__Asset_uid: alias-only-uid\nexo__Asset_label: Custom Label\n---\nBody\n",
    );

    await service.execute("tasks/Preset Label");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/alias-only-uid.md"));
    expect(fm.exo__Asset_label).toBe("Custom Label");
    expect(fm.aliases).toEqual(expect.arrayContaining(["Preset Label"]));
  });

  it("does NOT append alias for archived asset", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Archived Task.md",
      "---\nexo__Asset_uid: arch-uid\nexo__Asset_label: Archived\nexo__Asset_isArchived: true\n---\nBody\n",
    );

    await service.execute("tasks/Archived Task");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/arch-uid.md"));
    expect(fm.exo__Asset_label).toBe("Archived");
    expect(fm.aliases).toBeUndefined();
  });

  it("adds exo__Asset_label = original basename when label is missing before rename", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Needs Label.md",
      "---\nexo__Asset_uid: label-fix-uid\n---\nBody\n",
    );

    await service.execute("tasks/Needs Label");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/label-fix-uid.md"));
    expect(fm.exo__Asset_label).toBe("Needs Label");
  });

  // ── Ticket 77ffc37a / req 2f642d6c — the basename goes through the shared
  // YAML escaper. Every axis writes a REAL file through FileSystemVaultAdapter
  // and reads the result back with the real js-yaml (parseFrontmatterAsReader),
  // i.e. exactly what the Obsidian metadataCache would see.
  describe("YAML-significant basenames (@req:2f642d6c-a2c2-47c8-84fb-8285f0f65c44)", () => {
    const REQ = "@req:2f642d6c-a2c2-47c8-84fb-8285f0f65c44";

    it.each([
      ["a leading dash", "- leading dash", "y2-dash-uid"],
      ["a colon-space", "Note: colon space", "y2-colon-uid"],
      ["a space-hash", "Tag #hash", "y2-hash-uid"],
      ["an interior double quote", 'say "hi"', "y2-quote-uid"],
      ["a backslash", "back\\slash", "y2-bslash-uid"],
    ])(
      `${REQ} Y2 rename-to-uid with %s in the basename (no label, no aliases) stays parseable and alias === label === basename`,
      async (_shape, basename, uid) => {
        writeRaw(
          vaultRoot,
          `tasks/${basename}.md`,
          `---\nexo__Asset_uid: ${uid}\n---\nBody\n`,
        );

        await service.execute(`tasks/${basename}`);

        const fm = readFrontmatter(path.join(vaultRoot, `tasks/${uid}.md`));
        expect(fm.exo__Asset_label).toBe(basename);
        expect(fm.aliases).toEqual([basename]);
      },
    );

    it(`${REQ} Y2b a space-hash basename keeps the WHOLE alias (the pre-fix output silently truncated it to the text before the hash)`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Tag #hash.md",
        "---\nexo__Asset_uid: y2b-uid\nexo__Asset_label: Existing\n---\nBody\n",
      );

      await service.execute("tasks/Tag #hash");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y2b-uid.md"));
      expect(fm.aliases).toEqual(["Tag #hash"]);
      expect(fm.exo__Asset_label).toBe("Existing");
    });

    it(`${REQ} Y3 appending a colon-space basename to an existing block list keeps every item a string (the pre-fix output produced a nested mapping)`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Note: colon.md",
        "---\nexo__Asset_uid: y3-uid\nexo__Asset_label: Existing\naliases:\n  - old-one\n---\nBody\n",
      );

      await service.execute("tasks/Note: colon");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y3-uid.md"));
      expect(fm.aliases).toEqual(["old-one", "Note: colon"]);
    });

    it(`${REQ} Y4 appending a comma basename to a non-empty inline array keeps it one string item`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/a, b.md",
        "---\nexo__Asset_uid: y4-uid\nexo__Asset_label: Existing\naliases: [old-one]\n---\nBody\n",
      );

      await service.execute("tasks/a, b");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y4-uid.md"));
      expect(fm.aliases).toEqual(["old-one", "a, b"]);
    });

    it(`${REQ} Y4b replacing an empty inline array with a leading-dash basename stays parseable`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/- dash.md",
        "---\nexo__Asset_uid: y4b-uid\nexo__Asset_label: Existing\naliases: []\n---\nBody\n",
      );

      await service.execute("tasks/- dash");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y4b-uid.md"));
      expect(fm.aliases).toEqual(["- dash"]);
    });

    it(`${REQ} Y4c replacing a null aliases (~) with a colon-space basename stays parseable`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Note: tilde.md",
        "---\nexo__Asset_uid: y4c-uid\nexo__Asset_label: Existing\naliases: ~\n---\nBody\n",
      );

      await service.execute("tasks/Note: tilde");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y4c-uid.md"));
      expect(fm.aliases).toEqual(["Note: tilde"]);
    });

    it(`${REQ} Y5 a safe basename is written in the plain form, byte-identical to the pre-fix output (pair — no quote churn)`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/plain name.md",
        "---\nexo__Asset_uid: y5-uid\n---\nBody\n",
      );

      await service.execute("tasks/plain name");

      const text = fs.readFileSync(
        path.join(vaultRoot, "tasks/y5-uid.md"),
        "utf-8",
      );
      expect(text).toBe(
        "---\nexo__Asset_uid: y5-uid\nexo__Asset_label: plain name\naliases:\n  - plain name\n---\nBody\n",
      );
    });

    // ── Ticket 71f1ca37 (review of PR #4256): the inline FLOW sequence is read
    // by the YAML reader, not split on `,` over the raw text — a quoted item
    // that contains `,` or `]` is ONE item. Mutant matrix — copied from the
    // driver output (mutants-71f1ca37.py r2, 2026-09-18; control 61/40 green):
    //   M3  (raw split(",") instead of the YAML reader)        → RED: ['Y11']
    //   M4  (scan does not skip double-quoted runs)            → RED: ['Y11b', 'Y11f']
    //   M5  (scan does not skip single-quoted runs)            → RED: ['Y11b']
    //   M6  (scan stops at end of line)                        → RED: ['Y11c']
    //   M7  (backslash escape inside "…" ignored)              → RED: ['Y11f']
    //   M8  (head regex [ \t]*: next-line flow not recognised) → RED: ['Y11d']
    //   M9  (quote opens a run anywhere, no atItemStart gate)  → RED: ['Y11e']
    //   M10 (items read with YAML11 instead of FAILSAFE)       → RED: ['Y11g']
    it(`${REQ} Y11 a quoted inline item that CONTAINS a comma is one item for the dedup: the same basename is not appended twice, another basename is appended after it`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/a, b.md",
        '---\nexo__Asset_uid: y11-uid\nexo__Asset_label: Existing\naliases: [old-one, "a, b"]\n---\nBody\n',
      );

      await service.execute("tasks/a, b");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11-uid.md"));
      expect(fm.aliases).toEqual(["old-one", "a, b"]);

      writeRaw(
        vaultRoot,
        "tasks/c.md",
        '---\nexo__Asset_uid: y11b-uid\nexo__Asset_label: Existing\naliases: [old-one, "a, b"]\n---\nBody\n',
      );

      await service.execute("tasks/c");

      const fm2 = readFrontmatter(path.join(vaultRoot, "tasks/y11b-uid.md"));
      expect(fm2.aliases).toEqual(["old-one", "a, b", "c"]);
    });

    it(`${REQ} Y11b a double- or single-quoted inline item that CONTAINS a closing bracket is not cut by the flow-sequence match: the sequence stays intact and the basename is appended`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/new one.md",
        '---\nexo__Asset_uid: y11c-uid\nexo__Asset_label: Existing\naliases: ["x]y", \'p]q\', plain]\n---\nBody\n',
      );

      await service.execute("tasks/new one");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11c-uid.md"));
      expect(fm.aliases).toEqual(["x]y", "p]q", "plain", "new one"]);
    });

    it(`${REQ} Y11c a flow sequence that spans two lines is still recognised (the bracket scan is not line-bound): the basename is appended and the file stays parseable`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/fresh.md",
        '---\nexo__Asset_uid: y11d-uid\nexo__Asset_label: Existing\naliases: [old-one,\n  "two, words"]\n---\nBody\n',
      );

      await service.execute("tasks/fresh");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11d-uid.md"));
      expect(fm.aliases).toEqual(["old-one", "two, words", "fresh"]);
    });

    it(`${REQ} Y11d a flow sequence on the line AFTER the aliases key is the same sequence (not an empty aliases value): the basename is appended and the file stays parseable`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/third.md",
        '---\nexo__Asset_uid: y11e-uid\nexo__Asset_label: Existing\naliases:\n  [alpha, beta]\n---\nBody\n',
      );

      await service.execute("tasks/third");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11e-uid.md"));
      expect(fm.aliases).toEqual(["alpha", "beta", "third"]);
    });

    it(`${REQ} Y11e an apostrophe INSIDE a plain flow item is an ordinary character (the scan opens a quoted run only at an item start): the sequence is recognised and the basename appended`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/mine.md",
        "---\nexo__Asset_uid: y11f-uid\nexo__Asset_label: Existing\naliases: [it's, foo]\n---\nBody\n",
      );

      await service.execute("tasks/mine");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11f-uid.md"));
      expect(fm.aliases).toEqual(["it's", "foo", "mine"]);
    });

    it(`${REQ} Y11f an escaped double quote inside a double-quoted flow item does not end the quoted run: the item keeps its \\"]\\" and the basename is appended`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/esc.md",
        '---\nexo__Asset_uid: y11g-uid\nexo__Asset_label: Existing\naliases: ["a\\"]b", plain]\n---\nBody\n',
      );

      await service.execute("tasks/esc");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y11g-uid.md"));
      expect(fm.aliases).toEqual(['a"]b', "plain", "esc"]);
    });

    it(`${REQ} Y11g flow items are compared as the STRINGS they spell (FAILSAFE reader): a bare 'yes' item equals the basename 'yes' and is not appended twice`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/yes.md",
        "---\nexo__Asset_uid: y11h-uid\nexo__Asset_label: Existing\naliases: [yes]\n---\nBody\n",
      );

      await service.execute("tasks/yes");

      const raw = fs.readFileSync(path.join(vaultRoot, "tasks/y11h-uid.md"), "utf8");
      expect(raw).toContain("aliases: [yes]\n");
      expect(raw).not.toContain('"yes"');
    });

    it(`${REQ} Y6 an alias already stored QUOTED (the shape apply set-label writes) is recognised by the dedup and not appended a second time`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/plain name.md",
        '---\nexo__Asset_uid: y6-uid\nexo__Asset_label: Existing\naliases:\n  - "plain name"\n---\nBody\n',
      );

      await service.execute("tasks/plain name");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y6-uid.md"));
      expect(fm.aliases).toEqual(["plain name"]);
    });

    it.each([
      ["a date-shaped basename", "2026-01-15", "y7-date-uid"],
      ["a number-shaped basename", "123", "y7-num-uid"],
    ])(
      `${REQ} Y7 %s stays a STRING under a real YAML parser (not a Date / number)`,
      async (_shape, basename, uid) => {
        writeRaw(
          vaultRoot,
          `tasks/${basename}.md`,
          `---\nexo__Asset_uid: ${uid}\n---\nBody\n`,
        );

        await service.execute(`tasks/${basename}`);

        const fm = readFrontmatter(path.join(vaultRoot, `tasks/${uid}.md`));
        expect(fm.aliases).toEqual([basename]);
        expect(typeof (fm.aliases as unknown[])[0]).toBe("string");
        expect(fm.exo__Asset_label).toBe(basename);
      },
    );

    // Round 2 (review MEDIUM): every `.replace(pattern, <string with basename>)`
    // read `$1` / `$&` / `$$` in the basename as a REPLACEMENT pattern — a
    // capture got spliced in, or `$$` collapsed to `$` — before the YAML escaper
    // ever saw the text. Function replacers make the basename inert.
    it.each([
      ["a $<digit> capture reference", "Pay $100 invoice", "y9-cap-uid"],
      ["a $& whole-match reference", "a $& b", "y9-amp-uid"],
      ["a $$ escaped dollar", "Cost $$ total", "y9-dd-uid"],
    ])(
      `${REQ} Y9 %s in the basename is written literally (no label, no aliases): label and alias equal the basename byte-for-byte`,
      async (_shape, basename, uid) => {
        writeRaw(
          vaultRoot,
          `tasks/${basename}.md`,
          `---\nexo__Asset_uid: ${uid}\n---\nBody\n`,
        );

        await service.execute(`tasks/${basename}`);

        const fm = readFrontmatter(path.join(vaultRoot, `tasks/${uid}.md`));
        expect(fm.exo__Asset_label).toBe(basename);
        expect(fm.aliases).toEqual([basename]);
      },
    );

    it(`${REQ} Y9b a $& basename appended to an existing block list lands literally`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/a $& b.md",
        "---\nexo__Asset_uid: y9b-uid\nexo__Asset_label: Existing\naliases:\n  - old-one\n---\nBody\n",
      );

      await service.execute("tasks/a $& b");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y9b-uid.md"));
      expect(fm.aliases).toEqual(["old-one", "a $& b"]);
    });

    // `$1` is inert on a pattern with NO capture group (JS leaves it literal),
    // so the null-aliases case uses `$&` — the form every pattern expands.
    it(`${REQ} Y9c a $1 basename appended to an inline array, and a $& basename replacing a null aliases, land literally`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Pay $1 now.md",
        "---\nexo__Asset_uid: y9c-uid\nexo__Asset_label: Existing\naliases: [old-one]\n---\nBody\n",
      );
      writeRaw(
        vaultRoot,
        "tasks/Pay $& later.md",
        "---\nexo__Asset_uid: y9d-uid\nexo__Asset_label: Existing\naliases: ~\n---\nBody\n",
      );

      await service.execute("tasks/Pay $1 now");
      await service.execute("tasks/Pay $& later");

      expect(
        readFrontmatter(path.join(vaultRoot, "tasks/y9c-uid.md")).aliases,
      ).toEqual(["old-one", "Pay $1 now"]);
      expect(
        readFrontmatter(path.join(vaultRoot, "tasks/y9d-uid.md")).aliases,
      ).toEqual(["Pay $& later"]);
    });

    it(`${REQ} Y9d a $$ basename replacing an empty inline array lands literally`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Cost $$ total.md",
        "---\nexo__Asset_uid: y9e-uid\nexo__Asset_label: Existing\naliases: []\n---\nBody\n",
      );

      await service.execute("tasks/Cost $$ total");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y9e-uid.md"));
      expect(fm.aliases).toEqual(["Cost $$ total"]);
    });

    // Round 2 (review LOW-2): the block-list append replaced the FIRST
    // occurrence of the block's text, so an identical list under an earlier
    // key (`tags:`) was edited instead of `aliases:`.
    it(`${REQ} Y10 a tags list identical to the aliases list and placed before it is left untouched; aliases gets the new item`, async () => {
      writeRaw(
        vaultRoot,
        "tasks/Second.md",
        "---\nexo__Asset_uid: y10-uid\nexo__Asset_label: Existing\ntags:\n  - old-one\naliases:\n  - old-one\n---\nBody\n",
      );

      await service.execute("tasks/Second");

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y10-uid.md"));
      expect(fm.tags).toEqual(["old-one"]);
      expect(fm.aliases).toEqual(["old-one", "Second"]);
    });

    it(`${REQ} Y8 a basename that is itself a complete "…" run round-trips with its quotes (no pass-through as a pre-wrapped scalar)`, async () => {
      writeRaw(
        vaultRoot,
        'tasks/"quoted".md',
        "---\nexo__Asset_uid: y8-uid\n---\nBody\n",
      );

      await service.execute('tasks/"quoted"');

      const fm = readFrontmatter(path.join(vaultRoot, "tasks/y8-uid.md"));
      expect(fm.aliases).toEqual(['"quoted"']);
      expect(fm.exo__Asset_label).toBe('"quoted"');
    });
  });

  it("throws when exo__Asset_uid is missing", async () => {
    writeRaw(
      vaultRoot,
      "tasks/NoUid.md",
      "---\nexo__Asset_label: NoUid\n---\nBody\n",
    );

    await expect(service.execute("tasks/NoUid")).rejects.toThrow(/uid/i);
  });

  it("throws when file is already named according to UID", async () => {
    writeRaw(
      vaultRoot,
      "tasks/already-named.md",
      "---\nexo__Asset_uid: already-named\nexo__Asset_label: Already\n---\nBody\n",
    );

    await expect(service.execute("tasks/already-named")).rejects.toThrow(
      /already named/i,
    );
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real renameToUid (no throw-stub)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Registered.md",
      "---\nexo__Asset_uid: reg-uid-42\nexo__Asset_label: Registered\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
      renameToUidService,
      folderRepairService,
    });

    const registered = registry.get("renameToUid");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(vaultRoot, "tasks/reg-uid-42.md"))).toBe(true);
  });

  it("registry integration: renameToUid is NOT a CliServiceNotImplementedError stub when deps provided (#2871 regression guard)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Guard.md",
      "---\nexo__Asset_uid: guard-uid\nexo__Asset_label: Guard\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
      renameToUidService,
      folderRepairService,
    });
    const registered = registry.get("renameToUid");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, renameToUid is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("renameToUid")).toBe(false);
  });
});
