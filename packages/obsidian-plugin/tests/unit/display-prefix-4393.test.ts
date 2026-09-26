import { App } from "obsidian";
import {
  DynamicAssetCreationModal,
  DynamicAssetCreationResult,
} from "../../src/presentation/modals/DynamicAssetCreationModal";
import { getDefaultColumnHeader } from "../../src/domain/layout/LayoutColumn";
import {
  humanizePropertyName,
  humanizePropertyValue,
} from "../../src/presentation/components/AssetRelationsTable";

/**
 * Issue #4393 — four DISPLAY-only sites still stripped the namespace prefix with
 * a narrow `/^[a-z]+__/`, so a camelCase (`aiKnow`), hyphenated (`tbank-nessy`)
 * or digit-bearing (`exo003`) namespace kept its prefix in the label. #4353
 * moved eight consumers of the prefix grammar to `Namespace.fromPropertyKey`;
 * these four are the display half it left out.
 *
 * One axis per file, each over all three prefix kinds plus a classic-prefix
 * control. The revert mutants put the narrow regex back at one site each
 * (`display-prefix-4393.*.spec.json`).
 */

/** Each non-`[a-z]+` prefix kind the shared grammar accepts. */
const PREFIXES = ["aiKnow", "tbank-nessy", "exo003"] as const;

describe("display sites read the shared prefix grammar (issue #4393)", () => {
  it("[A1] the creation modal's title drops any well-formed prefix", () => {
    const titles = [
      ["aiKnow__Memory", "Create Memory"],
      ["tbank-nessy__OrgUnit", "Create Org Unit"],
      ["exo003__ValidatorRule", "Create Validator Rule"],
      ["ems__Task", "Create Task"],
    ];
    for (const [className, expected] of titles) {
      const onSubmit = jest.fn<void, [DynamicAssetCreationResult]>();
      const modal = new DynamicAssetCreationModal({} as App, className, onSubmit);
      modal.close = jest.fn();
      modal.onOpen();
      expect({
        className,
        title: modal.contentEl.querySelector("h2")?.textContent,
      }).toEqual({ className, title: expected });
    }
  });

  it("[A2] a Layout column's default header drops any well-formed prefix", () => {
    for (const prefix of [...PREFIXES, "ems"]) {
      expect({
        prefix,
        header: getDefaultColumnHeader(`[[${prefix}__Memory_startTimestamp]]`),
      }).toEqual({ prefix, header: "Start Timestamp" });
    }
  });

  it("[A3] a relations-table property NAME drops any well-formed prefix", () => {
    const names = [
      ["aiKnow__Memory_source", "Memory Source"],
      ["tbank-nessy__OrgUnit_code", "OrgUnit Code"],
      ["exo003__Rule_body", "Rule Body"],
      ["exo__Instance_class", "Instance Class"],
    ];
    for (const [raw, expected] of names) {
      expect({ raw, name: humanizePropertyName(raw) }).toEqual({
        raw,
        name: expected,
      });
    }
  });

  it("[A4] a plain prefixed VALUE is recognised as `prefix__Local` for any well-formed prefix", () => {
    const values = [
      ["aiKnow__Memory", "Memory"],
      ["tbank-nessy__OrgUnit", "OrgUnit"],
      ["exo003__Rule", "Rule"],
      ["ems__Project", "Project"],
      // control: free text is not a prefixed value and passes through
      ["plain free text", "plain free text"],
    ];
    for (const [raw, expected] of values) {
      expect({ raw, value: humanizePropertyValue(raw) }).toEqual({
        raw,
        value: expected,
      });
    }
  });
});
