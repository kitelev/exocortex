/**
 * Data-guard (Issue #3798) — asserts the REAL `packages/exoas-exocmd` set-label
 * composite grounding (3dfa3379) has the 4-step shape that fixes the two
 * residual bugs:
 *   1. property_set  exo__Asset_label   = $input.label   (f79e2d7d)
 *   2. property_delete aliases                           (7f33c6c7, #3798)  ← clear stale
 *   3. property_append aliases = $input.label            (b36996d5)         ← re-mirror single
 *   4. property_set  exo__Asset_updatedAt = $nowLocal    (49e00287, #3798)  ← bump
 *
 * This walks the ACTUAL submodule data (not an inline fixture), so it guards
 * against the grounding drifting back to the buggy 2-step form (revert-verify:
 * bumping the submodule pointer to before the fix → RED; after → GREEN). It is
 * the data-code coupling guard complementing the engine/pipeline behaviour test
 * in packages/cli/tests/integration/apply-mutation-parity.integration.test.ts
 * (cross-repo-submodule-sync.md §stale-walker, test-fixture-realism.md).
 *
 * @req:f7790000-3779-4bbb-8bbb-000000000002
 */
import * as fs from "fs";
import * as path from "path";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UID_TO_ENUM } from "../../../src/domain/constants/GroundingTypeUIDs";

const SUBMODULE_EXOCMD = path.resolve(__dirname, "../../../../exoas-exocmd/exocmd");
const SET_LABEL_COMPOSITE = "3dfa3379-5cee-4717-97fe-e0885fec0549";
const NOWLOCAL_TOKEN = "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8";

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string | string[]> = {};
  let key: string | null = null;
  let list: string[] | null = null;
  for (const line of m[1].split("\n")) {
    const li = line.match(/^\s*-\s*(.+)$/);
    if (li && list) {
      list.push(li[1].trim().replace(/^"|"$/g, ""));
      continue;
    }
    const kv = line.match(/^([a-zA-Z_][\w]*?):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      if (v === "") {
        list = [];
        fm[key] = list;
      } else {
        fm[key] = v.replace(/^"|"$/g, "");
        list = null;
      }
    }
  }
  return fm;
}

const wikilinkUid = (v: string | undefined): string | null => {
  if (!v) return null;
  const m = v.match(/\[\[([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
};

function readAsset(uid: string): Record<string, string | string[]> {
  const p = path.join(SUBMODULE_EXOCMD, `${uid}.md`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `exoas-exocmd asset ${uid}.md not found at ${p}. Run \`git submodule update --init packages/exoas-exocmd\` (or the submodule pointer predates #3798).`,
    );
  }
  return parseFrontmatter(fs.readFileSync(p, "utf8"));
}

describe("#3798 set-label grounding shape (real exoas-exocmd data)", () => {
  const submodulePresent = fs.existsSync(SUBMODULE_EXOCMD);

  (submodulePresent ? it : it.skip)(
    "@req:f7790000-3779-4bbb-8bbb-000000000002 the composite is [set label, DELETE aliases, append alias, set updatedAt=$nowLocal]",
    () => {
      const composite = readAsset(SET_LABEL_COMPOSITE);
      expect(wikilinkUid(composite["exocmd__Grounding_type"] as string)).toBe(
        // composite type
        "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3",
      );

      const stepsRaw = composite["exocmd__Grounding_steps"];
      const stepUids = (Array.isArray(stepsRaw) ? stepsRaw : [stepsRaw])
        .map((s) => wikilinkUid(s as string))
        .filter((u): u is string => u !== null);

      // Resolve each step to (GroundingType, targetProperty).
      const steps = stepUids.map((uid) => {
        const fm = readAsset(uid);
        const typeUid = wikilinkUid(fm["exocmd__Grounding_type"] as string);
        return {
          uid,
          type: typeUid ? GROUNDING_TYPE_UID_TO_ENUM[typeUid] : undefined,
          targetProperty: fm["exocmd__Grounding_targetProperty"] as
            | string
            | undefined,
          substitution: fm["exocmd__Grounding_targetValueSubstitution"] as
            | string
            | undefined,
        };
      });

      // Exactly the 4-step fix shape (order matters: delete BEFORE append).
      expect(
        steps.map((s) => [s.type, s.targetProperty]),
      ).toEqual([
        [GroundingType.PROPERTY_SET, "exo__Asset_label"],
        [GroundingType.PROPERTY_DELETE, "aliases"],
        [GroundingType.PROPERTY_APPEND, "aliases"],
        [GroundingType.PROPERTY_SET, "exo__Asset_updatedAt"],
      ]);

      // The updatedAt step stamps the $nowLocal token (8bc0c038).
      const updatedAtStep = steps[3];
      expect(wikilinkUid(updatedAtStep.substitution)).toBe(NOWLOCAL_TOKEN);
      // …and that token's label IS "$nowLocal" (so the executor resolves it).
      expect(readAsset(NOWLOCAL_TOKEN)["exo__Asset_label"]).toBe("$nowLocal");
    },
  );
});
