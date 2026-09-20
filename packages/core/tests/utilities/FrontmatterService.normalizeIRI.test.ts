import { FrontmatterService } from "../../src/utilities/FrontmatterService";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

/**
 * Ticket c8fc6793 — the dead frontmatter key.
 *
 * `FrontmatterService.normalizeIRI` is the ONLY point that forms the physical
 * write key: both `updateProperty` and `applyPatch` splice
 * `canonicalYamlKey(normalizeIRI(key))` into the YAML block. Whatever it returns
 * for an unrecognised shape lands on disk as a real key.
 *
 * ⛔ THE DEFECT IS LATENT IN ITS CONSEQUENCES, NOT IN ITS INPUT POPULATION, and
 * saying so is load-bearing for reading these axes. Measured on the three
 * canonical vaults BEFORE the fix:
 *   - hand-authored full-IRI `exocmd__Grounding_targetProperty`: 0 / 0 / 0;
 *   - already-corrupted `[[prefix__]]` carriers:                 0 / 0 / 0;
 *   - ⛔ assets holding exactly `…/ontology/<in-map-ns>#` in `exo__Ontology_url`
 *     (the shape that used to yield the junk key `ems__`):       8 / 8 / 7.
 * So an axis driven off live vault data would be identically green BY
 * CONSTRUCTION — every fixture below seeds its own shape. Without this note a
 * later reader sees "everything added up before the fix" and concludes we fixed
 * something that never existed.
 *
 * @req:eac1690d-4d17-4f00-a221-0f8bee3c697c
 */
describe("FrontmatterService.normalizeIRI — every namespace, or nothing (ticket c8fc6793)", () => {
  const OUT_OF_MAP = "https://exocortex.my/ontology/flow#Stage_chatId";
  const IN_MAP = "https://exocortex.my/ontology/ems#Effort_status";

  it("DK1 canonicalises a namespace OUTSIDE the static nine-entry map @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    expect(FrontmatterService.normalizeIRI(OUT_OF_MAP)).toBe(
      "flow__Stage_chatId",
    );
    // A second out-of-map namespace that is live in the vaults, so the axis is
    // not pinned to one lucky prefix.
    expect(
      FrontmatterService.normalizeIRI(
        "https://exocortex.my/ontology/agr#Norm_acceptedOn",
      ),
    ).toBe("agr__Norm_acceptedOn");
  });

  it("DK2 PAIRED CONTROL — a namespace INSIDE the map is unchanged @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    expect(FrontmatterService.normalizeIRI(IN_MAP)).toBe("ems__Effort_status");
    expect(
      FrontmatterService.normalizeIRI(
        "https://exocortex.my/ontology/exo#Asset_label",
      ),
    ).toBe("exo__Asset_label");
  });

  // ── DK3/DK4/DK5: three DIFFERENT rejection paths inside `fromTermIRI`, kept
  // apart on purpose — one green case must not mask two unverified ones.

  it("DK3 a foreign, underivable base passes through untouched @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    const foreign = "https://example.com/foo#bar";
    expect(FrontmatterService.normalizeIRI(foreign)).toBe(foreign);
  });

  it("DK4 an EMPTY local name passes through untouched — the exo__Ontology_url shape @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // ⛔ Before the fix this returned the junk prefix `ems__` (in-map namespace,
    // no local-name check) — and 8/8/7 live assets hold exactly this value.
    const base = "https://exocortex.my/ontology/ems#";
    expect(FrontmatterService.normalizeIRI(base)).toBe(base);
    const slashBase = "https://exocortex.my/ontology/ems/docs#";
    expect(FrontmatterService.normalizeIRI(slashBase)).toBe(slashBase);
  });

  it("DK5 a local name containing a slash passes through untouched @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // ⛔ Before the fix: `exo__Asset/Sub` — a key no reader resolves.
    const slashLocal = "https://exocortex.my/ontology/exo#Asset/Sub";
    expect(FrontmatterService.normalizeIRI(slashLocal)).toBe(slashLocal);
  });

  it("DK6 a non-IRI property name is returned verbatim @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    expect(FrontmatterService.normalizeIRI("ems__Effort_status")).toBe(
      "ems__Effort_status",
    );
    expect(FrontmatterService.normalizeIRI("aliases")).toBe("aliases");
    // A bare CURIE is NOT a full IRI — it is how exo__Property_range is stored
    // 138 times in vault-exodev, and it must stay untouched.
    expect(FrontmatterService.normalizeIRI("xsd:string")).toBe("xsd:string");
  });

  it("DK7 the hot-path map never DISAGREES with the canonical inverse @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // The map is an optimisation, not a second opinion: for every input where
    // the canonical inverse yields a name, normalizeIRI must yield THAT name.
    const probes = [
      IN_MAP,
      OUT_OF_MAP,
      "https://exocortex.my/ontology/pmbok#Risk_impact",
      "https://exocortex.my/ontology/ims#Person_email",
      "http://www.w3.org/2000/01/rdf-schema#label",
      "https://exocortex.my/ontology/ems#",
      "https://exocortex.my/ontology/exo#Asset/Sub",
      "https://example.com/foo#bar",
    ];
    for (const probe of probes) {
      const canonical = Namespace.fromTermIRI(probe);
      const expected =
        canonical === null
          ? probe
          : `${canonical.namespace.prefix}__${canonical.localName}`;
      expect(FrontmatterService.normalizeIRI(probe)).toBe(expected);
    }
  });

  it("DK8 the physical write key is canonical — updateProperty @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    const service = new FrontmatterService();
    const before = "---\nexo__Asset_uid: aaaa\n---\nbody\n";
    const after = service.updateProperty(before, OUT_OF_MAP, "-1003912427125");
    expect(after).toContain("flow__Stage_chatId:");
    // ⛔ The raw IRI must not appear as a key anywhere in the block.
    expect(after).not.toContain(`${OUT_OF_MAP}:`);
  });

  it("DK9 one predicate, ONE physical key — the split-state case @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    const service = new FrontmatterService();
    const start = "---\nexo__Asset_uid: aaaa\n---\nbody\n";
    // Write it first by full IRI, then by its prefixed spelling.
    const once = service.updateProperty(start, OUT_OF_MAP, "-1003912427125");
    const twice = service.updateProperty(once, "flow__Stage_chatId", "-999");
    const keyCount = twice
      .split("\n")
      .filter((line) => line.startsWith("flow__Stage_chatId:")).length;
    expect(keyCount).toBe(1);
    expect(twice).toContain("flow__Stage_chatId: -999");
    expect(twice).not.toContain(OUT_OF_MAP);
  });

  it("DK10 the object path (applyPatch) forms the same key @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    const patched = FrontmatterService.applyPatch(
      { exo__Asset_uid: "aaaa" },
      { [OUT_OF_MAP]: "-1003912427125" },
    );
    expect(Object.keys(patched)).toContain("flow__Stage_chatId");
    expect(Object.keys(patched)).not.toContain(OUT_OF_MAP);
  });

  it("DK11 an out-of-map term IRI as a VALUE becomes a wikilink, like an in-map one @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    expect(
      FrontmatterService.normalizeIRIValue(
        "https://exocortex.my/ontology/ems#EffortStatusDone",
      ),
    ).toBe('"[[ems__EffortStatusDone]]"');
    expect(
      FrontmatterService.normalizeIRIValue(
        "https://exocortex.my/ontology/flow#StageDone",
      ),
    ).toBe('"[[flow__StageDone]]"');
  });

  it("DK13 a REGISTERED W3C vocabulary resolves too — as a KEY @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // ⚠ DELIBERATE WIDENING, locked here so it is a decision and not a drift.
    // Before the fix these stayed raw, because the nine-entry map holds only
    // exocortex.my namespaces. `Namespace.fromTermIRI` is the shared inverse of
    // the FORWARD emission path, which registers the W3C vocabularies on
    // purpose — restricting the fallback to exocortex.my here would have been a
    // FOURTH divergence from that canon.
    expect(
      FrontmatterService.normalizeIRI(
        "http://www.w3.org/2000/01/rdf-schema#label",
      ),
    ).toBe("rdfs__label");
    expect(
      FrontmatterService.normalizeIRI("http://www.w3.org/2002/07/owl#sameAs"),
    ).toBe("owl__sameAs");
    expect(
      FrontmatterService.normalizeIRI("http://www.w3.org/ns/shacl#targetClass"),
    ).toBe("sh__targetClass");
  });

  it("DK14 a REGISTERED W3C vocabulary resolves too — as a VALUE @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // ⚠ This is the half with NO live carrier and a DOUBLE existing convention:
    // exo__Property_range is stored as the CURIE `xsd:string` and as a UID
    // wikilink, never as a full IRI, so the form below is a THIRD spelling on an
    // input that does not occur today. Locked so that if it ever starts
    // occurring, the behaviour is the one we chose rather than the one we drifted
    // into. The vault already models W3C terms under exactly these names
    // (rdfs__comment, owl__sameAs, sh__targetClass, xsd__date …), so the name is
    // consistent with the live convention, not invented.
    expect(
      FrontmatterService.normalizeIRIValue(
        "http://www.w3.org/2001/XMLSchema#string",
      ),
    ).toBe('"[[xsd__string]]"');
    // …while the W3C ontology BASE (empty local) still passes through.
    expect(
      FrontmatterService.normalizeIRIValue(
        "http://www.w3.org/2001/XMLSchema#",
      ),
    ).toBe("http://www.w3.org/2001/XMLSchema#");
  });

  it("DK12 an ontology-base VALUE and a plain URL stay untouched @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    // ⛔ Before the fix the first of these became the broken wikilink
    // `"[[ems__]]"` — the corruption 8/8/7 live assets were exposed to.
    for (const value of [
      "https://exocortex.my/ontology/ems#",
      "https://exocortex.my/ontology/ems/docs#",
      "https://exocortex.my/ontology/flow#",
      "https://github.com/kitelev/exocortex",
    ]) {
      expect(FrontmatterService.normalizeIRIValue(value)).toBe(value);
    }
  });
});
