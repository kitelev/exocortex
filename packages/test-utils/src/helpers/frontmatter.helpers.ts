import * as yaml from "js-yaml";

/**
 * Parse a markdown file's frontmatter the way the PRODUCTION READERS do.
 *
 * ## Why this exists as one function
 *
 * Before this helper, 29 test files across three packages each carried their own
 * copy of `yaml.load(match[1])` — the same three lines, none of them naming a
 * schema. That made the simulated reader's semantics a property of whatever
 * `js-yaml` happened to default to, a value nobody in this repo chose.
 *
 * It stopped being hypothetical on 2026-08-20: js-yaml 5 changed the default
 * from YAML 1.1 to CORE, which turns a bare date-like scalar from a `Date` into
 * a plain string. Exactly ONE of the 29 copies went red (#4173); the other 28
 * stayed green. ⛔ That "28 are fine" was learned by RUNNING them — from the
 * files themselves it is impossible to tell which copy depends on the typing,
 * because none of them says. Duplication did not merely risk drift here; it hid
 * the dependency from verification.
 *
 * ## Why YAML11_SCHEMA specifically
 *
 * `YAML11_SCHEMA` reproduces js-yaml 4's DEFAULT_SCHEMA, which is what the real
 * readers still behave like:
 *
 *   - Obsidian's `metadataCache` — and Obsidian does NOT upgrade when our
 *     `package.json` does, so a test simulating it must keep the old semantics
 *     or it asserts against a reader that does not exist;
 *   - `parseYamlFrontmatterTolerant` in `@kitelev/exocortex-core`, which names
 *     the same schema for the same reason.
 *
 * Concretely, the vault's dual typing survives: `createdAt: 2026-08-19` loads as
 * a `Date`, `label: "2026-08-19"` stays a `string`. Both forms exist in every
 * real vault because both writers produce them — `create` writes bare,
 * `set-property` quotes string-semantic properties.
 *
 * ⚠ This helper deliberately does NOT reproduce js-yaml 4's stricter parser.
 * v5 accepts input v4 rejected (`  : : :` → `{ null: { null: … } }`), and no
 * load option restores that. Production guards it inside
 * `parseYamlFrontmatterTolerant`; a test that needs the rejection should go
 * through that function rather than through this one.
 *
 * @param content full file text, including the `---` fences
 * @returns the parsed mapping, or `{}` when the file has no frontmatter
 */
export function parseFrontmatterAsReader(
  content: string,
): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const parsed = yaml.load(match[1] ?? "", { schema: yaml.YAML11_SCHEMA });
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Same semantics as {@link parseFrontmatterAsReader}, for a bare YAML block that
 * has already been separated from its fences.
 */
export function parseYamlAsReader(block: string): Record<string, unknown> {
  const parsed = yaml.load(block, { schema: yaml.YAML11_SCHEMA });
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
