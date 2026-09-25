/**
 * Data-guard (req 2821fdf0) — asserts the REAL `packages/exoas-exocmd` data
 * still wires the Task-conditioned parent rule that makes «Create Action» nest
 * a new `ems__Action` under an `ems__Task` target.
 *
 * The fixture-based sibling (`create-action-parent.integration.test.ts`) proves
 * the ENGINE honours such a rule. This one proves the SHIPPED DATA still
 * declares it — the two fail for different reasons, and only this one goes red
 * if someone unwires the rule in the assetspace while the engine stays correct
 * (cross-repo-submodule-sync.md §stale-walker, test-fixture-realism.md).
 *
 * The invariant has three parts, and all three are load-bearing:
 *
 *   1. The Universal Default Template (62907ff4) lists BOTH parent rules —
 *      01f570c9 (condition ems__Project) and 65acce2f (condition ems__Task).
 *      They live there because the Universal override in
 *      `mergeInheritanceRules` is keyed by `targetPropertyName`: any rule a
 *      Grounding declares for a property shadows EVERY Universal rule for it.
 *      ⛤ Corrected 2026-09-25 (req a2c868e9) — this used to add «a Grounding
 *      can express at most one rule per property», which is no longer true:
 *      grounding rules are no longer deduplicated against each other. The
 *      shadowing, which is what actually forces this topology, is unchanged.
 *   2. Therefore the «Create action» grounding (1bc1e938) declares NO rule
 *      whose `_targetProperty` is `ems__Effort_parent`. Adding one back would
 *      silently disable BOTH template rules for this command — the exact defect
 *      req 2821fdf0 fixes, in a new disguise.
 *   3. The Task rule's own shape: source `exo__Asset_uid` (fada7446), target
 *      `ems__Effort_parent` (6528ecfa), condition `ems__Task` (1b20a8f0),
 *      priority 50. The condition must stay the concrete Task class, not a
 *      superclass: conditions are matched directly, so `ems__Effort` there would
 *      re-admit prototypes (the 2026-05-24 defect).
 *
 * @req:2821fdf0-bf65-4afe-96cd-59da980ffe84
 */
import * as fs from "fs";
import * as path from "path";

const SUBMODULE_EXOCMD = path.resolve(
  __dirname,
  "../../../../exoas-exocmd/exocmd",
);

const UDT_SINGLETON = "62907ff4-bf91-4c94-8e02-92b3ca2bc798";
const GROUNDING_CREATE_ACTION = "1bc1e938-d07b-41b0-8264-d9ca81104af2";
const IR_PROJECT_PARENT = "01f570c9-3bf2-4ec8-af27-0aa4d9cbc29f";
const IR_TASK_PARENT = "65acce2f-e0eb-48e2-bcb3-8d5c9664e799";

const PROP_ASSET_UID = "fada7446-b0a4-4100-88f4-6d4421c175fb";
const PROP_EFFORT_PARENT = "6528ecfa-a03d-47f1-a819-9ba5fea8fc28";
const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";

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
      `exoas-exocmd asset ${uid}.md not found at ${p}. Run \`git submodule update --init packages/exoas-exocmd\` (or the submodule pointer predates req 2821fdf0).`,
    );
  }
  return parseFrontmatter(fs.readFileSync(p, "utf8"));
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

describe("req 2821fdf0 — Task parent rule wiring (real exoas-exocmd data)", () => {
  const submodulePresent = fs.existsSync(SUBMODULE_EXOCMD);

  (submodulePresent ? it : it.skip)(
    "@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 the Universal Default Template lists BOTH the Project and the Task parent rule",
    () => {
      const template = readAsset(UDT_SINGLETON);
      const rules = asList(template["exocmd__Template_inheritanceRule"])
        .map((r) => wikilinkUid(r))
        .filter((u): u is string => u !== null);

      expect(rules).toContain(IR_PROJECT_PARENT);
      expect(rules).toContain(IR_TASK_PARENT);
    },
  );

  (submodulePresent ? it : it.skip)(
    "@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 the Task rule has the shipped shape (uid → Effort_parent, condition ems__Task, prio 50)",
    () => {
      const rule = readAsset(IR_TASK_PARENT);
      expect(
        wikilinkUid(rule["exocmd__InheritanceRule_sourceProperty"] as string),
      ).toBe(PROP_ASSET_UID);
      expect(
        wikilinkUid(rule["exocmd__InheritanceRule_targetProperty"] as string),
      ).toBe(PROP_EFFORT_PARENT);
      // Concrete Task, NOT a superclass: conditions are matched directly, and
      // ems__Effort here would re-admit prototypes (2026-05-24 defect).
      expect(
        wikilinkUid(
          rule["exocmd__InheritanceRule_targetClassCondition"] as string,
        ),
      ).toBe(CLS_TASK);
      expect(String(rule["exocmd__InheritanceRule_priority"])).toBe("50");
    },
  );

  (submodulePresent ? it : it.skip)(
    "@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 the «Create action» grounding declares NO ems__Effort_parent rule of its own",
    () => {
      const grounding = readAsset(GROUNDING_CREATE_ACTION);
      const ruleUids = asList(grounding["exocmd__Grounding_inheritanceRule"])
        .map((r) => wikilinkUid(r))
        .filter((u): u is string => u !== null);

      // The grounding still declares rules (area, isDefinedBy) — this is not a
      // vacuous "empty list" assertion.
      expect(ruleUids.length).toBeGreaterThan(0);

      const parentRules = ruleUids.filter((uid) => {
        const rule = readAsset(uid);
        return (
          wikilinkUid(
            rule["exocmd__InheritanceRule_targetProperty"] as string,
          ) === PROP_EFFORT_PARENT
        );
      });

      // Any parent rule here would shadow BOTH template rules for this command.
      expect(parentRules).toEqual([]);
    },
  );
});
