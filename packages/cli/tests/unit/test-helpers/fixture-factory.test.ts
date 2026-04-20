/**
 * Unit tests for the integration-layer `fixture-factory.ts` helper.
 *
 * RFC v4 §12 PR-readiness gate pairs `tests/integration/**\/test-helpers/` with
 * `tests/unit/**\/test-helpers/`. This suite keeps the factory's contract
 * self-enforcing without relying on the starter-kit submodule or jest plumbing.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildFixture,
  cleanupFixtureRoot,
  makeFixtureRoot,
  uuidFromSeed,
} from "../../integration/starter-kit/test-helpers/fixture-factory.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidFromSeed", () => {
  it("produces a UUIDv5-shaped identifier", () => {
    const uid = uuidFromSeed("some-seed");
    expect(uid).toMatch(UUID_RE);
  });

  it("is deterministic across invocations", () => {
    expect(uuidFromSeed("cmd-a::case-1")).toBe(uuidFromSeed("cmd-a::case-1"));
  });

  it("produces distinct UIDs for distinct seeds", () => {
    const a = uuidFromSeed("cmd-a::case-1");
    const b = uuidFromSeed("cmd-a::case-2");
    const c = uuidFromSeed("cmd-b::case-1");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("treats empty string as a valid seed (still UUID-shaped)", () => {
    expect(uuidFromSeed("")).toMatch(UUID_RE);
  });
});

describe("makeFixtureRoot / cleanupFixtureRoot", () => {
  it("creates a fresh empty directory under os.tmpdir()", () => {
    const root = makeFixtureRoot();
    try {
      expect(fs.existsSync(root)).toBe(true);
      expect(fs.readdirSync(root)).toEqual([]);
      expect(root.startsWith(os.tmpdir())).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("allocates distinct roots on repeated calls (parallel-safe)", () => {
    const a = makeFixtureRoot();
    const b = makeFixtureRoot();
    try {
      expect(a).not.toBe(b);
    } finally {
      cleanupFixtureRoot(a);
      cleanupFixtureRoot(b);
    }
  });

  it("respects a custom prefix", () => {
    const root = makeFixtureRoot("unit-fixture-prefix-");
    try {
      expect(path.basename(root)).toMatch(/^unit-fixture-prefix-/);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("cleanupFixtureRoot is idempotent / no-op on missing paths", () => {
    const root = makeFixtureRoot();
    cleanupFixtureRoot(root);
    expect(() => cleanupFixtureRoot(root)).not.toThrow();
    expect(() => cleanupFixtureRoot("")).not.toThrow();
  });
});

describe("buildFixture", () => {
  it("materialises a .md file with the deterministic UID as basename", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "deterministic-seed-1",
        root,
      });
      expect(asset.uid).toMatch(UUID_RE);
      expect(asset.path).toBe(path.join(root, `${asset.uid}.md`));
      expect(fs.existsSync(asset.path)).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("emits valid frontmatter with class wikilink and alias", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Project",
        seed: "seed-project",
        label: "My Fixture Project",
        root,
      });
      const content = fs.readFileSync(asset.path, "utf8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain(`exo__Asset_uid: "${asset.uid}"`);
      expect(content).toContain(`exo__Asset_label: "My Fixture Project"`);
      expect(content).toContain(`- "[[ems__Project]]"`);
      expect(content).toContain(`- "My Fixture Project"`);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("falls back to `Fixture for <seed>` label when label omitted", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "labelless",
        root,
      });
      expect(asset.label).toBe("Fixture for labelless");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("merges extraFrontmatter on top of the skeleton", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "extras",
        root,
        extraFrontmatter: {
          ems__Effort_status: `"[[ems__EffortStatusBacklog]]"`,
          tags: ["fixture", "smoke"],
        },
      });
      const content = fs.readFileSync(asset.path, "utf8");
      expect(content).toContain("ems__Effort_status");
      expect(content).toContain("ems__EffortStatusBacklog");
      expect(content).toContain("tags:");
      expect(content).toContain(`- "fixture"`);
      expect(content).toContain(`- "smoke"`);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("emits a stable Obsidian-style targetIRI", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "iri-shape",
        root,
      });
      expect(asset.targetIRI).toBe(`obsidian://vault/${asset.uid}`);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("refuses to overwrite an existing fixture (seed collision)", () => {
    const root = makeFixtureRoot();
    try {
      buildFixture({ className: "ems__Task", seed: "collide", root });
      expect(() =>
        buildFixture({ className: "ems__Task", seed: "collide", root }),
      ).toThrow(/refusing to overwrite/);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("throws when root is missing or unset", () => {
    expect(() =>
      buildFixture({
        className: "ems__Task",
        seed: "no-root",
        root: "",
      }),
    ).toThrow(/root does not exist/);

    const fake = path.join(os.tmpdir(), `never-made-${Date.now()}`);
    expect(() =>
      buildFixture({ className: "ems__Task", seed: "fake-root", root: fake }),
    ).toThrow(/root does not exist/);
  });

  it("encodes object-valued frontmatter as inline JSON", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "json-object",
        root,
        extraFrontmatter: {
          custom__Nested: { property: "value", other: 1 },
        },
      });
      const content = fs.readFileSync(asset.path, "utf8");
      expect(content).toContain(
        `custom__Nested: {"property":"value","other":1}`,
      );
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("round-trips the body heading with the asset label", () => {
    const root = makeFixtureRoot();
    try {
      const asset = buildFixture({
        className: "ems__Task",
        seed: "body",
        label: "Body Heading Sample",
        root,
      });
      const content = fs.readFileSync(asset.path, "utf8");
      expect(content.endsWith("# Body Heading Sample\n")).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
