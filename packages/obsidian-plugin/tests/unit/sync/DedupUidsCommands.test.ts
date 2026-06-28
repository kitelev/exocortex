/**
 * DedupUidsCommands unit tests (#3676) — the in-plugin «Deduplicate uids»
 * command, Desktop↔Mobile parity for `exosync dedup-uids`. Drives the REAL
 * command + the REAL platform-free core (findDuplicateUidGroups /
 * planDuplicateUidFix) over a production-shape `vault.adapter`-style fake
 * (an in-memory file map whose write MODIFIES by path — never creates / renames,
 * mirroring app.vault.modify). Pure logic — no Obsidian renderer.
 *
 * Covers: report-first → confirm-gated fix (reassign all-but-first, never
 * rename, first keeps uid, idempotent re-run), cancel = no-op, empty-state,
 * and the D11 sync/apply/own-reentry guards.
 */

import {
  DedupUidsCommands,
  type DedupUidsCommandsDeps,
} from "../../../src/infrastructure/adapters/DedupUidsCommands";
import type { DedupUidFile, DedupUidGroup } from "@kitelev/exocortex-core";

const fm = (uid: string, body = "body"): string =>
  `---\nexo__Asset_uid: ${uid}\n---\n\n${body}\n`;

/**
 * Production-shape vault fake: a path→content map. `listFiles` snapshots it as
 * {path, content}[] (like app.vault.getMarkdownFiles()+read); `writeFile`
 * MODIFIES an existing path in place (like app.vault.modify) — it never adds a
 * new key, so a rename would surface as a failed assertion on the key set.
 */
class FakeVault {
  constructor(private readonly files: Map<string, string>) {}
  listFiles = async (): Promise<DedupUidFile[]> =>
    [...this.files.entries()].map(([path, content]) => ({ path, content }));
  writeFile = async (path: string, content: string): Promise<void> => {
    if (!this.files.has(path)) {
      throw new Error(`writeFile to a non-existent path (rename?): ${path}`);
    }
    this.files.set(path, content);
  };
  snapshot(): Map<string, string> {
    return new Map(this.files);
  }
}

function makeDeps(
  vault: FakeVault,
  overrides: Partial<DedupUidsCommandsDeps> = {},
): {
  deps: DedupUidsCommandsDeps;
  notices: string[];
  confirmGroups: DedupUidGroup[][];
} {
  const notices: string[] = [];
  const confirmGroups: DedupUidGroup[][] = [];
  let n = 0;
  const deps: DedupUidsCommandsDeps = {
    listFiles: vault.listFiles,
    writeFile: vault.writeFile,
    freshUid: () => `fresh-uid-${++n}`,
    confirm: async (groups) => {
      confirmGroups.push(groups);
      return true; // default: proceed
    },
    notify: (m) => notices.push(m),
    log: () => undefined,
    ...overrides,
  };
  return { deps, notices, confirmGroups };
}

describe("DedupUidsCommands", () => {
  it("the «Deduplicate uids» command reports duplicate uids and, on confirm, reassigns a fresh uuid to every duplicate but the first over vault.adapter — never renaming a file @req:e8a51306-158c-4713-a4c3-979c582bf8c7", async () => {
    const vault = new FakeVault(
      new Map([
        ["a.md", fm("dupe-uid")], // first (sorted) — keeps its uid
        ["b.md", fm("dupe-uid")], // duplicate — gets a fresh uid
        ["c.md", fm("solo")], // unique — untouched
      ]),
    );
    const { deps, notices, confirmGroups } = makeDeps(vault);
    const keysBefore = [...vault.snapshot().keys()];

    await new DedupUidsCommands(deps).invokeDedup();

    // Report-first: the confirm gate was shown the duplicate group (uid + paths).
    expect(confirmGroups).toEqual([
      [{ uid: "dupe-uid", paths: ["a.md", "b.md"] }],
    ]);

    const after = vault.snapshot();
    // a.md (first sorted) KEEPS the original uid; b.md gets a fresh one.
    expect(after.get("a.md")).toMatch(/^exo__Asset_uid: dupe-uid$/m);
    expect(after.get("b.md")).not.toMatch(/^exo__Asset_uid: dupe-uid$/m);
    expect(after.get("b.md")).toMatch(/^exo__Asset_uid: fresh-uid-1$/m);
    // The unique file is untouched.
    expect(after.get("c.md")).toBe(fm("solo"));
    // No file was renamed — the path set is identical (FakeVault.writeFile
    // throws on a new key, so this also guards rename by construction).
    expect([...after.keys()]).toEqual(keysBefore);
    expect(notices).toContain(
      "Reassigned 1 duplicate uid(s) to fresh values. Run Sync to propagate.",
    );

    // Idempotent: a second run finds no duplicates.
    const second = makeDeps(vault);
    await new DedupUidsCommands(second.deps).invokeDedup();
    expect(second.confirmGroups).toEqual([]); // never reached the confirm gate
    expect(second.notices).toContain("No duplicate uids on disk ✅");
  });

  it("cancel at the confirm gate writes nothing", async () => {
    const vault = new FakeVault(
      new Map([
        ["a.md", fm("dup")],
        ["b.md", fm("dup")],
      ]),
    );
    const before = vault.snapshot();
    const { deps, notices } = makeDeps(vault, { confirm: async () => false });
    await new DedupUidsCommands(deps).invokeDedup();
    expect(vault.snapshot()).toEqual(before); // untouched
    expect(notices).toContain("Deduplicate cancelled — no changes");
  });

  it("reports the empty-state without opening the confirm gate", async () => {
    const vault = new FakeVault(new Map([["a.md", fm("u1")], ["b.md", fm("u2")]]));
    const { deps, notices, confirmGroups } = makeDeps(vault);
    await new DedupUidsCommands(deps).invokeDedup();
    expect(confirmGroups).toEqual([]);
    expect(notices).toContain("No duplicate uids on disk ✅");
  });

  it("refuses while a sync is in flight (D11) — no scan, no write", async () => {
    const vault = new FakeVault(new Map([["a.md", fm("dup")], ["b.md", fm("dup")]]));
    let listed = 0;
    const { deps, notices } = makeDeps(vault, {
      isSyncBusy: () => true,
      listFiles: async () => {
        listed++;
        return vault.listFiles();
      },
    });
    await new DedupUidsCommands(deps).invokeDedup();
    expect(listed).toBe(0);
    expect(notices).toContain(
      "A sync is in progress — deduplicate after it finishes (D11)",
    );
  });

  it("refuses while a profile apply is in flight (D11)", async () => {
    const vault = new FakeVault(new Map([["a.md", fm("dup")], ["b.md", fm("dup")]]));
    const { deps, notices } = makeDeps(vault, {
      isSwitchInProgress: () => true,
    });
    await new DedupUidsCommands(deps).invokeDedup();
    expect(notices).toContain(
      "A profile apply is in progress — deduplicate after it finishes (D11)",
    );
  });

  it("refuses re-entry while a dedup is already running", async () => {
    const vault = new FakeVault(new Map([["a.md", fm("dup")], ["b.md", fm("dup")]]));
    // Hold the confirm gate open so the first invocation parks with running=true.
    let release!: () => void;
    const held = new Promise<boolean>((r) => {
      release = () => r(false); // cancel so the held run writes nothing
    });
    const { deps, notices } = makeDeps(vault, { confirm: () => held });
    const cmd = new DedupUidsCommands(deps);

    const first = cmd.invokeDedup(); // parks at the held confirm gate
    await Promise.resolve(); // let the first run reach the confirm await
    await cmd.invokeDedup(); // re-entry while the first is mid-confirm
    expect(notices).toContain("Deduplicate is already running");

    release();
    await first;
  });
});
