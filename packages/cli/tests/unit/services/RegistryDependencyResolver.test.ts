/**
 * Unit tests for `RegistryDependencyResolver` (issue #3513, builds on #3511).
 *
 * Uses an on-disk temp registry fixture per test — exercises the real file walk
 * + yaml parse + closure resolution the CI gate hits (per `test-fixture-realism`,
 * mirrors the production registry descriptor shape rather than stubbing fs).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  RegistryDependencyResolver,
  ownerRepoSlug,
} from "../../../src/services/RegistryDependencyResolver.js";
import { ASSET_SPACE_CLASS_UID } from "../../../src/services/CliProfileResolver.js";

// Stable UIDs mirroring the real registry topology
//   exo → w3c ; public → exo ; shared-private → public ; my → shared-private + shared-kalashnikova
const UID_W3C = "01ef516e-c697-4988-b86c-472574e13cdc";
const UID_EXO = "e5c47526-e72f-42e3-8535-3d243dd2db94";
const UID_PUBLIC = "f80bb130-7d05-4399-8407-467be8bfbfc9";
const UID_SHARED_PRIVATE = "0857de05-7158-4988-a6e3-9fb47a267649";
const UID_SHARED_KALASH = "9415477b-841d-44df-8b87-90e33cd20590";
const UID_MY = "08dd15ed-c0f6-4772-9f0b-3519e2e2c87c";

interface DescSpec {
  uid: string;
  namespace?: string;
  source?: string;
  dependsOn?: Array<{ uid: string; alias: string }>;
  /** Override the instance class (default = AssetSpace) — for non-AS noise files. */
  instanceClass?: string;
}

async function makeRegistry(root: string, descs: DescSpec[]): Promise<void> {
  const dir = path.join(root, "registry");
  await fs.ensureDir(dir);
  for (const d of descs) {
    const lines = [
      "---",
      `exo__Asset_uid: ${d.uid}`,
      `exo__Instance_class:`,
      `  - "[[${d.instanceClass ?? ASSET_SPACE_CLASS_UID}]]"`,
    ];
    if (d.namespace !== undefined)
      lines.push(`exo__AssetSpace_namespace: "${d.namespace}"`);
    if (d.source !== undefined)
      lines.push(`exo__AssetSpace_source: "${d.source}"`);
    if (d.dependsOn && d.dependsOn.length > 0) {
      lines.push("exo__AssetSpace_dependsOn:");
      for (const dep of d.dependsOn)
        lines.push(`  - "[[${dep.uid}|${dep.alias}]]"`);
    }
    lines.push("---", "", `descriptor ${d.uid}`, "");
    await fs.writeFile(path.join(dir, `${d.uid}.md`), lines.join("\n"), "utf-8");
  }
}

/** The canonical 4-level chain used by most tests. */
function chainFixture(): DescSpec[] {
  return [
    { uid: UID_W3C, namespace: "w3c-aggregated", source: "https://github.com/kitelev/exoas-w3c-aggregated" },
    {
      uid: UID_EXO,
      namespace: "exo",
      source: "https://github.com/kitelev/exoas-exo",
      dependsOn: [{ uid: UID_W3C, alias: "exoas-w3c-aggregated" }],
    },
    {
      uid: UID_PUBLIC,
      namespace: "public",
      source: "https://github.com/kitelev/exoas-public",
      dependsOn: [{ uid: UID_EXO, alias: "exoas-exo" }],
    },
    {
      uid: UID_SHARED_PRIVATE,
      namespace: "shared-private",
      source: "https://github.com/kitelev/exoas-shared-private",
      dependsOn: [{ uid: UID_PUBLIC, alias: "exoas-public" }],
    },
    { uid: UID_SHARED_KALASH, namespace: "shared-kalashnikova", source: "https://github.com/kitelev/exoas-shared-kalashnikova", dependsOn: [{ uid: UID_PUBLIC, alias: "exoas-public" }] },
    {
      uid: UID_MY,
      namespace: "my",
      source: "https://github.com/kitelev/exoas-my",
      dependsOn: [
        { uid: UID_SHARED_PRIVATE, alias: "exoas-shared-private" },
        { uid: UID_SHARED_KALASH, alias: "exoas-shared-kalashnikova" },
      ],
    },
  ];
}

describe("RegistryDependencyResolver", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reg-dep-res-"));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  describe("scanRegistry", () => {
    it("parses every AssetSpace descriptor (uid, namespace, source, dependsOn)", async () => {
      await makeRegistry(tmp, chainFixture());
      const resolver = new RegistryDependencyResolver();
      const descs = await resolver.scanRegistry(path.join(tmp, "registry"));
      expect(descs.size).toBe(6);
      const exo = descs.get(UID_EXO);
      expect(exo).toMatchObject({
        uid: UID_EXO,
        namespace: "exo",
        source: "https://github.com/kitelev/exoas-exo",
        dependsOn: [UID_W3C],
      });
    });

    it("skips non-AssetSpace .md files (different instance class)", async () => {
      await makeRegistry(tmp, [
        { uid: UID_EXO, namespace: "exo", source: "https://github.com/kitelev/exoas-exo" },
        { uid: "deadbeef-0000-0000-0000-000000000000", instanceClass: "11111111-2222-3333-4444-555555555555" },
      ]);
      const resolver = new RegistryDependencyResolver();
      const descs = await resolver.scanRegistry(path.join(tmp, "registry"));
      expect(descs.size).toBe(1);
      expect(descs.has(UID_EXO)).toBe(true);
    });

    it("returns an empty map (with a warn) for a non-existent registry path", async () => {
      const warnings: string[] = [];
      const resolver = new RegistryDependencyResolver({ warn: (m) => warnings.push(m) });
      const descs = await resolver.scanRegistry(path.join(tmp, "does-not-exist"));
      expect(descs.size).toBe(0);
      expect(warnings.join("\n")).toMatch(/does not exist/);
    });
  });

  describe("resolve — closure", () => {
    it("resolves a floor repo (exo) to its single dependency (w3c)", async () => {
      await makeRegistry(tmp, chainFixture());
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "kitelev/exoas-exo");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      expect(out.self.uid).toBe(UID_EXO);
      expect(out.dependencies.map((d) => d.namespace)).toEqual(["w3c-aggregated"]);
    });

    it("resolves a mid-chain repo (public) transitively (exo → w3c)", async () => {
      await makeRegistry(tmp, chainFixture());
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "kitelev/exoas-public");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      // BFS order: direct dep first, then transitive
      expect(out.dependencies.map((d) => d.namespace)).toEqual(["exo", "w3c-aggregated"]);
    });

    it("resolves a multi-parent leaf (my) to the full transitive closure, deduped", async () => {
      await makeRegistry(tmp, chainFixture());
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "kitelev/exoas-my");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      const ns = new Set(out.dependencies.map((d) => d.namespace));
      // shared-private + shared-kalashnikova both reach public→exo→w3c; deduped
      expect(ns).toEqual(
        new Set(["shared-private", "shared-kalashnikova", "public", "exo", "w3c-aggregated"]),
      );
      // self excluded
      expect(out.dependencies.find((d) => d.uid === UID_MY)).toBeUndefined();
      // each appears exactly once
      expect(out.dependencies.length).toBe(5);
    });

    it("emits dependency clone URLs (the urls payload) from descriptor sources", async () => {
      await makeRegistry(tmp, chainFixture());
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "kitelev/exoas-public");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      expect(out.dependencies.map((d) => d.source)).toEqual([
        "https://github.com/kitelev/exoas-exo",
        "https://github.com/kitelev/exoas-w3c-aggregated",
      ]);
    });
  });

  describe("resolve — self matching", () => {
    beforeEach(async () => {
      await makeRegistry(tmp, chainFixture());
    });

    it("matches by full https git URL", async () => {
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "https://github.com/kitelev/exoas-exo");
      expect(out.outcome === "resolved" && out.self.uid).toBe(UID_EXO);
    });

    it("matches by scp-form ssh URL", async () => {
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "git@github.com:kitelev/exoas-exo.git");
      expect(out.outcome === "resolved" && out.self.uid).toBe(UID_EXO);
    });

    it("matches by bare namespace", async () => {
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "public");
      expect(out.outcome === "resolved" && out.self.uid).toBe(UID_PUBLIC);
    });

    it("returns self-not-found for an unregistered repo", async () => {
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "kitelev/exoas-ems");
      expect(out.outcome).toBe("self-not-found");
      if (out.outcome !== "self-not-found") return;
      expect(out.descriptorCount).toBe(6);
    });
  });

  describe("resolve — diagnostics", () => {
    it("surfaces dangling dependsOn edges (missing descriptor)", async () => {
      await makeRegistry(tmp, [
        {
          uid: UID_EXO,
          namespace: "exo",
          source: "https://github.com/kitelev/exoas-exo",
          dependsOn: [{ uid: "ffffffff-0000-0000-0000-000000000000", alias: "exoas-ghost" }],
        },
      ]);
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "exo");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      expect(out.missingDescriptors).toEqual(["ffffffff-0000-0000-0000-000000000000"]);
      expect(out.dependencies).toHaveLength(0);
    });

    it("surfaces sourceless dependency descriptors (cannot clone)", async () => {
      await makeRegistry(tmp, [
        {
          uid: UID_EXO,
          namespace: "exo",
          source: "https://github.com/kitelev/exoas-exo",
          dependsOn: [{ uid: UID_W3C, alias: "exoas-w3c-aggregated" }],
        },
        { uid: UID_W3C, namespace: "w3c-aggregated" /* no source */ },
      ]);
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "exo");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      expect(out.sourceless.map((d) => d.uid)).toEqual([UID_W3C]);
    });

    it("terminates on a cyclic dependsOn DAG (cycle-guard)", async () => {
      // a → b → a
      const A = "aaaaaaaa-0000-0000-0000-000000000000";
      const B = "bbbbbbbb-0000-0000-0000-000000000000";
      await makeRegistry(tmp, [
        { uid: A, namespace: "a", source: "https://github.com/kitelev/exoas-a", dependsOn: [{ uid: B, alias: "b" }] },
        { uid: B, namespace: "b", source: "https://github.com/kitelev/exoas-b", dependsOn: [{ uid: A, alias: "a" }] },
      ]);
      const resolver = new RegistryDependencyResolver();
      const out = await resolver.resolve(path.join(tmp, "registry"), "a");
      expect(out.outcome).toBe("resolved");
      if (out.outcome !== "resolved") return;
      // closure of a = {a, b}; deps (excl. self) = {b}
      expect(out.dependencies.map((d) => d.namespace)).toEqual(["b"]);
    });
  });
});

describe("ownerRepoSlug", () => {
  it("derives owner/repo from an https URL", () => {
    expect(ownerRepoSlug("https://github.com/kitelev/exoas-exo")).toBe("kitelev/exoas-exo");
  });
  it("derives owner/repo from a scp-form ssh URL with .git", () => {
    expect(ownerRepoSlug("git@github.com:kitelev/exoas-exo.git")).toBe("kitelev/exoas-exo");
  });
  it("accepts a bare owner/repo slug (github.repository form)", () => {
    expect(ownerRepoSlug("kitelev/exoas-exo")).toBe("kitelev/exoas-exo");
  });
  it("lowercases for case-insensitive matching", () => {
    expect(ownerRepoSlug("Kitelev/Exoas-Exo")).toBe("kitelev/exoas-exo");
  });
  it("returns null for an unparseable identifier", () => {
    expect(ownerRepoSlug("just-a-namespace")).toBeNull();
    expect(ownerRepoSlug("")).toBeNull();
  });
});
