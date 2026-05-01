/**
 * CommandResolver — RFC-024 §4 Phase 2 binding-style resolution (T5.2).
 *
 * Coverage:
 * - Step 1: explicit `CommandBinding_style` wikilink → CommandBindingStyle asset projection
 * - Step 2: inline `CommandBinding_variant` shorthand → synthesized minimal style
 * - Step 3: neither present → `style` is `undefined` (UI applies group-based fallback)
 * - Edge-case matrix (parametrized): non-string, null, empty, unicode zero-width, casing
 * - Coerce → warn (cap 200 chars) → drop (RFC-024 §5 — never crash)
 * - Cache coherence: concurrent edit + invalidate → re-resolve picks up change
 *
 * Strategy: split-query SPARQL (separate `match()` calls per property), not OPTIONAL.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";

// -- Stub logger that records warnings for assertions --

interface RecordingLogger extends ILogger {
  readonly warnings: string[];
}

function makeRecordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  return {
    debug() {},
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    warnings,
  };
}

// -- Asset builders (mirrors patterns from CommandResolver.test.ts) --

async function addGrounding(store: InMemoryTripleStore, uid: string): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`Grounding ${uid}`)),
    new Triple(subject, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_delete")),
    new Triple(subject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_x")),
  ]);
}

async function addCommand(store: InMemoryTripleStore, uid: string, groundingUid: string): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`Command ${uid}`)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${groundingUid}.md`),
    ),
  ]);
}

async function addStyleAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    variant?: string;
    showIcon?: string;
    labelClass?: string;
    ariaLabel?: string;
    tooltip?: string;
    keyboardShortcut?: string;
    source?: string;
  },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBindingStyle")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`Style ${opts.uid}`)),
  ];
  const term = (local: string) => Namespace.EXOCMD.term(local);
  if (opts.variant !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_variant"), new Literal(opts.variant)));
  if (opts.showIcon !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_showIcon"), new Literal(opts.showIcon)));
  if (opts.labelClass !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_labelClass"), new Literal(opts.labelClass)));
  if (opts.ariaLabel !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_ariaLabel"), new Literal(opts.ariaLabel)));
  if (opts.tooltip !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_tooltip"), new Literal(opts.tooltip)));
  if (opts.keyboardShortcut !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_keyboardShortcut"), new Literal(opts.keyboardShortcut)));
  if (opts.source !== undefined)
    triples.push(new Triple(subject, term("CommandBindingStyle_source"), new Literal(opts.source)));
  await store.addAll(triples);
}

interface BindingOpts {
  uid: string;
  commandUid: string;
  targetClass: string;
  styleRefUid?: string;
  inlineVariant?: string;
}

async function addBinding(store: InMemoryTripleStore, opts: BindingOpts): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`Binding ${opts.uid}`)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_command"),
      new IRI(`obsidian://vault/${opts.commandUid}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new Literal(opts.targetClass),
    ),
  ];
  if (opts.styleRefUid !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_style"),
        new IRI(`obsidian://vault/${opts.styleRefUid}.md`),
      ),
    );
  }
  if (opts.inlineVariant !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_variant"),
        new Literal(opts.inlineVariant),
      ),
    );
  }
  await store.addAll(triples);
  return subject;
}

// -- Tests --

describe("CommandResolver — RFC-024 binding style resolution", () => {
  const TARGET_CLASS = "ems__Task";
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
    await addGrounding(store, "gnd-1");
    await addCommand(store, "cmd-1", "gnd-1");
  });

  describe("Step 1 — explicit style asset reference (preferred)", () => {
    it("projects all 7 properties from CommandBindingStyle asset", async () => {
      await addStyleAsset(store, {
        uid: "style-success",
        variant: "success",
        showIcon: "true",
        labelClass: "bold",
        ariaLabel: "Mark Done",
        tooltip: "Promote to Done",
        keyboardShortcut: "Mod+Shift+D",
        source: "vendor",
      });
      await addBinding(store, {
        uid: "bind-1",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        styleRefUid: "style-success",
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style).toEqual({
        id: "style-success",
        label: "Style style-success",
        variant: "success",
        showIcon: true,
        labelClass: "bold",
        ariaLabel: "Mark Done",
        tooltip: "Promote to Done",
        keyboardShortcut: "Mod+Shift+D",
        source: "vendor",
        inline: false,
      });
    });

    it("style reference wins over inline variant when both present", async () => {
      await addStyleAsset(store, { uid: "style-danger", variant: "danger" });
      await addBinding(store, {
        uid: "bind-2",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        styleRefUid: "style-danger",
        inlineVariant: "primary",
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style?.variant).toBe("danger");
      expect(resolved.binding.style?.inline).toBe(false);
    });

    it("falls through to inline variant when style asset is unresolvable", async () => {
      await addBinding(store, {
        uid: "bind-3",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        // styleRefUid points to a non-existent asset path resolved as IRI;
        // adding a binding with style ref to missing UID via Literal wikilink
      });
      // Inject a bare wikilink-literal style ref pointing at a non-existent uid
      await store.addAll([
        new Triple(
          new IRI(`obsidian://vault/bind-3.md`),
          Namespace.EXOCMD.term("CommandBinding_style"),
          new Literal("[[does-not-exist]]"),
        ),
        new Triple(
          new IRI(`obsidian://vault/bind-3.md`),
          Namespace.EXOCMD.term("CommandBinding_variant"),
          new Literal("warning"),
        ),
      ]);

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style?.variant).toBe("warning");
      expect(resolved.binding.style?.inline).toBe(true);
      expect(logger.warnings.some((w) => /style reference unresolved/.test(w))).toBe(true);
    });
  });

  describe("Step 2 — inline `CommandBinding_variant` shorthand", () => {
    it.each([
      ["primary"],
      ["secondary"],
      ["success"],
      ["warning"],
      ["danger"],
      ["muted"],
    ])("synthesizes minimal inline style for valid variant %p", async (variant) => {
      await addBinding(store, {
        uid: `bind-${variant}`,
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        inlineVariant: variant,
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style).toEqual({
        id: `inline:bind-${variant}`,
        label: "",
        variant,
        inline: true,
      });
    });

    it("coerces casing — uppercase, mixed-case, surrounding whitespace", async () => {
      const cases: Array<[string, string]> = [
        ["PRIMARY", "primary"],
        ["  Success  ", "success"],
        ["DaNgEr", "danger"],
        ["\tmuted\n", "muted"],
      ];
      for (const [raw, expected] of cases) {
        const subStore = new InMemoryTripleStore();
        const subResolver = new CommandResolver(subStore, logger);
        await addGrounding(subStore, "gnd-1");
        await addCommand(subStore, "cmd-1", "gnd-1");
        await addBinding(subStore, {
          uid: "bind-coerce",
          commandUid: "cmd-1",
          targetClass: TARGET_CLASS,
          inlineVariant: raw,
        });
        const [resolved] = await subResolver.resolveForAsset(
          "obsidian://vault/asset-1.md",
          TARGET_CLASS,
        );
        expect(resolved.binding.style?.variant).toBe(expected);
      }
    });
  });

  describe("Step 3 — fallback (neither style ref nor inline variant)", () => {
    it("returns binding with `style` undefined when neither source present", async () => {
      await addBinding(store, {
        uid: "bind-fallback",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style).toBeUndefined();
      expect(logger.warnings).toHaveLength(0);
    });
  });

  describe("Edge-case matrix — invalid values coerce → warn → drop", () => {
    // Each row exercises the resilience contract: never crash, log capped warning,
    // emit `style: undefined` (falls through to UI group-default).
    // Note: empty-string variant is impossible to inject — Literal rejects "" at
    // construction. Frontmatter parsers replace empty values with null upstream;
    // null is exercised separately via "Step 3 — fallback".
    const invalidVariants: Array<[string, string]> = [
      ["whitespace only", "   "],
      ["unicode zero-width", "​primary‌"],
      ["typo", "primry"],
      ["unknown enum", "info"],
      ["numeric string", "3"],
      ["very long string", "x".repeat(500)],
      ["null literal text", "null"],
      ["yaml-style array", "[primary,danger]"],
    ];

    it.each(invalidVariants)(
      "drops invalid inline variant (%s) without crashing",
      async (_label, raw) => {
        const subStore = new InMemoryTripleStore();
        const subLogger = makeRecordingLogger();
        const subResolver = new CommandResolver(subStore, subLogger);
        await addGrounding(subStore, "gnd-1");
        await addCommand(subStore, "cmd-1", "gnd-1");
        await addBinding(subStore, {
          uid: "bind-bad",
          commandUid: "cmd-1",
          targetClass: TARGET_CLASS,
          inlineVariant: raw,
        });

        const result = await subResolver.resolveForAsset(
          "obsidian://vault/asset-1.md",
          TARGET_CLASS,
        );

        expect(result).toHaveLength(1);
        expect(result[0].binding.style).toBeUndefined();
        // empty/whitespace-only short-circuit before whitelist check — no warn
        const expectsWarning = raw.trim().length > 0;
        if (expectsWarning) {
          expect(subLogger.warnings.length).toBeGreaterThan(0);
          for (const w of subLogger.warnings) {
            expect(w.length).toBeLessThanOrEqual(200);
          }
        }
      },
    );

    it("drops invalid labelClass and source on style asset, keeps valid variant", async () => {
      await addStyleAsset(store, {
        uid: "style-mixed",
        variant: "primary",
        labelClass: "italic", // not in whitelist
        source: "external", // not in whitelist
      });
      await addBinding(store, {
        uid: "bind-mixed",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        styleRefUid: "style-mixed",
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.style?.variant).toBe("primary");
      expect(resolved.binding.style?.labelClass).toBeUndefined();
      expect(resolved.binding.style?.source).toBeUndefined();
      expect(logger.warnings.length).toBeGreaterThanOrEqual(2);
    });

    it("coerces showIcon to boolean only for true/false (case-insensitive)", async () => {
      await addStyleAsset(store, { uid: "style-icon-on", variant: "primary", showIcon: "TRUE" });
      await addStyleAsset(store, { uid: "style-icon-off", variant: "primary", showIcon: "False" });
      await addStyleAsset(store, { uid: "style-icon-bad", variant: "primary", showIcon: "yes" });
      await addBinding(store, { uid: "bind-on", commandUid: "cmd-1", targetClass: "C-on", styleRefUid: "style-icon-on" });
      await addBinding(store, { uid: "bind-off", commandUid: "cmd-1", targetClass: "C-off", styleRefUid: "style-icon-off" });
      await addBinding(store, { uid: "bind-bad", commandUid: "cmd-1", targetClass: "C-bad", styleRefUid: "style-icon-bad" });

      const [on] = await resolver.resolveForAsset("a", "C-on");
      const [off] = await resolver.resolveForAsset("a", "C-off");
      const [bad] = await resolver.resolveForAsset("a", "C-bad");

      expect(on.binding.style?.showIcon).toBe(true);
      expect(off.binding.style?.showIcon).toBe(false);
      expect(bad.binding.style?.showIcon).toBeUndefined();
    });
  });

  describe("Cache coherence — invalidate → re-resolve", () => {
    it("picks up style asset edit after invalidateCache()", async () => {
      await addStyleAsset(store, { uid: "style-mut", variant: "secondary" });
      await addBinding(store, {
        uid: "bind-mut",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        styleRefUid: "style-mut",
      });

      const [first] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );
      expect(first.binding.style?.variant).toBe("secondary");

      // Concurrent edit: replace variant on the style asset
      const styleSubject = new IRI("obsidian://vault/style-mut.md");
      await store.remove(
        new Triple(
          styleSubject,
          Namespace.EXOCMD.term("CommandBindingStyle_variant"),
          new Literal("secondary"),
        ),
      );
      await store.add(
        new Triple(
          styleSubject,
          Namespace.EXOCMD.term("CommandBindingStyle_variant"),
          new Literal("danger"),
        ),
      );

      // Without invalidate, cache still serves stale value
      const [stale] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );
      expect(stale.binding.style?.variant).toBe("secondary");

      // After invalidate, fresh read sees the edit
      resolver.invalidateCache();
      const [fresh] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );
      expect(fresh.binding.style?.variant).toBe("danger");
    });

    it("multi-resolve cache invalidates across class permutations", async () => {
      await addStyleAsset(store, { uid: "style-multi", variant: "primary" });
      await addBinding(store, {
        uid: "bind-multi",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        styleRefUid: "style-multi",
      });

      const [first] = await resolver.resolveForAssetMulti(
        "obsidian://vault/asset-1.md",
        [TARGET_CLASS, "exo__Asset"],
      );
      expect(first.binding.style?.variant).toBe("primary");

      const styleSubject = new IRI("obsidian://vault/style-multi.md");
      await store.remove(
        new Triple(
          styleSubject,
          Namespace.EXOCMD.term("CommandBindingStyle_variant"),
          new Literal("primary"),
        ),
      );
      await store.add(
        new Triple(
          styleSubject,
          Namespace.EXOCMD.term("CommandBindingStyle_variant"),
          new Literal("muted"),
        ),
      );
      resolver.invalidateCache();

      const [updated] = await resolver.resolveForAssetMulti(
        "obsidian://vault/asset-1.md",
        [TARGET_CLASS, "exo__Asset"],
      );
      expect(updated.binding.style?.variant).toBe("muted");
    });
  });

  describe("RFC f1dc284a — top-level binding.variant", () => {
    it("populates binding.variant from `_variant` literal", async () => {
      await addBinding(store, {
        uid: "bind-variant-top",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        inlineVariant: "danger",
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.variant).toBe("danger");
    });

    it("drops invalid variant (coerce → warn → undefined)", async () => {
      await addBinding(store, {
        uid: "bind-variant-bad",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        inlineVariant: "rainbow",
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.variant).toBeUndefined();
    });

    it("logs warning when both legacy `_group` and `_variant` are present (prefers _variant)", async () => {
      const subject = await addBinding(store, {
        uid: "bind-coexist",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        inlineVariant: "primary",
      });
      await store.addAll([
        new Triple(
          subject,
          Namespace.EXOCMD.term("CommandBinding_group"),
          new Literal("maintenance"),
        ),
      ]);

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.variant).toBe("primary");
      expect(resolved.binding.group).toBe("maintenance");
      expect(
        logger.warnings.some((w) =>
          /both _group and _variant present/.test(w),
        ),
      ).toBe(true);
    });

    it("leaves binding.variant undefined when neither `_variant` literal nor style asset is set", async () => {
      await addBinding(store, {
        uid: "bind-no-variant",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
      });

      const [resolved] = await resolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );

      expect(resolved.binding.variant).toBeUndefined();
    });
  });

  describe("Default constructor — no logger", () => {
    it("works without explicit logger (NullLogger fallback)", async () => {
      const silentResolver = new CommandResolver(store);
      await addBinding(store, {
        uid: "bind-silent",
        commandUid: "cmd-1",
        targetClass: TARGET_CLASS,
        inlineVariant: "not-a-variant",
      });

      // Must not throw despite invalid variant
      const result = await silentResolver.resolveForAsset(
        "obsidian://vault/asset-1.md",
        TARGET_CLASS,
      );
      expect(result).toHaveLength(1);
      expect(result[0].binding.style).toBeUndefined();
    });
  });
});
