import * as yaml from "js-yaml";
import { classifySpaceDeclaration, type YamlCodec } from "@kitelev/exocortex-core";
import {
  RegisterForSyncCommand,
  type RegisterForSyncDeps,
} from "../../../../src/infrastructure/adapters/RegisterForSyncCommand";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-06-28T15:00:00+05:00";

/** Same CORE_SCHEMA codec the plugin wires in production (coreSchemaYamlCodec). */
const codec: YamlCodec = {
  parse: (t) => yaml.load(t, { schema: yaml.CORE_SCHEMA }),
  stringify: (v) => yaml.dump(v, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

interface Written {
  mountPath: string;
  fileName: string;
  content: string;
}

interface Harness {
  cmd: RegisterForSyncCommand;
  written: Written[];
  notices: string[];
  reindexCalls: number;
  deps: RegisterForSyncDeps;
}

function makeCmd(opts: {
  packs?: string[];
  pick?: string | null;
  ownership?: boolean | null;
  hasDescriptor?: boolean;
  writeThrows?: boolean;
} = {}): Harness {
  const written: Written[] = [];
  const notices: string[] = [];
  let reindexCalls = 0;
  const deps: RegisterForSyncDeps = {
    listUnregisteredPacks: async () =>
      opts.packs ?? ["assetspaces/kitelev/exoas-foo"],
    pickPack: async () => opts.pick ?? null,
    probeOwnership: async () =>
      opts.ownership === undefined ? null : opts.ownership,
    ...(opts.hasDescriptor !== undefined
      ? { hasDescriptor: async () => opts.hasDescriptor! }
      : {}),
    newUid: () => UID,
    now: () => NOW,
    codec,
    writeDescriptor: async (mountPath, fileName, content) => {
      if (opts.writeThrows) throw new Error("EACCES: read-only folder");
      written.push({ mountPath, fileName, content });
    },
    notify: (m) => notices.push(m),
    onMaterialized: async () => {
      reindexCalls++;
    },
  };
  return { cmd: new RegisterForSyncCommand(deps), written, notices, reindexCalls: 0, deps };
}

/** Parse the frontmatter object out of a written descriptor file. */
function parseFrontmatter(content: string): Record<string, unknown> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (m === null) throw new Error("no frontmatter block");
  return yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>;
}

describe("RegisterForSyncCommand (#3707)", () => {
  it("@req:f3465725-b02d-4d20-b05a-69881a783552 writes a descriptor that the REAL ExoSync discriminator enumerates into the sync set", async () => {
    // Revert-verify binding: the command writes the descriptor; we feed exactly
    // that descriptor through the genuine sync-set discriminator
    // (classifySpaceDeclaration). With the descriptor builder in place this is a
    // sync candidate (pack ENTERS the materialized set, GREEN); reverting the
    // builder (omit instance_class / _source) makes it a non-sync-unit (pack
    // stays OUT, RED). al-3707-register-sync, 2026-06-28.
    const h = makeCmd({ packs: ["assetspaces/kitelev/exoas-foo"] });
    await h.cmd.invoke();

    expect(h.written).toHaveLength(1);
    const w = h.written[0];
    expect(w.mountPath).toBe("assetspaces/kitelev/exoas-foo");
    expect(w.fileName).toBe(`${UID}.md`);

    const fm = parseFrontmatter(w.content);
    const verdict = classifySpaceDeclaration(
      fm,
      `${w.mountPath}/${w.fileName}`,
    );
    expect(verdict.kind).toBe("candidate");
    if (verdict.kind === "candidate") {
      // The pack is now in the materialized sync set under its derived repoKey.
      expect(verdict.candidate.spec.repoKey).toBe("kitelev/exoas-foo#main");
      expect(verdict.candidate.spec.localPath).toBe(
        "assetspaces/kitelev/exoas-foo",
      );
    }
  });

  it("auto-fills the source URL from the canonical Maven mount path", async () => {
    const h = makeCmd({ packs: ["assetspaces/kitelev/exoas-bar"] });
    await h.cmd.invoke();
    const fm = parseFrontmatter(h.written[0].content);
    expect(fm["exo__AssetSpace_source"]).toBe(
      "https://github.com/kitelev/exoas-bar",
    );
  });

  it("HONESTLY refuses a non-canonical (un-derivable) mount path — no write, no false success", async () => {
    // A flat / non-`assetspaces/<owner>/<repo>` folder has no determinable GitHub
    // source; registering it would write a descriptor whose derived localPath
    // could not match the folder, so it would never sync — refuse instead.
    let reindexed = 0;
    const h = makeCmd({ packs: ["assetspaces/legacyflat"] });
    h.deps.onMaterialized = async () => {
      reindexed++;
    };
    await h.cmd.invoke();
    expect(h.written).toHaveLength(0);
    expect(reindexed).toBe(0);
    expect(h.notices.join("\n")).toMatch(/cannot be determined|cannot register/);
  });

  it("reindexes after a successful write", async () => {
    let reindexed = 0;
    const h = makeCmd();
    h.deps.onMaterialized = async () => {
      reindexed++;
    };
    await h.cmd.invoke();
    expect(reindexed).toBe(1);
  });

  it("OWNED pack → claims pull AND push", async () => {
    const h = makeCmd({ ownership: true });
    await h.cmd.invoke();
    expect(h.notices.join("\n")).toMatch(/pull AND push/);
  });

  it("READ-ONLY pack → pull-only warning, never a push claim", async () => {
    const h = makeCmd({ ownership: false });
    await h.cmd.invoke();
    const joined = h.notices.join("\n");
    expect(joined).toMatch(/pull-only/);
    expect(joined).not.toMatch(/pull AND push/);
  });

  it("UNKNOWN ownership (no token) → set-a-token nudge", async () => {
    const h = makeCmd({ ownership: null });
    await h.cmd.invoke();
    expect(h.notices.join("\n")).toMatch(/Set a GitHub token/);
  });

  it("nothing to register → notice, no write, no reindex", async () => {
    let reindexed = 0;
    const h = makeCmd({ packs: [] });
    h.deps.onMaterialized = async () => {
      reindexed++;
    };
    await h.cmd.invoke();
    expect(h.written).toHaveLength(0);
    expect(reindexed).toBe(0);
    expect(h.notices.join("\n")).toMatch(/nothing to do/);
  });

  it("multiple packs → uses the picker; cancel writes nothing", async () => {
    const h = makeCmd({
      packs: ["assetspaces/kitelev/exoas-a", "assetspaces/kitelev/exoas-b"],
      pick: null, // user cancels
    });
    await h.cmd.invoke();
    expect(h.written).toHaveLength(0);
  });

  it("multiple packs → registers the picked one", async () => {
    const h = makeCmd({
      packs: ["assetspaces/kitelev/exoas-a", "assetspaces/kitelev/exoas-b"],
      pick: "assetspaces/kitelev/exoas-b",
    });
    await h.cmd.invoke();
    expect(h.written).toHaveLength(1);
    expect(h.written[0].mountPath).toBe("assetspaces/kitelev/exoas-b");
    const fm = parseFrontmatter(h.written[0].content);
    expect(fm["exo__AssetSpace_namespace"]).toBe("b");
  });

  it("read-only FOLDER (write throws) → warns and does NOT reindex", async () => {
    let reindexed = 0;
    const h = makeCmd({ writeThrows: true });
    h.deps.onMaterialized = async () => {
      reindexed++;
    };
    await h.cmd.invoke();
    expect(h.written).toHaveLength(0);
    expect(reindexed).toBe(0);
    expect(h.notices.join("\n")).toMatch(/could not write the descriptor/);
  });

  it("already-registered pack (hasDescriptor) → skips the write", async () => {
    const h = makeCmd({ hasDescriptor: true });
    await h.cmd.invoke();
    expect(h.written).toHaveLength(0);
    expect(h.notices.join("\n")).toMatch(/already has a descriptor/);
  });
});
