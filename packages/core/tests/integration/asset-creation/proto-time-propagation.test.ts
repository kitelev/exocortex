/**
 * Integration test: create_instance grounding → prototype-time propagation.
 *
 * Feature ec15f83e / req 57b03ab3 — when the $target prototype declares a
 * time-of-day on itself (`ems__EffortPrototype_startTime`, optionally
 * `_endTime`, in "HH:MM" form), creating an instance from it:
 *   (A) lets the user choose the target DATE (reserved `plannedDate` userInput =
 *       the plugin modal's date field / the CLI `--date` param), defaulting to
 *       today; the chosen date drives the date-denoting label (`$today`) too.
 *   (B) auto-stamps `ems__Effort_plannedStartTimestamp` (and `_plannedEnd...`
 *       when endTime present) = chosenDate + that time, a FULL timezone-naive
 *       local dateTime "YYYY-MM-DDTHH:MM:SS".
 * When the prototype declares no time-of-day → unchanged (no planned timestamps,
 * no date prompt) — zero regression.
 *
 * Exercises the real `create_instance` pipeline through GroundingExecutor with
 * an in-memory file system (executor logic NOT mocked) + a frozen clock for a
 * deterministic "today". Mirrors `create-instance-body.test.ts`.
 *
 * Revert-verify ([[integration-test-revert-verify]]): with the propagation
 * neutralised (applyPrototypeTimePropagation call removed / startTime read
 * skipped), the default-date / explicit-date / only-start / full-timestamp
 * assertions FAIL; restored → PASS. The "prototype declares no time" scenario
 * stays GREEN both ways (intended no-op signal, not a false positive).
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { frozenClock } from "../../../src/services/IClock";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";

const REQ = "@req:57b03ab3-9666-4c5a-8f38-cf650e4f48d2";

// ---------------------------------------------------------------------------
// In-memory file system (shared between GroundingExecutor reads + writes)
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROTO_PATH = "/vault/breakfast-proto.md";
const PROTO_NO_END_PATH = "/vault/dinner-proto.md";
const PROTO_NO_TIME_PATH = "/vault/plain-proto.md";

/** Prototype carrying BOTH start + end time-of-day (Breakfast 09:45–10:15). */
const PROTO_WITH_TIMES = [
  "---",
  'exo__Asset_uid: "proto-breakfast-uid"',
  'exo__Asset_label: "Breakfast"',
  "exo__Instance_class:",
  '  - "[[df7e579d-02d4-4f3a-971f-3d1d785b689b]]"',
  'ems__EffortPrototype_startTime: "09:45"',
  'ems__EffortPrototype_endTime: "10:15"',
  "---",
  "",
].join("\n");

/** Prototype with ONLY a start time (Dinner 20:00, no end). */
const PROTO_ONLY_START = [
  "---",
  'exo__Asset_uid: "proto-dinner-uid"',
  'exo__Asset_label: "Dinner"',
  "exo__Instance_class:",
  '  - "[[df7e579d-02d4-4f3a-971f-3d1d785b689b]]"',
  'ems__EffortPrototype_startTime: "20:00"',
  "---",
  "",
].join("\n");

/** Prototype declaring NO time-of-day (control — no-op expected). */
const PROTO_WITHOUT_TIME = [
  "---",
  'exo__Asset_uid: "proto-plain-uid"',
  'exo__Asset_label: "Plain routine"',
  "exo__Instance_class:",
  '  - "[[df7e579d-02d4-4f3a-971f-3d1d785b689b]]"',
  "---",
  "",
].join("\n");

/** Prototype with a MALFORMED start time → must be skipped, never spliced. */
const PROTO_BAD_TIME = [
  "---",
  'exo__Asset_uid: "proto-bad-uid"',
  'exo__Asset_label: "Broken routine"',
  "exo__Instance_class:",
  '  - "[[df7e579d-02d4-4f3a-971f-3d1d785b689b]]"',
  'ems__EffortPrototype_startTime: "25:99"',
  "---",
  "",
].join("\n");
const PROTO_BAD_TIME_PATH = "/vault/broken-proto.md";

// create-task-instance-shaped grounding: InheritanceRule writes the prototype
// backlink (so needsTargetRead → targetFm is the prototype frontmatter), and a
// labelTemplate uses $today so we can assert the label denotes the chosen date.
const GROUNDING: GroundingDefinition = {
  id: "gnd-create-task-instance-ec15f83e",
  label: "Create Task Instance",
  type: GroundingType.CREATE_INSTANCE,
  targetClass: "ems__Task",
  targetFolder: "01 Inbox",
  labelTemplate: "$target.exo__Asset_label $today",
  inheritanceRule: [
    {
      sourcePropertyName: "exo__Asset_uid",
      targetPropertyName: "exo__Asset_prototype",
      targetClassExclusion: [],
      priority: 50,
    },
  ],
};

// Frozen clock → deterministic "today" = 2026-06-28. 12:00Z = 17:00 Asia/Almaty
// (UTC+5), maximally clear of BOTH the local and the UTC midnight edges — max
// tz-headroom so the now-local `$today` (DateFormatter.toDateString, #3809) and
// the UTC date agree here regardless of the port runner's timezone (#3811).
const FROZEN_TODAY = "2026-06-28";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitFrontmatterAndBody(content: string): { fm: string; body: string } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) return { fm: "", body: content };
  const fm = match[0];
  const body = content.slice(fm.length).replace(/^\r?\n/, "");
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe(`Integration: create_instance prototype-time propagation (ec15f83e) ${REQ}`, () => {
  let fs: InMemoryFileSystem;
  let groundingExecutor: GroundingExecutor;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.createFile(PROTO_PATH, PROTO_WITH_TIMES);
    await fs.createFile(PROTO_NO_END_PATH, PROTO_ONLY_START);
    await fs.createFile(PROTO_NO_TIME_PATH, PROTO_WITHOUT_TIME);
    await fs.createFile(PROTO_BAD_TIME_PATH, PROTO_BAD_TIME);
    const serviceRegistry = new ServiceRegistry();
    groundingExecutor = new GroundingExecutor(fs, fs, serviceRegistry, undefined, {
      clock: frozenClock(`${FROZEN_TODAY}T12:00:00Z`),
    });
  });

  /** The created instance file = the only path that is not a prototype fixture. */
  function createdContent(): string {
    const protos = new Set([
      PROTO_PATH,
      PROTO_NO_END_PATH,
      PROTO_NO_TIME_PATH,
      PROTO_BAD_TIME_PATH,
    ]);
    const path = fs.getAllPaths().find((p) => !protos.has(p));
    if (!path) throw new Error("No created file");
    return fs.getContent(path)!;
  }

  // Scenario: default target date is today.
  it(`${REQ} default target date is today → plannedStart/End = today + prototype time`, async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/breakfast-proto",
      PROTO_PATH,
      undefined, // no userInput → no explicit date → today
    );
    expect(result.success).toBe(true);

    const { fm } = splitFrontmatterAndBody(createdContent());
    expect(fm).toMatch(
      /ems__Effort_plannedStartTimestamp:\s*"?2026-06-28T09:45:00"?/,
    );
    expect(fm).toMatch(
      /ems__Effort_plannedEndTimestamp:\s*"?2026-06-28T10:15:00"?/,
    );
  });

  // Scenario: explicit target date is honoured (modal date field / CLI param).
  it(`${REQ} explicit plannedDate is honoured for timestamps AND the label`, async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/breakfast-proto",
      PROTO_PATH,
      { plannedDate: "2026-07-01" },
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    const { fm } = splitFrontmatterAndBody(content);

    expect(fm).toMatch(
      /ems__Effort_plannedStartTimestamp:\s*"?2026-07-01T09:45:00"?/,
    );
    expect(fm).toMatch(
      /ems__Effort_plannedEndTimestamp:\s*"?2026-07-01T10:15:00"?/,
    );
    // The label denotes the CHOSEN date, not today ($today → plannedDate).
    expect(fm).toMatch(/exo__Asset_label:\s*"?Breakfast 2026-07-01"?/);
    // The label's date is the chosen one — never today's date.
    expect(fm).not.toMatch(
      new RegExp(`exo__Asset_label:.*${FROZEN_TODAY}`),
    );
    // …but createdAt remains the REAL clock time (today), proving the split:
    // createdAt = now, label + planned timestamps = the chosen date.
    expect(fm).toMatch(
      new RegExp(`exo__Asset_createdAt:\\s*${FROZEN_TODAY}T`),
    );
    // `plannedDate` never leaks as a frontmatter key (reserved engine input).
    expect(fm).not.toMatch(/^plannedDate:/m);
    expect(content).not.toContain("\nplannedDate:");
  });

  // Scenario: prototype declares only a start time → only plannedStart.
  it(`${REQ} prototype with only startTime → instance gets only plannedStart`, async () => {
    await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/dinner-proto",
      PROTO_NO_END_PATH,
      { plannedDate: "2026-07-02" },
    );
    const { fm } = splitFrontmatterAndBody(createdContent());

    expect(fm).toMatch(
      /ems__Effort_plannedStartTimestamp:\s*"?2026-07-02T20:00:00"?/,
    );
    expect(fm).not.toContain("ems__Effort_plannedEndTimestamp");
  });

  // Scenario: prototype declares NO time-of-day → unchanged (no-op, no regression).
  // GREEN both ways under revert-verify — guards against over-eager stamping.
  it(`${REQ} prototype without time-of-day → no planned timestamps written`, async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/plain-proto",
      PROTO_NO_TIME_PATH,
      undefined,
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    expect(content).not.toContain("ems__Effort_plannedStartTimestamp");
    expect(content).not.toContain("ems__Effort_plannedEndTimestamp");
  });

  // Scenario: the planned value is a FULL date+time, timezone-naive.
  it(`${REQ} planned timestamp is a full timezone-naive dateTime, never bare HH:MM`, async () => {
    await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/breakfast-proto",
      PROTO_PATH,
      { plannedDate: "2026-07-01" },
    );
    const { fm } = splitFrontmatterAndBody(createdContent());

    const startMatch = fm.match(
      /ems__Effort_plannedStartTimestamp:\s*"?([^"\n]+)"?/,
    );
    expect(startMatch).not.toBeNull();
    const value = startMatch![1].trim().replace(/"$/, "");
    // Full "YYYY-MM-DDTHH:MM:SS".
    expect(value).toBe("2026-07-01T09:45:00");
    // Never the bare prototype "HH:MM".
    expect(value).not.toBe("09:45");
    // No timezone offset.
    expect(value).not.toContain("+05:00");
    expect(value).not.toContain("Z");
  });

  // Hardening (code-reviewer LOW): a malformed prototype time must be skipped,
  // never spliced into the typed planned*Timestamp as a garbage value.
  it(`${REQ} malformed prototype startTime is skipped, not written as a garbage timestamp`, async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/broken-proto",
      PROTO_BAD_TIME_PATH,
      undefined,
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    expect(content).not.toContain("ems__Effort_plannedStartTimestamp");
    expect(content).not.toContain("25:99");
  });
});
