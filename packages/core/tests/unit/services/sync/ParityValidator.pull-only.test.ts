/**
 * req c0810b83 — the parity harness and pull-only repos.
 *
 *  - V1: the plugin's POST-SYNC round snapshots dirty paths before the sync
 *    and flags an edit that «survived nowhere» as an M1 conservation
 *    violation. A pull-only mirror erases local edits BY CONTRACT, so for a
 *    pull-only repo that detector must stay silent — otherwise every pull
 *    that undoes a substitution would be journalled as a lost edit.
 *  - V2: every report of a pull-only repo carries `pullOnly: true` (also when
 *    the check itself errors); an ordinary repo's report has no such key.
 */

import { describe, expect, it } from "@jest/globals";
import * as yaml from "js-yaml";
import {
  ParityValidator,
  SyncEngine,
  type SyncRepoSpec,
  type YamlCodec,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

const FILE = "assets/a.md";
const BASE = mdAsset("u1", "canonical");
const INJECTED = mdAsset("u1", "INJECTED");

function setup() {
  const gh = new FakeGitHubRepo({ [FILE]: BASE });
  const local = new FakeLocalFiles({ [FILE]: BASE });
  const watermarks = new FakeWatermarkStore();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
  });
  const validator = new ParityValidator({
    transport: gh.transport(),
    sha1: sha1Hex,
    localFilesFor: () => local,
    watermarks,
    yaml: codec,
    now: () => "2026-10-09T00:00:00.000Z",
  });
  const pullOnly: SyncRepoSpec = { ...gh.spec(), pullOnly: true };
  return { gh, local, watermarks, engine, validator, spec: gh.spec(), pullOnly };
}

describe("ParityValidator × pull-only repos (req c0810b83)", () => {
  it("V1 @req:c0810b83-8554-403e-bff0-d341c7d90926 a post-sync round does not report the mirror's overwrite of a local edit as a lost edit", async () => {
    const h = setup();
    await h.engine.sync(h.spec); // bootstrap the watermark (disk == remote)
    h.local.files.set(FILE, INJECTED);
    const snapshot = await h.validator.captureSnapshot([h.pullOnly]);
    expect(snapshot.dirtyByRepo.get(h.spec.repoKey)?.has(FILE)).toBe(true);
    const r = await h.engine.sync(h.pullOnly, "pull");
    expect(h.local.files.get(FILE)).toBe(BASE);
    const round = await h.validator.runRound([h.pullOnly], {
      trigger: "post-sync",
      snapshot,
      syncResults: [r],
    });
    expect(round.repos[0].status).toBe("checked");
    expect(round.m1Total).toBe(0);
    expect(round.repos[0].m1Violations).toEqual([]);
  });

  it("V2 @req:c0810b83-8554-403e-bff0-d341c7d90926 every report of a pull-only repo carries pullOnly: true, an ordinary one does not", async () => {
    const h = setup();
    await h.engine.sync(h.spec);
    const marked = await h.validator.runRound([h.pullOnly], { trigger: "standalone" });
    expect(marked.repos[0].pullOnly).toBe(true);
    const plain = await h.validator.runRound([h.spec], { trigger: "standalone" });
    expect(plain.repos[0]).not.toHaveProperty("pullOnly");
    const failing = new ParityValidator({
      transport: async () => {
        throw new Error("GitHub request GET url → HTTP 401: Bad credentials");
      },
      sha1: sha1Hex,
      localFilesFor: () => h.local,
      watermarks: h.watermarks,
      yaml: codec,
    });
    const errored = await failing.runRound([h.pullOnly], { trigger: "standalone" });
    expect(errored.repos[0].status).toBe("auth-required");
    expect(errored.repos[0].pullOnly).toBe(true);
  });
});
