import { describe, it, expect } from "@jest/globals";
import { extractReqUids } from "../e2e/eka-gui/req-evidence-reporter";

// al-gui-ci-runner — the eka-gui req-evidence reporter binds an eka-gui scenario
// to a requirement by a `@req:<uid>` token in the test title (the AUTOMATED
// ui-acceptance sub-mode). This pins the title→uid extraction the manifest +
// the `requirements audit` checker both rely on.
//
// NB: the test inputs build the tag prefix from parts (`TAG`) so this file does
// NOT contain a literal contiguous `@req:<uuid>` — otherwise `requirements audit`
// (`--tests .`) would scan THIS file and treat the fixture uids as dangling tags.
const TAG = "@" + "req:";

describe("eka-gui req-evidence reporter — extractReqUids", () => {
  it("extracts a @req:<uid> token from a scenario title (lower-cased)", () => {
    expect(
      extractReqUids(
        `scenario 9 — Create Instance (flagship) ${TAG}ACE6DF4F-B2C7-4DCB-AFB6-BDA8B20E7DA0`,
      ),
    ).toEqual(["ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0"]);
  });

  it("extracts multiple @req tags from one title", () => {
    expect(
      extractReqUids(
        `${TAG}11111111-1111-4111-8111-111111111111 and ${TAG}22222222-2222-4222-8222-222222222222`,
      ),
    ).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("returns [] for a title with no @req tag", () => {
    expect(extractReqUids("scenario 2 — Create Task on ems__Area")).toEqual([]);
  });

  it("ignores a malformed (non-UUID) @req token", () => {
    expect(extractReqUids(`${TAG}not-a-uuid`)).toEqual([]);
  });
});
