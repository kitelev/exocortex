import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_SETTINGS,
  type ExocortexSettings,
} from "../../../../src/domain/settings/ExocortexSettings";
import {
  NON_HOMOICONIZABLE_FIELDS,
  SETTING_KEY_CLASS_UID,
  VAULT_SETTINGS_REGISTRY,
  descriptorByField,
  descriptorByKeyRef,
} from "../../../../src/domain/settings/VaultSettingsRegistry";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("VaultSettingsRegistry", () => {
  it("contains exactly 24 descriptors (20 boolean / 2 string / 2 stringList)", () => {
    expect(VAULT_SETTINGS_REGISTRY).toHaveLength(24);
    const byType = { boolean: 0, string: 0, stringList: 0 };
    for (const d of VAULT_SETTINGS_REGISTRY) byType[d.datatype]++;
    expect(byType).toEqual({ boolean: 20, string: 2, stringList: 2 });
  });

  it("has unique fields, keyUids and settingUids (all UUID-shaped)", () => {
    const fields = VAULT_SETTINGS_REGISTRY.map((d) => d.field);
    const keyUids = VAULT_SETTINGS_REGISTRY.map((d) => d.keyUid);
    const settingUids = VAULT_SETTINGS_REGISTRY.map((d) => d.settingUid);
    expect(new Set(fields).size).toBe(fields.length);
    expect(new Set(keyUids).size).toBe(keyUids.length);
    expect(new Set(settingUids).size).toBe(settingUids.length);
    for (const uid of [...keyUids, ...settingUids]) {
      expect(uid).toMatch(UUID_RE);
    }
    // Setting-instance UIDs must not collide with SettingKey UIDs.
    for (const uid of settingUids) {
      expect(keyUids).not.toContain(uid);
    }
  });

  it("0-leakage: allowlist and denylist are disjoint; denylist covers per-device + structural fields", () => {
    const fields = new Set(VAULT_SETTINGS_REGISTRY.map((d) => d.field));
    for (const denied of NON_HOMOICONIZABLE_FIELDS) {
      expect(fields.has(denied)).toBe(false);
    }
    for (const required of [
      "activeProfileUid",
      "_switchInProgress",
      "pat",
      "displayNameSettings",
      "logChannels",
    ]) {
      expect(NON_HOMOICONIZABLE_FIELDS).toContain(required);
    }
  });

  it("covers every ExocortexSettings field except the denylisted ones (anti-drift, onto-RFC R3)", () => {
    // DEFAULT_SETTINGS enumerates every concrete field of the interface
    // (the index signature admits more, but defaults define the schema).
    const allFields = Object.keys(DEFAULT_SETTINGS);
    const registryFields = new Set(VAULT_SETTINGS_REGISTRY.map((d) => d.field));
    const denySet = new Set(NON_HOMOICONIZABLE_FIELDS);
    for (const field of allFields) {
      const covered = registryFields.has(field) || denySet.has(field);
      if (!covered) {
        throw new Error(
          `ExocortexSettings field "${field}" is neither in ` +
            "VAULT_SETTINGS_REGISTRY nor in NON_HOMOICONIZABLE_FIELDS — " +
            "a new setting was added without deciding its homoiconization " +
            "(add a SettingKey individual to exoas-exo + a registry entry, " +
            "or denylist it explicitly; onto-RFC 981b6070 R3)",
        );
      }
    }
  });

  it("registry fields exist in DEFAULT_SETTINGS (no phantom fields)", () => {
    for (const d of VAULT_SETTINGS_REGISTRY) {
      expect(
        Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, d.field),
      ).toBe(true);
    }
  });

  it("datatype matches the DEFAULT_SETTINGS value shape", () => {
    for (const d of VAULT_SETTINGS_REGISTRY) {
      const v = DEFAULT_SETTINGS[d.field as keyof ExocortexSettings];
      if (d.datatype === "boolean") expect(typeof v).toBe("boolean");
      if (d.datatype === "string") expect(typeof v).toBe("string");
      if (d.datatype === "stringList") expect(Array.isArray(v)).toBe(true);
    }
  });

  describe("descriptorByKeyRef", () => {
    const show = VAULT_SETTINGS_REGISTRY.find(
      (d) => d.field === "showArchivedAssets",
    )!;

    it("resolves UID-form wikilinks with and without alias/anchor", () => {
      expect(descriptorByKeyRef(`[[${show.keyUid}]]`)).toBe(show);
      expect(descriptorByKeyRef(`[[${show.keyUid}|любой алиас]]`)).toBe(show);
      expect(descriptorByKeyRef(`[[${show.keyUid}#section]]`)).toBe(show);
    });

    it("resolves label-form wikilinks (hand-authored assets)", () => {
      expect(descriptorByKeyRef(`[[${show.keyLabel}]]`)).toBe(show);
    });

    it("returns undefined for unknown keys and non-strings", () => {
      expect(descriptorByKeyRef("[[deadbeef-0000-0000-0000-000000000000]]")).toBeUndefined();
      expect(descriptorByKeyRef(42)).toBeUndefined();
      expect(descriptorByKeyRef(undefined)).toBeUndefined();
      expect(descriptorByKeyRef(["[[x]]"])).toBeUndefined();
    });
  });

  it("descriptorByField round-trips", () => {
    for (const d of VAULT_SETTINGS_REGISTRY) {
      expect(descriptorByField(d.field)).toBe(d);
    }
    expect(descriptorByField("activeProfileUid")).toBeUndefined();
  });
});

describe("registry ↔ graph parity (exoas-exo submodule, onto-RFC R3)", () => {
  // CI checks out submodules recursively for the unit-test jobs; a missing
  // or empty submodule must FAIL (not skip) — a silent skip would let the
  // registry drift from the graph unnoticed.
  const exoDir = path.resolve(
    __dirname,
    "../../../../..",
    "exoas-exo",
    "exo",
  );

  interface GraphKey {
    uid: string;
    label: string;
    datatype: string;
  }

  function readGraphSettingKeys(): GraphKey[] {
    const out: GraphKey[] = [];
    for (const fn of fs.readdirSync(exoDir)) {
      if (!fn.endsWith(".md")) continue;
      const text = fs.readFileSync(path.join(exoDir, fn), "utf8");
      // SettingKey individuals: typed by the exo__SettingKey class AND
      // carrying a datatype declaration (the class/property TBox files
      // mention the class UID too, but have no _datatype of their own
      // in instance position — they re both filtered by requiring the
      // Instance_class line).
      if (
        !text.includes(
          `exo__Instance_class:\n  - "[[${SETTING_KEY_CLASS_UID}]]"`,
        )
      ) {
        continue;
      }
      const dt = /exo__SettingKey_datatype: (\S+)/.exec(text);
      if (!dt) continue;
      const uid = /exo__Asset_uid: (\S+)/.exec(text);
      const label = /exo__Asset_label: (\S+)/.exec(text);
      if (!uid || !label) continue;
      out.push({ uid: uid[1], label: label[1], datatype: dt[1] });
    }
    return out;
  }

  it("submodule TBox is present (packages/exoas-exo @ ≥6c0797e)", () => {
    expect(fs.existsSync(exoDir)).toBe(true);
    expect(fs.readdirSync(exoDir).length).toBeGreaterThan(0);
  });

  it("every registry entry matches a graph SettingKey individual 1:1 (uid + label + datatype)", () => {
    const graph = readGraphSettingKeys();
    expect(graph).toHaveLength(VAULT_SETTINGS_REGISTRY.length);

    const graphByUid = new Map(graph.map((g) => [g.uid, g]));
    for (const d of VAULT_SETTINGS_REGISTRY) {
      const g = graphByUid.get(d.keyUid);
      if (!g) {
        throw new Error(
          `registry field "${d.field}" references keyUid ${d.keyUid} ` +
            "that has no SettingKey individual in packages/exoas-exo/exo",
        );
      }
      expect(g.label).toBe(d.keyLabel);
      expect(g.datatype).toBe(d.datatype);
    }
  });

  it("no graph SettingKey individual is missing from the registry (reverse direction)", () => {
    const graph = readGraphSettingKeys();
    const registryUids = new Set(VAULT_SETTINGS_REGISTRY.map((d) => d.keyUid));
    for (const g of graph) {
      if (!registryUids.has(g.uid)) {
        throw new Error(
          `graph SettingKey ${g.label} (${g.uid}) has no registry entry — ` +
            "D1 added a key the loader does not bind (onto-RFC R3 drift)",
        );
      }
    }
  });
});
