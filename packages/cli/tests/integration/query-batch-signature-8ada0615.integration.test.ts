/**
 * Ticket 8ada0615 — the result-cache vault signature (a full stat-walk of the
 * vault, 1.5 s on vault-exodev under load) is computed at most ONCE per batch,
 * and never under `--no-cache`. The signature module is replaced by a counting
 * stub; everything else is real.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const signatureCalls: string[] = [];
jest.unstable_mockModule("../../src/cache/vaultSignature.js", () => ({
  computeVaultSignature: async (vaultPath: string) => {
    signatureCalls.push(vaultPath);
    return "stub-signature";
  },
}));

const { sparqlQueryCommand } = await import("../../src/commands/sparql-query.js");

describe("query --batch: one vault signature per batch (ticket 8ada0615)", () => {
  let vaultDir: string;
  let workDir: string;
  let homeDir: string;
  let saved: typeof process.exitCode;

  beforeEach(() => {
    signatureCalls.length = 0;
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615s-vault-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615s-work-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-8ada0615s-home-"));
    fs.writeFileSync(
      path.join(vaultDir, "a.md"),
      '---\nexo__Asset_uid: 22222222-2222-4222-8222-000000000001\nexo__Asset_label: "A"\n---\n',
    );
    jest.spyOn(os, "homedir").mockReturnValue(homeDir);
    jest.spyOn(process.stdout, "write").mockImplementation(((_c: unknown, ...rest: unknown[]) => {
      const cb = rest.find((r) => typeof r === "function") as ((e?: Error | null) => void) | undefined;
      cb?.(null);
      return true;
    }) as never);
    jest.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    saved = process.exitCode;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = saved;
    for (const d of [vaultDir, workDir, homeDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  function batch(n: number): string {
    const p = path.join(workDir, "b.json");
    fs.writeFileSync(
      p,
      JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `q${i}`, sparql: `SELECT ?s WHERE { ?s ?p ?o } LIMIT ${i + 1}` }))),
    );
    return p;
  }

  it("B12 @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea result cache on: 4 entries ⇒ exactly one signature walk", async () => {
    await sparqlQueryCommand().parseAsync(["node", "query", "--batch", batch(4), "--vault", vaultDir]);
    expect(signatureCalls).toHaveLength(1);
  }, 60000);

  it("B12b @req:166613ce-7b3f-4ab0-825c-b9a3c36fbdea --no-cache: no signature walk at all", async () => {
    await sparqlQueryCommand().parseAsync(["node", "query", "--batch", batch(4), "--vault", vaultDir, "--no-cache"]);
    expect(signatureCalls).toHaveLength(0);
  }, 60000);
});
