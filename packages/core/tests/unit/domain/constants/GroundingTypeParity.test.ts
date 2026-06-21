/**
 * @file Parity-guard tests for RFC 9d20c91f Phase 2.
 *
 * Asserts bijection invariant between:
 * 1. `GroundingType` TS enum (9 values)
 * 2. `GROUNDING_TYPE_UIDS` map (TS → vault UID)
 * 3. `GROUNDING_TYPE_UID_TO_ENUM` reverse map
 * 4. `GROUNDING_TYPE_IRI_TO_ENUM` (symbolic class IRI → enum)
 *
 * If a new GroundingType is added to the enum, this test fails until:
 * (a) a vault asset is created in `kitelev/exoas-exocmd` with `exo__Instance_class`
 *     pointing to the GroundingType class (UID `708604a5-...`)
 * (b) `GROUNDING_TYPE_UIDS` is updated with the new (enum value, UID) pair
 * (c) `GROUNDING_TYPE_IRI_TO_ENUM` is updated with the symbolic IRI
 * (d) `GroundingExecutor.execute` gets a `case` branch + private method
 *
 * Without this guard, drift between TS dispatcher and vault catalog
 * silently regresses to "Unknown grounding type" runtime failure (Issue
 * lineage: #2999, #3132, #3134 — all homoiconicity-exception precursors
 * RFC 9d20c91f Variant C closes).
 */

import { GroundingType } from "../../../../src/domain/constants/GroundingType";
import {
  GROUNDING_TYPE_UIDS,
  GROUNDING_TYPE_UID_TO_ENUM,
  GROUNDING_TYPE_IRI_TO_ENUM,
  resolveGroundingTypeFromIRI,
  resolveGroundingTypeFromWikilinkLiteral,
} from "../../../../src/domain/constants/GroundingTypeUIDs";

describe("RFC 9d20c91f Phase 2 — TS enum ↔ vault asset parity", () => {
  describe("GROUNDING_TYPE_UIDS bijection", () => {
    it("every GroundingType enum value has a UID entry", () => {
      const enumValues = Object.values(GroundingType).sort();
      const mappedKeys = Object.keys(GROUNDING_TYPE_UIDS).sort();
      expect(mappedKeys).toEqual(enumValues);
    });

    it("every UID entry is a valid UUID v4 form", () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      for (const uid of Object.values(GROUNDING_TYPE_UIDS)) {
        expect(uid).toMatch(uuidRegex);
      }
    });

    it("11 unique UIDs (no collisions)", () => {
      const uids = Object.values(GROUNDING_TYPE_UIDS);
      expect(new Set(uids).size).toBe(11);
    });
  });

  describe("GROUNDING_TYPE_UID_TO_ENUM reverse map", () => {
    it("is a true inverse of GROUNDING_TYPE_UIDS", () => {
      const entries = Object.entries(GROUNDING_TYPE_UIDS) as Array<
        [GroundingType, string]
      >;
      for (const [enumValue, uid] of entries) {
        expect(GROUNDING_TYPE_UID_TO_ENUM[uid]).toBe(enumValue);
      }
    });

    it("has the same 11 entries as GROUNDING_TYPE_UIDS", () => {
      expect(Object.keys(GROUNDING_TYPE_UID_TO_ENUM)).toHaveLength(11);
    });
  });

  describe("GROUNDING_TYPE_IRI_TO_ENUM (symbolic class IRI map)", () => {
    it("covers all 11 enum values", () => {
      const enumValuesFromIRI = new Set(Object.values(GROUNDING_TYPE_IRI_TO_ENUM));
      const allEnumValues = new Set(Object.values(GroundingType));
      expect(enumValuesFromIRI).toEqual(allEnumValues);
    });

    it("all keys follow exocmd namespace + GroundingType<Suffix> shape", () => {
      const expectedPrefix = "https://exocortex.my/ontology/exocmd#GroundingType";
      for (const iri of Object.keys(GROUNDING_TYPE_IRI_TO_ENUM)) {
        expect(iri.startsWith(expectedPrefix)).toBe(true);
      }
    });
  });

  describe("resolveGroundingTypeFromIRI", () => {
    it("resolves symbolic class IRI to enum (Issue #2782 substitution path)", () => {
      expect(
        resolveGroundingTypeFromIRI(
          "https://exocortex.my/ontology/exocmd#GroundingTypePropertySet",
        ),
      ).toBe(GroundingType.PROPERTY_SET);
    });

    it("resolves file IRI via UID extraction (substitution fallback path)", () => {
      const uid = GROUNDING_TYPE_UIDS[GroundingType.SERVICE_CALL];
      const fileIRI = `obsidian://vault/assetspaces/exocmd/${uid}.md`;
      expect(resolveGroundingTypeFromIRI(fileIRI)).toBe(GroundingType.SERVICE_CALL);
    });

    it("returns null for unknown IRI", () => {
      expect(
        resolveGroundingTypeFromIRI(
          "https://exocortex.my/ontology/exocmd#NotAGroundingType",
        ),
      ).toBeNull();
    });

    it("returns null for malformed IRI (no UUID inside)", () => {
      expect(resolveGroundingTypeFromIRI("obsidian://vault/whatever.md")).toBeNull();
    });

    it("returns null for unknown UID inside file IRI", () => {
      const bogusUid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      expect(
        resolveGroundingTypeFromIRI(`obsidian://vault/foo/${bogusUid}.md`),
      ).toBeNull();
    });
  });

  describe("resolveGroundingTypeFromWikilinkLiteral", () => {
    it("resolves bare wikilink form", () => {
      const uid = GROUNDING_TYPE_UIDS[GroundingType.PROPERTY_APPEND];
      expect(
        resolveGroundingTypeFromWikilinkLiteral(`[[${uid}]]`),
      ).toBe(GroundingType.PROPERTY_APPEND);
    });

    it("resolves alias wikilink form `[[<uid>|<label>]]`", () => {
      const uid = GROUNDING_TYPE_UIDS[GroundingType.COMPOSITE];
      expect(
        resolveGroundingTypeFromWikilinkLiteral(
          `[[${uid}|exocmd__GroundingTypeComposite]]`,
        ),
      ).toBe(GroundingType.COMPOSITE);
    });

    it("returns null for legacy bare string (caller falls back to enum match)", () => {
      expect(resolveGroundingTypeFromWikilinkLiteral("property_set")).toBeNull();
    });

    it("returns null for unknown UID inside wikilink", () => {
      expect(
        resolveGroundingTypeFromWikilinkLiteral(
          "[[ffffffff-ffff-ffff-ffff-ffffffffffff]]",
        ),
      ).toBeNull();
    });

    it("returns null for invalid wikilink syntax", () => {
      expect(resolveGroundingTypeFromWikilinkLiteral("not a wikilink")).toBeNull();
      expect(resolveGroundingTypeFromWikilinkLiteral("[[]]")).toBeNull();
    });
  });
});
