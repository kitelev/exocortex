# Developer Troubleshooting — Plugin Runtime & Feature Debugging (frozen archive)

> **Frozen archive — as of 2026-06-19.** Past-tense incident write-ups extracted from the root
> `DEV-TROUBLESHOOTING.md` (RFC 0001 §4 Phase 3). Each entry documented a specific
> plugin-runtime / feature bug and how it was fixed (tied to an issue/PR). They are preserved
> verbatim for historical reference and are **not** maintained; for current dev/CI
> troubleshooting see [`../../DEV-TROUBLESHOOTING.md`](../../DEV-TROUBLESHOOTING.md).

---

## DateTime/Timezone Issues

### Timestamp Saved with Wrong Offset (e.g., +20 hours)

**Problem**: User enters datetime value, but it's saved with unexpected hour offset.

**Example (Issue #1052)**:

- User entered: `2025-12-17T20:05`
- Actually saved: `2025-12-18T16:05` (+20 hours offset!)

**Symptoms**:

- One datetime field works correctly (e.g., plannedStartTimestamp)
- Another field has offset bug (e.g., plannedEndTimestamp)
- Offset is not a simple timezone conversion (e.g., +20 hours instead of ±5)

**Root Cause Investigation**:

```typescript
// Check if code uses Date.toISOString() - converts to UTC
const saved = new Date(userInput).toISOString(); // ❌ WRONG

// Check getTimezoneOffset() arithmetic
// GOTCHA: Returns NEGATIVE for POSITIVE timezones!
// UTC+5 (Almaty) → getTimezoneOffset() returns -300 (minutes)

// Common mistake: sign error + double application
// Input: 20:05 local
// Step 1: Convert to UTC: 15:05 (subtract 5 hours - correct)
// Step 2: Bug applies +15 hours instead of nothing
// Result: 16:05 next day (+20 hours total)
```

**Debugging Steps**:

```typescript
// 1. Find the serialization code
rg "toISOString" packages/obsidian-plugin/src --type ts
rg "getTimezoneOffset" packages/obsidian-plugin/src --type ts

// 2. Compare working vs broken fields
// If plannedStartTimestamp works but plannedEndTimestamp doesn't,
// they may use different code paths

// 3. Check for double offset application
// Search for multiple getTimezoneOffset() calls or manual math

// 4. Test in browser console
const testDate = '2025-12-17T20:05';
console.log('Input:', testDate);
console.log('toISOString:', new Date(testDate).toISOString());
console.log('getTimezoneOffset:', new Date(testDate).getTimezoneOffset());
```

**Solution**:

```typescript
// ✅ CORRECT: Preserve user input as string
function serializeTimestamp(userInput: string): string {
  if (userInput.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
    return userInput + ":00"; // Just add seconds
  }
  return userInput;
}

// ❌ WRONG: Don't use Date object for local time
const broken = new Date(userInput).toISOString();
```

**Key Gotchas**:

- `getTimezoneOffset()` returns **negative** for **positive** timezones
- `toISOString()` **always** converts to UTC
- JavaScript Date is always UTC internally
- Fractional hour timezones exist (UTC+5:30, etc.)

**Reference**: Issue #1052, PR #1052 - Fixed +20 hour offset bug in plannedEndTimestamp

---

## SPARQL Indexing Issues

### Statement Files Not Indexed in CLI SPARQL

**Problem**: CLI SPARQL queries return empty results for files in Exo 0.0.3 format.

**Symptoms**:

- `exocortex-cli sparql query "SELECT ?s WHERE { ?s a exo:Statement }"` returns 0 results
- Files exist and are in correct format
- Previous version worked correctly

**Root Cause**: Statement files in Exo 0.0.3 format have different structure (anchor/statement/body sections) and require specialized indexing.

**Diagnosis**:

```bash
# Check if files are being found
exocortex-cli sparql query --folder /path/to/vault \
  "SELECT ?s WHERE { ?s ?p ?o }" | head -5

# Check for indexing errors
exocortex-cli sparql query --verbose \
  "SELECT ?s WHERE { ?s a exo:Statement }"
```

**Common Causes**:

1. **Regression from format change**: New format parser doesn't emit triples
2. **Missing file type handling**: Indexer skips `.md` files with certain frontmatter
3. **Wikilink alias stripping**: Links like `[[Page|Alias]]` not properly parsed

**Solution History**:

- Issue #1377: Initial regression - statement files not converted to RDF
- Issue #1380: Follow-up regression - statement files still not indexed after #1377 fix

**Prevention**: Always add regression tests when implementing new format support.

**Reference**: Issues #1377, #1380 - CLI SPARQL Statement Indexing (January 2026)

---

## Plugin Features Not Available During Startup

### Metadata Cache Returns Null

**Problem**: Plugin features (buttons, commands, renderers) are not available when opening files immediately after Obsidian startup.

**Symptoms**:

- "Create Instance" buttons not visible on prototype files
- Commands fail with "cannot determine asset class"
- Renderers show empty/incomplete layouts
- Works correctly after ~5-10 seconds

**Root Cause**: `metadataCache.getFileCache(file)` returns `null` until Obsidian finishes indexing the vault.

**Diagnosis**:

```typescript
// Check in browser console (Ctrl+Shift+I in Obsidian)
const file = app.workspace.getActiveFile();
console.log(app.metadataCache.getFileCache(file));
// Output: null (during indexing) or {frontmatter: {...}} (after indexing)
```

**Solution**: Implement fallback YAML parsing (see PATTERNS.md § "Metadata Cache Fallback Pattern")

```typescript
// Quick check: Is frontmatter accessible?
const cache = app.metadataCache.getFileCache(file);
if (cache?.frontmatter) {
  // Normal path
} else {
  // Fallback: read file directly and parse YAML
  const content = await app.vault.read(file);
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = match ? yaml.load(match[1]) : null;
}
```

**When This Happens**:

- First launch after Obsidian update
- Cache invalidation (`.obsidian/` folder deleted)
- Large vaults (>10,000 files) with slow indexing
- Immediately after installing/enabling plugin

**Reference**: Issue #2103 - Make plugin independent from Obsidian metadata cache (February 2026)

---

## Table Column Misalignment in Virtualized Tables

### Scrollbar Width Causing Offset

**Problem**: In tables with >50 rows (virtualized), header columns don't align with body columns.

**Symptoms**:

- Header text appears shifted ~17px to the left of body cells
- Problem only appears with scrollbar visible
- Works correctly in non-virtualized tables (<50 rows)

**Root Cause**: Virtualized tables use separate `<table>` elements for header and body. The body table is inside a scroll container, which has a scrollbar taking ~17px width.

**Diagnosis**:

```typescript
// Check in browser console
const scrollContainer = document.querySelector(".scroll-container");
console.log(scrollContainer.offsetWidth - scrollContainer.clientWidth);
// Output: 17 (Windows/Linux) or 0 (macOS overlay scrollbars)
```

**Solution**: Apply padding compensation to header table (see PATTERNS.md § "Virtualized Table Scrollbar Compensation Pattern")

**Quick Fix** (CSS only):

```css
/* May not work with all scrollbar styles */
.virtualized-table-header {
  padding-right: 17px; /* Hardcoded scrollbar width */
}
```

**Proper Fix** (measure dynamically):

```typescript
const scrollWidth =
  parentRef.current.offsetWidth - parentRef.current.clientWidth;
setScrollbarWidth(scrollWidth);
// Apply as style={{ paddingRight: scrollbarWidth }}
```

**Affected Components**:

- `DailyTasksTable.tsx` (fixed in PR #941)
- `AssetRelationsTable.tsx` (fixed in PR #2116)
- `TableLayoutRenderer.tsx` (fixed in PR #2116)

**Reference**: Issues #941, #2116, #2120 - Scrollbar width compensation (February 2026)

---

## CLI SPARQL Queries Missing Expected Results

### UUID-Based Wikilinks Not Resolved

**Problem**: SPARQL queries for class hierarchies return incomplete results.

**Symptoms**:

```sparql
# Expected: Returns all subclasses of exo:Prototype
SELECT ?subclass WHERE {
  ?subclass rdfs:subClassOf* exo:Prototype
}
# Actual: Missing classes that reference parent by UUID
```

**Root Cause**: Wikilinks like `[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]` are not resolved to file IRIs because standard relative path resolution fails for UUID-named files.

**Diagnosis**:

```yaml
# Check frontmatter of affected file
exo__Class_superClass:
  - "[[ems__EffortPrototype]]" # ✅ Resolves
  - "[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]" # ❌ May fail
```

**Solution**: Build UUID-to-filepath index in `FileSystemVaultAdapter` (see PATTERNS.md § "UUID Wikilink Resolution Pattern")

**Quick Workaround**:

```yaml
# Use human-readable filename instead of UUID
exo__Class_superClass:
  - "[[exo__Prototype]]" # If file exists as exo__Prototype.md
```

**Long-term Fix**: Update CLI to version with UUID resolution (PR #2113+)

**Reference**: Issue #2113 - Resolve UUID-based wikilinks in FileSystemVaultAdapter (February 2026)

---

## Wikilink Display Issues in Reading View

### Block Reference Shows UUID Instead of Label

**Problem**: Wikilinks like `[[uuid#^blockid]]` display as `uuid > ^blockid` instead of `Asset Label > ^blockid` in Reading View.

**Symptoms**:

- Block reference links show raw UUID in Reading View
- Same links display correctly in Live Preview mode
- Links work correctly (navigation functions)
- Only display text is wrong

**Root Cause**: `BodyLinkPatch.ts` has a `hasUserAlias` guard that may incorrectly classify Obsidian-generated text as user-provided aliases, causing early return before label resolution.

**Diagnosis**:

```typescript
// Add temporary debug logging in BodyLinkPatch.patchLink()
console.log("BodyLinkPatch debug:", {
  currentText, // What Obsidian rendered
  expectedBlockRefText, // What we expect
  matchesBlockRefText, // true/false
  hasUserAlias, // If true, patching is skipped
});
```

**Common Cause**: Obsidian renders wikilink text in multiple formats:

- `basename#^blockid` (standard)
- `basename#blockid` (without caret)
- `basename > ^blockid` (separator format)
- `basename` (basename only)

If the guard only checks for one format, others are misclassified as "user alias".

**Solution**: Update `hasUserAlias` guard to recognize all known Obsidian text formats (see PATTERNS.md § "Obsidian Wikilink Text Rendering Variations Pattern")

```typescript
// Add additional format checks
const matchesBlockRefWithoutCaret = blockId
  ? currentText === `${file.basename}#${blockId}`
  : false;

const matchesBlockRefSeparatorFormat = blockId
  ? currentText === `${file.basename} > ^${blockId}`
  : false;

// Update guard
const hasUserAlias =
  currentText !== "" &&
  !matchesBasename &&
  !matchesDataHref &&
  !matchesBlockRefText &&
  !matchesBlockRefWithoutCaret && // NEW
  !matchesBlockRefSeparatorFormat && // NEW
  !wasAlreadyPatched;
```

**Prevention**:

- Always test wikilink features in **both** Live Preview and Reading View
- Log actual Obsidian output before hardcoding expected formats
- Add regression tests for format variations

**Reference**: Issue #2139, PR #2140 - Block reference Reading View fix (41 steps, February 2026)

---

## Graph View Labels Show UUIDs Despite Fix

### Symptom: Patch Applied But Labels Still Show UUIDs

**Problem**: `showLabelsInGraphView` setting is enabled, GraphViewPatch unit tests pass, but Graph View still displays UUID filenames instead of `exo__Asset_label` values.

**Symptoms**:

- All unit tests pass (including GraphViewPatch tests)
- Setting toggle is enabled in plugin settings
- Graph View nodes show UUIDs like `84e75603-0103-4594-8499-09dc404800b0`
- Expected behavior: nodes should show labels like "My Project"

**Root Causes** (in order of likelihood):

1. **No forced re-render after patching**: Obsidian renders node labels at creation time. Patching `getDisplayText()` AFTER nodes exist has no visible effect.

2. **Timing issue**: Patch applied too early (before Graph View loads) or too late (after nodes already rendered).

3. **Multiple prototypes**: Global graph and Local graph may use different internal classes. Patching one prototype leaves the other unpatched.

4. **Mocks hide lifecycle issues**: Unit tests mock graph nodes directly, never testing actual Obsidian rendering lifecycle.

**Diagnosis**:

```typescript
// Add debug logging to GraphViewPatch.patchProto()
console.log("GraphViewPatch.patchProto called:", {
  protoConstructor: proto.constructor?.name,
  nodesCount: renderer?.nodes?.length,
  enabled: this.enabled,
});
```

Check browser console:

- If not logged → patch never called
- If logged but 0 nodes → patch applied before graph loaded
- If logged with nodes but still UUIDs → missing re-render

**Solution**: See PATTERNS.md § "FunctionReplacer Pattern for Obsidian Patches"

Key fixes:

1. Use FunctionReplacer pattern with restorer functions
2. Collect ALL unique prototypes from renderer nodes
3. Call `forceRedrawGraphView()` after patching
4. Subscribe to `layout-change` event with debounced handler

**Reference**: Issues #2149, #2151, #2157 - Graph View label fixes (17-150 steps, February 2026)

---

## Graph View Fix Works But Causes TypeScript Errors

### Symptom: FunctionReplacer Pattern Compiles Locally But CI Fails

**Problem**: After implementing FunctionReplacer pattern for Graph View, local build works but CI reports TypeScript errors.

**Common Errors**:

```
error TS2339: Property 'getDisplayText' does not exist on type 'object'
error TS7006: Parameter 'proto' implicitly has an 'any' type
error TS2352: Conversion of type 'T[keyof T]' to type 'Function' may be a mistake
```

**Root Cause**: Generic FunctionReplacer typing conflicts with Obsidian's untyped internal APIs.

**Solution**: Use careful type narrowing and explicit casts:

```typescript
// ❌ WRONG: Generic typing fails on untyped Obsidian APIs
function replaceMethod<T>(proto: T, name: keyof T) { ... }

// ✅ CORRECT: Explicit object type with method cast
function replacePrototypeMethod(
  proto: object,
  methodName: string,
  wrapper: (original: () => string) => () => string
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
  const original = descriptor?.value as (() => string) | undefined;

  if (typeof original !== "function") {
    return () => {}; // No-op restorer if method doesn't exist
  }

  Object.defineProperty(proto, methodName, {
    value: wrapper(original),
    configurable: true,
    writable: true,
  });

  return () => {
    Object.defineProperty(proto, methodName, {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
```

**Prevention**:

- Run `npm run check:types` before pushing
- Use explicit type casts for Obsidian internals
- Avoid overly generic typing for prototype manipulation

**Reference**: Issue #2165 - TypeScript errors in FunctionReplacer (February 2026)

---

## Wikilinks in Tables Not Resolved

### Symptom: Paragraph Links Work But Table Links Show UUIDs

**Problem**: Wikilink label resolution works for `[[uuid]]` links in paragraphs, but links inside markdown tables still display raw UUIDs.

**Example**:

```markdown
<!-- This works -->

Link to [[7db5eeff-718a-49b0-8d2b-39b084a356e3]] in paragraph.

<!-- This shows UUID -->

| Field | Value                                    |
| ----- | ---------------------------------------- |
| Link  | [[7db5eeff-718a-49b0-8d2b-39b084a356e3]] |
```

**Root Cause**: MutationObserver in `BodyLinkPatch.ts` uses `querySelectorAll()` on added nodes, but doesn't check if the added node itself IS a link (which can happen when Obsidian adds table cells).

**Diagnosis**:

```typescript
// Add debug logging to observer callback
console.log("Mutation added:", {
  nodeName: node.nodeName,
  isElement: node instanceof HTMLElement,
  isLink: node instanceof HTMLElement && node.matches("a.internal-link"),
  innerHTML: node instanceof HTMLElement ? node.innerHTML.slice(0, 100) : null,
});
```

**Solution**: Check both the node AND its descendants:

```typescript
// ✅ COMPLETE: Handles both cases
for (const node of mutation.addedNodes) {
  if (node instanceof HTMLElement) {
    // Case 1: Node IS a link (common in table cells)
    if (node.matches("a.internal-link")) {
      this.patchLink(node as HTMLAnchorElement);
    }

    // Case 2: Node CONTAINS links
    node.querySelectorAll("a.internal-link").forEach((link) => {
      this.patchLink(link as HTMLAnchorElement);
    });
  }
}
```

**Also verify**: Observer configuration includes `subtree: true`:

```typescript
observer.observe(container, {
  childList: true,
  subtree: true, // Required for table cell content!
});
```

**Reference**: Issue #2153 - Wikilinks in tables not resolved (56 steps, February 2026)

---

## SHACL-lite `sh:maxCount got 2` on Single UUID Wikilink

**Symptom**: `sh:maxCount violation: expected at most 1 value for <predicate>, got 2` — but the frontmatter has only one wikilink value (e.g. `pmbok__RiskItem_project: "[[uuid]]"`).

**Root cause**: Before v15.160.1, `NoteToRDFConverter.valueToRDFObject` emitted dual-storage (IRI + UUID Literal) for **all** UUID-form wikilinks. SHACL cardinality shapes with `sh:maxCount=1` counted both as separate values.

**Fix**: Upgrade to `@kitelev/exocortex-cli@^15.160.1`. Dual-storage is now scoped to `exo__Asset_prototype` only — all other predicates emit a single IRI.

**If still failing after upgrade**:

- Verify the predicate in the violation is NOT `exo__Asset_prototype` (that predicate intentionally emits 2 triples)
- Check for `exo__Asset_legacyValidationException: "true"` in the asset — if present from the window 2026-05-03 10:00–13:20 UTC+5, it can now be removed

**Reference**: IssueItem ff3858e5, PR #3070

---

## SHACL-lite `sh:class violation` on Enum Instance Wikilink

**Symptom**: `sh:class violation: <pmbok#ClosureOutcomeAllAccepted> does not conform to expected class pmbok#ClosureOutcome` (or similar for RiskImpact, RiskProbability, RiskStatus, etc.).

**Root cause**: Before v15.160.1, resolving `[[pmbok__ClosureOutcomeAllAccepted]]` to namespace IRI `pmbok#ClosureOutcomeAllAccepted` did not emit an `rdf:type` triple. SHACL `sh:class` validation requires `pmbok:ClosureOutcomeAllAccepted rdf:type pmbok:ClosureOutcome` to be present in the graph to confirm conformance.

**Fix**: Upgrade to `@kitelev/exocortex-cli@^15.160.1`. The converter now emits the `rdf:type` triple derived from the target file's `exo__Instance_class` frontmatter.

**Prerequisite**: The enum instance file (e.g. `pmbok__ClosureOutcomeAllAccepted.md`) must have `exo__Instance_class` in its frontmatter pointing to the parent class.

**Reference**: IssueItem ff3858e5, PR #3070

---

## SHACL-lite false `sh:class violation` from Multi-Valued `exo__Instance_class` with One Malformed Entry

**Symptom**: An asset has frontmatter like

```yaml
exo__Instance_class:
  - "[[kf__Academic Discipline]]" # malformed (whitespace in local name)
  - "[[ims__Concept]]" # well-formed
```

…and SHACL still reports `sh:class violation` for the asset (or for assets that reference it) even though `ims__Concept` IS expected to be in `rdf:type`.

**Diagnostic procedure (IRI-normalization / triple-presence audit, ≤15 min)**

1. **Probe whether the target has ANY triples in the store:**

   ```bash
   npx @kitelev/exocortex-cli exoql query \
     "SELECT ?p ?o WHERE { <obsidian://vault/path/to/target.md> ?p ?o }"
   ```

   - `0 results` → the converter dropped the entire asset. Continue at step 2.
   - rdf:type triples appear → the bug is not the converter. Suspect IRI normalization between `subjectClasses.set` (line 165 of `ShaclLiteValidator.ts`) and `subjectClasses.get(obj.value)` (line 235) — compare lookup-key vs subject-key encoding (percent-encoding, trailing slashes).

2. **Inspect the target's `exo__Instance_class` array.** Any entry whose `[[wikilink]]` starts with a namespaced prefix (`kf__`, `ems__`, `inbox__`, …) but whose local name contains whitespace, parentheses, or other characters illegal in an IRI is malformed.

3. **Pre-fix root cause (resolved by Issue #3121):** a single malformed entry threw at `Namespace.term()`, aborting the whole-asset triple build via the outer catch in `convertVaultWithValidation`. Validator-side `validateExocortexAsset` also rejected the whole asset on the first malformed entry. Net result: every reference to the asset triggered a false sh:class violation because the target had zero `rdf:type` triples in the store.

**Fix (Issue #3121, v15.176.x+)**

- `expandClassValue` rejects local names containing whitespace/parens — returns `null` instead of throwing.
- `validateExocortexAsset` accepts a multi-valued array if **any** entry is well-formed; only rejects when **all** entries are malformed.
- Net effect: malformed entries are silently dropped at conversion; valid siblings still produce `rdf:type` and `exo__Instance_class` triples, so SHACL `sh:class` ANY-of check sees the correct class set.

**User action**: optionally rename malformed targets to a valid namespace form (e.g. `kf__AcademicDiscipline`). The asset is no longer invisible to SHACL in the meantime.

**Reference**: Issue #3121

---

## exo\_\_Instance_class wikilink form mismatch — all forms RDF-equivalent

**Symptom / question**: "I bulk-rewrote `exo__Instance_class` from label form `[[ems__Task]]` to bare-UUID form `[[1b20a8f0-…]]`. SHACL violation count didn't change at all. Did the rewrite do nothing? Was my hypothesis wrong?"

**Short answer**: The rewrite did exactly what it should — **nothing semantically**, because all three accepted forms are RDF-equivalent. The violation count is identical _by design_. Don't burn cycles debugging this.

### The three forms

`exo__Instance_class` historically accepts three wikilink shapes:

| Form | Example                                                 | Where used                                                                   |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A    | `"[[ems__Task]]"`                                       | Older `/exocortex-asset` skill template, hand-written assets                 |
| B    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e\|ems__Task]]"` | Mixed-form skill outputs (UUID for stability, alias for humans)              |
| C    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"`            | **Canonical** since 2026-05-16 (issue #3123). Used by recent bulk migrations |

### Why all three are semantically equivalent

`NoteToRDFConverter.valueToClassURI` resolves any of the three to the **same namespace IRI** (e.g. `https://exocortex.my/ontology/ems#Task`) via `Namespace.fromPropertyKey`. The converter:

1. Strips wikilink brackets `[[...]]` and any alias `|...`.
2. Tries the inner value as a property-key (`ems__Task`) — succeeds for Form A and Form B (after alias strip).
3. If not a property-key (Form C: bare UUID), looks up the target asset and reads _its_ `exo__Instance_class` to derive the class IRI.

Crucially, **file existence at the wikilink target is not consulted for the class IRI itself in Form A/B** — only the property-key registry. That means Form A (`[[ems__Task]]`) produces a valid class IRI even when no file named `ems__Task.md` exists in the vault.

The SHACL-lite validator (`ShaclLiteValidator`) then sees the same `rdf:type` triple regardless of which form was emitted, so:

- `sh:class` checks: identical result.
- `sh:in` enum checks: identical result.
- `sh:minCount` / `sh:maxCount` cardinality: identical result.

### Empirical evidence (2026-05-16 SHACL deep-dive session)

Migration A → C across the vault:

- **n** = 305 files rewritten
- **Total SHACL violations before**: 307
- **Total SHACL violations after**: 307
- **Delta**: 0

This is the expected, correct outcome — not a bug, not a missed cache invalidation, not a malformed entry being silently dropped.

### Obsidian navigation caveat

The forms _do_ differ for **Obsidian wiki-style navigation** (Ctrl/Cmd + click on the link in the editor):

- Form A `[[ems__Task]]` only navigates if a file `ems__Task.md` exists (label-named shim).
- Form B `[[uuid|ems__Task]]` navigates to the UUID-named file (`<uuid>.md`); alias is display-only.
- Form C `[[uuid]]` navigates to the UUID-named file with the UUID as display text.

This is a UX/cosmetic concern that has **no bearing on RDF semantics or SHACL conformance**.

### What to do

1. **For new assets**: emit Form C only. `/exocortex-asset` skill template and `docs/reference/PROPERTY_SCHEMA.md` § _exo\_\_Instance_class › Canonical form_ are the source of truth.
2. **For existing assets**: Form A and Form B continue to work; migration is cosmetic and may be deferred. The pre-write hook `~/.claude/hooks/validate-wikilinks.sh` warns on non-Form-C in _new_ writes but does not block or rewrite legacy content.
3. **If SHACL violation counts didn't change after a form-only rewrite**: that's success, not failure. Move on.

**Reference**: Issue #3123. Related: `docs/reference/PROPERTY_SCHEMA.md` § `exo__Instance_class` › _Canonical form_.

## Plugin Patch Behavior Not Visible After Code Change

**Symptom**: Plugin code change is merged and built, but the expected UI behavior (e.g. patched DOM elements, new render, settings effect) is not observable in Obsidian. May appear as "only some elements affected" — partial-application state.

### Diagnostic ladder

1. **Plugin actually reloaded?**
   - `Cmd+R` reloads the renderer process **only**. Plugin lifecycle (onload / enable) runs in the main process — Electron split. Cmd+R will not re-run `onload`, will not re-init patches, will not pick up new code paths.
   - **Correct**: `Cmd+P` → `Reload app without saving` — full lifecycle restart. Or use BRAT update (which triggers reinstall + restart automatically).
   - See aiKnow `2d7dd8c1-...` (vault-exodev/assetspaces/exoass).

2. **Manifest version matches main.js?**
   - If you copied `main.js` manually (not via BRAT), manifest.json may be stale → version mismatch → BRAT thinks no update needed → partial reload state.
   - **Check via DevTools console**: `app.plugins.plugins['exocortex'].manifest.version`
   - **Correct**: never manual-copy `main.js`. Go through the release pipeline → BRAT update.

3. **Index built against new code path?**
   - Many plugin features (PropertiesLabelPatch, FileExplorerLabelPatch, etc.) lazily build index at first invocation, then cache. If first invocation happened against OLD code, cache holds stale results.
   - **Check**: spawn `metadataCache.trigger('resolved')` from console to force re-index, then observe.
   - **Reference**: PropertiesLabelPatch caches both `propertyClassUids: Set<string>` AND `resolveCache: Map<key, ResolvedPredicate>`. Both invalidated on `metadataCache.changed` and `resolved` events.

4. **Setting toggle disabled the feature?**
   - Many patches are gated by user-toggleable settings (RFC-030's `enablePropertiesLabelPatch`, etc.). Check `Cmd+,` → Exocortex → setting state.
   - In DevTools: `app.plugins.plugins['exocortex'].settings.enablePropertiesLabelPatch`

### How to verify correctness

```js
// From DevTools console — count active patched elements:
document.querySelectorAll(".exo-label-clickable").length;
// Compare against expected (e.g. open known note with 5 predicate keys → expect 5)
```

### Anti-pattern

Don't iterate `cp main.js → vault/.obsidian/plugins/ + Cmd+R` for debugging — this builds up cache-drift between renderer state and plugin state, and obscures the actual symptom. Either fully reload the app or go through BRAT.

**Reference**: RFC-030 implementation (PR #3246) — manual main.js copy + Cmd+R produced "patch applied only to aliases" partial state. Root cause: renderer-only reload kept old DOM hooks; new main.js bytes loaded but old patch handlers still attached. Restoration via backup + merge + BRAT update + Cmd+P Reload resolved cleanly. See `~/.claude/rules/obsidian-plugin-update-via-brat.md`.
