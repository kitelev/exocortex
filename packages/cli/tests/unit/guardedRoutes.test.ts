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
  IMMUTABLE_PROPERTIES,
  renderGuardedRoute,
  renderGuardRefusal,
} from "../../src/commands/propertyMutationShared";
import { classifyMessage } from "../../src/utils/ErrorHandler";
import { ExitCodes } from "../../src/utils/ExitCodes";

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
   * The guard sentence is ALSO the input of the exit-code classifier, which picks
   * the process exit code by SUBSTRING. A word chosen for readability silently
   * re-routes the code a scripted consumer branches on.
   *
   * Measured: an early draft of the timestamp notes read "as a transition side
   * effect" → `message.includes("transition")` → exit 6 (INVALID_STATE_TRANSITION)
   * instead of 1 (GENERAL_ERROR). The existing `set-property` tests caught it only
   * as a bare `expect(exit).toContain(1)` failure with no hint at the cause.
   *
   * ⛔ This axis asserts on the FULL rendered error, not on the `GUARDED_PROPERTIES`
   * fragment: the call sites wrap the fragment in ~25 more words, and those are
   * classified too. An earlier version of this axis read only the fragment and was
   * therefore blind to a trigger word introduced in the wrapper — demonstrated by
   * review, which injected "Invalid" into the wrapper and left this file green
   * while the integration suite went red with the very `toContain(1)` failure this
   * axis exists to diagnose.
   *
   * ⛤ And it asserts BEHAVIOUR (`classifyMessage`), not a copied trigger list: a
   * hand-maintained list drifts the moment a branch is added to the classifier.
   */
  /** The SAME renderer both primitives use — no copy to drift. */
  const SURFACES: ReadonlyArray<readonly [string, string]> = [
    ["set", "set-property"],
    ["remove", "remove-property"],
  ];

  it("every guard refusal classifies as GENERAL_ERROR, on the FULL rendered message @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const misrouted: string[] = [];
    for (const [property, fragment] of Object.entries(GUARDED_PROPERTIES)) {
      for (const [verb, command] of SURFACES) {
        const message = renderGuardRefusal(verb, command, property, fragment);
        const { exitCode } = classifyMessage(message);
        if (exitCode !== ExitCodes.GENERAL_ERROR) {
          misrouted.push(`${property}: exit ${exitCode} — "${message}"`);
        }
      }
    }
    expect(misrouted).toEqual([]);
  });

  it("the classifier axis is not vacuous — a trigger word IS detected @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    // Negative control: if this ever stops failing, the axis above proves nothing.
    const poisoned = renderGuardRefusal(
      "set",
      "set-property",
      "ems__Effort_startTimestamp",
      "apply start-effort <path>  (cleared as a transition side effect)",
    );
    expect(classifyMessage(poisoned).exitCode).not.toBe(
      ExitCodes.GENERAL_ERROR,
    );
  });

  /**
   * MEDIUM-A from review: the `resolutionTimestamp` fix (adding `re-open`) was
   * correct but UNPROTECTED — dropping it again left every axis green, because
   * the integration assertion is a loose `/mark-done/` that both forms satisfy.
   *
   * ⛔ The obvious guard — "these three routes must list these commands" — would be
   * CIRCULAR: asserting route content against a copy of route content. This axis
   * instead checks the route against ITSELF for internal consistency: a `note` that
   * claims something CLEARS the property is a claim about the `commands` array, so
   * the two must agree. Removing `re-open` while leaving the note reddens this;
   * removing both is a deliberate semantic edit, not a silent regression.
   */
  it("a route whose note claims a command CLEARS the property lists more than one command @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const inconsistent: string[] = [];
    for (const [property, route] of Object.entries(GUARDED_ROUTES)) {
      const claimsClearing = /clears? it/i.test(route.note ?? "");
      if (claimsClearing && route.commands.length < 2) {
        inconsistent.push(
          `${property}: note claims a clearing command but lists only [${route.commands.join(", ")}]`,
        );
      }
    }
    expect(inconsistent).toEqual([]);
  });

  /**
   * The fact timestamps are SET as a status-transition side effect and CLEARED by
   * the reverse transition (`ems__WorkflowTransition_postActions`). Measured on the
   * live graph: `← Doing` (re-open) carries BOTH `2c53ea68` "Delete end timestamp"
   * and `d08d588c` "Delete resolution timestamp", in the Task AND Project workflows.
   *
   * So a route for one of them that offers only a SETTING command sends the user to
   * a command that writes the value they are removing — the defect this file exists
   * to prevent, one notch softer.
   */
  it("every fact-timestamp route offers a way to CLEAR, not only to set @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const FACT_TIMESTAMPS = [
      "ems__Effort_startTimestamp",
      "ems__Effort_endTimestamp",
      "ems__Effort_resolutionTimestamp",
    ];
    const setOnly: string[] = [];
    for (const property of FACT_TIMESTAMPS) {
      const route = GUARDED_ROUTES[property];
      expect(route).toBeDefined(); // canary: a renamed property must not silently skip
      if (!/clears? it/i.test(route.note ?? "")) {
        setOnly.push(
          `${property}: no note describing how the value is cleared`,
        );
      }
    }
    expect(setOnly).toEqual([]);
  });

  /**
   * `classifyMessage` mixes two operands ON PURPOSE: `transition` / `transaction` /
   * `concurrent` / `modified` match the LOWERCASED message, while `Invalid` /
   * `Not a` / `ENOENT` / `EACCES` match the RAW one. Extracting the function
   * preserved that exactly — but review showed nothing ENFORCED it: lowercasing the
   * `Invalid` branch left the whole 359-test error suite green, and a user-supplied
   * property name containing "invalid" would then newly route to exit 2.
   *
   * Pre-existing, and more exposed now that the function is exported — so pin it.
   */
  it("classifyMessage keeps the case-SENSITIVE branches case-sensitive @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    // Capitalised → the Invalid branch.
    expect(classifyMessage("Invalid file path").exitCode).toBe(
      ExitCodes.INVALID_ARGUMENTS,
    );
    // Lower-cased → must NOT hit it (a property name is user-supplied text).
    expect(
      classifyMessage('Refusing to set "x__invalid_field" — no.').exitCode,
    ).toBe(ExitCodes.GENERAL_ERROR);
    // The lowercase-matched family behaves the opposite way, by design.
    expect(classifyMessage("TRANSITION not allowed").exitCode).toBe(
      ExitCodes.INVALID_STATE_TRANSITION,
    );
  });

  /**
   * `IMMUTABLE_PROPERTIES` refusals share the classifier exposure but take a
   * different sentence, so the axis above does not reach them (review LOW).
   */
  it("immutable-property refusals also classify as GENERAL_ERROR @req:3800d995-2bae-401f-a23a-dac914505e9d", () => {
    const misrouted: string[] = [];
    for (const [property, reason] of Object.entries(IMMUTABLE_PROPERTIES)) {
      for (const verb of ["set", "remove"]) {
        const message = `Refusing to ${verb} "${property}" — ${reason}.`;
        if (classifyMessage(message).exitCode !== ExitCodes.GENERAL_ERROR) {
          misrouted.push(`${property}: "${message}"`);
        }
      }
    }
    expect(misrouted).toEqual([]);
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
