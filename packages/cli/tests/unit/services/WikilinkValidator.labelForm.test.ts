import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * A link that resolves to nothing must be refused WHATEVER FORM it takes.
 * @req:1cfb6f3b-bd77-49d3-8270-2eeecf0272f3
 *
 * ⛔ `validateWikilink` opened with
 *
 *     if (!this.looksLikeUUID(uuid)) { return; }   // "Skip non-UUID references"
 *
 * so every label-form linkpath left the validator unchecked. The intent named in
 * that comment was narrow (skip date wikilinks like `[[2025-01-01]]`); the
 * implementation was "skip everything that is not a UUID".
 *
 * ⛤ The asymmetry pointed the wrong way. Label-form is the form the graph
 * REQUIRES for a joinable reference — a bare UUID emits a symbolic IRI that
 * carries none of the target's predicates, so the join dies. The only working
 * form was therefore the unvalidated one, and a typo in it produced a bare
 * literal that SHACL cannot flag (a literal is not a dangling ref). The defect
 * surfaced much later as "the query returns nothing", which reads as "no data".
 *
 * Issue #4068; siblings #3701, #3352, #3362.
 */

const mockFsAdapter = {
  getMarkdownFiles: jest.fn(),
  getFileMetadata: jest.fn(),
  readFile: jest.fn(),
  fileExists: jest.fn<(path: string) => Promise<boolean>>(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata:
    jest.fn<(query: Record<string, unknown>) => Promise<string[]>>(),
  findFileByUID: jest.fn<(uid: string) => Promise<string | null>>(),
  findFileByUidFilename: jest.fn<(uid: string) => Promise<string | null>>(),
  findFileByLinkpath: jest.fn<(target: string) => Promise<string | null>>(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapter),
}));

const { WikilinkValidator, WikilinkNotFoundError } = await import(
  "../../../src/services/WikilinkValidator.js"
);

describe("WikilinkValidator — label-form linkpaths (#4068)", () => {
  let validator: InstanceType<typeof WikilinkValidator>;

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new WikilinkValidator(mockFsAdapter as never);
  });

  it("refuses a label-form link that resolves to nothing", async () => {
    mockFsAdapter.findFileByLinkpath.mockResolvedValue(null);

    // ⛔ Before the fix this resolved silently and the reference landed in the
    // file as a bare literal.
    await expect(
      validator.validateValue("[[flow__NoSuchThing]]")
    ).rejects.toThrow(WikilinkNotFoundError);
  });

  it("names the unresolvable target in the error", async () => {
    mockFsAdapter.findFileByLinkpath.mockResolvedValue(null);

    // The message is what the user acts on; it has to say WHICH link failed.
    await expect(
      validator.validateValue("[[flow__NoSuchThing]]")
    ).rejects.toThrow(/flow__NoSuchThing/);
  });

  it("accepts a label-form link that resolves", async () => {
    // ⛤ Load-bearing: this is the form the graph requires for a joinable
    // reference. Tightening must not make the only working form unusable.
    mockFsAdapter.findFileByLinkpath.mockResolvedValue("assetspaces/x/ems__Task.md");

    await expect(validator.validateValue("[[ems__Task]]")).resolves.toBeUndefined();
  });

  it("passes the ALIAS-bearing form through the same lookup", async () => {
    mockFsAdapter.findFileByLinkpath.mockResolvedValue("assetspaces/x/a.md");

    await expect(
      validator.validateValue("[[ems__Task|Задача]]")
    ).resolves.toBeUndefined();
    // The lookup must receive the TARGET, not the alias — an alias is display
    // text and resolves to nothing.
    expect(mockFsAdapter.findFileByLinkpath).toHaveBeenCalledWith("ems__Task");
  });

  it("CANARY: UUID-form still resolves through the UID lookup, untouched", async () => {
    // Green in BOTH states. ~all current callers depend on this path and on the
    // exact error message, which is greppable in logs.
    mockFsAdapter.findFileByUidFilename.mockResolvedValue("assetspaces/x/uid.md");

    await expect(
      validator.validateValue("[[3fa85f64-5717-4562-b3fc-2c963f66afa6]]")
    ).resolves.toBeUndefined();
    expect(mockFsAdapter.findFileByLinkpath).not.toHaveBeenCalled();
  });

  it("CANARY: UUID-form that resolves to nothing still throws", async () => {
    mockFsAdapter.findFileByUidFilename.mockResolvedValue(null);
    mockFsAdapter.findFilesByMetadata.mockResolvedValue([]);

    await expect(
      validator.validateValue("[[3fa85f64-5717-4562-b3fc-2c963f66afa6]]")
    ).rejects.toThrow(WikilinkNotFoundError);
  });
});
