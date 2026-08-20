import { describe, it, expect } from "@jest/globals";
import { BlankNode, IRI, Literal } from "@kitelev/exocortex-core";
import {
  serializeNode,
  deserializeNode,
} from "../../../src/cache/tripleSerialization";

/**
 * Blank nodes must survive the cache round-trip.
 *
 * ⛔ `serializeNode` read `node.value` on a BlankNode. BlankNode exposes `.id`,
 * not `.value`, so the field was `undefined`, `JSON.stringify` DROPPED the key
 * entirely, and reading the record back called `new BlankNode(undefined)` →
 * `TypeError: Cannot read properties of undefined (reading 'trim')`.
 *
 * The failure is STICKY: the poisoned record lands in
 * `.exocortex/cache/triples.json`, which `loadOrBuild()` feeds to five commands
 * (`classes`, `run-query`, `sparql-index`, `validate-schema`, `sparql-query`).
 * All five throw until the cache file is deleted by hand.
 *
 * ⛤ `packages/cli/src` is type-checked nowhere — the root tsconfig excludes it
 * and esbuild does not check types — so the compiler never saw `.value` on a
 * type that has no such member. The defect surfaced only via the ratchet added
 * in #4074.
 *
 * ⛤ These axes use a REAL `BlankNode`, not a `{ value }` stub. A stub is
 * exactly what hid the sibling instance of this class (#4070) through two
 * review rounds: a fake shaped like the WRONG assumption confirms the wrong
 * assumption. The JSON.stringify step is included deliberately — the key drop
 * happens there, not in serializeNode, so an assertion on the in-memory object
 * alone would miss it.
 *
 * @req: none — bug-fix restoring already-required behaviour (feature-sdd Step 0).
 */
describe("tripleSerialization — BlankNode round-trip", () => {
  it("serialises the blank node id, not undefined", () => {
    const bn = new BlankNode("b0");

    const serialized = serializeNode(bn);

    expect(serialized.type).toBe("BlankNode");
    // ⛔ Before the fix this was `undefined`.
    expect(serialized.value).toBe("b0");
  });

  it("survives JSON.stringify — the step where the dropped key becomes fatal", () => {
    const bn = new BlankNode("b0");

    const record = JSON.parse(JSON.stringify(serializeNode(bn)));

    // ⛔ Before the fix: {"type":"BlankNode"} — the key was gone entirely,
    // because JSON.stringify omits properties whose value is undefined.
    expect(record).toEqual({ type: "BlankNode", value: "b0" });
  });

  it("deserialises back to an equal BlankNode", () => {
    const bn = new BlankNode("b0");

    const restored = deserializeNode(
      JSON.parse(JSON.stringify(serializeNode(bn)))
    );

    // ⛔ Before the fix this threw:
    //   TypeError: Cannot read properties of undefined (reading 'trim')
    expect(restored).toBeInstanceOf(BlankNode);
    expect((restored as BlankNode).id).toBe("b0");
    expect((restored as BlankNode).equals(bn)).toBe(true);
  });

  it("keeps ids distinct across several blank nodes", () => {
    // A single-node axis would pass against a fix that hardcoded any string.
    const ids = ["b0", "b1", "genid-42"];

    const restored = ids.map((id) =>
      deserializeNode(JSON.parse(JSON.stringify(serializeNode(new BlankNode(id)))))
    );

    expect(restored.map((n) => (n as BlankNode).id)).toEqual(ids);
  });

  it("CANARY: IRI and Literal round-trips are unaffected", () => {
    // Green in BOTH states. The fix touches a shared serializer, so a change
    // that broke the neighbouring branches would otherwise look like a clean
    // pass on the blank-node axes alone.
    const iri = deserializeNode(
      JSON.parse(JSON.stringify(serializeNode(new IRI("urn:exo:x"))))
    );
    expect((iri as IRI).value).toBe("urn:exo:x");

    const lit = deserializeNode(
      JSON.parse(
        JSON.stringify(serializeNode(new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer"))))
      )
    );
    expect((lit as Literal).value).toBe("42");
  });
});
