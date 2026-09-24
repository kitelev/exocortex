/**
 * Unit tests — the `createdInstance` substitution token
 * (ticket ff7709cb-29a0-44be-a28a-683f50ecfed9 / req c0122d7f-1c48-4bc7-b0b8-02dc109b16c4).
 *
 * A composite grounding could already RETARGET a later step at the asset an
 * earlier step created (`exocmd__Grounding_targetsCreatedInstance`, req
 * b00acde4). It could NOT use that asset as a property VALUE: the created path
 * lived in `executeComposite`'s local `lastCreatedPath`, while the
 * `ResolverContext` feeding substitution tokens is built in
 * `executeCreateInstance` — four signatures away.
 *
 * This file locks the thread end-to-end. Production-shape: the real
 * `GroundingExecutor.executeComposite` runs real `create_instance` steps over an
 * in-memory fs honouring read-after-write; the assertions read the CREATED
 * FILE's frontmatter, i.e. what a user would actually see, not an internal
 * structure.
 *
 * Axis map (each level of the thread has one, so removing any one level reddens
 * something — a level whose removal reddens nothing is not covered):
 *   A1  executeComposite → executeStep → execute → executeCreateInstance → ctx
 *       (the whole thread, happy path)
 *   A2  negative control: no prior create_instance ⇒ resolver yields null ⇒ the
 *       PropertyDefault entry is SKIPPED (property absent, click-target NOT
 *       substituted in its place)
 *   A3  a NESTED composite inherits the parent's most-recently-created asset
 *       (locks `inheritedCreatedPath`, which A1 alone leaves free)
 *   A4  the created path is a VALUE source, orthogonal to the step's TARGET:
 *       the second create_instance still writes its own new file
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

/** In-memory fs that honours read-after-write (mirrors the real contract). */
function makeFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const reader = {
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    }),
    fileExists: jest.fn(async (path: string) => files.has(path)),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
  const writer = {
    createFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return "";
    }),
    updateFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteFile: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
  return { files, reader, writer };
}

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-created-instance",
    label: "created-instance-token",
    ...overrides,
  } as unknown as GroundingDefinition;
}

/**
 * UUID-canon click-target (`<uid>.md`) — the vault invariant. It matters here:
 * `extractBacklinkTarget` emits the bare basename ONLY for a UUID-shaped one and
 * falls back to the full path otherwise, so a prettily-named fixture would
 * measure the fallback instead of the strip-canon form the assertions claim.
 */
const CLICK_TARGET_UID = "99999999-8888-4777-8666-555555555555";
const CLICK_TARGET_IRI = `https://exocortex.my/assets/${CLICK_TARGET_UID}`;
const CLICK_TARGET_PATH = `/vault/norms/${CLICK_TARGET_UID}.md`;
const CLICK_TARGET_SEED = `---\nexo__Asset_uid: ${CLICK_TARGET_UID}\nexo__Asset_label: Norm\n---\nNorm body`;

/** The token asset's own uid — only its SHAPE matters to the marker regex. */
const TOKEN_UID = "11111111-2222-4333-8444-555555555555";
const CREATED_INSTANCE_MARKER = `__SUBSTITUTE__createdInstance__${TOKEN_UID}__`;
/** `$target` marker, used to prove A2 does not silently fall back to it. */
const TARGET_MARKER = `__SUBSTITUTE__target__${TOKEN_UID}__`;

/** The property that receives the reference to the previously-created asset. */
const LINK_PROPERTY = "ims__Verification_subject";

/** Step 1: creates the RECORD the later step must point at. */
function createRecordStep(): GroundingDefinition {
  return gnd({
    id: "step-create-record",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ims__Verification",
    targetFolder: "/vault/records",
  });
}

/**
 * Step 2: creates the LINK asset whose `LINK_PROPERTY` is defaulted from the
 * substitution marker under test.
 */
function createLinkStep(marker: string = CREATED_INSTANCE_MARKER): GroundingDefinition {
  return gnd({
    id: "step-create-link",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ims__VerificationLink",
    targetFolder: "/vault/links",
    propertyDefault: [{ propertyName: LINK_PROPERTY, value: marker }],
  });
}

/** The single file created under `folder` (there is exactly one per test). */
function createdIn(files: Map<string, string>, folder: string): [string, string] {
  const hit = [...files.entries()].find(([p]) => p.startsWith(`${folder}/`));
  expect(hit).toBeDefined();
  return hit as [string, string];
}

/** UUID-canon basename without the `.md` suffix — what a wikilink carries. */
function bareUid(path: string): string {
  return (path.split("/").pop() as string).replace(/\.md$/i, "");
}

describe("GroundingExecutor — `createdInstance` substitution token (req c0122d7f)", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("A1 a later create_instance step substitutes the asset an EARLIER step created, in `$target`'s strip-canon wikilink form @req:c0122d7f-1c48-4bc7-b0b8-02dc109b16c4", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createRecordStep(), createLinkStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    const [recordPath] = createdIn(files, "/vault/records");
    const [, linkContent] = createdIn(files, "/vault/links");

    // The link asset points at the RECORD created one step earlier…
    expect(linkContent).toContain(`${LINK_PROPERTY}: "[[${bareUid(recordPath)}]]"`);
    // …and NOT at the click-target (which is what `$target` would have given).
    expect(linkContent).not.toContain(CLICK_TARGET_UID);
    // The marker itself must not survive into the written frontmatter.
    expect(linkContent).not.toContain("__SUBSTITUTE__");
  });

  it("A2 negative control: with NO prior create_instance the entry is SKIPPED — the property is absent and the click-target is never substituted in its place @req:c0122d7f-1c48-4bc7-b0b8-02dc109b16c4", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    // The ONLY step carries the marker — nothing has been created before it.
    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createLinkStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    const [, linkContent] = createdIn(files, "/vault/links");
    // Absent, not empty and not a marker left behind.
    expect(linkContent).not.toContain(LINK_PROPERTY);
    expect(linkContent).not.toContain("__SUBSTITUTE__");
    // The click-target was NOT silently used as the value.
    expect(linkContent).not.toContain(CLICK_TARGET_UID);
  });

  it("A2b the same composite WITH a `$target` marker does write the click-target — proving A2's absence is the resolver's null, not a dead PropertyDefault path @req:c0122d7f-1c48-4bc7-b0b8-02dc109b16c4", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createLinkStep(TARGET_MARKER)],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    const [, linkContent] = createdIn(files, "/vault/links");
    expect(linkContent).toContain(`${LINK_PROPERTY}: "[[${CLICK_TARGET_UID}]]"`);
  });

  it("A3 a NESTED composite inherits the asset created by its PARENT @req:c0122d7f-1c48-4bc7-b0b8-02dc109b16c4", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        createRecordStep(),
        gnd({
          id: "step-nested",
          type: GroundingType.COMPOSITE,
          steps: [createLinkStep()],
        }),
      ],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    const [recordPath] = createdIn(files, "/vault/records");
    const [, linkContent] = createdIn(files, "/vault/links");
    expect(linkContent).toContain(`${LINK_PROPERTY}: "[[${bareUid(recordPath)}]]"`);
  });

  it("A4 the created path is a VALUE source only — the substituting step still writes its OWN new file and leaves the click-target untouched @req:c0122d7f-1c48-4bc7-b0b8-02dc109b16c4", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createRecordStep(), createLinkStep()],
    });

    await exec.execute(composite, CLICK_TARGET_IRI, CLICK_TARGET_PATH);

    // Two distinct created files — the link did NOT overwrite the record.
    const [recordPath] = createdIn(files, "/vault/records");
    const [linkPath] = createdIn(files, "/vault/links");
    expect(recordPath).not.toBe(linkPath);

    // The click-target is byte-identical to its seed.
    expect(files.get(CLICK_TARGET_PATH)).toBe(CLICK_TARGET_SEED);
  });
});
