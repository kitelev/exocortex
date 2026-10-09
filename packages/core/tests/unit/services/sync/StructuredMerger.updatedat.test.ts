/**
 * `exo__Asset_updatedAt` changed on both sides keeps the LATER stamp instead
 * of conflicting (ems__Bug 413f80b9).
 *
 * Production shape (measured 2026-10-10 on 17 vaults, 53 conflict-cache
 * entries): 16 conflicts hinged ONLY on `exo__Asset_updatedAt` with a
 * mergeable body, 2 more were identical once the stamp was removed — the
 * stamp every edit rewrites made two edits of DIFFERENT keys conflict.
 *
 * Stamp forms in the vaults (49 612 stamps): `…+05:00` 28 286, naive local
 * 20 705, `…+0500` 437, quoted 148, `…Z` 34 (true UTC — each precedes its
 * first push by minutes), date-only 2. Axes compare as TIME and are
 * independent of the runner's time zone: naive stamps go through an injected
 * `localTimeToEpoch` (Asia/Almaty, UTC+5, no DST) — except U11, which runs
 * the production default and compares naive with naive only.
 */

import * as yaml from "js-yaml";
import {
  InMemoryQuarantineStore,
  GatedStructuredMerger,
  SyncEngine,
  type LocalTimeToEpoch,
} from "../../../../src";
import {
  StructuredMerger,
  timestampToEpoch,
  type YamlCodec,
} from "../../../../src/services/sync/StructuredMerger";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  sha1Hex,
} from "./fakeGitHub";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

const ALMATY: LocalTimeToEpoch = (y, mo, d, h, mi, s, ms) =>
  Date.UTC(y, mo, d, h, mi, s, ms) - 5 * 3_600_000;
const UTC_LOCAL: LocalTimeToEpoch = (y, mo, d, h, mi, s, ms) =>
  Date.UTC(y, mo, d, h, mi, s, ms);

const almatyMerger = new StructuredMerger(codec, { localTimeToEpoch: ALMATY });

function asset(
  fields: Record<string, string | undefined>,
  body = "body text",
): string {
  const lines = ["---", "exo__Asset_uid: u1"];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) lines.push(`${k}: ${v}`);
  }
  lines.push("---", "", body, "");
  return lines.join("\n");
}

function fmOf(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(m).not.toBeNull();
  return yaml.load((m as RegExpExecArray)[1], {
    schema: yaml.CORE_SCHEMA,
  }) as Record<string, unknown>;
}

const UPD = "exo__Asset_updatedAt";

/** base → local edits keyA, remote edits keyB, both re-stamp. */
function diverging(localStamp: string, remoteStamp: string) {
  return {
    path: "a.md",
    base: asset({ keyA: "a0", keyB: "b0", [UPD]: "2026-09-01T10:00:00" }),
    local: asset({ keyA: "a1", keyB: "b0", [UPD]: localStamp }),
    remote: asset({ keyA: "a0", keyB: "b1", [UPD]: remoteStamp }),
  };
}

describe("StructuredMerger — exo__Asset_updatedAt changed on both sides (ems__Bug 413f80b9)", () => {
  it("U1 edits of different keys merge; the REMOTE stamp is later → it is kept (revert-verify target)", () => {
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T10:00:00", "2026-09-12T11:00:00"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    const fm = fmOf(out.content);
    expect(fm.keyA).toBe("a1");
    expect(fm.keyB).toBe("b1");
    expect(fm[UPD]).toBe("2026-09-12T11:00:00");
    expect(out.warnings.join("\n")).toMatch(/later stamp kept \(remote\)/);
  });

  it("U2 the LOCAL stamp is later → it is kept (not 'always remote')", () => {
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T12:00:00", "2026-09-12T11:00:00"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T12:00:00");
  });

  it("U3 compared as TIME, not as text: `…+05:00` vs `…Z` where the lexically larger one is EARLIER", () => {
    // 10:00+05:00 = 05:00Z < 06:00Z, yet "…T10…" > "…T06…" as strings.
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T10:00:00+05:00", "2026-09-12T06:00:00Z"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T06:00:00Z");
  });

  it("U4 the compact offset form `+0500` is read as an offset too", () => {
    // 10:30+0500 = 05:30Z > 05:00Z.
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T10:30:00+0500", "2026-09-12T05:00:00Z"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T10:30:00+0500");
  });

  it("U5 a naive stamp is read through the injected local time (UTC+5 here): naive 09:00 (= 04:00Z) is EARLIER than 04:30Z", () => {
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T09:00:00", "2026-09-12T04:30:00Z"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T04:30:00Z");
    // Same pair, local time = UTC: naive 09:00 is now the later one.
    const utcMerger = new StructuredMerger(codec, {
      localTimeToEpoch: UTC_LOCAL,
    });
    const out2 = utcMerger.mergeAsset(
      diverging("2026-09-12T09:00:00", "2026-09-12T04:30:00Z"),
    );
    expect(out2.status).toBe("merged");
    if (out2.status !== "merged") return;
    expect(fmOf(out2.content)[UPD]).toBe("2026-09-12T09:00:00");
  });

  it("U6 a REAL conflict is never hidden: another scalar key changed differently on both sides still conflicts — even a TIMESTAMP-valued one", () => {
    // `ems__Effort_startTimestamp` holds the same kind of value as the stamp,
    // yet a both-sides change of it is a genuine disagreement, never a max.
    const START = "ems__Effort_startTimestamp";
    const out = almatyMerger.mergeAsset({
      path: "a.md",
      base: asset({
        [UPD]: "2026-09-01T10:00:00",
        [START]: "2026-09-01T09:00:00",
      }),
      local: asset({
        [UPD]: "2026-09-12T10:00:00",
        [START]: "2026-09-12T08:00:00",
      }),
      remote: asset({
        [UPD]: "2026-09-12T11:00:00",
        [START]: "2026-09-12T09:30:00",
      }),
    });
    expect(out.status).toBe("conflict");
    if (out.status !== "conflict") return;
    expect(out.reason).toMatch(
      /frontmatter key "ems__Effort_startTimestamp" changed differently on both sides/,
    );
  });

  it("U6b a non-timestamp key changed differently on both sides still conflicts", () => {
    const out = almatyMerger.mergeAsset({
      path: "a.md",
      base: asset({ keyA: "a0", [UPD]: "2026-09-01T10:00:00" }),
      local: asset({ keyA: "a1", [UPD]: "2026-09-12T10:00:00" }),
      remote: asset({ keyA: "a2", [UPD]: "2026-09-12T11:00:00" }),
    });
    expect(out.status).toBe("conflict");
    if (out.status !== "conflict") return;
    expect(out.reason).toMatch(
      /frontmatter key "keyA" changed differently on both sides/,
    );
  });

  it("U7 an unparseable stamp on one side still conflicts on the stamp", () => {
    const out = almatyMerger.mergeAsset(
      diverging("yesterday evening", "2026-09-12T11:00:00"),
    );
    expect(out.status).toBe("conflict");
    if (out.status !== "conflict") return;
    expect(out.reason).toMatch(/"exo__Asset_updatedAt" changed differently/);
  });

  it("U8 the stamp deleted on one side + changed on the other still conflicts", () => {
    const out = almatyMerger.mergeAsset({
      path: "a.md",
      base: asset({ keyA: "a0", [UPD]: "2026-09-01T10:00:00" }),
      local: asset({ keyA: "a1" }),
      remote: asset({ keyA: "a0", [UPD]: "2026-09-12T11:00:00" }),
    });
    expect(out.status).toBe("conflict");
  });

  it("U9 without a base VERSION of the file (no-base add/add) the rule does not apply — conflict as before", () => {
    const out = almatyMerger.mergeAsset({
      path: "a.md",
      local: asset({ keyA: "a0", [UPD]: "2026-09-12T10:00:00" }),
      remote: asset({ keyA: "a0", [UPD]: "2026-09-12T11:00:00" }),
    });
    expect(out.status).toBe("conflict");
  });

  it("U9b a base version exists but carried no stamp yet (or an empty one) → both added stamps merge to the later", () => {
    for (const baseStamp of [undefined, ""]) {
      const out = almatyMerger.mergeAsset({
        path: "a.md",
        base: asset({ keyA: "a0", [UPD]: baseStamp }),
        local: asset({ keyA: "a1", [UPD]: "2026-09-12T10:00:00" }),
        remote: asset({ keyA: "a0", [UPD]: "2026-09-12T11:00:00" }),
      });
      expect(out.status).toBe("merged");
      if (out.status !== "merged") return;
      expect(fmOf(out.content)[UPD]).toBe("2026-09-12T11:00:00");
      expect(fmOf(out.content).keyA).toBe("a1");
    }
  });

  it("U10 equal instants written differently → the remote value (devices converge)", () => {
    // 10:00+05:00 and 05:00Z are the same instant.
    const out = almatyMerger.mergeAsset(
      diverging("2026-09-12T10:00:00+05:00", "2026-09-12T05:00:00Z"),
    );
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T05:00:00Z");
  });

  it("U12 identical but for the stamp → merged, the later stamp kept", () => {
    const base = asset(
      { keyA: "a0", [UPD]: "2026-09-01T10:00:00" },
      "same body",
    );
    const out = almatyMerger.mergeAsset({
      path: "a.md",
      base,
      local: asset({ keyA: "a1", [UPD]: "2026-09-12T10:00:00" }, "same body"),
      remote: asset({ keyA: "a1", [UPD]: "2026-09-12T09:00:00" }, "same body"),
    });
    expect(out.status).toBe("merged");
    if (out.status !== "merged") return;
    expect(fmOf(out.content)[UPD]).toBe("2026-09-12T10:00:00");
    expect(fmOf(out.content).keyA).toBe("a1");
  });
});

describe("StructuredMerger — production default time mapping", () => {
  it("U13 the default reads a naive stamp in the runner's LOCAL time (both directions)", () => {
    const def = new StructuredMerger(codec);
    const naive = "2026-09-12T09:00:00";
    const naiveEpoch = new Date(2026, 8, 12, 9, 0, 0).getTime();
    const later = new Date(naiveEpoch + 30 * 60_000).toISOString();
    const earlier = new Date(naiveEpoch - 30 * 60_000).toISOString();
    const a = def.mergeAsset(diverging(naive, later));
    expect(a.status).toBe("merged");
    if (a.status !== "merged") return;
    expect(fmOf(a.content)[UPD]).toBe(later);
    const b = def.mergeAsset(diverging(naive, earlier));
    expect(b.status).toBe("merged");
    if (b.status !== "merged") return;
    expect(fmOf(b.content)[UPD]).toBe(naive);
  });
});

describe("timestampToEpoch", () => {
  const at5 = Date.UTC(2026, 8, 12, 5, 0, 0);

  it("T1 reads every measured form; date-only and garbage are rejected", () => {
    expect(timestampToEpoch("2026-09-12T10:00:00+05:00", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-12T10:00:00+0500", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-12T05:00:00Z", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-12T10:00:00", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-12T01:00:00-04:00", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-12T10:30:00+05:30", ALMATY)).toBe(at5);
    expect(timestampToEpoch("2026-09-20", ALMATY)).toBeUndefined();
    expect(timestampToEpoch("not a date", ALMATY)).toBeUndefined();
  });

  it("T2 out-of-range fields and calendar dates that do not exist are rejected, never rolled over", () => {
    for (const bad of [
      "2026-13-12T10:00:00",
      "2026-00-12T10:00:00",
      "2026-09-32T10:00:00",
      "2026-09-00T10:00:00",
      "2026-02-30T10:00:00Z",
      "2026-04-31T10:00:00Z",
      "2026-09-12T24:00:00",
      "2026-09-12T10:60:00",
      "2026-09-12T10:00:60",
    ]) {
      expect([bad, timestampToEpoch(bad, ALMATY)]).toEqual([bad, undefined]);
    }
  });

  it("T3 an offset beyond ±14:59 is rejected", () => {
    for (const bad of [
      "2026-09-12T10:00:00+15:00",
      "2026-09-12T10:00:00+05:60",
    ]) {
      expect([bad, timestampToEpoch(bad, ALMATY)]).toEqual([bad, undefined]);
    }
  });

  it("T4 fractional seconds are milliseconds (`.5` = 500 ms)", () => {
    expect(timestampToEpoch("2026-09-12T05:00:00.250Z", ALMATY)).toBe(
      at5 + 250,
    );
    expect(timestampToEpoch("2026-09-12T05:00:00.5Z", ALMATY)).toBe(at5 + 500);
  });
});

describe("SyncEngine — two devices edit different keys of one asset (ems__Bug 413f80b9)", () => {
  it("U11 through the real sync() with the PRODUCTION default merger: merged, nothing quarantined, the later stamp kept", async () => {
    const PATH = "assets/a.md";
    const base = asset({
      keyA: "a0",
      keyB: "b0",
      [UPD]: "2026-09-01T10:00:00",
    });
    const gh = new FakeGitHubRepo({ [PATH]: base });
    const local = new FakeLocalFiles({ [PATH]: base });
    const store = new InMemoryQuarantineStore();
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => local,
      sha1: sha1Hex,
      // Production composition: the default (device-local) time mapping.
      mergeLayer: new GatedStructuredMerger(new StructuredMerger(codec)),
      quarantine: store,
    });
    expect((await engine.sync(gh.spec())).status).toBe("synced");

    // Device B (remote) edits keyB at 11:00, this device edits keyA at 10:30
    // (naive vs naive — the order holds in any time zone).
    gh.commitDirect(
      gh.branch,
      {
        [PATH]: asset({ keyA: "a0", keyB: "b1", [UPD]: "2026-09-12T11:00:00" }),
      },
      "device B",
    );
    local.files.set(
      PATH,
      asset({ keyA: "a1", keyB: "b0", [UPD]: "2026-09-12T10:30:00" }),
    );

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    expect(result.mergedCount).toBe(1);
    for (const content of [
      local.files.get(PATH) as string,
      gh.headFiles().get(PATH)!,
    ]) {
      const fm = fmOf(content);
      expect(fm.keyA).toBe("a1");
      expect(fm.keyB).toBe("b1");
      expect(fm[UPD]).toBe("2026-09-12T11:00:00");
    }
  });
});
