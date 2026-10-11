/**
 * req 088f94c6 (ems__Bug b090c2e8) — `apply trash` records the reason as its own
 * `ems__EffortTrashReason` asset and never rewrites the effort's body.
 *
 * Production data, not hand-authored copies: the temp vault is built from the
 * REAL `packages/exoas-exocmd` and `packages/exoas-exo` submodule trees, so the
 * `trash` command, its composite grounding (`d612e5f5`) and every reused step
 * are exactly what ships (test-fixture-realism). The real `apply` pipeline runs
 * over it and the files are read back — no --dry-run.
 *
 * Before this requirement the composite's fourth step was a PRIVATE
 * `body_template` step (`d3412530`, exoas-my) that replaced the whole body with
 * an empty «## Trash Reason» stub. The fixture copies that step and its template
 * outside `assetspaces/`, as the founder's vault has them, so the old composite
 * really overwrites the body here (R5 goes red on it) while R7 still judges the
 * public submodules alone.
 *
 * Axes:
 *   R1 — the reason becomes a new asset of class ems__EffortTrashReason, labelled with the input
 *   R2 — the reason lives in the effort's folder and is defined by the effort's ontology
 *   R3 — the reason links to the effort via exo__Asset_relates (new → old)
 *   R4 — the effort still turns Trashed, with the default category and a resolution timestamp
 *   R5 — the effort's body is byte-identical after the command
 *   R6 — without a reason the command refuses by name and changes nothing
 *   R7 — every step of the shipped composite resolves inside the public submodules
 *   R8 — a blank reason ("" or spaces) is refused like a missing one
 *   R9 — the reason carries exactly its own keys: no ems__Effort_parent, for a task or a project
 *  R10 — the reason lands in its ontology's folder even when the effort lies elsewhere
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

const { applyCommand } = await import("../../src/commands/apply.js");

const PACKAGES = path.resolve(import.meta.dirname, "../../..");
const SUBMODULES = ["exoas-exocmd", "exoas-exo"] as const;
const REQ = "@req:088f94c6-7076-4e96-9dff-e282349db9f5";

const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
const PROJECT_CLASS = "7db5eeff-718a-49b0-8d2b-39b084a356e3"; // ems__Project
const TRASH_REASON_CLASS = "90f77d9e-27f9-48f2-ad1a-8490d99eb088"; // ems__EffortTrashReason
const STATUS_TRASHED = "5d14f18d-db2b-4847-9ac1-144cb93b2541";
const REASON_NO_LONGER_RELEVANT = "6332c6d8-861f-475c-a051-4b6bbb669f7a";
const STATUS_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const TRASH_COMPOSITE = "d612e5f5-f495-47a1-ad4d-4f468e8b841a";

/** Body with characters a template engine or a YAML round-trip could disturb. */
const BODY = [
  "# Original task body",
  "",
  "Context the user wrote: cost $$100, $& and $1 stay literal.",
  "",
  "- [ ] a checkbox",
  "- [x] a done one",
  "",
  "## Trash Reason",
  "",
  "Not a template — the user's own heading.",
  "",
].join("\n");

function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".github") continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

const submodulesPresent = SUBMODULES.every((m) =>
  fs.existsSync(path.join(PACKAGES, m, m === "exoas-exocmd" ? "exocmd" : "exo")),
);

function readFrontmatter(abs: string): Record<string, unknown> {
  const text = fs.readFileSync(abs, "utf-8");
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new Error(`no frontmatter in ${abs}`);
  return yaml.load(m[1]) as Record<string, unknown>;
}

function bodyOf(abs: string): string {
  const text = fs.readFileSync(abs, "utf-8");
  const m = /^---\n[\s\S]*?\n---\n/.exec(text);
  if (!m) throw new Error(`no frontmatter in ${abs}`);
  return text.slice(m[0].length);
}

/** Wikilink targets of a frontmatter value, as bare UIDs/link paths. */
function linkTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((v) => /^\[\[([^\]|#]+)/.exec(String(v))?.[1])
    .filter((v): v is string => v !== undefined);
}

(submodulesPresent ? describe : describe.skip)(
  "req 088f94c6 — apply trash records the reason as its own asset over the real exoas-exocmd data",
  () => {
    let root: string;
    let n = 0;
    let exitSpy: jest.SpiedFunction<typeof process.exit>;
    let logSpy: jest.SpiedFunction<typeof console.log>;
    let errSpy: jest.SpiedFunction<typeof console.error>;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-trash-reason-"));
      for (const m of SUBMODULES) {
        copyTree(path.join(PACKAGES, m), path.join(root, "assetspaces", "kitelev", m));
      }
      // The ems ontology lives in exoas-public, which is not a submodule here.
      // Stub exactly the TBox the shipped command reads from it, with the real
      // UIDs and labels: the effort carries its class as a bare UID (what
      // `create` writes), so the class must resolve for the `Trash → Task`
      // binding (targetClass `ems__Task`) to match; and each property_set step
      // names its property by UID, so the property must resolve to its label.
      const stubs: Array<[string, string, string]> = [
        [TASK_CLASS, "ems__Task", "exo__Class"],
        ["44c6e9e3-955f-4afc-9ca5-b4bd70667051", "ems__Effort_status", "exo__ObjectProperty"],
        ["e34c283b-dcbd-4e4b-ac3a-d4d2ca11750b", "ems__Effort_trashedReason", "exo__ObjectProperty"],
        ["6c5ea4a6-b592-40cb-9253-ea8f29ee0f56", "ems__Effort_resolutionTimestamp", "exo__DatatypeProperty"],
        // The Universal Default Template's parent rules (65acce2f Task, 01f570c9 Project) write
        // ems__Effort_parent; without this property resolving they are skipped and R9 is blind.
        [PROJECT_CLASS, "ems__Project", "exo__Class"],
        ["6528ecfa-a03d-47f1-a819-9ba5fea8fc28", "ems__Effort_parent", "exo__ObjectProperty"],
      ];
      fs.mkdirSync(path.join(root, "ems-stubs"), { recursive: true });
      for (const [uid, label, metaclass] of stubs) {
        fs.writeFileSync(
          path.join(root, "ems-stubs", `${uid}.md`),
          [
            "---",
            `exo__Asset_uid: ${uid}`,
            `exo__Asset_label: ${label}`,
            "exo__Instance_class:",
            `  - "[[${metaclass}]]"`,
            "---",
            "",
          ].join("\n"),
          "utf-8",
        );
      }
      // The founder's vault also mounts exoas-my, where the PREVIOUS fourth step
      // lived: «Add Trashed Comment» (`d3412530`, body_template) with its template
      // «## Trash Reason / - ». Copied verbatim, OUTSIDE `assetspaces/` so R7 still
      // judges the public submodules alone. With them present the old composite
      // really overwrites the body here, which is what makes R5 able to go red.
      fs.mkdirSync(path.join(root, "private-stubs"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "private-stubs", "d3412530-3433-4291-bb8f-00bbedd2676e.md"),
        [
          "---",
          "exo__Asset_uid: d3412530-3433-4291-bb8f-00bbedd2676e",
          "exo__Instance_class:",
          '  - "[[11579feb-2e42-491c-af59-b89b1129a539]]"',
          "exo__Asset_label: Add Trashed Comment",
          'exocmd__Grounding_type: "[[6093bfcb-cf9b-4565-86c3-ff74d8bc11c0]]"',
          'exocmd__Grounding_templateRef: "[[63bc4dc9-1841-4cf5-8147-0429b1bdc488]]"',
          "---",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(root, "private-stubs", "63bc4dc9-1841-4cf5-8147-0429b1bdc488.md"),
        [
          "---",
          "exo__Asset_uid: 63bc4dc9-1841-4cf5-8147-0429b1bdc488",
          "exo__Instance_class:",
          '  - "[[8bdf4506-80bf-4999-8fda-1ea0808b4ee5]]"',
          "exo__Asset_label: Trash Reason Template",
          "---",
          "## Trash Reason",
          "-",
        ].join("\n"),
        "utf-8",
      );
    });

    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    beforeEach(() => {
      exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
      logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    });

    /**
     * A Backlog effort in its own folder. By default its ontology lies in the same folder
     * (co-located); `misplaced` puts the ontology in a sibling folder instead, so the
     * effort's folder and its ontology's folder differ (R10).
     */
    function writeTask(
      opts: { cls?: string; misplaced?: boolean } = {},
    ): { rel: string; uid: string; dir: string; ontologyDir: string; ontologyUid: string } {
      n += 1;
      const folder = `work-${n}`;
      const dir = path.join(root, folder);
      fs.mkdirSync(dir, { recursive: true });
      const ontologyUid = `0880f94c-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
      const ontologyDir = opts.misplaced ? path.join(root, `${folder}-ontology`) : dir;
      fs.mkdirSync(ontologyDir, { recursive: true });
      fs.writeFileSync(
        path.join(ontologyDir, `${ontologyUid}.md`),
        [
          "---",
          `exo__Asset_uid: ${ontologyUid}`,
          `exo__Asset_label: "trash-reason test ontology ${n}"`,
          `exo__Asset_isDefinedBy: "[[${ontologyUid}]]"`,
          "exo__Instance_class:",
          '  - "[[exo__Ontology]]"',
          "---",
          "",
        ].join("\n"),
        "utf-8",
      );
      const uid = `0880f94c-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      const lines = [
        "---",
        `exo__Asset_uid: ${uid}`,
        "exo__Instance_class:",
        `  - "[[${opts.cls ?? TASK_CLASS}]]"`,
        `exo__Asset_label: "Effort to throw away ${n}"`,
        `exo__Asset_isDefinedBy: "[[${ontologyUid}]]"`,
        `ems__Effort_status: "[[${STATUS_BACKLOG}]]"`,
        "exo__Asset_updatedAt: 2020-01-01T00:00:00",
        "---",
        BODY,
      ];
      const rel = `${folder}/${uid}.md`;
      fs.writeFileSync(path.join(root, rel), lines.join("\n"), "utf-8");
      return { rel, uid, dir, ontologyDir, ontologyUid };
    }

    async function runTrash(rel: string, input?: Record<string, unknown>): Promise<number> {
      const args = ["node", "apply", "trash", rel, "--vault", root, "--yes"];
      if (input) args.push("--input", JSON.stringify(input));
      try {
        await applyCommand().parseAsync(args);
        return 0;
      } catch (err) {
        const m = /^__process_exit_(\d+)__$/.exec(String((err as Error)?.message));
        if (m) return Number(m[1]);
        throw err;
      }
    }

    /**
     * Assets the command created next to the effort: everything in its folder
     * except the effort and its ontology. Deliberately NOT filtered by class, so
     * R1 alone judges the class and a wrong-class asset still counts as created.
     */
    function reasonsIn(dir: string): string[] {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .filter((f) => !f.startsWith("0880f94c-"))
        .map((f) => path.join(dir, f));
    }

    const stderr = (): string => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");

    it(`R1 ${REQ} the reason becomes a new ems__EffortTrashReason asset labelled with the input`, async () => {
      const t = writeTask();
      expect(reasonsIn(t.dir)).toHaveLength(0); // input built

      const code = await runTrash(t.rel, { label: "Переехало в другой проект" });

      expect(code).toBe(0);
      const reasons = reasonsIn(t.dir);
      expect(reasons).toHaveLength(1);
      const fm = readFrontmatter(reasons[0]);
      expect(linkTargets(fm["exo__Instance_class"])).toEqual([TRASH_REASON_CLASS]);
      expect(fm["exo__Asset_label"]).toBe("Переехало в другой проект");
    }, 60_000);

    it(`R2 ${REQ} the reason is defined by the effort's ontology`, async () => {
      const t = writeTask();
      await runTrash(t.rel, { label: "Дубль другой задачи" });

      const reasons = reasonsIn(t.dir);
      expect(reasons).toHaveLength(1);
      expect(linkTargets(readFrontmatter(reasons[0])["exo__Asset_isDefinedBy"])).toEqual([
        t.ontologyUid,
      ]);
    }, 60_000);

    it(`R3 ${REQ} the reason links to the effort via exo__Asset_relates`, async () => {
      const t = writeTask();
      await runTrash(t.rel, { label: "Сделал кто-то другой" });

      const reasons = reasonsIn(t.dir);
      expect(reasons).toHaveLength(1);
      expect(linkTargets(readFrontmatter(reasons[0])["exo__Asset_relates"])).toEqual([t.uid]);
      // New → old only: the effort gets no link to its reason.
      expect(fs.readFileSync(path.join(root, t.rel), "utf-8")).not.toContain(
        path.basename(reasons[0], ".md"),
      );
    }, 60_000);

    it(`R4 ${REQ} the effort turns Trashed with the default category and a resolution timestamp`, async () => {
      const t = writeTask();
      await runTrash(t.rel, { label: "Потеряло смысл" });

      const fm = readFrontmatter(path.join(root, t.rel));
      expect(linkTargets(fm["ems__Effort_status"])).toEqual([STATUS_TRASHED]);
      expect(linkTargets(fm["ems__Effort_trashedReason"])).toEqual([REASON_NO_LONGER_RELEVANT]);
      expect(String(fm["ems__Effort_resolutionTimestamp"])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(String(fm["exo__Asset_updatedAt"])).not.toContain("2020-01-01");
    }, 60_000);

    it(`R5 ${REQ} the effort's body is byte-identical after the command`, async () => {
      const t = writeTask();
      const before = bodyOf(path.join(root, t.rel));
      expect(before).toBe(BODY); // input built

      await runTrash(t.rel, { label: "Неактуально" });

      // The command ran: its last step bumps updatedAt (not the status — that is R4's subject).
      expect(String(readFrontmatter(path.join(root, t.rel))["exo__Asset_updatedAt"])).not.toContain(
        "2020-01-01",
      );
      expect(bodyOf(path.join(root, t.rel))).toBe(before);
    }, 60_000);

    it(`R6 ${REQ} without a reason the command refuses by name and changes nothing`, async () => {
      const t = writeTask();
      const before = fs.readFileSync(path.join(root, t.rel), "utf-8");

      const code = await runTrash(t.rel);

      expect(code).not.toBe(0);
      expect(stderr()).toMatch(/"label"/);
      expect(fs.readFileSync(path.join(root, t.rel), "utf-8")).toBe(before);
      expect(reasonsIn(t.dir)).toHaveLength(0);
    }, 60_000);

    it(`R8 ${REQ} a blank reason is refused like a missing one and changes nothing`, async () => {
      for (const blank of ["", "   "]) {
        const t = writeTask();
        const before = fs.readFileSync(path.join(root, t.rel), "utf-8");

        const code = await runTrash(t.rel, { label: blank });

        expect(code).not.toBe(0);
        expect(fs.readFileSync(path.join(root, t.rel), "utf-8")).toBe(before);
        expect(reasonsIn(t.dir)).toHaveLength(0);
      }
      expect(stderr()).toMatch(/"label"/);
    }, 60_000);

    it(`R9 ${REQ} the reason carries no key beyond its own — no ems__Effort_parent — for a task and for a project`, async () => {
      // Keys the reason may carry. A subset check, not equality: a missing key is the
      // subject of R1–R3, an extra one (the universal parent rules) is the subject here.
      const allowed = new Set([
        "aliases",
        "exo__Asset_createdAt",
        "exo__Asset_isDefinedBy",
        "exo__Asset_label",
        "exo__Asset_relates",
        "exo__Asset_uid",
        "exo__Asset_updatedAt",
        "exo__Instance_class",
      ]);
      for (const cls of [TASK_CLASS, PROJECT_CLASS]) {
        const t = writeTask({ cls });
        await runTrash(t.rel, { label: "Не нужно" });

        const reasons = reasonsIn(t.dir);
        expect(reasons).toHaveLength(1); // the reason exists, so the check below is not vacuous
        const fm = readFrontmatter(reasons[0]);
        expect(fm).not.toHaveProperty("ems__Effort_parent");
        expect(Object.keys(fm).filter((k) => !allowed.has(k))).toEqual([]);
      }
    }, 120_000);

    it(`R10 ${REQ} the reason lands in its ontology's folder even when the effort lies elsewhere`, async () => {
      const t = writeTask({ misplaced: true });
      expect(t.ontologyDir).not.toBe(t.dir); // input built

      await runTrash(t.rel, { label: "Лежала не на месте" });

      expect(reasonsIn(t.ontologyDir)).toHaveLength(1);
      expect(reasonsIn(t.dir)).toHaveLength(0);
    }, 60_000);

    it(`R7 ${REQ} every step of the shipped trash composite resolves inside the public submodules`, () => {
      const present = new Set<string>();
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) walk(abs);
          else if (e.name.endsWith(".md")) present.add(e.name.slice(0, -3));
        }
      };
      walk(path.join(root, "assetspaces"));
      expect(present.size).toBeGreaterThan(100); // the trees were copied

      const composite = path.join(
        root,
        "assetspaces",
        "kitelev",
        "exoas-exocmd",
        "exocmd",
        `${TRASH_COMPOSITE}.md`,
      );
      const steps = linkTargets(readFrontmatter(composite)["exocmd__Grounding_steps"]);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.filter((uid) => !present.has(uid))).toEqual([]);
    });
  },
);
