/**
 * Data-guard (req f6690c74, ticket eb603ba7) — asserts the REAL
 * `packages/exoas-exocmd` data for `set-label-keep-alias`: command 8ba3e3ff
 * points at composite 341f7314, whose steps are, IN ORDER,
 *   1. property_append aliases = $target.exo__Asset_label  (a85668fa)  ← keep the OLD label
 *   2. property_set  exo__Asset_label = $input.label       (f79e2d7d)
 *   3. property_append aliases = $input.label             (b36996d5)
 *   4. property_set  exo__Asset_updatedAt = $nowLocal     (49e00287)
 * Step 1 must precede step 2: after the label is overwritten,
 * `$target.exo__Asset_label` reads the NEW label. There is deliberately no
 * property_delete of `aliases` (that is the default set-label, req f7790000).
 *
 * Walks the ACTUAL submodule data, complementing the behaviour test in
 * packages/cli/tests/integration/apply-set-label-keep-alias.integration.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UID_TO_ENUM } from "../../../src/domain/constants/GroundingTypeUIDs";

const SUBMODULE_EXOCMD = path.resolve(__dirname, "../../../../exoas-exocmd/exocmd");
const COMMAND = "8ba3e3ff-9cea-45d6-83ef-99ec3de3281f";
const COMPOSITE = "341f7314-cef3-461e-b8c8-4de7934b1aa8";
const STEPS = [
  "a85668fa-17b7-45d0-aa7f-935e2502dff0",
  "f79e2d7d-7edd-4e7d-bba1-c668d362efcf",
  "b36996d5-d09f-4d98-a50b-799a7e007a7b",
  "49e00287-9355-4f6f-8b2f-882b0d8be21e",
];

function frontmatterOf(uid: string): string {
  const p = path.join(SUBMODULE_EXOCMD, `${uid}.md`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `exoas-exocmd asset ${uid}.md not found at ${p}. Run \`git submodule update --init packages/exoas-exocmd\` (or the submodule pointer predates req f6690c74).`,
    );
  }
  const m = fs.readFileSync(p, "utf8").match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

const scalar = (fm: string, key: string): string | null => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : null;
};

const list = (fm: string, key: string): string[] => {
  const m = fm.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s.*\\n?)*)`, "m"));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s+-\s*/, "").trim().replace(/^"|"$/g, ""))
    .filter((l) => l.length > 0);
};

const uidOf = (v: string | null): string | null => {
  const m = v?.match(/\[\[([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
};

const typeOf = (fm: string): GroundingType | undefined => {
  const uid = uidOf(scalar(fm, "exocmd__Grounding_type"));
  return uid ? GROUNDING_TYPE_UID_TO_ENUM[uid] : undefined;
};

describe("req f6690c74 set-label-keep-alias grounding shape (real exoas-exocmd data)", () => {
  const present = fs.existsSync(SUBMODULE_EXOCMD);

  (present ? it : it.skip)(
    "S1 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac the command is CLI-addressable as set-label-keep-alias and grounds on the composite",
    () => {
      const cmd = frontmatterOf(COMMAND);
      expect(scalar(cmd, "exocmd__Command_cliName")).toBe("set-label-keep-alias");
      expect(uidOf(scalar(cmd, "exocmd__Command_grounding"))).toBe(COMPOSITE);
    },
  );

  (present ? it : it.skip)(
    "S2 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac the composite runs [append OLD label, set label, append new label, bump updatedAt] in that order, with no aliases delete",
    () => {
      const composite = frontmatterOf(COMPOSITE);
      expect(typeOf(composite)).toBe(GroundingType.COMPOSITE);
      expect(list(composite, "exocmd__Grounding_steps").map((s) => uidOf(s))).toEqual(STEPS);
      for (const step of list(composite, "exocmd__Grounding_steps")) {
        expect(typeOf(frontmatterOf(uidOf(step)!))).not.toBe(GroundingType.PROPERTY_DELETE);
      }
    },
  );

  (present ? it : it.skip)(
    "S3 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac step 1 appends the CURRENT label ($target.exo__Asset_label) to aliases",
    () => {
      const first = frontmatterOf(STEPS[0]);
      expect(typeOf(first)).toBe(GroundingType.PROPERTY_APPEND);
      expect(scalar(first, "exocmd__Grounding_targetProperty")).toBe("aliases");
      expect(scalar(first, "exocmd__Grounding_appendExpression")).toBe("$target.exo__Asset_label");
    },
  );
});
