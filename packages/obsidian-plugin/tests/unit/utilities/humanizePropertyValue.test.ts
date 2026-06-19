import { humanizePropertyValue } from "../../../src/presentation/components/AssetRelationsTable";

/**
 * RFC 0002 §3.7 (P11) — humanize enum/class *values* in the Properties block.
 *
 * Companion to humanizePropertyName (which humanizes property *keys*). The same
 * IRI-prefix-stripping mechanism is applied to *values* that are wikilinks or
 * bare `prefix__Name` jargon. Wikilink targets resolve to a readable display
 * string (alias → resolved `exo__Asset_label` → target), then strip the prefix.
 *
 * Verify-before-assert note on the RFC's "Doing" example: the live status asset's
 * `exo__Asset_label` is literally `ems__EffortStatusDoing` (not "Doing"), and
 * humanizePropertyName deliberately preserves PascalCase (see its own test:
 * `ems__EffortStatusBacklog` → "EffortStatusBacklog"). So the reuse-humanization
 * produces "EffortStatusDoing" / "Project" — consistent with the relations table.
 * Literal per-enum display ("Doing") would need an enum→label map (out of scope).
 */
describe("humanizePropertyValue", () => {
  describe("class-value humanization (RFC §3.7 DoD)", () => {
    it("strips prefix from a bare class value: ems__Project → Project", () => {
      expect(humanizePropertyValue("ems__Project")).toBe("Project");
    });

    it("strips prefix from a class wikilink: [[ems__Project]] → Project", () => {
      expect(humanizePropertyValue("[[ems__Project]]")).toBe("Project");
    });

    it("humanizes a status alias wikilink: [[uid|ems__EffortStatusDoing]] → EffortStatusDoing", () => {
      expect(
        humanizePropertyValue(
          "[[027e78f4-6e16-4b36-b8fb-5510507d5745|ems__EffortStatusDoing]]",
        ),
      ).toBe("EffortStatusDoing");
    });
  });

  describe("UID wikilink resolution via resolveLabel", () => {
    it("resolves a UID-only wikilink to the target's humanized exo__Asset_label", () => {
      const resolve = (target: string): string | null =>
        target === "1b20a8f0-d745-4e93-91db-4531b3df120e"
          ? "ems__Task"
          : null;
      expect(
        humanizePropertyValue(
          "[[1b20a8f0-d745-4e93-91db-4531b3df120e]]",
          resolve,
        ),
      ).toBe("Task");
    });

    it("humanizes the resolved label even when it is jargon (de-jargon the IRI prefix)", () => {
      const resolve = (): string | null => "ems__EffortStatusDoing";
      expect(
        humanizePropertyValue(
          "[[027e78f4-6e16-4b36-b8fb-5510507d5745]]",
          resolve,
        ),
      ).toBe("EffortStatusDoing");
    });

    it("falls back to the raw UID when no resolver/label is available (UUID guard)", () => {
      const uuid = "027e78f4-6e16-4b36-b8fb-5510507d5745";
      expect(humanizePropertyValue(`[[${uuid}]]`)).toBe(uuid);
    });
  });

  describe("preserves existing wikilink-resolution behaviour (does not break non-jargon)", () => {
    it("keeps a human-readable alias unchanged: [[uid|ExoAssistant]] → ExoAssistant", () => {
      expect(
        humanizePropertyValue(
          "[[de20a3f1-7483-4714-ab28-b45f5cf02c76|ExoAssistant]]",
        ),
      ).toBe("ExoAssistant");
    });

    it("keeps a multi-word person alias unchanged: [[uid|John Doe]] → John Doe", () => {
      expect(humanizePropertyValue("[[abc|John Doe]]")).toBe("John Doe");
    });
  });

  describe("arrays", () => {
    it("humanizes each element and joins with comma", () => {
      expect(
        humanizePropertyValue(["[[a|ems__Project]]", "[[b|ems__Task]]"]),
      ).toBe("Project, Task");
    });

    it("resolves UID-only elements via resolveLabel", () => {
      const resolve = (target: string): string | null =>
        target === "1b20a8f0-d745-4e93-91db-4531b3df120e" ? "ems__Task" : null;
      expect(
        humanizePropertyValue(
          ["[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"],
          resolve,
        ),
      ).toBe("Task");
    });

    it("drops null/undefined elements", () => {
      expect(humanizePropertyValue(["ems__Project", null, undefined])).toBe(
        "Project",
      );
    });
  });

  describe("non-jargon / scalar passthrough", () => {
    it("returns empty string for null/undefined", () => {
      expect(humanizePropertyValue(null)).toBe("");
      expect(humanizePropertyValue(undefined)).toBe("");
    });

    it("passes through plain human-readable strings unchanged", () => {
      expect(humanizePropertyValue("title")).toBe("title");
      expect(humanizePropertyValue("Some free text")).toBe("Some free text");
    });

    it("passes through ISO timestamps unchanged (no underscores, not a UUID)", () => {
      expect(humanizePropertyValue("2026-06-19T01:22:46")).toBe(
        "2026-06-19T01:22:46",
      );
    });

    it("stringifies numbers and booleans", () => {
      expect(humanizePropertyValue(42)).toBe("42");
      expect(humanizePropertyValue(true)).toBe("true");
    });

    it("JSON-stringifies plain objects", () => {
      expect(humanizePropertyValue({ a: 1 })).toBe('{"a":1}');
    });
  });
});
