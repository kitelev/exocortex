/**
 * Guard-message ⇄ routing-table parity (req 3800d995, bug 8f35fec0).
 *
 * The `set-property` / `remove-property` refusal message is a CLAIM about which
 * dedicated commands exist. Req `3800d995` promises an "error that NAMES the
 * dedicated command" — so a name that resolves nowhere makes that promise false
 * while every existing test stays green (they only assert the substring
 * "dedicated guarded command" or a loose `/set-criticality/`).
 *
 * That is exactly what happened: three of the hand-authored names never existed
 * in any live registry —
 *   `remove-start-timestamp`, `remove-end-timestamp`, `archive-completed`
 * — so the guard refused the mutation and then pointed the user at a command
 * that `apply` cannot resolve. `remove-start-timestamp` exists ONLY as an e2e
 * test fixture, which is where the false name came from.
 *
 * ⛔ WHY THESE AXES AND NOT "every cliName resolves in the registry": the
 * registry is SPLIT across assetspaces and exocortex pins only `exoas-exocmd`
 * (`archive`, `set-criticality-*`, `set-planned-*` live in the UNPINNED
 * `exoas-public`), so a CI-side existence check would cover a MINORITY and need
 * an exempt-list for the rest. Existence needs the live vault — which the
 * commands DO have at refusal time; that is a separate follow-up. What IS
 * checkable here is that the sentence cannot name anything the machine-readable
 * array does not list.
 */
import {
  GUARDED_PROPERTIES,
  GUARDED_ROUTES,
  renderGuardedRoute,
} from "../../src/commands/propertyMutationShared";

/**
 * Names that were shipped in the message but exist in NO live registry.
 * Verified 2026-08-19 against 76 `exocmd__Command_cliName` across the mounted
 * assetspaces of vault-my. Kept as a regression guard: each came from prose,
 * and `remove-start-timestamp` specifically leaked in from an e2e fixture.
 */
const PHANTOM_NAMES = [
  "remove-start-timestamp",
  "remove-end-timestamp",
  "archive-completed",
];

describe(`guard message is DERIVED from the routing table (bug 8f35fec0)`, () => {
  it("the routing table is non-empty (canary: an empty table makes every axis below vacuous) @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    expect(Object.keys(GUARDED_ROUTES).length).toBeGreaterThan(0);
    expect(Object.keys(GUARDED_PROPERTIES)).toEqual(
      Object.keys(GUARDED_ROUTES),
    );
  });

  it("every rendered message names EXACTLY the cliNames its route lists @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const mismatches: string[] = [];
    for (const [property, route] of Object.entries(GUARDED_ROUTES)) {
      const message = GUARDED_PROPERTIES[property];
      // The invocation head is `apply <a|b|c> <path>` — parse it back out, so a
      // name added to the sentence by hand (bypassing the array) is detectable.
      const head = message.match(/^apply ([^ ]+) <path>/);
      if (!head) {
        mismatches.push(
          `${property}: message does not start with "apply … <path>" (${message})`,
        );
        continue;
      }
      const named = head[1].split("|");
      if (named.join("|") !== route.commands.join("|")) {
        mismatches.push(
          `${property}: message names [${named.join(", ")}] but the route lists [${route.commands.join(", ")}]`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("no route recommends a command that exists in NO live registry @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const offenders: string[] = [];
    for (const [property, route] of Object.entries(GUARDED_ROUTES)) {
      for (const name of route.commands) {
        if (PHANTOM_NAMES.includes(name)) {
          offenders.push(`${property} → ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no phantom name survives anywhere in a rendered message (incl. prose/notes) @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const offenders: string[] = [];
    for (const [property, message] of Object.entries(GUARDED_PROPERTIES)) {
      for (const phantom of PHANTOM_NAMES) {
        if (message.includes(phantom))
          offenders.push(`${property}: ${phantom}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every cliName is a well-formed, non-duplicated kebab-case token @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const malformed: string[] = [];
    for (const [property, route] of Object.entries(GUARDED_ROUTES)) {
      expect(route.commands.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const name of route.commands) {
        if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
          malformed.push(`${property} → "${name}" is not kebab-case`);
        }
        if (seen.has(name))
          malformed.push(`${property} → "${name}" duplicated`);
        seen.add(name);
      }
    }
    expect(malformed).toEqual([]);
  });

  /**
   * `ErrorHandler.classifyError` picks the process EXIT CODE by scanning the
   * error message for substrings. The guard message is part of that error, so a
   * word chosen for readability silently re-routes the exit code a scripted
   * consumer branches on.
   *
   * Measured: an early draft of the timestamp notes read "as a transition side
   * effect" → `message.includes("transition")` → exit 6
   * (INVALID_STATE_TRANSITION) instead of 1 (GENERAL_ERROR), and the existing
   * `set-property` guard tests caught it only as a bare `expect(exit).toContain(1)`
   * failure with no hint at the cause.
   *
   * Kept in sync with ErrorHandler.classifyError (packages/cli/src/utils/).
   */
  const CLASSIFIER_TRIGGERS = [
    "transition",
    "transaction",
    "concurrent",
    "modified",
    "not found",
    "enoent",
    "eacces",
    "permission denied",
    "invalid",
    "outside vault",
    "not a",
  ];

  it("guard messages do not collide with the exit-code classifier @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const collisions: string[] = [];
    for (const [property, message] of Object.entries(GUARDED_PROPERTIES)) {
      const lowered = message.toLowerCase();
      for (const trigger of CLASSIFIER_TRIGGERS) {
        if (lowered.includes(trigger)) {
          collisions.push(`${property}: "${trigger}" in "${message}"`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("renderGuardedRoute places argSuffix after <path> and note in parentheses @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    expect(renderGuardedRoute({ commands: ["a", "b"] })).toBe(
      "apply a|b <path>",
    );
    expect(renderGuardedRoute({ commands: ["a"], argSuffix: "--x 1" })).toBe(
      "apply a <path> --x 1",
    );
    expect(renderGuardedRoute({ commands: ["a"], note: "why" })).toBe(
      "apply a <path>  (why)",
    );
  });
});
