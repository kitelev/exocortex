import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  launchObsidianWithPlugin,
  log,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — the class IRI keeps its SYMBOLIC form on a cold metadataCache
 * ============================================================================
 *
 * @req:7d00a60b-5ca3-457e-a160-5bf955e8c195
 *
 * Tier 3 of RFC 8f93ff95. Tiers 1-2 are closed, so on a cold cache the store is
 * no longer empty and the class reference no longer collapses to a Literal. What
 * this guards is the FORM: `valueToClassURI` used to read the resolved class
 * file's label through the CACHE only, so cold => null => fall-through to a
 * FILE-IRI. That IRI is graph-traversable, hence buttons gated on a path still
 * render — but every ASK precondition comparing against the SYMBOLIC form
 * silently stops matching (3 of 36 on vault-my, incl. "Is Prototype").
 *
 * The unit axes pin the converter in isolation. This one exists because they
 * cannot: only here do the REAL ObsidianVaultAdapter, the REAL metadataCache and
 * the REAL disk read take part — i.e. exactly the boundary that was cold on the
 * phone.
 *
 * The cold state is CONSTRUCTED, never awaited: `getFileCache` is stubbed to
 * return null for the class file only, and the test fails LOUD if that stub did
 * not take effect — a green assertion against a still-warm cache would be
 * vacuous, and silently so.
 */

const SEED_DIR_REL = "assetspaces/kitelev/exoas-public/ems";
const CLASS_UID = "0e2e0001-c1a5-4c1a-9c1a-000000000001";
const ASSET_UID = "0e2e0002-a55e-4a55-8a55-000000000002";
/** Namespace-parseable label: the ONLY source of the symbolic IRI, since the
 *  file's basename is its uuid under the UID-CANON invariant. */
const CLASS_LABEL = "ems__E2eColdClass";
const EXPECTED_IRI = "https://exocortex.my/ontology/ems#E2eColdClass";

const CLASS_REL = path.posix.join(SEED_DIR_REL, `${CLASS_UID}.md`);
const ASSET_REL = path.posix.join(SEED_DIR_REL, `${ASSET_UID}.md`);

function writeSeeds(vaultPath: string): void {
  const dir = path.join(vaultPath, SEED_DIR_REL);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, `${CLASS_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${CLASS_UID}\n` +
      `exo__Asset_label: ${CLASS_LABEL}\n` +
      `---\n\nEphemeral e2e class for the cold-cache IRI-form scenario.\n`,
  );

  // uid-bare class reference — the canonical UID-CANON form, and the only one
  // that needs a lookup at all (label-bare / uid+alias resolve from their text).
  fs.writeFileSync(
    path.join(dir, `${ASSET_UID}.md`),
    `---\n` +
      `exo__Asset_uid: ${ASSET_UID}\n` +
      `exo__Instance_class:\n  - "[[${CLASS_UID}]]"\n` +
      `exo__Asset_label: EKA E2E Cold Class-IRI Asset\n` +
      `---\n\nEphemeral e2e asset whose class ref must survive a cold cache.\n`,
  );
}

/** Read back the object of the asset's exo__Instance_class triple. */
async function classObjectInStore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window: any,
  assetRel: string,
): Promise<string[]> {
  return window.evaluate(async (rel: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = (window as any).app?.plugins?.plugins?.exocortex;
    const store = plugin?.sparql?.getTripleStore?.();
    const loader = plugin?.lazyAssetGraphLoader;
    if (!store || !loader) return ["<no store/loader>"];
    const subject = loader.notePathToIRI(rel);
    const triples = await store.match(subject, undefined, undefined);
    return triples
      .filter((t: { predicate: { toString(): string } }) =>
        t.predicate.toString().endsWith("#Instance_class"),
      )
      .map((t: { object: { toString(): string } }) => t.object.toString());
  }, assetRel);
}

test.describe("EKA GUI BDD — symbolic class IRI under a cold metadataCache", () => {
  test.describe.configure({ mode: "serial" });

  let vaultPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let launcher: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let window: any;

  test.beforeAll(async () => {
    vaultPath = setupGuiVault();
    writeSeeds(vaultPath);
    log(`cold-class-iri: vault ${vaultPath}`);
    launcher = await launchObsidianWithPlugin(vaultPath, "cold-class-iri");
    window = await launcher.getWindow();
    await waitForStoreSettled(window);
  });

  test.afterAll(async () => {
    await launcher?.close().catch(() => undefined);
  });

  test(`@req:7d00a60b-5ca3-457e-a160-5bf955e8c195 warm control — the class IRI is symbolic to begin with`, async () => {
    const objects = await classObjectInStore(window, ASSET_REL);
    log(`cold-class-iri: warm objects = ${JSON.stringify(objects)}`);
    expect(
      objects,
      "the seed asset produced no Instance_class triple at all — the scenario is vacuous",
    ).toContain(EXPECTED_IRI);
  });

  test(`@req:7d00a60b-5ca3-457e-a160-5bf955e8c195 cold cache — the class IRI stays SYMBOLIC, not a file IRI`, async () => {
    const cold = await window.evaluate(
      async ([classRel, assetRel]: [string, string]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const app = w.app;
        const plugin = app?.plugins?.plugins?.exocortex;
        const loader = plugin?.lazyAssetGraphLoader;
        const store = plugin?.sparql?.getTripleStore?.();
        if (!loader || !store)
          return { ok: false, reason: "loader/store unavailable" };

        const classFile = app.vault.getAbstractFileByPath(classRel);
        const assetFile = app.vault.getAbstractFileByPath(assetRel);
        if (!classFile || !assetFile)
          return { ok: false, reason: "seed files not found" };

        // ── construct the cold state: the CLASS file only, deterministically ──
        const original = app.metadataCache.getFileCache.bind(app.metadataCache);
        app.metadataCache.getFileCache = (f: { path: string }) =>
          f?.path === classRel ? null : original(f);
        const stubWorks = app.metadataCache.getFileCache(classFile) === null;
        const othersWarm = !!app.metadataCache.getFileCache(assetFile);

        // Re-derive the asset's triples through the REAL lazy-load path.
        const assetIRI = loader.notePathToIRI(assetRel);
        const owned = await store.match(assetIRI, undefined, undefined);
        const removed = await store.removeAll(owned);
        loader.forget(assetIRI);
        await loader.ensureFileLoaded(assetFile);

        const after = await store.match(assetIRI, undefined, undefined);
        const objects = after
          .filter((t: { predicate: { toString(): string } }) =>
            t.predicate.toString().endsWith("#Instance_class"),
          )
          .map((t: { object: { toString(): string } }) => t.object.toString());

        app.metadataCache.getFileCache = original; // restore
        return { ok: true, stubWorks, othersWarm, removed, objects };
      },
      [CLASS_REL, ASSET_REL],
    );

    log(`cold-class-iri: cold state = ${JSON.stringify(cold)}`);
    expect(cold.ok, `cold setup failed: ${cold.reason}`).toBe(true);
    // Fail LOUD on a vacuous run: if the stub never took effect, or the asset had
    // no triples to re-derive, a green assertion would prove nothing.
    expect(
      cold.stubWorks,
      "getFileCache stub did not take effect — the cache is NOT cold",
    ).toBe(true);
    expect(
      cold.othersWarm,
      "the stub went too wide — it must starve the CLASS file only",
    ).toBe(true);
    expect(
      cold.removed,
      "asset had no triples to re-derive — the scenario is vacuous",
    ).toBeGreaterThan(0);

    expect(cold.objects).toContain(EXPECTED_IRI);
    expect(
      cold.objects.some((o: string) => o.startsWith("obsidian://vault/")),
      "a FILE-IRI was emitted — Tier 3 has regressed",
    ).toBe(false);
  });
});
