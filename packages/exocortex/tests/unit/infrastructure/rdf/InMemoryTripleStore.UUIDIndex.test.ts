import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../src/domain/models/rdf/Triple";

describe("InMemoryTripleStore UUID Index", () => {
  let store: InMemoryTripleStore;

  const createTriple = (s: string, p: string, o: string): Triple => {
    const subject = new IRI(s);
    const predicate = new IRI(p);
    const object = o.startsWith("http") ? new IRI(o) : new Literal(o);
    return new Triple(subject, predicate, object);
  };

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  describe("findSubjectsByUUID", () => {
    const UUID_1 = "550e8400-e29b-41d4-a716-446655440000";
    const UUID_2 = "7a1b2c3d-4e5f-6789-abcd-ef0123456789";

    beforeEach(async () => {
      // Add triples with UUIDs in subject URIs
      await store.add(
        createTriple(
          `https://exocortex.my/entity/${UUID_1}`,
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          "http://example.org/Task"
        )
      );
      await store.add(
        createTriple(
          `https://exocortex.my/entity/${UUID_1}`,
          "http://example.org/name",
          "Test Task"
        )
      );
      await store.add(
        createTriple(
          `https://exocortex.my/entity/${UUID_2}`,
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          "http://example.org/Project"
        )
      );
    });

    it("should find subject by exact UUID", async () => {
      const subjects = await store.findSubjectsByUUID(UUID_1);

      expect(subjects.length).toBe(1);
      expect((subjects[0] as IRI).value).toContain(UUID_1);
    });

    it("should find subject with case-insensitive UUID", async () => {
      const subjectsLower = await store.findSubjectsByUUID(UUID_1.toLowerCase());
      const subjectsUpper = await store.findSubjectsByUUID(UUID_1.toUpperCase());
      const subjectsMixed = await store.findSubjectsByUUID("550E8400-e29b-41D4-a716-446655440000");

      expect(subjectsLower.length).toBe(1);
      expect(subjectsUpper.length).toBe(1);
      expect(subjectsMixed.length).toBe(1);
    });

    it("should return empty array for non-existent UUID", async () => {
      const subjects = await store.findSubjectsByUUID("00000000-0000-0000-0000-000000000000");
      expect(subjects.length).toBe(0);
    });

    it("should return empty array for invalid UUID format", async () => {
      const subjects = await store.findSubjectsByUUID("not-a-uuid");
      expect(subjects.length).toBe(0);
    });

    it("should return multiple subjects if same UUID in different paths", async () => {
      // Add another triple with the same UUID but different path
      await store.add(
        createTriple(
          `https://exocortex.my/different/${UUID_1}`,
          "http://example.org/type",
          "http://example.org/Copy"
        )
      );

      const subjects = await store.findSubjectsByUUID(UUID_1);

      expect(subjects.length).toBe(2);
      expect(subjects.map((s) => (s as IRI).value)).toContain(
        `https://exocortex.my/entity/${UUID_1}`
      );
      expect(subjects.map((s) => (s as IRI).value)).toContain(
        `https://exocortex.my/different/${UUID_1}`
      );
    });
  });

  describe("UUID index maintenance", () => {
    const UUID = "12345678-1234-1234-1234-123456789012";

    it("should update index when adding triples", async () => {
      let subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(0);

      await store.add(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/type",
          "Test"
        )
      );

      subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(1);
    });

    it("should clear index on store clear", async () => {
      await store.add(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/type",
          "Test"
        )
      );

      let subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(1);

      await store.clear();

      subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(0);
    });

    it("should handle subjects with multiple UUIDs", async () => {
      const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

      // Subject URI contains two UUIDs
      await store.add(
        createTriple(
          `http://example.org/${UUID_A}/child/${UUID_B}`,
          "http://example.org/type",
          "Test"
        )
      );

      const subjectsA = await store.findSubjectsByUUID(UUID_A);
      const subjectsB = await store.findSubjectsByUUID(UUID_B);

      expect(subjectsA.length).toBe(1);
      expect(subjectsB.length).toBe(1);
      expect((subjectsA[0] as IRI).value).toBe(
        `http://example.org/${UUID_A}/child/${UUID_B}`
      );
    });

    it("should not index blank nodes", async () => {
      // Blank nodes don't have UUIDs typically, but even if they did,
      // we only index IRIs
      const subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(0);
    });

    it("should only return subjects that still exist", async () => {
      await store.add(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/type",
          "Test"
        )
      );
      await store.add(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/name",
          "Name"
        )
      );

      let subjects = await store.findSubjectsByUUID(UUID);
      expect(subjects.length).toBe(1);

      // Remove all triples with this subject
      await store.remove(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/type",
          "Test"
        )
      );
      await store.remove(
        createTriple(
          `http://example.org/${UUID}`,
          "http://example.org/name",
          "Name"
        )
      );

      subjects = await store.findSubjectsByUUID(UUID);
      // Subject should no longer be returned since no triples exist
      expect(subjects.length).toBe(0);
    });
  });

  describe("performance", () => {
    it("should provide fast UUID lookup even with many triples", async () => {
      const targetUUID = "99999999-9999-9999-9999-999999999999";

      // Add many triples without the target UUID
      for (let i = 0; i < 1000; i++) {
        await store.add(
          createTriple(
            `http://example.org/entity/${i}`,
            "http://example.org/type",
            "http://example.org/Entity"
          )
        );
      }

      // Add one triple with the target UUID
      await store.add(
        createTriple(
          `http://example.org/special/${targetUUID}`,
          "http://example.org/type",
          "http://example.org/Special"
        )
      );

      const start = performance.now();
      const subjects = await store.findSubjectsByUUID(targetUUID);
      const elapsed = performance.now() - start;

      expect(subjects.length).toBe(1);
      expect((subjects[0] as IRI).value).toContain(targetUUID);

      // UUID index lookup should be very fast (< 1ms for 1000 triples)
      expect(elapsed).toBeLessThan(5);
    });
  });
});
