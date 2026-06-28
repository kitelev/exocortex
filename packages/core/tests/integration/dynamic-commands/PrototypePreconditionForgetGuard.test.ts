/**
 * Forget-leak guard (req @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62).
 *
 * Walks the REAL `packages/exoas-exocmd` submodule, classifies every
 * `exocmd__Command` by the targetClass of its `exocmd__CommandBinding`s, and
 * asserts that EVERY instance-lifecycle command (bindings target
 * ems__Task/Project/Area/Meeting/Session — NOT exo__Asset, NOT a prototype
 * class, NOT a class metaclass) carries a command-level
 * `exocmd__Command_precondition` whose precondition asset's
 * `exocmd__Precondition_sparqlAsk` contains the canonical not-a-prototype clause
 * (`FILTER NOT EXISTS { … exo:Instance_class … STRENDS(…, "Prototype") … }`).
 *
 * If a future lifecycle command (or a binding retargeted onto a lifecycle class)
 * ships without the clause, this fails — the silent-leak the precondition-primary
 * design is otherwise vulnerable to (design node f853eadd, §forget-leak guard).
 *
 * Conversely, asserts universal-maintenance commands (targetClass exo__Asset) do
 * NOT carry the clause (they must keep working on prototype-template assets).
 *
 * @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62
 */
import * as fs from "fs";
import * as path from "path";

const SUBMODULE_EXOCMD = path.resolve(__dirname, "../../../../exoas-exocmd/exocmd");

const COMMAND_BINDING_CLASS_UID = "3677039a-a5a8-4402-9a07-f8f18fe384ad";
const STANDALONE_PRECONDITION_UID = "847c37e0-9812-4dc7-9a92-923dac7cda56";

// Lifecycle target classes (label form) — bindings on these make a command an
// instance-lifecycle command that MUST carry the not-a-prototype clause.
const LIFECYCLE_TARGET_CLASSES = new Set([
  "ems__Task",
  "ems__Project",
  "ems__Area",
  "ems__Effort",
  "ems__Meeting",
  "ems__Session",
]);
const UNIVERSAL_TARGET_CLASSES = new Set(["exo__Asset"]);

// STRENDS not-a-prototype clause (suffix check on the symbolic instance_class IRI).
const NOT_A_PROTOTYPE_CLAUSE_RE =
  /FILTER\s+NOT\s+EXISTS\s*\{[^}]*Instance_class[^}]*STRENDS\s*\(\s*STR\s*\(\s*\?\w+\s*\)\s*,\s*["']Prototype["']\s*\)[^}]*\}/i;

interface Asset {
  uid: string;
  label: string;
  file: string;
  fm: Record<string, string | string[]>;
  raw: string;
}

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string | string[]> = {};
  let key: string | null = null;
  let list: string[] | null = null;
  for (const line of m[1].split("\n")) {
    const li = line.match(/^\s*-\s*(.+)$/);
    if (li && list) {
      list.push(li[1].trim().replace(/^"|"$/g, ""));
      continue;
    }
    const kv = line.match(/^([a-zA-Z_][\w]*?):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      if (v === "") {
        list = [];
        fm[key] = list;
      } else {
        fm[key] = v.replace(/^"|"$/g, "");
        list = null;
      }
    }
  }
  return fm;
}

function wikilinkUid(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/\[\[([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
}

function loadAssets(): Asset[] {
  if (!fs.existsSync(SUBMODULE_EXOCMD)) {
    throw new Error(
      `exoas-exocmd submodule not found at ${SUBMODULE_EXOCMD}. Run \`git submodule update --init packages/exoas-exocmd\``,
    );
  }
  const out: Asset[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const raw = fs.readFileSync(full, "utf8");
      const fm = parseFrontmatter(raw);
      out.push({
        uid: (fm["exo__Asset_uid"] as string) ?? "",
        label: (fm["exo__Asset_label"] as string) ?? "",
        file: full,
        fm,
        raw,
      });
    }
  };
  walk(SUBMODULE_EXOCMD);
  return out;
}

function instanceClassUids(fm: Record<string, string | string[]>): string[] {
  const ic = fm["exo__Instance_class"];
  const refs = Array.isArray(ic) ? ic : typeof ic === "string" ? [ic] : [];
  return refs.map(wikilinkUid).filter((u): u is string => u !== null);
}

describe("prototype precondition — forget-leak guard (exoas-exocmd submodule) (@req:5579ffa1-a829-4fcf-b93d-4fb664b02d62)", () => {
  const assets = loadAssets();
  const byUid = new Map(assets.map((a) => [a.uid, a]));

  // command uid -> set of binding targetClass labels
  const commandTargets = new Map<string, Set<string>>();
  for (const a of assets) {
    if (!instanceClassUids(a.fm).includes(COMMAND_BINDING_CLASS_UID)) continue;
    const tc = a.fm["exocmd__CommandBinding_targetClass"];
    const cmdUid = wikilinkUid(a.fm["exocmd__CommandBinding_command"] as string | undefined);
    if (typeof tc !== "string" || !cmdUid) continue;
    if (!commandTargets.has(cmdUid)) commandTargets.set(cmdUid, new Set());
    commandTargets.get(cmdUid)!.add(tc);
  }

  /** Resolve a command's command-level precondition sparqlAsk (or null). */
  function commandPreconditionAsk(cmdUid: string): string | null {
    const cmd = byUid.get(cmdUid);
    if (!cmd) return null;
    const preUid = wikilinkUid(cmd.fm["exocmd__Command_precondition"] as string | undefined);
    if (!preUid) return null;
    const pre = byUid.get(preUid);
    if (!pre) return null;
    // sparqlAsk is a multi-line YAML scalar — read from the raw file.
    const m = pre.raw.match(/exocmd__Precondition_sparqlAsk:\s*[>|][-]?\n((?:  .*\n?)+)/);
    return m ? m[1] : (typeof pre.fm["exocmd__Precondition_sparqlAsk"] === "string" ? (pre.fm["exocmd__Precondition_sparqlAsk"] as string) : null);
  }

  const lifecycleCommands = [...commandTargets.entries()].filter(
    ([, tcs]) =>
      [...tcs].some((t) => LIFECYCLE_TARGET_CLASSES.has(t)) &&
      ![...tcs].some((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
  );

  it("finds the instance-lifecycle command set (non-trivial)", () => {
    expect(lifecycleCommands.length).toBeGreaterThanOrEqual(20);
  });

  it.each(
    // present a readable [uid, label] tuple per lifecycle command
    [...commandTargets.keys()]
      .filter((u) =>
        commandTargets.get(u)!.size > 0 &&
        [...commandTargets.get(u)!].some((t) => LIFECYCLE_TARGET_CLASSES.has(t)) &&
        ![...commandTargets.get(u)!].some((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
      )
      .map((u) => [u, byUid.get(u)?.label ?? "?"] as [string, string]),
  )(
    "lifecycle command %s (%s) carries the not-a-prototype clause",
    (cmdUid) => {
      const ask = commandPreconditionAsk(cmdUid);
      expect(ask).toBeTruthy();
      expect(ask!).toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
    },
  );

  it("the standalone 'Target is not a prototype' precondition exists and carries the clause", () => {
    const pre = byUid.get(STANDALONE_PRECONDITION_UID);
    expect(pre).toBeTruthy();
    expect(pre!.raw).toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
  });

  it("universal-maintenance commands (targetClass exo__Asset) do NOT carry the clause", () => {
    const universal = [...commandTargets.entries()].filter(
      ([, tcs]) => [...tcs].every((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
    );
    expect(universal.length).toBeGreaterThanOrEqual(1);
    for (const [cmdUid] of universal) {
      const ask = commandPreconditionAsk(cmdUid);
      if (ask) expect(ask).not.toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
    }
  });
});
