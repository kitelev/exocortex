/**
 * Integration test: OrderSpecResolver wired into the 3 known entry points
 * (MetadataHelpers.buildFileContent, FrontmatterService.createFrontmatter,
 * SupervisionCreationService.buildFileContent). The presence of an ordering
 * spec must reorder output frontmatter; its absence must be a no-op.
 *
 * RFC 27a7a877.
 */
import {
  registerOrderSpecLoader,
  clearOrderSpecLoader,
} from "../../src/services/OrderSpecResolver";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";

const DEFAULT_SPEC = {
  head: [
    "exo__Asset_isDefinedBy",
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__Instance_class",
    "exo__Asset_prototype",
    "ems__Effort_status",
    "ems__Effort_area",
    "ems__Effort_parent",
  ],
  tail: ["exo__Asset_relates", "exo__Asset_label", "aliases"],
  middleStrategy: "alphabetical",
};

function extractKeyOrder(serialized: string): string[] {
  const fmMatch = serialized.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error("no frontmatter block");
  return fmMatch[1]
    .split("\n")
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*:/.test(l))
    .map((l) => l.split(":")[0]);
}

describe("OrderSpecResolver integration", () => {
  afterEach(() => {
    clearOrderSpecLoader();
  });

  describe("MetadataHelpers.buildFileContent", () => {
    it("returns insertion order when no loader registered (legacy behaviour)", () => {
      const fm = {
        zeta: "z",
        exo__Asset_uid: "u",
        alpha: "a",
        exo__Asset_label: "Label",
        exo__Asset_isDefinedBy: "[[onto]]",
      };
      const out = MetadataHelpers.buildFileContent(fm);
      expect(extractKeyOrder(out)).toEqual([
        "zeta",
        "exo__Asset_uid",
        "alpha",
        "exo__Asset_label",
        "exo__Asset_isDefinedBy",
      ]);
    });

    it("applies head → alphabetical middle → tail when spec registered", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);

      const fm = {
        zeta: "z",
        exo__Asset_uid: "u",
        alpha: "a",
        exo__Asset_label: "Label",
        exo__Asset_isDefinedBy: "[[onto]]",
        aliases: ["a1"],
        omega: "o",
      };
      const out = MetadataHelpers.buildFileContent(fm);
      expect(extractKeyOrder(out)).toEqual([
        // head (in spec order, skipping absent keys)
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        // middle (alphabetical)
        "alpha",
        "omega",
        "zeta",
        // tail (in spec order, skipping absent)
        "exo__Asset_label",
        "aliases",
      ]);
    });

    it("body inference uses the ordered label, not raw frontmatter label", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);
      const fm = {
        zeta: "z",
        exo__Asset_label: "Some Label",
        exo__Asset_uid: "u",
      };
      const out = MetadataHelpers.buildFileContent(fm);
      expect(out).toContain("# Some Label");
    });
  });

  describe("FrontmatterService.createFrontmatter", () => {
    let service: FrontmatterService;
    beforeEach(() => {
      service = new FrontmatterService();
    });

    it("returns insertion order when no loader registered", () => {
      const out = service.createFrontmatter("body", {
        zeta: "z",
        exo__Asset_uid: "u",
        alpha: "a",
      });
      expect(extractKeyOrder(out)).toEqual(["zeta", "exo__Asset_uid", "alpha"]);
    });

    it("applies canonical ordering when spec registered", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);
      const out = service.createFrontmatter("body", {
        zeta: "z",
        exo__Asset_uid: "u",
        alpha: "a",
        exo__Asset_label: "L",
        exo__Asset_isDefinedBy: "[[onto]]",
      });
      expect(extractKeyOrder(out)).toEqual([
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        "alpha",
        "zeta",
        "exo__Asset_label",
      ]);
    });

    it("preserves body content alongside reordered frontmatter", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);
      const out = service.createFrontmatter("# Body text", {
        zeta: "z",
        exo__Asset_uid: "u",
      });
      expect(out).toMatch(/---\n[\s\S]+\n---\n# Body text$/);
    });
  });
});
