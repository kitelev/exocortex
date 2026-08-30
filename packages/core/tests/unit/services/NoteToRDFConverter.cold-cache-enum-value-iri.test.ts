import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { IFile } from "../../../src/interfaces/IVaultAdapter";

/**
 * Tier 4 of RFC 8f93ff95 — @req:f3ec4a75-f49c-47db-9cd6-5c8d09fbf0e0
 *
 * Tier 3 warmed the CLASS position only. The #2782 enum-substitution block resolves
 * a VALUE target through the same `label -> symbolic` lookup, so on a cold cache an
 * enum value fell through to a file-IRI.
 *
 * That is worse than a missing button: the starter-kit ASK gates are EXISTENTIAL, so
 * `FILTER(?s != <ems:EffortStatusDoing>)` PASSES on a file-IRI and the gate opens on
 * an asset it was written to close — a task already in progress offers "Start" again.
 *
 * Under UID-CANON the status file's basename is a uuid, so `exo__Asset_label` is the
 * ONLY source of the symbolic IRI — which is exactly why a cold cache breaks it.
 */

const STATUS_UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STATUS_PATH = `assetspaces/kitelev/exoas-public/ems/${STATUS_UID}.md`;
const STATUS_FM = { exo__Asset_label: "ems__EffortStatusDoing" };
const statusFile = {
  path: STATUS_PATH,
  basename: STATUS_UID,
  name: `${STATUS_UID}.md`,
  extension: "md",
} as unknown as IFile;

const ASSET_PATH = "assetspaces/kitelev/exoas-my/my/task.md";
const assetFile = {
  path: ASSET_PATH,
  basename: "task",
  name: "task.md",
  extension: "md",
} as unknown as IFile;
const ASSET_FM = {
  exo__Asset_uid: "11111111-2222-4333-8444-555555555555",
  ems__Effort_status: `[[${STATUS_UID}]]`,
};

const SYMBOLIC = Namespace.EMS.term("EffortStatusDoing").toString();

/** `cold` starves ONLY the status file — the asset's own frontmatter stays warm, so a
 *  failure here cannot be blamed on Tier 1's conveyor. */
function makeVault(cold: boolean) {
  const diskReads: string[] = [];
  const vault = {
    getFiles: () => [assetFile, statusFile],
    getMarkdownFiles: () => [assetFile, statusFile],
    getAbstractFileByPath: (p: string) =>
      p === STATUS_PATH ? statusFile : p === ASSET_PATH ? assetFile : null,
    getFirstLinkpathDest: (lp: string) => (lp === STATUS_UID ? statusFile : null),
    getFrontmatter: (f: IFile) => {
      if (f.path === ASSET_PATH) return ASSET_FM;
      if (f.path === STATUS_PATH) return cold ? null : STATUS_FM;
      return null;
    },
    getFrontmatterWithFallback: async (f: IFile) => {
      diskReads.push(f.path);
      if (f.path === STATUS_PATH) return STATUS_FM;
      if (f.path === ASSET_PATH) return ASSET_FM;
      return null;
    },
    read: async () => "",
    getName: () => "vault",
  } as never;
  return { vault, diskReads };
}

async function statusObjects(cold: boolean): Promise<{ objects: string[]; diskReads: string[] }> {
  const { vault, diskReads } = makeVault(cold);
  const triples = await new NoteToRDFConverter(vault).convertNoteFromFrontmatter(
    assetFile,
    ASSET_FM as never,
  );
  const objects = triples
    .filter((t) => t.predicate.toString().endsWith("#Effort_status"))
    .map((t) => t.object.toString());
  return { objects, diskReads };
}

describe("NoteToRDFConverter — enum VALUE keeps its symbolic IRI on a cold cache (Tier 4)", () => {
  it("@req:f3ec4a75-f49c-47db-9cd6-5c8d09fbf0e0 emits the SYMBOLIC enum IRI when only the cache is cold", async () => {
    const { objects } = await statusObjects(true);

    // Guard against a vacuous pass: the predicate must have produced an object at all.
    expect(objects.length).toBeGreaterThan(0);
    expect(objects).toContain(SYMBOLIC);
    // The pre-Tier-4 failure, named explicitly so a regression cannot read as "still green".
    expect(objects.some((o) => o.startsWith("obsidian://vault/"))).toBe(false);
  });

  it("@req:f3ec4a75-f49c-47db-9cd6-5c8d09fbf0e0 a WARM cache yields the identical object and costs ZERO extra disk reads", async () => {
    const { objects, diskReads } = await statusObjects(false);

    expect(objects).toContain(SYMBOLIC);
    // The warm path must be byte-identical to the cold one — no behaviour change when
    // nothing is cold (req acceptance clause 3).
    const cold = await statusObjects(true);
    expect(objects).toEqual(cold.objects);
    // Tier 1 reads the asset's OWN frontmatter through the fallback; the widened warm-up
    // must add NOTHING on top of that when the target's cache is warm.
    expect(diskReads.filter((p) => p === STATUS_PATH)).toEqual([]);
  });
});
