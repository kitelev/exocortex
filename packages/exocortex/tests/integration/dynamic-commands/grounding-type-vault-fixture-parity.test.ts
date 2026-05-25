/**
 * @file Vault-fixture parity test for RFC 9d20c91f Phase 2.
 *
 * Walks `packages/exoas-exocmd/` (the shared submodule clone) and finds
 * every asset whose `exo__Instance_class` points to the `exocmd__GroundingType`
 * class (UID `708604a5-a682-4ff6-9391-c2e80ab78ca5`). Asserts:
 *
 * 1. Exactly 9 instances (matches `GroundingType` TS enum cardinality)
 * 2. The 9 vault UIDs are exactly the values in `GROUNDING_TYPE_UIDS`
 * 3. Each vault asset's `exo__Asset_label` matches the expected naming
 *    convention X (e.g., `exocmd__GroundingTypePropertySet` for
 *    `GroundingType.PROPERTY_SET`)
 *
 * If a vault asset is renamed, removed, or has its UID changed without
 * coordinated TS update, this test fails before any runtime regression
 * propagates to production.
 */

import * as fs from "fs";
import * as path from "path";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UIDS } from "../../../src/domain/constants/GroundingTypeUIDs";

const GROUNDING_TYPE_CLASS_UID = "708604a5-a682-4ff6-9391-c2e80ab78ca5";
// Resolve from current test file location. `__dirname` is CommonJS-provided
// by ts-jest preset.
const SUBMODULE_PATH = path.resolve(__dirname, "../../../../exoas-exocmd");

const ENUM_TO_EXPECTED_LABEL: Record<GroundingType, string> = {
  [GroundingType.PROPERTY_SET]:       "exocmd__GroundingTypePropertySet",
  [GroundingType.PROPERTY_DELETE]:    "exocmd__GroundingTypePropertyDelete",
  [GroundingType.COMPOSITE]:          "exocmd__GroundingTypeComposite",
  [GroundingType.SERVICE_CALL]:       "exocmd__GroundingTypeServiceCall",
  [GroundingType.CREATE_INSTANCE]:    "exocmd__GroundingTypeCreateInstance",
  [GroundingType.PROPERTY_APPEND]:    "exocmd__GroundingTypePropertyAppend",
  [GroundingType.PROPERTY_INCREMENT]: "exocmd__GroundingTypePropertyIncrement",
  [GroundingType.PROPERTY_SHIFT]:     "exocmd__GroundingTypePropertyShift",
  [GroundingType.SPARQL_UPDATE]:      "exocmd__GroundingTypeSparqlUpdate",
};

interface VaultAsset {
  uid: string;
  label: string;
  instanceClassRefs: string[];
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const fm: Record<string, unknown> = {};
  const lines = fmMatch[1].split("\n");
  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  for (const line of lines) {
    const listItemMatch = line.match(/^\s*-\s*(.+)$/);
    if (listItemMatch && currentList) {
      currentList.push(listItemMatch[1].trim().replace(/^"|"$/g, ""));
      continue;
    }
    const kvMatch = line.match(/^([a-zA-Z_][\w]*?):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        currentList = [];
        fm[currentKey] = currentList;
      } else {
        fm[currentKey] = value.replace(/^"|"$/g, "");
        currentList = null;
      }
    }
  }
  return fm;
}

function extractWikilinkUid(value: string): string | null {
  const match = value.match(/\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1].toLowerCase() : null;
}

function scanGroundingTypeInstances(): VaultAsset[] {
  if (!fs.existsSync(SUBMODULE_PATH)) {
    throw new Error(
      `exoas-exocmd submodule not found at ${SUBMODULE_PATH}. Run \`git submodule update --init packages/exoas-exocmd\``,
    );
  }
  const instances: VaultAsset[] = [];
  for (const entry of fs.readdirSync(SUBMODULE_PATH, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = path.join(SUBMODULE_PATH, entry.name);
    const content = fs.readFileSync(fullPath, "utf8");
    const fm = parseFrontmatter(content);
    const instanceClass = fm["exo__Instance_class"];
    const refs: string[] = Array.isArray(instanceClass)
      ? (instanceClass as string[])
      : typeof instanceClass === "string"
        ? [instanceClass]
        : [];
    const classUids = refs
      .map(extractWikilinkUid)
      .filter((uid): uid is string => uid !== null);
    if (classUids.includes(GROUNDING_TYPE_CLASS_UID)) {
      instances.push({
        uid: (fm["exo__Asset_uid"] as string | undefined) ?? "",
        label: (fm["exo__Asset_label"] as string | undefined) ?? "",
        instanceClassRefs: refs,
      });
    }
  }
  return instances;
}

describe("RFC 9d20c91f Phase 2 — vault-fixture parity (exoas-exocmd submodule)", () => {
  let instances: VaultAsset[];

  beforeAll(() => {
    instances = scanGroundingTypeInstances();
  });

  it("contains exactly 9 GroundingType instances", () => {
    expect(instances).toHaveLength(9);
  });

  it("instance UIDs match TS GROUNDING_TYPE_UIDS exactly", () => {
    const vaultUids = instances.map((i) => i.uid).sort();
    const tsUids = Object.values(GROUNDING_TYPE_UIDS).sort();
    expect(vaultUids).toEqual(tsUids);
  });

  it("each instance label follows naming convention X", () => {
    const labelByUid = new Map(instances.map((i) => [i.uid, i.label]));
    const entries = Object.entries(GROUNDING_TYPE_UIDS) as Array<
      [GroundingType, string]
    >;
    for (const [enumValue, expectedUid] of entries) {
      const actualLabel = labelByUid.get(expectedUid);
      const expectedLabel = ENUM_TO_EXPECTED_LABEL[enumValue];
      expect({ enumValue, uid: expectedUid, actualLabel }).toEqual({
        enumValue,
        uid: expectedUid,
        actualLabel: expectedLabel,
      });
    }
  });
});
