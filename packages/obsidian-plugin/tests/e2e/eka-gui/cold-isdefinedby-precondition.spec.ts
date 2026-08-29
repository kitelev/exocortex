import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  launchObsidianWithPlugin,
  log,
  openAssetAndRender,
  pollUntil,
  registerConfirmAutoAccept,
  renderedButtonLabels,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — a DATA-DRIVEN precondition survives a cold store
 * ============================================================================
 *
 * @req:044a6890-414e-452f-9870-b6ed67b0bf92
 *
 * WHAT THIS PINS (and why the existing unit axis is not enough).
 *
 * Req 044a6890 `covers` promises button availability "at RENDER TIME" under a
 * cold cache. Its shipped axes (LazyAssetGraphLoader.test.ts) assert the walk
 * itself — "if you call ensureFileLoaded(A), file O is loaded once". That is a
 * statement about the LOADER; it says nothing about the CONSUMER, i.e. whether
 * the button actually renders when the ontology is absent from the store. The
 * production defect was exactly on the consumer side: `Create, Execute & Archive`
 * was missing on a cold start and only appeared ~25s later, once convertVault()
 * had walked the whole vault.
 *
 * DETERMINISTIC COLD — not a race.
 *
 * Racing "assert before indexing finishes" would be VACUOUSLY GREEN whenever the
 * index wins the race, and that vacuity is invisible. Instead the cold state is
 * CONSTRUCTED: after a warm control proves the button is reachable at all, the
 * ontology's triples are removed from the store and both load-marks are dropped.
 * `forget()`/`clearAll()` deliberately do NOT touch the store (see their doc
 * comments), so BOTH halves are required for a truthful cold state.
 *
 * The warm control is what makes a red run diagnosable: without it, "button
 * absent" is indistinguishable from "the command never resolved in this vault".
 *
 * REVERT-VERIFY: drop the `isDefinedByPredicate` branch from the loader's walk
 * (LazyAssetGraphLoader.ts) and scenario 2 goes red while scenario 1 stays green.
 */

/** `exo__Ontology` metaclass. Resolved from the live TBox, never from memory. */
const EXO_ONTOLOGY_CLASS_UID = "829b9b3b-6fc3-4276-be6a-27d3398c012e";
/** `ems__ActionPrototype` — the class the gated binding targets. */
const EMS_ACTION_PROTOTYPE_CLASS_UID = "93d74dfd-1994-4673-853c-65f1fde80df3";

/** Seeds. Ephemeral, recreated every run — the suite's "fresh vault" contract. */
const SEED_ONTOLOGY_UID = "e2e0a4ea-0000-4000-a000-0000000000c1";
const SEED_ARCHIVE_ONTOLOGY_UID = "e2e0a4ea-0000-4000-a000-0000000000c2";
const SEED_PROTO_UID = "e2e0a4ea-0000-4000-a000-0000000000c3";

/** Co-located with the other seeds (see create-instance-buttons.spec.ts). */
const SEED_DIR_REL = "assetspaces/kitelev/exoas-public/ems";

/**
 * The button gated by precondition 38ff3c61, whose ASK is TWO hops:
 *   ASK { $target exo:Asset_isDefinedBy ?onto . ?onto exo:Ontology_archiveOntology ?a }
 * The second hop reads a property OF THE ONTOLOGY — so the ontology asset must be
 * in the store at render time, which is precisely what the lazy walk now ensures.
 */
const GATED_BUTTON = "Create, Execute & Archive";

function writeSeeds(vaultPath: string): void {
  const dir = path.join(vaultPath, SEED_DIR_REL);
  fs.mkdirSync(dir, { recursive: true });

  // The ARCHIVE ontology — merely the target of archiveOntology; its own content
  // is irrelevant to the ASK, only its existence as a resolvable reference.
  fs.writeFileSync(
    path.join(dir, `${SEED_ARCHIVE_ONTOLOGY_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${SEED_ARCHIVE_ONTOLOGY_UID}\n` +
      `exo__Instance_class:\n  - "[[${EXO_ONTOLOGY_CLASS_UID}]]"\n` +
      `exo__Asset_label: $e2e-cold-archive\n` +
      `exo__Asset_isDefinedBy: "[[${SEED_ARCHIVE_ONTOLOGY_UID}]]"\n` +
      `---\n\nEphemeral e2e archive ontology.\n`,
  );

  // The ontology under test: carries `exo__Ontology_archiveOntology`, i.e. the
  // property the precondition's SECOND hop reads.
  fs.writeFileSync(
    path.join(dir, `${SEED_ONTOLOGY_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${SEED_ONTOLOGY_UID}\n` +
      `exo__Instance_class:\n  - "[[${EXO_ONTOLOGY_CLASS_UID}]]"\n` +
      `exo__Asset_label: $e2e-cold\n` +
      `exo__Asset_isDefinedBy: "[[${SEED_ONTOLOGY_UID}]]"\n` +
      `exo__Ontology_archiveOntology: "[[${SEED_ARCHIVE_ONTOLOGY_UID}]]"\n` +
      `---\n\nEphemeral e2e ontology carrying archiveOntology.\n`,
  );

  // The render target: an ems__ActionPrototype whose isDefinedBy points at the
  // ontology above — so the gated button's ASK needs the ontology's triples.
  fs.writeFileSync(
    path.join(dir, `${SEED_PROTO_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${SEED_PROTO_UID}\n` +
      `exo__Instance_class:\n  - "[[${EMS_ACTION_PROTOTYPE_CLASS_UID}]]"\n` +
      `exo__Asset_label: EKA E2E Cold Action Prototype\n` +
      `exo__Asset_isDefinedBy: "[[${SEED_ONTOLOGY_UID}]]"\n` +
      `---\n\nEphemeral e2e action prototype for the cold-store scenario.\n`,
  );
}

const SEED_PROTO_REL = path.posix.join(SEED_DIR_REL, `${SEED_PROTO_UID}.md`);

test.describe("EKA GUI BDD — data-driven precondition under a cold store", () => {
  test.describe.configure({ mode: "serial" });

  let vaultPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let launcher: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let window: any;

  test.beforeAll(async () => {
    vaultPath = setupGuiVault();
    writeSeeds(vaultPath);
    log(`cold-isdefinedby: vault ${vaultPath}`);
    launcher = await launchObsidianWithPlugin(vaultPath, "cold-isdefinedby");
    window = await launcher.getWindow();
    registerConfirmAutoAccept(window);
    // A complete store is the PRECONDITION of this suite, not its subject: the
    // scenario removes ONE ontology from an otherwise-settled store, so the
    // command/binding/grounding subgraph must already be resolvable.
    await waitForStoreSettled(window);
  });

  test.afterAll(async () => {
    await launcher?.close().catch(() => undefined);
  });

  test(`@req:044a6890-414e-452f-9870-b6ed67b0bf92 warm control — the gated button is reachable at all`, async () => {
    await openAssetAndRender(window, SEED_PROTO_REL);
    await pollUntil(
      `warm: "${GATED_BUTTON}" rendered`,
      async () =>
        (await renderedButtonLabels(window)).some((l: string) =>
          l.includes(GATED_BUTTON),
        ),
      60_000,
      1000,
    );
    const labels = await renderedButtonLabels(window);
    log(`cold-isdefinedby: warm buttons = ${JSON.stringify(labels)}`);
    expect(labels.some((l: string) => l.includes(GATED_BUTTON))).toBe(true);
  });

  test(`@req:044a6890-414e-452f-9870-b6ed67b0bf92 cold store — the render-time walk re-hydrates the ontology so the ASK still passes`, async () => {
    // ── construct the cold state (deterministic, not a race) ────────────────
    const cold = await window.evaluate(
      async ([protoRel, ontoRel]: [string, string]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plugin = (window as any).app?.plugins?.plugins?.exocortex;
        const loader = plugin?.lazyAssetGraphLoader;
        const store = plugin?.sparql?.getTripleStore?.();
        if (!loader || !store)
          return { ok: false, reason: "loader/store unavailable" };

        const ontoIRI = loader.notePathToIRI(ontoRel);
        const protoIRI = loader.notePathToIRI(protoRel);

        // 1. Drop the ontology's triples from the store …
        const owned = await store.match(ontoIRI, undefined, undefined);
        const removed = await store.removeAll(owned);
        // 2. … AND its load-mark, plus the target's, so the next render walks
        //    again instead of short-circuiting. forget() does not touch the
        //    store, hence both steps.
        loader.forget(ontoIRI);
        loader.forget(protoIRI);
        plugin?.commandResolver?.invalidateCache?.();

        const leftover = (await store.match(ontoIRI, undefined, undefined))
          .length;
        return { ok: true, removed, leftover };
      },
      [
        SEED_PROTO_REL,
        path.posix.join(SEED_DIR_REL, `${SEED_ONTOLOGY_UID}.md`),
      ],
    );

    log(`cold-isdefinedby: cold state = ${JSON.stringify(cold)}`);
    expect(cold.ok, `cold setup failed: ${cold.reason}`).toBe(true);
    // Fail LOUD if the cold state was not actually reached: a green assertion on
    // a still-warm store would be vacuous and silently so.
    expect(
      cold.removed,
      "ontology had no triples to remove — cold state not constructed",
    ).toBeGreaterThan(0);
    expect(
      cold.leftover,
      "ontology triples survived removal — store is not cold",
    ).toBe(0);

    // ── the subject: one render must re-hydrate the ontology ────────────────
    await openAssetAndRender(window, SEED_PROTO_REL);
    await pollUntil(
      `cold: "${GATED_BUTTON}" rendered`,
      async () =>
        (await renderedButtonLabels(window)).some((l: string) =>
          l.includes(GATED_BUTTON),
        ),
      60_000,
      1000,
    ).catch(async () => {
      // Diagnostic on the failing path: without it a timeout says only "not
      // found", which cannot distinguish "walk did not hop" from "selector wrong".
      const labels = await renderedButtonLabels(window);
      log(
        `cold-isdefinedby: FAILING — rendered buttons were ${JSON.stringify(labels)}`,
      );
      throw new Error(
        `"${GATED_BUTTON}" did not render on a cold store; rendered: ${JSON.stringify(labels)}`,
      );
    });

    const labels = await renderedButtonLabels(window);
    expect(labels.some((l: string) => l.includes(GATED_BUTTON))).toBe(true);
  });
});
