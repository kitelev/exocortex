/**
 * req f5b79260-f87c-4e73-8a34-19da341c7ec9 (ticket 316dd2be) — how the CLI's
 * creation gate resolves a UID reference: ONE listing of the vault's file names
 * per session, matching exactly the name shapes `NodeFsAdapter.findFileByUidFilename`
 * accepts, with the adapter's own lookups as the fallback.
 *
 * The fake adapter carries only what `createFsFrontmatterByRef` calls, and
 * counts the calls — the cost half of the contract.
 *
 * Axis names (R<n>) lead each title: they are the machine key of the mutant
 * driver (`creation-gate-f5b79260.frontmatterByRef.spec.json` next to this file).
 */
import { createFsFrontmatterByRef } from "../../../src/services/CreationGateCli.js";
import type { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";

const REQ = "@req:f5b79260-f87c-4e73-8a34-19da341c7ec9";
const UID = "aaaa0000-0000-4000-8000-000000000001";

interface Fake {
  fs: NodeFsAdapter;
  calls: { list: number; walk: number; byUid: number };
  /** The next `getMarkdownFiles` rejects. */
  failListing: { next: boolean };
}

/** `files`: vault-relative path → the frontmatter `getFileMetadata` returns (`"throw"`: unreadable). */
function fake(files: Record<string, Record<string, unknown> | "throw">): Fake {
  const calls = { list: 0, walk: 0, byUid: 0 };
  const failListing = { next: false };
  const metadata = async (p: string): Promise<Record<string, unknown>> => {
    const fm = files[p];
    if (fm === undefined || fm === "throw") throw new Error(`EIO: ${p}`);
    return fm;
  };
  const adapter = {
    getMarkdownFiles: async (): Promise<string[]> => {
      calls.list++;
      if (failListing.next) {
        failListing.next = false;
        throw new Error("EACCES: listing");
      }
      return Object.keys(files).sort();
    },
    getFileMetadata: metadata,
    findFileByUidFilename: async (uid: string): Promise<string | null> => {
      calls.walk++;
      return Object.keys(files).find((p) => p.toLowerCase().endsWith(`/${uid}.md`)) ?? null;
    },
    findFileByUID: async (uid: string): Promise<string | null> => {
      calls.byUid++;
      for (const [p, fm] of Object.entries(files)) {
        if (fm !== "throw" && fm.exo__Asset_uid === uid) return p;
      }
      return null;
    },
    findFilesByMetadata: async (): Promise<string[]> => [],
    findFileByLinkpath: async (): Promise<string | null> => null,
  };
  return { fs: adapter as unknown as NodeFsAdapter, calls, failListing };
}

const asset = (name: string): Record<string, unknown> => ({ exo__Asset_label: name });

describe("creation gate — CLI UID lookup (req f5b79260)", () => {
  it(`R1 ${REQ} the name shapes findFileByUidFilename accepts resolve by name; others do not`, async () => {
    for (const shape of [`${UID}.md`, `${UID} note.md`, `${UID}-copy.md`]) {
      const f = fake({ [`ems/${shape}`]: asset(shape) });
      expect(await createFsFrontmatterByRef(f.fs)(UID)).toEqual(asset(shape));
    }
    for (const shape of [`${UID}.excalidraw.md`, `${UID}x.md`]) {
      const f = fake({ [`ems/${shape}`]: asset(shape) });
      expect(await createFsFrontmatterByRef(f.fs)(UID)).toBeNull();
    }
  });

  it(`R2a ${REQ} <uid>.md wins over an earlier <uid> 2.md`, async () => {
    const f = fake({ [`a/${UID} 2.md`]: asset("copy"), [`b/${UID}.md`]: asset("canon") });
    expect(await createFsFrontmatterByRef(f.fs)(UID)).toEqual(asset("canon"));
  });

  it(`R2b ${REQ} of two <uid>.md the first in path order wins, as the adapter's lookups pick it`, async () => {
    const f = fake({ [`a/${UID}.md`]: asset("first"), [`b/${UID}.md`]: asset("second") });
    expect(await createFsFrontmatterByRef(f.fs)(UID)).toEqual(asset("first"));
  });

  it(`R3 ${REQ} files under node_modules or a dot directory are not taken by name`, async () => {
    for (const dir of ["node_modules/pkg", ".trash"]) {
      const f = fake({ [`${dir}/${UID}.md`]: asset(dir) });
      expect(await createFsFrontmatterByRef(f.fs)(UID)).toBeNull();
    }
  });

  it(`R4a ${REQ} a failed listing falls back to the adapter's name walk`, async () => {
    const f = fake({ [`ems/${UID}.md`]: asset("walked") });
    f.failListing.next = true;
    expect(await createFsFrontmatterByRef(f.fs)(UID)).toEqual(asset("walked"));
    expect(f.calls.walk).toBe(1);
  });

  it(`R4b ${REQ} a failed listing is not kept — the next lookup lists again`, async () => {
    const f = fake({ [`ems/${UID}.md`]: asset("listed") });
    f.failListing.next = true;
    const byRef = createFsFrontmatterByRef(f.fs);
    await byRef(UID);
    await byRef(UID);
    expect(f.calls.list).toBe(2);
  });

  it(`R5 ${REQ} a listed file that cannot be read falls back to the frontmatter lookup`, async () => {
    const f = fake({ [`ems/${UID}.md`]: "throw", [`legacy/old-name.md`]: { exo__Asset_uid: UID, exo__Asset_label: "legacy" } });
    expect(await createFsFrontmatterByRef(f.fs)(UID)).toEqual({ exo__Asset_uid: UID, exo__Asset_label: "legacy" });
    expect(f.calls.byUid).toBe(1);
  });

  it(`R6 ${REQ} one listing per session, no per-lookup directory walk`, async () => {
    const other = "bbbb0000-0000-4000-8000-000000000002";
    const f = fake({ [`ems/${UID}.md`]: asset("a"), [`ems/${other}.md`]: asset("b") });
    const byRef = createFsFrontmatterByRef(f.fs);
    for (let i = 0; i < 5; i++) {
      await byRef(UID);
      await byRef(other);
    }
    expect(f.calls.list).toBe(1);
    expect(f.calls.walk).toBe(0);
  });
});
