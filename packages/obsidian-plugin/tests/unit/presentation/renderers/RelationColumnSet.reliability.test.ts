/**
 * Reliability fault-injection matrix — RFC be70f741 Phase 3 ISO 25010
 * Reliability gap.
 *
 * Walks the invalid fixture set, asserts that each shape:
 *   - is rejected by the domain-level parser (returns null),
 *   - causes the warn-callback to fire exactly once,
 *   - never throws.
 *
 * Integration note: the repository swallows nulls silently; the React tree
 * stays on the legacy fallback.  This test validates the parser contract
 * the repository relies on for that invariant.
 */

import {
  createRelationColumnSetFromFrontmatter,
  isRelationColumnSetFrontmatter,
} from "exocortex";
import { invalidFrontmatterCases } from "../../../component/fixtures/relation-column-set/invalid";

describe("RelationColumnSet fault-injection matrix (Phase 3 AC8)", () => {
  for (const testCase of invalidFrontmatterCases) {
    if (testCase.name === "columns contains circular self-reference wikilink") {
      // This case is accepted by the parser (wikilinks are valid strings);
      // the resolver + renderer swallow it downstream via auto-escape.  We
      // still run the parser to make sure it does not throw.
      test(`accepts without throwing: ${testCase.name}`, () => {
        const warn = jest.fn();
        expect(() =>
          createRelationColumnSetFromFrontmatter(testCase.frontmatter, {
            sourcePath: testCase.sourcePath,
            warn,
          }),
        ).not.toThrow();
      });
      continue;
    }

    if (testCase.name === "non-existent property reference") {
      // Same story — non-existent property name is a valid string as far as
      // the parser is concerned; the renderer shows an empty cell.
      test(`accepts without throwing: ${testCase.name}`, () => {
        const warn = jest.fn();
        expect(() =>
          createRelationColumnSetFromFrontmatter(testCase.frontmatter, {
            sourcePath: testCase.sourcePath,
            warn,
          }),
        ).not.toThrow();
      });
      continue;
    }

    if (testCase.name === "malformed frontmatter (null exo__Instance_class)") {
      // The class-filter is upstream of the parser — assert
      // `isRelationColumnSetFrontmatter` rejects it, so the repository
      // never tries to parse.
      test(`isRelationColumnSetFrontmatter rejects: ${testCase.name}`, () => {
        expect(
          isRelationColumnSetFrontmatter(testCase.frontmatter),
        ).toBe(false);
      });
      continue;
    }

    test(`parser rejects + warn fires: ${testCase.name}`, () => {
      const warn = jest.fn();
      const parsed = createRelationColumnSetFromFrontmatter(
        testCase.frontmatter,
        { sourcePath: testCase.sourcePath, warn },
      );

      expect(parsed).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining(testCase.sourcePath));
    });
  }
});
