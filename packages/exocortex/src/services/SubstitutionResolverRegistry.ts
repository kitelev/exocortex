/**
 * SubstitutionResolverRegistry — central map of token resolver-id → handler
 * function for the RFC 727572d2 RDF-driven asset creation pipeline.
 *
 * Tokens are vault assets (`exocmd__SubstitutionToken` instances) that declare
 * a string `_resolver` literal; this registry maps that literal to a TS
 * function that produces the substitution value at execute time. Adding a new
 * token vocabulary entry usually means (a) creating the vault asset and (b)
 * registering a resolver here under the same id — no other code changes.
 *
 * Resolver functions receive a {@link ResolverContext} bundle and an optional
 * string parameter (from `exocmd__TokenInvocation_parameter`). They return
 * either a final string (most cases) or `string[]` for list-typed properties
 * (e.g. `$labelAsArray` → `[label]`).
 *
 * RFC 727572d2-194b-4a4d-8a5a-585a1d3bac8e.
 */

/**
 * Runtime context made available to resolver functions. Optional fields permit
 * use in test/CLI harnesses where some context (target frontmatter, grounding
 * targetClass) is not always available.
 */
export interface ResolverContext {
  /** Modal-collected user input, keyed by property local name. */
  readonly userInput?: Record<string, unknown>;
  /** Click-target asset's IRI value (vault wikilink-resolvable). */
  readonly targetIRI?: string;
  /** Click-target asset's vault-relative file path. */
  readonly targetFilePath?: string;
  /** Click-target asset's parsed frontmatter (read once per executeCreateInstance). */
  readonly targetFm?: Record<string, unknown>;
  /** UID-canon class ref baked into the active Grounding (already resolved by executor). */
  readonly groundingTargetClassUid?: string;
}

/**
 * Resolver function signature. Returns either a string value (for scalar
 * frontmatter writes) or `string[]` (for multi-valued writes like `aliases`).
 * `null` signals "skip this PropertyDefault entry" (e.g. required context
 * missing).
 */
export type ResolverFn = (
  ctx: ResolverContext,
  parameter?: string,
) => string | string[] | null;

const _resolvers = new Map<string, ResolverFn>();

/**
 * Register a resolver. Idempotent overwrite — last registration wins. Tests
 * may inject deterministic resolvers (e.g. fixed UUID, fixed timestamp);
 * production wiring at package init time installs the live implementations.
 */
export function registerResolver(id: string, fn: ResolverFn): void {
  _resolvers.set(id, fn);
}

export function getResolver(id: string): ResolverFn | undefined {
  return _resolvers.get(id);
}

export function getRegisteredResolverIds(): string[] {
  return Array.from(_resolvers.keys());
}

export function clearResolvers(): void {
  _resolvers.clear();
}

// -- Built-in resolvers (RFC 727572d2 Phase A2 vocabulary) --

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Install the default Phase A2 resolver set. Idempotent — safe to call from
 * multiple entry points (CLI bootstrap, plugin bootstrap, test setup). Tests
 * may call {@link clearResolvers} first to start from empty state.
 */
export function installDefaultResolvers(): void {
  // -- Existing tokens (legacy parity) --
  registerResolver("today", () => new Date().toISOString().slice(0, 10));
  registerResolver(
    "todayStart",
    () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
  );
  // `target` and `targetFolder` are context-dependent — executor resolves them
  // from marker form; they're registered here too for symmetry but their
  // handlers fall back to empty when context missing.
  registerResolver("target", (ctx) => {
    if (!ctx.targetIRI) return "";
    return `"[[${ctx.targetIRI}]]"`;
  });
  registerResolver("targetFolder", (ctx) => {
    if (!ctx.targetFilePath) return "";
    const normalized = ctx.targetFilePath.replace(/^\/+/, "");
    const slashIdx = normalized.lastIndexOf("/");
    return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
  });

  // -- RFC 727572d2 Phase A2 new vocabulary --

  registerResolver("randomUUIDv4", () => {
    // crypto.randomUUID() — Node 14.17+ / modern browsers / Obsidian Electron.
    // No Math.random fallback (ARCH-008 SEC-001 / Math.random not crypto-safe).
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    throw new Error(
      "randomUUIDv4 resolver requires crypto.randomUUID() — runtime is missing Node crypto / Web Crypto API.",
    );
  });

  registerResolver("nowTimestamp", () => {
    // Local ISO 8601 without TZ suffix — mirrors DateFormatter.toLocalTimestamp
    // shape used by all other creation services (Issue #3188).
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  });

  registerResolver("nowDate", () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });

  registerResolver("nowYear", () => String(new Date().getFullYear()));

  registerResolver("nowMonth", () => pad2(new Date().getMonth() + 1));

  registerResolver("userInputLabel", (ctx) => {
    const label = ctx.userInput?.label;
    return typeof label === "string" ? label : "";
  });

  registerResolver("userInput", (ctx, parameter) => {
    if (!parameter) return null;
    const v = ctx.userInput?.[parameter];
    return typeof v === "string" ? v : v == null ? null : String(v);
  });

  registerResolver("targetProperty", (ctx, parameter) => {
    if (!parameter || !ctx.targetFm) return null;
    const v = ctx.targetFm[parameter];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(String);
    return String(v);
  });

  registerResolver("labelAsArray", (ctx) => {
    const label = ctx.userInput?.label;
    return typeof label === "string" && label.length > 0 ? [label] : [];
  });

  registerResolver("groundingTargetClass", (ctx) => {
    if (!ctx.groundingTargetClassUid) return null;
    return `"[[${ctx.groundingTargetClassUid}]]"`;
  });

  // -- "Create Instance" homoiconic button (T1, project bbe40f8c) --
  //
  // `targetClassSelf` — the click-target IS the class definition (`exo__Class`
  // instance), so the new asset's `exo__Instance_class` must point back at the
  // host file's own UID. This inverts `groundingTargetClass` (which reads a
  // class baked into the Grounding): here the class is the host, discovered
  // from `targetFilePath` basename (UID-canon filenames guarantee
  // basename === uid). Returns a quoted wikilink so it serialises identically
  // to the other class-ref defaults. `null` when no target file path is in
  // context (CLI/test harness without a click target).
  registerResolver("targetClassSelf", (ctx) => {
    if (!ctx.targetFilePath) return null;
    const normalized = ctx.targetFilePath.replace(/^\/+/, "");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    const uid = fileName.replace(/\.md$/i, "");
    return uid.length > 0 ? `"[[${uid}]]"` : null;
  });
}
