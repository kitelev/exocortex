/**
 * req f5b79260-f87c-4e73-8a34-19da341c7ec9 (ticket 316dd2be, onto-RFC 4a8d887a)
 * — the creation gate's semantics, judged through the REAL session (loader +
 * policy parser + evaluator) over a fixture vault written as markdown in the
 * shape the vault holds: `"[[uid]]"` strings, multi-values as YAML lists,
 * classes linked by `exo__Class_superClass`, and a rule asset in the form the
 * onto-RFC's Appendix B creates.
 *
 * Every axis name (G<n>) is the first token of its title — the machine key the
 * mutant driver reads (`creationGate.*.spec.json`).
 */
import * as fs from "fs";
import * as path from "path";
import {
  CreationGateSession,
  parseCandidateFrontmatter,
  withCreationGate,
  type CreationGatePolicySource,
  type CreationGateVerdict,
} from "../../../../src/services/creationGate";

const REQ = "@req:f5b79260-f87c-4e73-8a34-19da341c7ec9";

// ── TBox (real UIDs and labels of vault-exodev) ───────────────────────────
const C = {
  effort: "086f71fa-dd30-4284-90cf-e609f2a6c461",
  task: "1b20a8f0-d745-4e93-91db-4531b3df120e",
  project: "7db5eeff-718a-49b0-8d2b-39b084a356e3",
  bug: "f25e8c45-7cc5-48a0-b814-30d1ba867525",
  meeting: "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca",
  effortPrototype: "a5c6d3aa-a47a-4f5f-99e6-4d932b0a2d49",
  taskPrototype: "df7e579d-02d4-4f3a-971f-3d1d785b689b",
  emsIdea: "6c0dab0c-c15f-4d08-b522-2b32d874755e",
  flowIdea: "003f976a-a628-45f6-8c95-f2c5527f4ab6",
  concept: "c0c0c0c0-0000-4000-8000-000000000001",
  gate: "d4cde00a-c211-437b-9ba1-71223a15551b",
};
const P = {
  guardedClass: "6c16eb5b-28da-4182-a692-6450731dcf7e",
  excludedClass: "30340ea7-036c-4050-bc8d-84b14830498a",
  exemptClass: "5a9aff21-f1da-4e7b-a7b7-0b0c98000dde",
  exemptEvidence: "3cee39fa-9aee-4cf8-9015-0e954465acd6",
  chainProperty: "42f9721a-844a-495b-ad68-3c41b6dbc7dc",
  anchorClass: "b7b2749e-bfeb-48a4-9698-25cc981a9e86",
  directionProperty: "f827a1ad-6936-4da1-b33a-388b59e81642",
  statusProperty: "9f817e90-6353-4214-ac9a-ec0053be4980",
  allowedStatus: "16035576-ed4a-42d4-bddf-27edd50d5f98",
  effortParent: "6528ecfa-a03d-47f1-a819-9ba5fea8fc28",
  relates: "e3a71d16-14b3-4aff-adf7-c9eccd1077b4",
  rfcStatus: "20a40d7f-fdd0-4707-a550-88ad793b507f",
};
const ST = {
  approved: "985dca1d-6bf7-4f30-98f6-204ffcf650ff",
  deferred: "dddd0000-0000-4000-8000-00000000def0",
  proposed: "9119367e-5744-4e20-89e0-119736602579",
};
const EVIDENCE =
  "github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:pull|issues|releases)/|(?:^|[^A-Za-z0-9_А-Яа-яЁё])(?:PR|issue|релиз)\\s*#?[0-9]+|(?:^|[^A-Za-z0-9_])v[0-9]+\\.[0-9]+\\.[0-9]+(?![0-9])";

// ── ABox ──────────────────────────────────────────────────────────────────
const RFC_A = "aaaa0000-0000-4000-8000-0000000000a1";
const RFC_D = "aaaa0000-0000-4000-8000-0000000000d1";
const RFC_P = "aaaa0000-0000-4000-8000-0000000000b1";
const NOTE = "aaaa0000-0000-4000-8000-0000000000c1";
const PRJ_OK = "bbbb0000-0000-4000-8000-000000000001";
const PRJ_ALP = "bbbb0000-0000-4000-8000-000000000002";
const PRJ_MULTI = "bbbb0000-0000-4000-8000-000000000003";
const TASK_OK = "bbbb0000-0000-4000-8000-000000000004";
const CYC_1 = "bbbb0000-0000-4000-8000-0000000000c1";
const CYC_2 = "bbbb0000-0000-4000-8000-0000000000c2";
const RULE = "eeee0000-0000-4000-8000-000000000001";
const RULE_2 = "eeee0000-0000-4000-8000-000000000002";
const NEW = "ffff0000-0000-4000-8000-000000000001";

type Fm = Record<string, string | string[]>;

/** Markdown in vault shape: scalars as written, lists as `  - item`. */
function md(frontmatter: Fm, body = ""): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", body);
  return lines.join("\n");
}

const link = (uid: string): string => `"[[${uid}]]"`;

function classAsset(uid: string, label: string, supers: string[] = []): Fm {
  const fm: Fm = {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [link("8619c4fc-64f1-4869-b17e-e34186cacca9")],
  };
  if (supers.length > 0) fm.exo__Class_superClass = supers.map(link);
  return fm;
}

function propertyAsset(uid: string, label: string, aliases: string[] = [label]): Fm {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    aliases,
    exo__Instance_class: [link("9a1cf31c-9d41-4ef3-9023-584a8d087d16")],
  };
}

function effort(uid: string, label: string, classes: string[], extra: Fm = {}): Fm {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: classes.map((c) => (c.startsWith('"') ? c : link(c))),
    ...extra,
  };
}

/** Appendix B of the ticket, as `create-batch` writes it. */
function ruleAsset(overrides: Partial<Record<string, string | string[] | null>> = {}, uid = RULE): Fm {
  const base: Record<string, string | string[] | null> = {
    exo__Asset_uid: uid,
    exo__Asset_label: '"Гейт Double Diamond: новый эффорт только под одобренное направление"',
    exo__Instance_class: [link(C.gate)],
    exo__Asset_isDefinedBy: link("32d2374c-1bef-4b64-ad23-e26b53b52df8"),
    exocmd__CreationGate_guardedClass: [link(C.task), link(C.project)],
    exocmd__CreationGate_excludedClass: [link(C.effortPrototype)],
    exocmd__CreationGate_exemptClass: [link(C.bug)],
    exocmd__CreationGate_exemptEvidence: `'${EVIDENCE}'`,
    exocmd__CreationGate_chainProperty: link(P.effortParent),
    exocmd__CreationGate_anchorClass: [link(C.project)],
    exocmd__CreationGate_directionProperty: link(P.relates),
    exocmd__CreationGate_statusProperty: link(P.rfcStatus),
    exocmd__CreationGate_allowedStatus: [link(ST.approved)],
    exo__Asset_description:
      '"Новая работа начинается с идеи; задача — под проект с одобренным направлением; дефект отгруженного — баг со ссылкой на PR, issue или релиз."',
  };
  const merged: Fm = {};
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return merged;
}

class FixtureVault {
  readonly files = new Map<string, string>();

  put(path: string, frontmatter: Fm, body = ""): this {
    this.files.set(path, md(frontmatter, body));
    return this;
  }

  remove(path: string): this {
    this.files.delete(path);
    return this;
  }

  readonly frontmatterByRef = async (
    ref: string,
  ): Promise<Record<string, unknown> | null> => {
    const wanted = ref.trim().toLowerCase();
    for (const [path, text] of this.files) {
      const fm = parseCandidateFrontmatter(text);
      const names = [
        fm.exo__Asset_uid,
        fm.exo__Asset_label,
        ...(Array.isArray(fm.aliases) ? fm.aliases : [fm.aliases]),
        path.replace(/^.*\//, "").replace(/\.md$/, ""),
      ];
      if (names.some((n) => typeof n === "string" && n.trim().toLowerCase() === wanted)) {
        return fm;
      }
    }
    return null;
  };

  readonly source: CreationGatePolicySource = {
    candidates: async () =>
      [...this.files].map(([path, text]) => ({
        path,
        frontmatter: parseCandidateFrontmatter(text),
      })),
  };

  async judge(frontmatter: Fm, body = "", path = `inbox/${NEW}.md`): Promise<CreationGateVerdict> {
    const session = new CreationGateSession({
      source: this.source,
      frontmatterByRef: this.frontmatterByRef,
    });
    return session.judge(path, md(frontmatter, body));
  }
}

/** The vault every axis starts from: TBox + ABox + the first rule. */
function baseVault(withRule = true): FixtureVault {
  const v = new FixtureVault()
    .put(`ems/${C.effort}.md`, classAsset(C.effort, "ems__Effort"))
    .put(`ems/${C.task}.md`, classAsset(C.task, "ems__Task", [C.effort]))
    .put(`ems/${C.project}.md`, classAsset(C.project, "ems__Project", [C.effort]))
    .put(`ems/${C.bug}.md`, classAsset(C.bug, "ems__Bug", [C.project]))
    .put(`ems/${C.meeting}.md`, classAsset(C.meeting, "ems__Meeting", [C.task]))
    .put(`ems/${C.effortPrototype}.md`, classAsset(C.effortPrototype, "ems__EffortPrototype"))
    .put(
      `ems/${C.taskPrototype}.md`,
      classAsset(C.taskPrototype, "ems__TaskPrototype", [C.effortPrototype, C.task]),
    )
    .put(`ems/${C.emsIdea}.md`, classAsset(C.emsIdea, "ems__Idea", [C.effort]))
    .put(`flow/${C.flowIdea}.md`, classAsset(C.flowIdea, "flow__Idea"))
    .put(`concept/${C.concept}.md`, classAsset(C.concept, "concept__Concept"))
    .put(`exocmd/${C.gate}.md`, classAsset(C.gate, "exocmd__CreationGate"))
    .put(`ems/${P.effortParent}.md`, propertyAsset(P.effortParent, "ems__Effort_parent"))
    .put(`exo/${P.relates}.md`, propertyAsset(P.relates, "exo__Asset_relates"))
    .put(`exodev/${P.rfcStatus}.md`, propertyAsset(P.rfcStatus, "exodev__RFC_status"))
    .put(`exodev/${ST.approved}.md`, { exo__Asset_uid: ST.approved, exo__Asset_label: "exodev__RFCStatusApproved" })
    .put(`exodev/${ST.deferred}.md`, { exo__Asset_uid: ST.deferred, exo__Asset_label: "exodev__RFCStatusDeferred" })
    .put(`exodev/${ST.proposed}.md`, { exo__Asset_uid: ST.proposed, exo__Asset_label: "exodev__RFCStatusProposed" })
    .put(`inbox/${RFC_A}.md`, { exo__Asset_uid: RFC_A, exo__Asset_label: '"RFC одобренный"', exodev__RFC_status: link(ST.approved) })
    .put(`inbox/${RFC_D}.md`, { exo__Asset_uid: RFC_D, exo__Asset_label: '"RFC отложенный"', exodev__RFC_status: link(ST.deferred) })
    .put(`inbox/${RFC_P}.md`, { exo__Asset_uid: RFC_P, exo__Asset_label: '"RFC предложенный"', exodev__RFC_status: link(ST.proposed) })
    .put(`concept/${NOTE}.md`, effort(NOTE, '"Концепт, не RFC"', [C.concept]))
    .put(`exodev/${PRJ_OK}.md`, effort(PRJ_OK, '"Проект под одобренным"', [C.project], { exo__Asset_relates: link(RFC_A) }))
    .put(`exodev/${PRJ_ALP}.md`, effort(PRJ_ALP, '"Проект ALP без RFC"', [C.project], { exo__Asset_relates: link(NOTE) }))
    .put(
      `exodev/${PRJ_MULTI}.md`,
      effort(PRJ_MULTI, '"Проект с двумя связями"', [C.project], { exo__Asset_relates: [link(NOTE), link(RFC_A)] }),
    )
    .put(`exodev/${TASK_OK}.md`, effort(TASK_OK, '"Задача под одобренным"', [C.task], { ems__Effort_parent: link(PRJ_OK) }))
    .put(`exodev/${CYC_1}.md`, effort(CYC_1, '"Цикл 1"', [C.task], { ems__Effort_parent: link(CYC_2) }))
    .put(`exodev/${CYC_2}.md`, effort(CYC_2, '"Цикл 2"', [C.task], { ems__Effort_parent: link(CYC_1) }));
  for (const [field, uid] of Object.entries(P).slice(0, 9)) {
    v.put(`exocmd/${uid}.md`, propertyAsset(uid, `exocmd__CreationGate_${field}`));
  }
  if (withRule) v.put(`exodev/${RULE}.md`, ruleAsset());
  return v;
}

const task = (extra: Fm = {}, classes = [C.task]): Fm => effort(NEW, '"Новая задача"', classes, extra);

function expectRefused(verdict: CreationGateVerdict, reason?: RegExp): void {
  expect(verdict.allowed).toBe(false);
  if (!verdict.allowed && reason) expect(verdict.reason).toMatch(reason);
}

describe("creation gate — semantics over a vault-shaped fixture", () => {
  it(`G0 ${REQ} no rule asset in the vault ⇒ every creation passes`, async () => {
    const v = baseVault(false);
    expect((await v.judge(task())).allowed).toBe(true);
    expect((await v.judge(effort(NEW, "x", [C.project]))).allowed).toBe(true);
    expect((await v.judge(effort(NEW, "x", [C.bug]))).allowed).toBe(true);
  });

  it(`G1 ${REQ} task without a parent is refused — the chain broke on the candidate`, async () => {
    const verdict = await baseVault().judge(task());
    expectRefused(verdict, /оборвалась на «Новая задача»/);
    if (!verdict.allowed) {
      expect(verdict.policyUid).toBe(RULE);
      expect(verdict.policyLabel).toMatch(/^Гейт Double Diamond/);
      expect(verdict.hint).toMatch(/^Новая работа начинается с идеи/);
    }
  });

  it(`G2 ${REQ} task under a project whose direction is Approved passes (two hops too)`, async () => {
    const v = baseVault();
    expect((await v.judge(task({ ems__Effort_parent: link(PRJ_OK) }))).allowed).toBe(true);
    expect((await v.judge(task({ ems__Effort_parent: link(TASK_OK) }))).allowed).toBe(true);
  });

  it(`G3 ${REQ} task under a project that relates to a non-RFC is refused`, async () => {
    expectRefused(
      await baseVault().judge(task({ ems__Effort_parent: link(PRJ_ALP) })),
      /оборвалась на «Проект ALP без RFC»/,
    );
  });

  it(`G4 ${REQ} project relating to a Deferred direction is refused`, async () => {
    expectRefused(
      await baseVault().judge(effort(NEW, '"Новый проект"', [C.project], { exo__Asset_relates: link(RFC_D) })),
    );
  });

  it(`G4b ${REQ} adding Deferred to allowedStatus admits it — the verdict follows the rule's data`, async () => {
    const v = baseVault().put(
      `exodev/${RULE}.md`,
      ruleAsset({ exocmd__CreationGate_allowedStatus: [link(ST.approved), link(ST.deferred)] }),
    );
    expect(
      (await v.judge(effort(NEW, '"Новый проект"', [C.project], { exo__Asset_relates: link(RFC_D) }))).allowed,
    ).toBe(true);
  });

  it(`G5 ${REQ} project relating to an Approved direction passes as its own anchor`, async () => {
    expect(
      (await baseVault().judge(effort(NEW, '"Новый проект"', [C.project], { exo__Asset_relates: link(RFC_A) }))).allowed,
    ).toBe(true);
  });

  it(`G6 ${REQ} a subclass of a guarded class (Meeting ⊑ Task) is guarded by closure`, async () => {
    expectRefused(await baseVault().judge(effort(NEW, '"Встреча"', [C.meeting])), /оборвалась/);
  });

  it(`G7 ${REQ} an excluded class (TaskPrototype ⊑ EffortPrototype) passes without a parent`, async () => {
    expect((await baseVault().judge(effort(NEW, '"Прототип"', [C.taskPrototype]))).allowed).toBe(true);
  });

  it(`G8 ${REQ} a bug with evidence passes without a parent (PR #, релиз N, PR URL)`, async () => {
    const v = baseVault();
    const bug = effort(NEW, '"Баг"', [C.bug]);
    expect((await v.judge(bug, "Регрессия после PR #4534.")).allowed).toBe(true);
    expect((await v.judge(bug, "см. релиз 17 — поломка")).allowed).toBe(true);
    expect((await v.judge(bug, "https://github.com/kitelev/exocortex/pull/4534")).allowed).toBe(true);
  });

  it(`G8i ${REQ} evidence is matched regardless of case ("Релиз 5")`, async () => {
    expect((await baseVault().judge(effort(NEW, '"Баг"', [C.bug]), "Релиз 5 сломал кнопку")).allowed).toBe(true);
  });

  it(`G9 ${REQ} a bug whose text is not evidence ("CLI 17.9.1") is judged by the chain and refused`, async () => {
    expectRefused(await baseVault().judge(effort(NEW, '"Баг"', [C.bug]), "сломалось в CLI 17.9.1"), /оборвалась/);
  });

  it(`G10 ${REQ} a bug without evidence under an Approved project passes by the chain`, async () => {
    expect(
      (await baseVault().judge(effort(NEW, '"Баг"', [C.bug], { ems__Effort_parent: link(PRJ_OK) }), "без ссылок")).allowed,
    ).toBe(true);
  });

  it(`G11 ${REQ} evidence found only in the label counts — the candidate is the assembled file`, async () => {
    expect((await baseVault().judge(effort(NEW, '"Баг после PR #4534"', [C.bug]))).allowed).toBe(true);
  });

  it(`G12 ${REQ} an unresolvable parent is refused and the reason says so`, async () => {
    expectRefused(
      await baseVault().judge(task({ ems__Effort_parent: link("99999999-0000-4000-8000-000000000000") })),
      /не найден/,
    );
  });

  it(`G13 ${REQ} parent by label and class/parent as [[uid|label]] resolve`, async () => {
    const v = baseVault();
    expect((await v.judge(task({ ems__Effort_parent: '"[[Проект под одобренным]]"' }))).allowed).toBe(true);
    expect(
      (
        await v.judge(
          effort(NEW, '"x"', [`"[[${C.task}|ems__Task]]"`], { ems__Effort_parent: `"[[${PRJ_OK}|Проект]]"` }),
        )
      ).allowed,
    ).toBe(true);
  });

  it(`G14 ${REQ} a [[uid|label]] class without a parent is refused`, async () => {
    expectRefused(await baseVault().judge(effort(NEW, '"x"', [`"[[${C.task}|ems__Task]]"`])), /оборвалась/);
  });

  it(`G15 ${REQ} any direction value may carry the allowed status (relates = [note, RFC])`, async () => {
    expect((await baseVault().judge(task({ ems__Effort_parent: link(PRJ_MULTI) }))).allowed).toBe(true);
  });

  it(`G16 ${REQ} a cycle in the chain is refused as a cycle`, async () => {
    expectRefused(await baseVault().judge(task({ ems__Effort_parent: link(CYC_1) })), /цикл/);
  });

  it(`G17 ${REQ} exclusion and exemption are judged per class — double typing does not bypass`, async () => {
    const v = baseVault();
    expectRefused(await v.judge(effort(NEW, '"x"', [C.task, C.taskPrototype])));
    expectRefused(await v.judge(effort(NEW, '"x"', [C.task, C.bug]), "после PR #1"));
    expectRefused(await v.judge(effort(NEW, '"x"', [C.emsIdea, C.task])));
  });

  it(`G18 ${REQ} ideas and a new rule asset are not guarded`, async () => {
    const v = baseVault();
    expect((await v.judge(effort(NEW, '"Идея"', [C.flowIdea]))).allowed).toBe(true);
    expect((await v.judge(effort(NEW, '"Идея"', [C.flowIdea, C.emsIdea]))).allowed).toBe(true);
    expect((await v.judge(ruleAsset({}, NEW))).allowed).toBe(true);
  });

  it(`G19 ${REQ} a rule without chainProperty refuses guarded classes only`, async () => {
    const v = baseVault().put(`exodev/${RULE}.md`, ruleAsset({ exocmd__CreationGate_chainProperty: null }));
    expectRefused(await v.judge(task({ ems__Effort_parent: link(PRJ_OK) })), /неполно.*chainProperty/);
    expect((await v.judge(effort(NEW, '"Идея"', [C.flowIdea, C.emsIdea]))).allowed).toBe(true);
  });

  it(`G20 ${REQ} a rule without guardedClass closes everything but a new rule asset`, async () => {
    const v = baseVault().put(`exodev/${RULE}.md`, ruleAsset({ exocmd__CreationGate_guardedClass: null }));
    expectRefused(await v.judge(task({ ems__Effort_parent: link(PRJ_OK) })), /guardedClass/);
    expectRefused(await v.judge(effort(NEW, '"Идея"', [C.flowIdea])), /guardedClass/);
    expect((await v.judge(ruleAsset({}, NEW))).allowed).toBe(true);
  });

  it(`G21 ${REQ} a rule key that is an alias of the property asset is recognised by UID`, async () => {
    const v = baseVault()
      .put(
        `exocmd/${P.guardedClass}.md`,
        propertyAsset(P.guardedClass, "exocmd__CreationGate_guardedClass", [
          "exocmd__CreationGate_guardedClass",
          "exocmd__CreationGate_protectedClass",
        ]),
      )
      .put(
        `exodev/${RULE}.md`,
        ruleAsset({
          exocmd__CreationGate_guardedClass: null,
          exocmd__CreationGate_protectedClass: [link(C.task), link(C.project)],
        }),
      );
    expectRefused(await v.judge(task()), /оборвалась/);
    expect((await v.judge(effort(NEW, '"Идея"', [C.flowIdea]))).allowed).toBe(true);
  });

  it(`G22 ${REQ} a superseded or archived rule does not act`, async () => {
    const deprecated = baseVault().put(
      `exodev/${RULE}.md`,
      ruleAsset({ exo__Asset_deprecatedBy: link(RULE_2) }),
    );
    expect((await deprecated.judge(task())).allowed).toBe(true);
    const archived = baseVault().put(`exodev/${RULE}.md`, ruleAsset({ exo__Asset_archived: "true" }));
    expect((await archived.judge(task())).allowed).toBe(true);
  });

  it(`G23 ${REQ} rules are a conjunction — the second rule's refusal wins`, async () => {
    const v = baseVault().put(
      `exodev/${RULE_2}.md`,
      ruleAsset(
        {
          exo__Asset_label: '"Второе правило: только отложенные"',
          exocmd__CreationGate_allowedStatus: [link(ST.deferred)],
        },
        RULE_2,
      ),
    );
    const verdict = await v.judge(task({ ems__Effort_parent: link(PRJ_OK) }));
    expectRefused(verdict);
    if (!verdict.allowed) expect(verdict.policyUid).toBe(RULE_2);
  });

  it(`G24 ${REQ} an evidence pattern that does not compile closes the evidence path, not the gate`, async () => {
    const v = baseVault().put(
      `exodev/${RULE}.md`,
      ruleAsset({ exocmd__CreationGate_exemptEvidence: "'(PR'" }),
    );
    expectRefused(await v.judge(effort(NEW, '"Баг"', [C.bug]), "после PR #1"), /регэксп exemptEvidence не компилируется/);
    expect(
      (await v.judge(effort(NEW, '"Баг"', [C.bug], { ems__Effort_parent: link(PRJ_OK) }), "после PR #1")).allowed,
    ).toBe(true);
  });

  it(`G25 ${REQ} a class written by label ([[ems__Task]]) is guarded`, async () => {
    expectRefused(await baseVault().judge(effort(NEW, '"x"', ['"[[ems__Task]]"'])), /оборвалась/);
  });

  it(`G26 ${REQ} a rule is found even where its class asset is not mounted`, async () => {
    const v = baseVault().remove(`exocmd/${C.gate}.md`);
    expectRefused(await v.judge(task()), /оборвалась/);
  });

  it(`G28 ${REQ} AC7 — no value of the rule is written in the gate's code (core module, CLI and plugin glue)`, () => {
    // The probe list is DERIVED from the rule asset (Appendix B shape): every
    // UID and label its values name, plus the evidence pattern — not authored
    // by hand beside it. The real rule's own UID is added on top.
    const rule = parseCandidateFrontmatter(md(ruleAsset()));
    const v = baseVault();
    const probes = new Set<string>(["06e6f840-0be3-4f34-9764-a268d8e900a0", EVIDENCE, "(?:pull|issues|releases)"]);
    for (const [key, value] of Object.entries(rule)) {
      if (!key.startsWith("exocmd__CreationGate_") && key !== "exo__Asset_isDefinedBy") continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        const uid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(String(item))?.[1];
        if (!uid) continue;
        probes.add(uid);
        const labelLine = [...v.files.values()].find((text) => text.includes(`exo__Asset_uid: ${uid}`));
        const label = labelLine ? parseCandidateFrontmatter(labelLine).exo__Asset_label : undefined;
        if (typeof label === "string") probes.add(label);
      }
    }
    expect(probes.size).toBeGreaterThan(10);
    const root = path.resolve(__dirname, "../../../../..");
    const sources = [
      ...fs
        .readdirSync(path.join(root, "core/src/services/creationGate"))
        .map((f) => path.join(root, "core/src/services/creationGate", f)),
      path.join(root, "cli/src/services/CreationGateCli.ts"),
      path.join(root, "obsidian-plugin/src/infrastructure/creationGate/PluginCreationGate.ts"),
    ];
    const hits: string[] = [];
    for (const file of sources) {
      const text = fs.readFileSync(file, "utf-8");
      for (const probe of probes) if (text.includes(probe)) hits.push(`${path.basename(file)}: ${probe}`);
    }
    expect(hits).toEqual([]);
  });

  it(`G27 ${REQ} a chain deeper than 12 hops is refused as too deep`, async () => {
    const v = baseVault();
    let parent = PRJ_ALP;
    for (let i = 0; i < 14; i++) {
      const uid = `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      v.put(`exodev/${uid}.md`, effort(uid, `"Звено ${i}"`, [C.task], { ems__Effort_parent: link(parent) }));
      parent = uid;
    }
    expectRefused(await v.judge(task({ ems__Effort_parent: link(parent) })), /глубже 12/);
  });

  // The BOUNDARY of the depth limit, from both sides: G27 alone survives a
  // limit moved to 13 or 14 (its chain is 15 hops long).
  const chainTo = (v: FixtureVault, anchor: string, links: number): string => {
    let parent = anchor;
    for (let i = 0; i < links; i++) {
      const uid = `dddd0000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      v.put(`exodev/${uid}.md`, effort(uid, `"Звено ${i}"`, [C.task], { ems__Effort_parent: link(parent) }));
      parent = uid;
    }
    return parent;
  };

  it(`G27a ${REQ} an approved anchor exactly 12 hops up passes`, async () => {
    const v = baseVault();
    const top = chainTo(v, PRJ_OK, 11); // candidate → 11 links → project = 12 hops
    expect((await v.judge(task({ ems__Effort_parent: link(top) }))).allowed).toBe(true);
  });

  it(`G27b ${REQ} the same anchor 13 hops up is refused as too deep`, async () => {
    const v = baseVault();
    const top = chainTo(v, PRJ_OK, 12); // 13 hops
    expectRefused(await v.judge(task({ ems__Effort_parent: link(top) })), /глубже 12/);
  });

  const gatedWriteFile = (v: FixtureVault, disk: Map<string, string>) =>
    withCreationGate(
      {
        async writeFile(p: string, c: string): Promise<void> {
          disk.set(p, c);
        },
        async fileExists(p: string): Promise<boolean> {
          return disk.has(p);
        },
      },
      new CreationGateSession({ source: v.source, frontmatterByRef: v.frontmatterByRef }),
    );

  it(`G29 ${REQ} writeFile judges a NEW file — an illegal one is refused and not written`, async () => {
    const disk = new Map<string, string>();
    const writer = gatedWriteFile(baseVault(), disk);
    await expect(writer.writeFile(`inbox/${NEW}.md`, md(task()))).rejects.toThrow(/^CREATION_GATE_REFUSED:/);
    expect(disk.has(`inbox/${NEW}.md`)).toBe(false);
  });

  it(`G29b ${REQ} writeFile over an EXISTING file is not a creation — it is not judged`, async () => {
    const disk = new Map<string, string>([[`inbox/old.md`, "old"]]);
    const writer = gatedWriteFile(baseVault(), disk);
    const illegal = md(task());
    await writer.writeFile(`inbox/old.md`, illegal);
    expect(disk.get(`inbox/old.md`)).toBe(illegal);
  });
});
