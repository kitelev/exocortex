/**
 * Unit tests for the `resolve-deps` command action (issue #3513).
 *
 * Drives `runResolveDeps` directly with captured IO sinks (no `process.exit`,
 * no network) against an on-disk temp registry fixture mirroring the real
 * descriptor shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  resolveDepsCommand,
  runResolveDeps,
} from "../../../src/commands/resolve-deps.js";
import { ASSET_SPACE_CLASS_UID } from "../../../src/services/CliProfileResolver.js";

const UID_W3C = "01ef516e-c697-4988-b86c-472574e13cdc";
const UID_EXO = "e5c47526-e72f-42e3-8535-3d243dd2db94";
const UID_PUBLIC = "f80bb130-7d05-4399-8407-467be8bfbfc9";

async function writeDescriptor(
  registryDir: string,
  uid: string,
  namespace: string,
  source: string,
  deps: string[] = [],
): Promise<void> {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    "exo__Instance_class:",
    `  - "[[${ASSET_SPACE_CLASS_UID}]]"`,
    `exo__AssetSpace_namespace: "${namespace}"`,
    `exo__AssetSpace_source: "${source}"`,
  ];
  if (deps.length > 0) {
    lines.push("exo__AssetSpace_dependsOn:");
    for (const d of deps) lines.push(`  - "[[${d}]]"`);
  }
  lines.push("---", "", "desc", "");
  await fs.writeFile(path.join(registryDir, `${uid}.md`), lines.join("\n"), "utf-8");
}

describe("resolve-deps command", () => {
  let tmp: string;
  let registry: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-deps-cmd-"));
    registry = path.join(tmp, "registry", "registry");
    await fs.ensureDir(registry);
    await writeDescriptor(registry, UID_W3C, "w3c-aggregated", "https://github.com/kitelev/exoas-w3c-aggregated");
    await writeDescriptor(registry, UID_EXO, "exo", "https://github.com/kitelev/exoas-exo", [UID_W3C]);
    await writeDescriptor(registry, UID_PUBLIC, "public", "https://github.com/kitelev/exoas-public", [UID_EXO]);
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (m: string) => out.push(m), err: (m: string) => err.push(m) } };
  }

  it("prints one dependency clone URL per line (urls format, self excluded)", async () => {
    const c = capture();
    const r = await runResolveDeps(
      { registry: path.join(tmp, "registry"), self: "kitelev/exoas-public", format: "urls" },
      c.io,
    );
    expect(r.exitCode).toBe(0);
    expect(c.out).toEqual([
      "https://github.com/kitelev/exoas-exo",
      "https://github.com/kitelev/exoas-w3c-aggregated",
    ]);
  });

  it("prints nothing for a floor repo with one dep (still just the dep)", async () => {
    const c = capture();
    const r = await runResolveDeps(
      { registry: path.join(tmp, "registry"), self: "kitelev/exoas-exo", format: "urls" },
      c.io,
    );
    expect(r.exitCode).toBe(0);
    expect(c.out).toEqual(["https://github.com/kitelev/exoas-w3c-aggregated"]);
  });

  it("emits a JSON diagnostic struct in json format", async () => {
    const c = capture();
    const r = await runResolveDeps(
      { registry: path.join(tmp, "registry"), self: "kitelev/exoas-public", format: "json" },
      c.io,
    );
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(c.out.join("\n"));
    expect(parsed.outcome).toBe("resolved");
    expect(parsed.self.namespace).toBe("public");
    expect(parsed.dependencies.map((d: { namespace: string }) => d.namespace)).toEqual([
      "exo",
      "w3c-aggregated",
    ]);
  });

  it("lenient (default): self-not-found → exit 0, no urls printed, warn on stderr", async () => {
    const c = capture();
    const r = await runResolveDeps(
      { registry: path.join(tmp, "registry"), self: "kitelev/exoas-ems", format: "urls" },
      c.io,
    );
    expect(r.exitCode).toBe(0);
    expect(c.out).toEqual([]); // no deps → validate standalone
    expect(c.err.join("\n")).toMatch(/not found/);
  });

  it("strict: self-not-found → exit 2 (CI fail-fast)", async () => {
    const c = capture();
    const r = await runResolveDeps(
      { registry: path.join(tmp, "registry"), self: "kitelev/exoas-ems", format: "urls", strict: true },
      c.io,
    );
    expect(r.exitCode).toBe(2);
    expect(c.err.join("\n")).toMatch(/STRICT/);
  });

  it("throws InvalidArgumentsError when --registry path does not exist", async () => {
    await expect(
      runResolveDeps(
        { registry: path.join(tmp, "nope"), self: "kitelev/exoas-exo" },
        capture().io,
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("command surface: --registry and --self are mandatory", () => {
    const cmd = resolveDepsCommand();
    expect(cmd.options.find((o) => o.long === "--registry")!.mandatory).toBe(true);
    expect(cmd.options.find((o) => o.long === "--self")!.mandatory).toBe(true);
    expect(cmd.options.find((o) => o.long === "--format")).toBeDefined();
    expect(cmd.options.find((o) => o.long === "--strict")).toBeDefined();
  });
});
