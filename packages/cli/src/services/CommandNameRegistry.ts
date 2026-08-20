/**
 * @file The set of `exocmd__Command_cliName`s that actually resolve in a vault.
 *
 * `GUARDED_ROUTES` tells a user which dedicated command owns the property they
 * tried to mutate directly. Nothing checked that a listed name EXISTS — which is
 * how three phantoms (`remove-start-timestamp`, `remove-end-timestamp`,
 * `archive-completed`) survived for months: the guard refused the mutation and
 * then pointed at a command `apply` cannot resolve, leaving no sanctioned path
 * at all.
 *
 * ⛔ The check cannot live in CI. The registry is SPLIT across assetspaces and
 * exocortex pins only `exoas-exocmd`; against the pinned SHA a "every listed
 * name resolves" gate would today PASS the phantom and FAIL five correct names
 * (`archive`, `un-archive`, `re-open`, `park-waiting`, `rollback-to-backlog`).
 * The live vault is available exactly where the refusal happens, so that is
 * where the resolution belongs — the same reasoning, and the same one-pass
 * scan, as {@link PropertyNameValidator} (reqs `40a9a81b` / `c616a289`).
 *
 * ⛤ Deliberately NOT a SPARQL query. The collector runs inside a refusal path
 * that already has a plain vault path and no store; a line scan over the same
 * files the sibling validator already walks costs the same and adds no engine
 * dependency to a code path whose only job is to render a sentence.
 *
 * ⛔ An EMPTY registry fails OPEN — a partial or degenerate mount (no `exocmd`
 * assetspace) must never turn a correct refusal into a false one, nor strip a
 * route down to nothing. Same must-have as the sibling validator.
 *
 * req 72419d3c-b425-4a0e-ad42-346853efc9cf
 */

/** `exocmd__Command_cliName: move-to-backlog` — quoted or bare, one per line. */
const CLI_NAME_LINE = /^\s*exocmd__Command_cliName:\s*(.+?)\s*$/gm;

/** Strips wrapping quotes a YAML printer may have added. */
function unquote(raw: string): string {
  const t = raw.trim();
  if (
    t.length >= 2 &&
    (t[0] === '"' || t[0] === "'") &&
    t[t.length - 1] === t[0]
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Collects every `cliName` declared by the mounted assetspaces of one vault.
 *
 * Cached per instance: a single refusal renders one route, but both mutation
 * primitives construct this once per invocation and a caller may render more
 * than one sentence.
 */
export class CommandNameRegistry {
  private cache: Set<string> | undefined;

  constructor(private readonly vaultPath: string) {}

  /**
   * @returns the declared cliNames; EMPTY means "nothing mounted", which every
   *   caller must treat as fail-open rather than as "nothing resolves".
   */
  async collect(): Promise<ReadonlySet<string>> {
    if (this.cache) return this.cache;

    // eslint-disable-next-line import/no-nodejs-modules
    const { readdir, readFile } = await import("fs/promises");

    const names = new Set<string>();

    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable subtree — same fail-open direction as the sibling
      }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          let content: string;
          try {
            content = await readFile(full, "utf-8");
          } catch {
            continue;
          }
          for (const m of content.matchAll(CLI_NAME_LINE)) {
            const name = unquote(m[1]);
            if (name) names.add(name);
          }
        }
      }
    };

    await walk(this.vaultPath);

    this.cache = names;
    return names;
  }
}
