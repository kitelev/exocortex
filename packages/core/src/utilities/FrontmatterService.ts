/**
 * FrontmatterService
 *
 * Centralized service for YAML frontmatter manipulation in Markdown files.
 * Follows DRY principle by eliminating duplication across 15+ locations.
 *
 * @module infrastructure/services
 * @since 1.0.0
 */

import { loadDefaultSpec, orderProperties } from "../services/OrderSpecResolver";
import { serializeYamlScalar, STRING_SCALAR_PROPERTIES } from "./yamlScalar";
import { canonicalYamlKey, LEGACY_YAML_KEYS } from "../services/NoteToRDFConverter";
import type { IFrontmatter } from "../interfaces/IVaultAdapter";
import { iriToObsidianName } from "./iriToObsidianName";

/**
 * Result of frontmatter parsing operation
 */
export interface FrontmatterParseResult {
  /** Whether frontmatter block exists */
  exists: boolean;
  /** Parsed frontmatter content (without --- delimiters) */
  content: string;
  /** Original full file content */
  originalContent: string;
}

/**
 * Service for manipulating YAML frontmatter in Markdown files.
 *
 * Handles common operations like:
 * - Adding/updating/removing properties
 * - Creating frontmatter blocks when missing
 * - Preserving existing properties
 * - Maintaining YAML formatting
 *
 * @example
 * ```typescript
 * const service = new FrontmatterService();
 *
 * // Update existing property
 * const updated = service.updateProperty(
 *   content,
 *   'status',
 *   '"[[StatusDone]]"'
 * );
 *
 * // Add new property
 * const withNew = service.addProperty(content, 'priority', 'high');
 *
 * // Remove property
 * const removed = service.removeProperty(content, 'archived');
 * ```
 */
export class FrontmatterService {
  /**
   * Regex pattern for matching YAML frontmatter blocks.
   * Matches: ---\n[content]\n---
   */
  private static readonly FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

  /**
   * Parse frontmatter from markdown content.
   *
   * @param content - Full markdown file content
   * @returns Parse result with existence flag and content
   *
   * @example
   * ```typescript
   * const result = service.parse('---\nfoo: bar\n---\nBody');
   * // result.exists === true
   * // result.content === 'foo: bar'
   * ```
   */
  parse(content: string): FrontmatterParseResult {
    const match = content.match(FrontmatterService.FRONTMATTER_REGEX);

    if (!match) {
      return {
        exists: false,
        content: "",
        originalContent: content,
      };
    }

    return {
      exists: true,
      content: match[1],
      originalContent: content,
    };
  }

  /**
   * A list item's own line, at the writer's two-space indentation OR at column
   * 0 — both are valid YAML for the same sequence (issue #4314 shape 2).
   */
  private static readonly ARRAY_ITEM_LINE = /^ {0,2}- (.*)$/;

  /**
   * A block-scalar HEADER, i.e. the whole value of the node: `|`, `>`, with an
   * optional indentation indicator (`1`-`9`) and/or chomping indicator (`-`/`+`)
   * in either order. When an item is one of these, every following more-indented
   * line — `#` included, because inside a block scalar `#` is literal text — is
   * its BODY, not a comment and not a new node.
   */
  private static readonly BLOCK_SCALAR_HEADER =
    /^[|>](?:[1-9][-+]?|[-+][1-9]?)?$/;

  /**
   * Split the BODY of a flow-style YAML sequence (`a, "b, c"`) into its items,
   * keeping each item's RAW text (quotes included) — `parseObject` is a textual
   * reader, and a decoded `[[uid]]` item would be re-emitted unquoted, where a
   * leading `[` opens a flow sequence and makes the file unparseable.
   *
   * Returns `null` for input this splitter cannot account for (unterminated
   * quote or unbalanced bracket), so the caller keeps the pre-#4314 behaviour of
   * treating the value as an opaque scalar rather than inventing items.
   */
  private static splitFlowSequence(inner: string): string[] | null {
    const items: string[] = [];
    let buffer = "";
    let quote: '"' | "'" | null = null;
    let depth = 0;

    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (quote !== null) {
        buffer += ch;
        if (ch === "\\" && quote === '"') {
          // A double-quoted scalar's escape: the next char is data, never a
          // closing quote.
          buffer += inner[++i] ?? "";
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buffer += ch;
        continue;
      }
      if (ch === "[" || ch === "{") {
        depth++;
        buffer += ch;
        continue;
      }
      if (ch === "]" || ch === "}") {
        depth--;
        if (depth < 0) return null;
        buffer += ch;
        continue;
      }
      if (ch === "," && depth === 0) {
        items.push(buffer.trim());
        buffer = "";
        continue;
      }
      buffer += ch;
    }
    if (quote !== null || depth !== 0) return null;

    const tail = buffer.trim();
    // `[]` is the empty sequence; `[a, ]`'s trailing comma is not an item.
    if (tail !== "") items.push(tail);
    return items;
  }

  /**
   * Parse frontmatter into a key/value object.
   *
   * Handles `key: value` scalar lines, `key:\n  - item` YAML arrays (two-space
   * OR column-0 item indentation) and `key: [a, b]` flow-style arrays. Returns
   * null when no frontmatter block is present. Used by callers that need to read
   * another asset's properties (e.g. copy-from-target in create_instance),
   * where `parse()` (which returns the raw YAML string) is insufficient.
   *
   * ⛤ Every value is RAW text, quotes and block-scalar indicators included —
   * `GroundingExecutor`'s list primitives write back exactly what they read, so
   * a decoded value would change the bytes on disk.
   *
   * ⛔ A line that CONTINUES the item above it (a block-scalar body, a plain
   * scalar's second line, a nested map's further keys) is kept VERBATIM on that
   * item instead of ending the array. Before issue #4314 such a line reset
   * `currentKey` to null, so every remaining `  - ` item of the same array was
   * silently dropped from the read — and `property_append` / `property_replace`
   * then wrote the truncated list back to disk. Measured 2026-09-25 on the three
   * canonical vaults: 46 assets carry an interleaved comment inside a list and 2
   * carry a nested map, i.e. the loss was live, not hypothetical.
   *
   * NOTE: still deliberately minimal — a nested map or a block-scalar body is
   * carried as opaque text, not structured; quoted-key edge cases are not
   * covered. This stays a lightweight line parser rather than pulling a full
   * YAML engine into every read path.
   */
  parseObject(content: string): Record<string, string | string[]> | null {
    const parsed = this.parse(content);
    if (!parsed.exists) return null;

    const result: Record<string, string | string[]> = {};
    const lines = parsed.content.split(/\r?\n/);
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;
    // Blank lines held back: a blank line belongs to the current item only when
    // an indented line follows it (legal inside a block scalar). This mirrors
    // `findPropertyLineSpan`, which decides the same ownership on WRITE — the
    // two halves of this service disagreeing is what #4314 is about.
    let pendingBlanks: string[] = [];

    const flushArray = (): void => {
      if (currentKey !== null && currentArray !== null) {
        result[currentKey] = currentArray;
      }
      currentKey = null;
      currentArray = null;
      pendingBlanks = [];
    };

    for (const line of lines) {
      const arrayItem = FrontmatterService.ARRAY_ITEM_LINE.exec(line);
      if (arrayItem) {
        if (currentKey !== null && currentArray !== null) {
          currentArray.push(arrayItem[1].trim());
        }
        pendingBlanks = [];
        continue;
      }

      // The item a continuation line would attach to — null when we are not
      // inside a list that already has one.
      const openItems =
        currentArray !== null && currentArray.length > 0 ? currentArray : null;
      const inBlockScalarBody =
        openItems !== null &&
        FrontmatterService.BLOCK_SCALAR_HEADER.test(
          openItems[openItems.length - 1].split("\n", 1)[0],
        );

      if (line.trim() === "") {
        if (openItems !== null) {
          pendingBlanks.push(line);
          continue;
        }
        flushArray();
        continue;
      }

      // A COMMENT under a key is not part of any value, and must not end the
      // array either. ⛔ The test is `currentArray !== null`, not `openItems`:
      // measured 2026-09-25, all 46 live carriers put the comment BEFORE the
      // first item (`aliases:` then `  # Русские`), i.e. while the array is
      // still EMPTY — treating that as a terminator read the property as `[]`
      // and `property_append` then erased every alias. Inside a block-scalar
      // body `#` is literal text, so that case falls through below.
      if (
        currentArray !== null &&
        !inBlockScalarBody &&
        /^[ \t]+#/.test(line)
      ) {
        pendingBlanks = [];
        continue;
      }

      if (openItems !== null && /^[ \t]/.test(line)) {
        const last = openItems.length - 1;
        openItems[last] = [openItems[last], ...pendingBlanks, line].join("\n");
        pendingBlanks = [];
        continue;
      }

      flushArray();

      const kvMatch = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
      if (!kvMatch) continue;
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (value === "") {
        currentKey = key;
        currentArray = [];
        continue;
      }

      // Flow-style sequence — a list the same callers must be able to edit
      // element-wise. Measured 2026-09-25: 15 live assets carry one (all
      // `exo__Instance_class`), and reading them as a scalar made
      // `property_append` write a NESTED array (`- ["[[uid]]"]`).
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = FrontmatterService.splitFlowSequence(
          value.slice(1, -1),
        );
        if (items !== null) {
          result[key] = items;
          continue;
        }
      }
      result[key] = value;
    }

    flushArray();
    return result;
  }

  /**
   * Update or add a property in frontmatter.
   *
   * - If frontmatter exists and has the property: updates value
   * - If frontmatter exists but lacks property: adds property
   * - If no frontmatter exists: creates frontmatter with property
   *
   * @param content - Full markdown file content
   * @param property - Property name (e.g., 'status', 'ems__Effort_status')
   * @param value - Property value (e.g., '"[[StatusDone]]"', 'true', '42')
   * @returns Updated content with modified frontmatter
   *
   * @example
   * ```typescript
   * // Update existing
   * const result1 = service.updateProperty(
   *   '---\nstatus: draft\n---\nBody',
   *   'status',
   *   'published'
   * );
   * // result1 === '---\nstatus: published\n---\nBody'
   *
   * // Add new property
   * const result2 = service.updateProperty(
   *   '---\nfoo: bar\n---\nBody',
   *   'status',
   *   'draft'
   * );
   * // result2 === '---\nfoo: bar\nstatus: draft\n---\nBody'
   *
   * // Create frontmatter if missing
   * const result3 = service.updateProperty(
   *   'Body content',
   *   'status',
   *   'draft'
   * );
   * // result3 === '---\nstatus: draft\n---\nBody content'
   * ```
   */
  updateProperty(content: string, property: string, value: unknown): string {
    property = canonicalYamlKey(FrontmatterService.normalizeIRI(property));
    if (typeof value === "string") {
      value = FrontmatterService.normalizeIRIValue(value);
    }
    const parsed = this.parse(content);
    const serialized = this.serializeValue(property, value);

    // No frontmatter exists - create new block
    if (!parsed.exists) {
      return `---\n${serialized}\n---\n${content}`;
    }

    // Frontmatter exists - update or add property
    let updatedFrontmatter = parsed.content;

    // Property already exists - replace the WHOLE value, including every
    // continuation line it owns (list items AND block-scalar bodies).
    const lines = updatedFrontmatter.split("\n");
    const span = FrontmatterService.findPropertyLineSpan(lines, property);
    if (span) {
      // Splice on LINES rather than String.replace: a `$`-pattern in the value
      // (`$&`, `$1`-`$9`, `` $` ``, `$'`, `$$`) is inserted verbatim, so it is
      // not re-interpreted as a replacement pattern (#3748 family / #3795 H1).
      lines.splice(span.start, span.end - span.start, ...serialized.split("\n"));
      updatedFrontmatter = lines.join("\n");
    } else {
      // Property doesn't exist - append to frontmatter
      // Add newline separator only if frontmatter is not empty
      const separator = updatedFrontmatter.length > 0 ? "\n" : "";
      updatedFrontmatter += `${separator}${serialized}`;
    }

    // Replace frontmatter block in original content. Function-replacer so a
    // `$`-bearing value spliced into `updatedFrontmatter` is not re-interpreted
    // as a String.replace pattern (#3748 family / #3795 review H1).
    const replaced = content.replace(
      FrontmatterService.FRONTMATTER_REGEX,
      () => `---\n${updatedFrontmatter}\n---`,
    );
    // req 960d7a3f (Scenario C): a write to the canonical key also clears its
    // LEGACY physical key(s) (`exo__Asset_archived` ← bare `archived`), so one
    // write migrates the carrier and the file never carries both spellings.
    return this.removeLegacyKeys(replaced, property);
  }

  /**
   * Remove every legacy physical spelling of `canonicalKey` (see
   * {@link LEGACY_YAML_KEYS}); a no-op for keys that have none.
   */
  private removeLegacyKeys(content: string, canonicalKey: string): string {
    let result = content;
    for (const legacy of LEGACY_YAML_KEYS.get(canonicalKey) ?? []) {
      // `removePhysicalKey` keeps the historical byte-shape of `removeProperty`
      // (a key on the FIRST line is replaced by a blank line). A migrated
      // legacy key must not leave that blank line behind, so remember whether
      // the legacy key led the block and strip the blank line it becomes.
      const ledTheBlock = new RegExp("^---\\r?\\n" + legacy + ":").test(result);
      result = this.removePhysicalKey(result, legacy);
      if (ledTheBlock) {
        result = result.replace(/^---(\r?\n)\1/, "---$1");
      }
    }
    return result;
  }

  /**
   * Add a new property to frontmatter (alias for updateProperty).
   *
   * Convenience method with clearer semantics for adding new properties.
   *
   * @param content - Full markdown file content
   * @param property - Property name
   * @param value - Property value
   * @returns Updated content
   */
  addProperty(content: string, property: string, value: unknown): string {
    return this.updateProperty(content, property, value);
  }

  /**
   * Remove a property from frontmatter.
   *
   * - If property exists: removes the line
   * - If property doesn't exist: returns content unchanged
   * - If no frontmatter exists: returns content unchanged
   *
   * @param content - Full markdown file content
   * @param property - Property name to remove
   * @returns Updated content with property removed
   *
   * @example
   * ```typescript
   * const result = service.removeProperty(
   *   '---\nfoo: bar\nstatus: draft\n---\nBody',
   *   'status'
   * );
   * // result === '---\nfoo: bar\n---\nBody'
   * ```
   */
  removeProperty(content: string, property: string): string {
    property = canonicalYamlKey(property);
    // req 960d7a3f (Scenario D): removing the canonical key also clears its
    // LEGACY spelling(s) — `un-archive` on a not-yet-migrated `archived: true`
    // carrier must leave neither key behind.
    return this.removeLegacyKeys(
      this.removePhysicalKey(content, property),
      property,
    );
  }

  /**
   * Remove ONE physical YAML key (no canonicalisation, no legacy expansion) —
   * the primitive behind {@link removeProperty}. Kept separate so a legacy
   * spelling can be removed without being re-canonicalised into the very key
   * that was just written.
   */
  private removePhysicalKey(content: string, property: string): string {
    const parsed = this.parse(content);

    if (!parsed.exists) {
      return content;
    }

    // Remove the key line and EVERY continuation line it owns (list items AND
    // block-scalar bodies) — see `findPropertyLineSpan`.
    //
    // The loop replaces the former `g` flag: ALL occurrences of a duplicated key
    // are removed, not just the first.
    //
    // ⚠ Removing the FIRST key leaves a blank line where it stood (the span is
    // replaced by an empty line instead of being deleted). That is the
    // byte-identical behaviour of the previous `(?:\n|^)`-anchored regex, whose
    // `^` matched empty at position 0 so the trailing newline survived.
    // Middle/last keys are deleted outright, leaving no blank line.
    //
    // ⛤ Existence is decided by `findPropertyLineSpan` itself, NOT by a separate
    // `hasProperty` pre-check. The two disagree on what a line is — `hasProperty`
    // is a `/m`-flagged regex (JS `^` also matches after a lone CR, U+2028, U+2029)
    // while the span splits on "\n" — so a `hasProperty`-gated early return could
    // pass while the loop found nothing, leaving the file rewritten unchanged and
    // the command still reporting `removed: true`. One source of truth for "where
    // does this key live" removes that class by construction.
    const lines = parsed.content.split("\n");
    if (FrontmatterService.findPropertyLineSpan(lines, property) === null) {
      return content; // absent → byte-identical passthrough, no frontmatter rebuild
    }
    for (;;) {
      const span = FrontmatterService.findPropertyLineSpan(lines, property);
      if (!span) break;
      if (span.start === 0) {
        lines.splice(0, span.end, "");
      } else {
        lines.splice(span.start, span.end - span.start);
      }
    }
    const updatedFrontmatter = lines.join("\n");

    // Replace frontmatter block in original content. Function-replacer so a
    // surviving `$`-bearing value in `updatedFrontmatter` is not re-interpreted
    // as a String.replace pattern (#3748 family / #3795 review H1).
    return content.replace(
      FrontmatterService.FRONTMATTER_REGEX,
      () => `---\n${updatedFrontmatter}\n---`,
    );
  }

  /**
   * Check if frontmatter contains a specific property.
   *
   * @param frontmatterContent - Frontmatter content (without --- delimiters)
   * @param property - Property name to check
   * @returns True if property exists
   *
   * @example
   * ```typescript
   * const hasStatus = service.hasProperty('foo: bar\nstatus: draft', 'status');
   * // hasStatus === true
   * ```
   */
  hasProperty(frontmatterContent: string, property: string): boolean {
    // ⛤ Anchored to LINE START. An unanchored `includes(\`${property}:\`)`
    // reports a hit on any key that merely ENDS with the searched name —
    // `namespace_aliases:` answers a search for `aliases:` — and the callers act
    // on that hit by rewriting or deleting the neighbour's line. Canonicalising
    // (req 869561bf) makes the searched key SHORTER, which turned that latent
    // collision into a likely one; anchoring closes it for both spellings.
    return new RegExp(`^${this.escapeRegex(property)}:`, "m").test(
      frontmatterContent,
    );
  }

  /**
   * Reverse-map a full IRI property name to Obsidian-style name.
   * E.g. "https://exocortex.my/ontology/ems#Effort_status" → "ems__Effort_status"
   * Non-IRI values pass through unchanged.
   *
   * ⛔ The result is the PHYSICAL WRITE KEY, not a display hint:
   * {@link updateProperty} and {@link applyPatch} both splice
   * `canonicalYamlKey(normalizeIRI(key))` into the YAML block. So whatever this
   * returns for an unrecognised shape becomes a real frontmatter key on disk —
   * which is why the two failure modes below were silent (`changed: true`, no
   * error) rather than loud. Ticket `c8fc6793`.
   *
   * ONE source of truth: `iriToObsidianName` → `Namespace.fromTermIRI`, the
   * shared inverse of the forward emission path (`Namespace.fromPropertyKey` /
   * `Namespace.term`). It resolves EVERY registered W3C vocabulary and EVERY
   * ad-hoc `https://exocortex.my/ontology/<prefix>#` namespace.
   *
   * ⛤ A static NINE-namespace `IRI_PREFIX_MAP` used to sit here as a HOT PATH,
   * guarded by the same local-name rule so that it could only answer FASTER,
   * never DIFFERENTLY (ticket `c8fc6793`, req `eac1690d`). Ticket `6572f3f3` /
   * req `38e3f174` removed it: a second literal list of bases is precisely what
   * {@link Namespace.fromTermIRI}'s own docstring warns against, and it is the
   * reason the three independent IRI↔prefix implementations could drift. The
   * measured price of the removal is +300 ns per key — +4.5 µs on a 15-key
   * asset write, +72 ms across a 16 000-file sweep — i.e. below the noise of the
   * file I/O it accompanies. Both prior failure modes stay closed, now by the
   * single inverse rather than by keeping two branches in agreement:
   *
   *   - `…/ontology/flow#Stage_chatId` (namespace outside the old nine) →
   *     `flow__Stage_chatId`, not the raw IRI as a physical key.
   *   - `…/ontology/ems#` (EMPTY local name — the shape of every
   *     `exo__Ontology_url`) → returned untouched, not the junk prefix `ems__`.
   *
   * ⛤ Of the three implementations named in `6572f3f3` two are now one; the
   * third, `PropertySchemaResolver`, derives from the same inverse as of req
   * `38e3f174`.
   */
  static normalizeIRI(property: string): string {
    // ⛔ LOAD-BEARING, not a micro-optimisation. Besides "no hash ⇒ not a term
    // IRI", this early return is the only thing keeping `iriToObsidianName`'s
    // SECOND shape (vault URL → basename) out of the write-key path:
    // `obsidian://vault/a/b.md` would otherwise become the key `b`. That shape
    // is consumed by {@link normalizeIRIValue} with its own anchored regex, so
    // this function must leave it alone. Measured on `origin/main` 0857307b:
    // deleting this line reddened NOTHING across 132 tests in 4 suites — the
    // property was true but unlocked; req `38e3f174` Scenario H is its spec.
    if (property.lastIndexOf("#") < 0) return property;
    return iriToObsidianName(property) ?? property;
  }

  /**
   * Reverse-map an IRI value to wikilink format.
   * E.g. "obsidian://vault/ems/ems__EffortStatusDoing.md" → "\"[[ems__EffortStatusDoing]]\""
   * Non-IRI and non-obsidian:// values pass through unchanged.
   *
   * Two forms, one per write path (req `27fbe40b`, ticket 73b16cc4):
   * - default — the QUOTED YAML scalar `"[[x]]"`, ready to be spliced into a
   *   frontmatter block as text ({@link updateProperty} inserts it verbatim);
   * - `{ bare: true }` — the bare `[[x]]`, for the OBJECT path
   *   ({@link applyPatch}): the value becomes a property of the live object
   *   and the serialiser (js-yaml on the CLI, Obsidian's `processFrontMatter`
   *   in the plugin) quotes it on disk — pre-quoting would make the quotes
   *   part of the string (`'"[[x]]"'`, the double-wrap PR #4243's review named).
   */
  static normalizeIRIValue(
    value: string,
    options: { readonly bare?: boolean } = {},
  ): string {
    const wrap = (inner: string): string =>
      options.bare ? `[[${inner}]]` : `"[[${inner}]]"`;
    // Handle obsidian:// vault URLs
    const obsMatch = value.match(/^obsidian:\/\/vault\/.*\/([^/]+)\.md$/);
    if (obsMatch) {
      return wrap(obsMatch[1]);
    }
    // Handle full ontology IRIs as values
    const normalized = FrontmatterService.normalizeIRI(value);
    if (normalized !== value) {
      return wrap(normalized);
    }
    return value;
  }

  /**
   * Apply `patch` to the live frontmatter OBJECT `target` in the chokepoint's
   * key dialect — the single carrier of that dialect for the object-shaped
   * write path (req `2a020489`; the text-shaped path is {@link updateProperty},
   * which applies the same rule one property at a time).
   *
   * Both production `IVaultAdapter.updateFrontmatter` implementations call
   * this and re-implement none of it: `ObsidianVaultAdapter` hands in the live
   * object Obsidian's `processFrontMatter` gives it (which is why this mutates
   * `target` in place rather than returning a copy), `FileSystemVaultAdapter`
   * hands in the parsed YAML block it is about to serialise back.
   *
   * Contract (port JSDoc `IVaultFrontmatterManager.updateFrontmatter` says the
   * same from the caller's side):
   *
   * 1. **PATCH, not REPLACE** — every key of `target` that `patch` does not
   *    carry is left untouched.
   * 2. **Omission is not deletion** — the only keys ever removed from `target`
   *    are the {@link LEGACY_YAML_KEYS} spellings of a canonical key this call
   *    has just written (bare `archived` after a write of
   *    `exo__Asset_archived`); removing a property is {@link removeProperty}'s
   *    job, not this one's.
   * 3. **Every written key goes through the dialect** — each patch key is
   *    mapped through `canonicalYamlKey(normalizeIRI(key))` (`archived` →
   *    `exo__Asset_archived`, `exo__Asset_aliases` → `aliases`, an
   *    `https://…#Local` IRI → `prefix__Local`, anything else → itself), each
   *    string value through {@link normalizeIRIValue}, and a patch that carries
   *    BOTH spellings of one key resolves canonical-wins (the legacy entry is
   *    skipped when the patch already holds the canonical key — the same
   *    priority `NoteToRDFConverter` guard M1 and
   *    `MetadataHelpers.ARCHIVED_FLAG_KEYS` apply on the read side). A patch
   *    that re-emits the full object (`{...current, [prop]: value}`) therefore
   *    canonicalises every current key, which is what migrates a legacy
   *    carrier on any edit (req `de7131ae` Scenario E).
   *
   * A patch value of `undefined` is "no opinion": the key is neither written
   * nor legacy-dropped (the CLI dumper would otherwise delete it — a removal
   * this path must not express).
   *
   * Not covered (named, not changed — PR #4241 review LOW-3): the reverse
   * write of the UNPREFIXED direction. A literal `exo__Asset_aliases:` already
   * on disk is NOT removed here, because {@link LEGACY_YAML_KEYS} has no entry
   * for it; the chokepoint behaves the same.
   *
   * Reference values are stored BARE (`[[x]]`, req `27fbe40b`): this is the
   * object path, so the serialiser quotes the string on disk — the CLI adapter
   * with `quoteStyle: "double"` (js-yaml 5) writes `key: "[[x]]"` for a
   * reference string, the same line the text path {@link updateProperty}
   * writes; pre-quoting (the pre-27fbe40b behaviour) made the quotes part of
   * the value (`"\"[[x]]\""` on disk). Arrays are not normalised on either path.
   *
   * @returns `target`, for callers that serialise the result.
   */
  static applyPatch(target: IFrontmatter, patch: IFrontmatter): IFrontmatter {
    for (const key of Object.keys(patch)) {
      const canonicalKey = canonicalYamlKey(FrontmatterService.normalizeIRI(key));
      if (
        canonicalKey !== key &&
        Object.prototype.hasOwnProperty.call(patch, canonicalKey)
      ) {
        // Canonical-wins: the patch already carries the canonical spelling of
        // this key; the legacy/prefixed alias must not overwrite it.
        continue;
      }
      let value = patch[key];
      if (value === undefined) {
        // `undefined` is "no opinion", not a value: writing it would make the
        // CLI's YAML dumper DROP the key (js-yaml skips undefined), i.e. a
        // deletion the contract says this path cannot express — so neither
        // the write nor the legacy-spelling drop happens (PR #4243 review).
        continue;
      }
      if (typeof value === "string") {
        value = FrontmatterService.normalizeIRIValue(value, { bare: true });
      }
      target[canonicalKey] = value;
      for (const legacy of LEGACY_YAML_KEYS.get(canonicalKey) ?? []) {
        delete target[legacy];
      }
    }
    return target;
  }

  /**
   * Create new frontmatter block with given properties.
   *
   * @param content - Original markdown content (without frontmatter)
   * @param properties - Object with property-value pairs
   * @returns Content with new frontmatter prepended
   *
   * @example
   * ```typescript
   * const result = service.createFrontmatter(
   *   'Body content',
   *   { status: 'draft', priority: 'high' }
   * );
   * // result === '---\nstatus: draft\npriority: high\n---\nBody content'
   * ```
   */
  createFrontmatter(
    content: string,
    properties: Record<string, unknown>,
    declaredRangeOf?: (suppliedKey: string) => readonly string[] | undefined,
  ): string {
    // req 869561bf — canonicalise BEFORE ordering, so the order spec and the
    // `STRING_SCALAR_PROPERTIES` lookup inside `serializeValue` both see the key
    // the file will actually carry. Doing it per-entry during the map instead
    // would let `exo__Asset_aliases` and `aliases` both survive into the output
    // as duplicate YAML keys; collapsing them here makes last-write-wins
    // explicit and keeps the emitted document parseable.
    const canonical: Record<string, unknown> = {};
    // Ticket 534a7a46 — the key each canonical key was SUPPLIED as, because the
    // range lookup is made with THAT one, exactly as in this method's twin
    // `MetadataHelpers.buildFileContent`: the TBox keys a range by the def's
    // `prefix__Name` label, so `exo__Asset_pinned` resolves a range in both
    // writers even though it is EMITTED as the bare `pinned:` key, and a caller
    // passing the bare `aliases` resolves nothing in either. When two supplied
    // keys collapse onto one canonical key the later entry wins the value, so it
    // also wins the lookup key.
    const suppliedKeyOf: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
      const canonicalKey = canonicalYamlKey(key);
      canonical[canonicalKey] = value;
      suppliedKeyOf[canonicalKey] = key;
    }
    const ordered = orderProperties(canonical, loadDefaultSpec());
    // Issue #3748: quote scalars on new-asset writes so a label / alias
    // containing `: ` (or another YAML indicator) stays valid YAML.
    const frontmatterLines = Object.entries(ordered).map(([key, value]) =>
      this.serializeValue(
        key,
        value,
        true,
        declaredRangeOf?.(suppliedKeyOf[key] ?? key),
      ),
    );

    const frontmatterBlock = `---\n${frontmatterLines.join("\n")}\n---`;

    // Preserve leading newline if original content starts with one
    const separator = content.startsWith("\n") ? "" : "\n";
    return `${frontmatterBlock}${separator}${content}`;
  }

  /**
   * Get property value from frontmatter content.
   *
   * @param frontmatterContent - Frontmatter content (without --- delimiters)
   * @param property - Property name
   * @returns Property value or null if not found
   *
   * @example
   * ```typescript
   * const value = service.getPropertyValue(
   *   'foo: bar\nstatus: draft',
   *   'status'
   * );
   * // value === 'draft'
   * ```
   */
  getPropertyValue(
    frontmatterContent: string,
    property: string,
  ): string | null {
    // Anchored for the same reason as the write paths: an unanchored match
    // would return the NEIGHBOUR's value for any key ending in this name.
    const propertyRegex = new RegExp(
      `^${this.escapeRegex(property)}:\\s*(.*)$`,
      "m",
    );
    const match = frontmatterContent.match(propertyRegex);
    return match ? match[1].trim() : null;
  }

  /**
   * Escape special regex characters in property names.
   *
   * Handles property names with special characters like dots, underscores, etc.
   *
   * @param str - String to escape
   * @returns Escaped string safe for use in RegExp
   * @private
   */
  /**
   * Serialize a property key-value pair to a YAML frontmatter line.
   * Arrays are serialized as multi-line YAML lists.
   *
   * `quoteScalars` (Issue #3748) wraps string scalars / array items that would
   * otherwise emit invalid YAML (e.g. `exo__Asset_label` containing `: `) in a
   * double-quoted scalar. It is enabled ONLY on the `createFrontmatter` path
   * (new-asset writes from `create_instance`). The `updateProperty` path leaves
   * it OFF: that path receives already-formatted values — pre-quoted wikilinks
   * and deliberate YAML flow-array strings like `["[[ems__Task]]"]` (multi-class
   * convert) — that must be emitted verbatim, not re-quoted into a string.
   */
  private serializeValue(
    property: string,
    value: unknown,
    quoteScalars = false,
    declaredRange?: readonly string[],
  ): string {
    // #3750 MEDIUM-3: also quote scalar-looking strings (123 / true / date)
    // for string-semantic properties (label / aliases) so they round-trip as
    // strings; other properties keep native number/date type.
    const quoteAmbiguous = quoteScalars && STRING_SCALAR_PROPERTIES.has(property);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return `${property}:`;
      }
      const items = value
        .map(
          (v) =>
            `  - ${quoteScalars ? serializeYamlScalar(v, quoteAmbiguous, declaredRange) : String(v)}`,
        )
        .join("\n");
      return `${property}:\n${items}`;
    }
    const scalar = quoteScalars
      ? serializeYamlScalar(value, quoteAmbiguous, declaredRange)
      : String(value);
    return `${property}: ${scalar}`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Line span `[start, end)` that a top-level frontmatter key OWNS.
   *
   * ⛤ A key owns its own line PLUS every following line that is INDENTED,
   * because in a YAML block mapping a top-level key ends exactly where the next
   * column-0 line begins. That covers both continuation shapes:
   *
   * - list items — `  - value`
   * - **block scalars** — `key: |-` / `key: |` / `key: >` followed by an
   *   indented body (any indentation, not just two spaces)
   *
   * ⛤ A COLUMN-0 list item (`key:\n- value`) is owned too (issue #4314). It is
   * not indented, so the previous implementation ended the span at the key line
   * and spliced the new value in ABOVE the old items, leaving them dangling at
   * column 0 — which made the whole document unparseable (measured: js-yaml
   * "end of the stream or a document separator is expected"). Since `parseObject`
   * now READS that shape, the write side has to own it or the round-trip breaks.
   *
   * The previous implementation matched `(?:\n {2}- .*)*`, i.e. list items ONLY.
   * A block scalar's body therefore survived the rewrite as dangling indented
   * lines under the new value, which makes the whole frontmatter unparseable —
   * so the asset drops out of the graph entirely (not just that one property)
   * while the command still reports success (ems__Bug 94fe70ac).
   *
   * A BLANK line is only absorbed when an indented line follows it (blank lines
   * are legal inside a block scalar). A blank line that trails the value is left
   * where it is, so removal/rewrite never eats the separator before the next key.
   *
   * @param lines - Frontmatter content split on "\n" (without --- delimiters)
   * @param property - Canonical YAML key to locate
   * @returns The owned span, or null when the key is absent
   */
  private static findPropertyLineSpan(
    lines: readonly string[],
    property: string,
  ): { start: number; end: number } | null {
    // Anchored to LINE START, mirroring `hasProperty` — a key that merely ENDS
    // with the searched name (`namespace_aliases:` vs `aliases:`) is not a hit.
    const keyPrefix = `${property}:`;
    const start = lines.findIndex((line) => line.startsWith(keyPrefix));
    if (start === -1) {
      return null;
    }

    let end = start + 1;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^[ \t]/.test(line) || /^-(?: |$)/.test(line)) {
        // Indented, or a column-0 list item → owned by this key. Absorbs any
        // blank lines skipped above. `-(?: |$)` requires the space, so a key
        // that merely STARTS with a dash (`-foo: bar`) still ends the span.
        end = i + 1;
        continue;
      }
      if (line.trim() === "") {
        // Blank — may sit INSIDE a block scalar; only absorbed if an indented
        // line follows (handled by the branch above on a later iteration).
        continue;
      }
      break;
    }
    return { start, end };
  }
}
