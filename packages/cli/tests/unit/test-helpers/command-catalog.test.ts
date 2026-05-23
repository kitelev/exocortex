/**
 * Unit tests for the integration-layer `command-catalog.ts` helper.
 *
 * RFC v4 §12 PR-readiness gate: every helper under
 * `tests/integration/**\/test-helpers/` MUST have a matching unit test under
 * `tests/unit/**\/test-helpers/`. This is the pair for
 * `tests/integration/commands/test-helpers/command-catalog.ts`.
 *
 * Strategy: dependency injection via `LoadOptions` (in-memory file list +
 * reader). Avoids `jest.unstable_mockModule` — see memory
 * `feedback_jest_esm_mock_named_exports` for the named-export trap.
 */
import { describe, it, expect, jest } from "@jest/globals";
import * as fsNode from "fs";
import {
  loadCommandCatalog,
  loadActiveCommandCatalog,
  classifyCommand,
  buildClassLabelToUuid,
  EXOCMD_COMMAND_CLASS_UUID,
  EXO_CLASS_META_UUID,
  KNOWN_BROKEN_UUIDS,
  type CommandCatalogEntry,
} from "../../integration/commands/test-helpers/command-catalog.js";

// ---------------------------------------------------------------------------
// Fixture factory — builds in-memory frontmatter so every test case is
// self-describing and no submodule access is required.
// ---------------------------------------------------------------------------

interface InMemoryFixture {
  [path: string]: string;
}

function fm(body: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) {
        lines.push(`  - "${String(v).replace(/"/g, '\\"')}"`);
      }
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function commandFrontmatter(
  uid: string,
  label: string,
  classRef: string,
  extras: Record<string, unknown> = {},
): string {
  return fm({
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [classRef],
    ...extras,
  });
}

function makeOptions(files: InMemoryFixture) {
  return {
    fixturesRoot: "/mock-fixtures",
    listMarkdownFiles: () => Object.keys(files),
    readFile: (p: string) => {
      if (!(p in files)) {
        throw new Error(`ENOENT: mock has no entry for ${p}`);
      }
      return files[p];
    },
  };
}

// ---------------------------------------------------------------------------
// buildClassLabelToUuid
// ---------------------------------------------------------------------------

describe("buildClassLabelToUuid", () => {
  it("indexes class definitions by label → uid", () => {
    const parsed = [
      {
        path: "/a.md",
        fm: {
          exo__Asset_label: "exocmd__Command",
          exo__Asset_uid: EXOCMD_COMMAND_CLASS_UUID,
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
      {
        path: "/b.md",
        fm: {
          exo__Asset_label: "ems__Task",
          exo__Asset_uid: "task-uid",
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
    ];
    const index = buildClassLabelToUuid(parsed);
    expect(index.get("exocmd__Command")).toBe(EXOCMD_COMMAND_CLASS_UUID);
    expect(index.get("ems__Task")).toBe("task-uid");
    expect(index.size).toBe(2);
  });

  it("accepts `[[exo__Class]]` label wikilink and bare `exo__Class`", () => {
    const parsed = [
      {
        path: "/a.md",
        fm: {
          exo__Asset_label: "A",
          exo__Asset_uid: "a",
          exo__Instance_class: "[[exo__Class]]",
        },
      },
      {
        path: "/b.md",
        fm: {
          exo__Asset_label: "B",
          exo__Asset_uid: "b",
          exo__Instance_class: "exo__Class",
        },
      },
    ];
    const index = buildClassLabelToUuid(parsed);
    expect(index.get("A")).toBe("a");
    expect(index.get("B")).toBe("b");
  });

  it("keeps the first-seen uid when a label collides (deterministic)", () => {
    const parsed = [
      {
        path: "/a.md",
        fm: {
          exo__Asset_label: "Dup",
          exo__Asset_uid: "first",
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
      {
        path: "/b.md",
        fm: {
          exo__Asset_label: "Dup",
          exo__Asset_uid: "second",
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
    ];
    expect(buildClassLabelToUuid(parsed).get("Dup")).toBe("first");
  });

  it("ignores non-class assets", () => {
    const parsed = [
      {
        path: "/a.md",
        fm: {
          exo__Asset_label: "NotAClass",
          exo__Asset_uid: "x",
          exo__Instance_class: [`[[${EXOCMD_COMMAND_CLASS_UUID}]]`],
        },
      },
    ];
    expect(buildClassLabelToUuid(parsed).size).toBe(0);
  });

  it("skips class defs missing label or uid", () => {
    const parsed = [
      {
        path: "/a.md",
        fm: {
          exo__Asset_label: "Only label",
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
      {
        path: "/b.md",
        fm: {
          exo__Asset_uid: "only-uid",
          exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
        },
      },
    ];
    expect(buildClassLabelToUuid(parsed).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadCommandCatalog — happy paths
// ---------------------------------------------------------------------------

describe("loadCommandCatalog — UUID wikilink filter", () => {
  it("returns Commands referenced by canonical class UUID wikilink", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/cmd-a.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Command A",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
        { exocmd__Command_icon: "star", exocmd__Command_category: "creation" },
      ),
      "/mock-fixtures/exocmd/cmd-b.md": commandFrontmatter(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "Command B",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.length).toBe(2);
    expect(catalog.map((c) => c.uid)).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
    expect(catalog[0].icon).toBe("star");
    expect(catalog[0].category).toBe("creation");
  });

  it("returns Commands referenced by resolved label wikilink", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/ontology.md": fm({
        exo__Asset_uid: EXOCMD_COMMAND_CLASS_UUID,
        exo__Asset_label: "exocmd__Command",
        exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
      }),
      "/mock-fixtures/exocmd/cmd-label.md": commandFrontmatter(
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "Label-form command",
        "[[exocmd__Command]]",
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.map((c) => c.uid)).toEqual([
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
    ]);
  });

  it("returns Commands referenced by bare label string", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/cmd.md": commandFrontmatter(
        "dddddddd-dddd-dddd-dddd-dddddddddddd",
        "Bare-label command",
        "exocmd__Command",
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.length).toBe(1);
  });

  it("resolves arbitrary legacy class label via reverse index", () => {
    // Simulate a future-legacy shape: an older class label that still
    // points to the Command class UUID in the ontology table.
    const files: InMemoryFixture = {
      "/mock-fixtures/ontology.md": fm({
        exo__Asset_uid: EXOCMD_COMMAND_CLASS_UUID,
        exo__Asset_label: "LegacyCommandLabel",
        exo__Instance_class: [`[[${EXO_CLASS_META_UUID}]]`],
      }),
      "/mock-fixtures/exocmd/cmd.md": commandFrontmatter(
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "Legacy label command",
        "[[LegacyCommandLabel]]",
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.length).toBe(1);
  });

  it("handles a single-value (non-array) `exo__Instance_class`", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/cmd.md": fm({
        exo__Asset_uid: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        exo__Asset_label: "Scalar class",
        exo__Instance_class: `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      }),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.length).toBe(1);
  });

  it("sorts the catalog deterministically by uid", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/zzz.md": commandFrontmatter(
        "22222222-2222-2222-2222-222222222222",
        "Z",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
      "/mock-fixtures/exocmd/aaa.md": commandFrontmatter(
        "11111111-1111-1111-1111-111111111111",
        "A",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.map((c) => c.uid)).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
  });
});

// ---------------------------------------------------------------------------
// loadCommandCatalog — exclusions
// ---------------------------------------------------------------------------

describe("loadCommandCatalog — exclusions", () => {
  it("returns [] for an empty fixture set (does not crash)", () => {
    expect(loadCommandCatalog(makeOptions({}))).toEqual([]);
  });

  it("excludes property-definition stubs that only reference Command via domain", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/prop.md": fm({
        exo__Asset_uid: "025fafe0-a42b-4b39-b917-ae8c3b2b1f59",
        exo__Asset_label: "exocmd__Command_confirmMessage",
        exo__Instance_class: ["[[30d63ce4-e574-456c-8de8-2bf1a53688c1]]"],
        exo__Property_domain: `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      }),
      "/mock-fixtures/exocmd/real-cmd.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Real",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const catalog = loadCommandCatalog(makeOptions(files));
    expect(catalog.map((c) => c.label)).toEqual(["Real"]);
  });

  it("excludes non-Command classes (e.g. inbox__Asset)", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/inbox/asset.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Inbox asset",
        "[[inbox__Asset]]",
      ),
    };
    expect(loadCommandCatalog(makeOptions(files))).toEqual([]);
  });

  it("skips files with no frontmatter and notifies onSkip", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/body-only.md": "# Heading\n\nNo frontmatter here.\n",
    };
    const onSkip = jest.fn();
    const catalog = loadCommandCatalog({ ...makeOptions(files), onSkip });
    expect(catalog).toEqual([]);
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no_frontmatter" }),
    );
  });

  it("skips malformed YAML without crashing", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/broken.md":
        "---\nexo__Asset_uid: x\n  bad: indent: here\n---\n",
      "/mock-fixtures/ok.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Survivor",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const onSkip = jest.fn();
    const catalog = loadCommandCatalog({ ...makeOptions(files), onSkip });
    expect(catalog.map((c) => c.label)).toEqual(["Survivor"]);
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "yaml_parse_error" }),
    );
  });

  it("skips read errors and notifies onSkip", () => {
    const onSkip = jest.fn();
    const catalog = loadCommandCatalog({
      fixturesRoot: "/mock-fixtures",
      listMarkdownFiles: () => ["/mock-fixtures/vanished.md"],
      readFile: () => {
        throw new Error("ENOENT");
      },
      onSkip,
    });
    expect(catalog).toEqual([]);
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "read_error" }),
    );
  });

  it("skips entries missing uid or label", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/no-uid.md": fm({
        exo__Asset_label: "No UID",
        exo__Instance_class: [`[[${EXOCMD_COMMAND_CLASS_UUID}]]`],
      }),
      "/mock-fixtures/no-label.md": fm({
        exo__Asset_uid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        exo__Instance_class: [`[[${EXOCMD_COMMAND_CLASS_UUID}]]`],
      }),
    };
    const onSkip = jest.fn();
    const catalog = loadCommandCatalog({ ...makeOptions(files), onSkip });
    expect(catalog).toEqual([]);
    const reasons = onSkip.mock.calls.map(
      (c) => (c[0] as { reason: string }).reason,
    );
    expect(reasons).toContain("missing_uid");
    expect(reasons).toContain("missing_label");
  });

  it("exposes `raw` frontmatter so downstream helpers can read custom keys", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/cmd.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Custom",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
        { custom__Field: "custom-value" },
      ),
    };
    const [entry] = loadCommandCatalog(makeOptions(files));
    expect(entry.raw["custom__Field"]).toBe("custom-value");
  });
});

// ---------------------------------------------------------------------------
// Default resolution paths — light smoke (full path coverage comes from the
// integration self-test hitting the real submodule).
// ---------------------------------------------------------------------------

describe("loadCommandCatalog — defaults", () => {
  it("uses defaultListMarkdownFiles when `listMarkdownFiles` omitted", () => {
    // The default walker reads from disk; point it at an empty tmp dir via
    // fixturesRoot to exercise the directory-walk branch without touching
    // the submodule.
    const tmp = "/tmp/command-catalog-empty-" + Date.now();
    fsNode.mkdirSync(tmp, { recursive: true });
    try {
      const catalog = loadCommandCatalog({ fixturesRoot: tmp });
      expect(catalog).toEqual([]);
    } finally {
      fsNode.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("default walker skips non-existent roots without throwing", () => {
    const catalog = loadCommandCatalog({
      fixturesRoot: "/definitely-does-not-exist-" + Date.now(),
    });
    expect(catalog).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KNOWN_BROKEN_UUIDS / classifyCommand / loadActiveCommandCatalog
// (Phase 2 — RFC v4 §4.0 stopgap filter, §12 gate)
// ---------------------------------------------------------------------------

function entryFor(
  uid: string,
  overrides: Partial<CommandCatalogEntry> = {},
): CommandCatalogEntry {
  return {
    uid,
    label: overrides.label ?? `Cmd ${uid.slice(0, 4)}`,
    path: overrides.path ?? `/mock/${uid}.md`,
    classUuid: EXOCMD_COMMAND_CLASS_UUID,
    icon: overrides.icon,
    category: overrides.category,
    grounding: overrides.grounding,
    precondition: overrides.precondition,
    targetClass: overrides.targetClass,
    raw: overrides.raw ?? {},
  };
}

describe("KNOWN_BROKEN_UUIDS", () => {
  it("contains exactly the 3 criticality Command UUIDs", () => {
    expect(KNOWN_BROKEN_UUIDS.size).toBe(3);
    expect(KNOWN_BROKEN_UUIDS.has("6b2f1cc6-a9f4-452a-93be-79b531188a62")).toBe(true);
    expect(KNOWN_BROKEN_UUIDS.has("e64dd9bd-49b6-480c-8e62-baaf6cab81fc")).toBe(true);
    expect(KNOWN_BROKEN_UUIDS.has("828c4653-cae2-446e-8d47-2826f8638bd9")).toBe(true);
  });
});

describe("classifyCommand", () => {
  it("returns 'broken' for each KNOWN_BROKEN UUID", () => {
    for (const uid of KNOWN_BROKEN_UUIDS) {
      expect(classifyCommand(entryFor(uid))).toBe("broken");
    }
  });

  it("returns 'active' for an unknown UUID with no state override", () => {
    expect(
      classifyCommand(entryFor("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")),
    ).toBe("active");
  });

  it("honours explicit exocmd__Command_state=broken even for active UUIDs", () => {
    const e = entryFor("11111111-1111-1111-1111-111111111111", {
      raw: { exocmd__Command_state: "broken" },
    });
    expect(classifyCommand(e)).toBe("broken");
  });

  it("honours explicit exocmd__Command_state=deprecated", () => {
    const e = entryFor("22222222-2222-2222-2222-222222222222", {
      raw: { exocmd__Command_state: "deprecated" },
    });
    expect(classifyCommand(e)).toBe("deprecated");
  });

  it("honours explicit exocmd__Command_state=active even for a KNOWN_BROKEN UUID", () => {
    const broken = [...KNOWN_BROKEN_UUIDS][0];
    const e = entryFor(broken, {
      raw: { exocmd__Command_state: "active" },
    });
    expect(classifyCommand(e)).toBe("active");
  });

  it("ignores unrecognised exocmd__Command_state values (falls through)", () => {
    const broken = [...KNOWN_BROKEN_UUIDS][0];
    const e = entryFor(broken, {
      raw: { exocmd__Command_state: "whatever" },
    });
    // Falls back to KNOWN_BROKEN → broken.
    expect(classifyCommand(e)).toBe("broken");
    const fresh = entryFor("99999999-9999-9999-9999-999999999999", {
      raw: { exocmd__Command_state: 42 },
    });
    expect(classifyCommand(fresh)).toBe("active");
  });
});

describe("loadActiveCommandCatalog", () => {
  it("filters out entries whose UUIDs are in KNOWN_BROKEN_UUIDS", () => {
    const brokenUid = [...KNOWN_BROKEN_UUIDS][0];
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/broken.md": commandFrontmatter(
        brokenUid,
        "Known Broken",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
      "/mock-fixtures/exocmd/active.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Alive",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const active = loadActiveCommandCatalog(makeOptions(files));
    expect(active.map((c) => c.label)).toEqual(["Alive"]);
  });

  it("returns the raw catalog unchanged when none of the entries are broken", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/a.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "A",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
      "/mock-fixtures/exocmd/b.md": commandFrontmatter(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "B",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    const raw = loadCommandCatalog(makeOptions(files));
    const active = loadActiveCommandCatalog(makeOptions(files));
    expect(active.length).toBe(raw.length);
    expect(active.map((c) => c.uid)).toEqual(raw.map((c) => c.uid));
  });

  it("preserves determinism — filtered output still sorted by uid", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/z.md": commandFrontmatter(
        "22222222-2222-2222-2222-222222222222",
        "Z",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
      "/mock-fixtures/exocmd/a.md": commandFrontmatter(
        "11111111-1111-1111-1111-111111111111",
        "A",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    expect(
      loadActiveCommandCatalog(makeOptions(files)).map((c) => c.uid),
    ).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
  });

  it("propagates explicit exocmd__Command_state=broken frontmatter", () => {
    const files: InMemoryFixture = {
      "/mock-fixtures/exocmd/marked.md": commandFrontmatter(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Marked broken",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
        { exocmd__Command_state: "broken" },
      ),
      "/mock-fixtures/exocmd/alive.md": commandFrontmatter(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "Alive",
        `[[${EXOCMD_COMMAND_CLASS_UUID}]]`,
      ),
    };
    expect(
      loadActiveCommandCatalog(makeOptions(files)).map((c) => c.label),
    ).toEqual(["Alive"]);
  });
});
