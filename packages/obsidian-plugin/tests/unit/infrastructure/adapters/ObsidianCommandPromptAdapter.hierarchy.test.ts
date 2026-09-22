/**
 * req 15f48fa1 (ticket 8df9e6eb) — PRODUCTION WIRING of the subsumption-aware
 * candidate resolver: the form the engine prompts through
 * `CommandExecutionFlow.run → CommandPromptAdapter.promptInputSchema` offers
 * the instances of every subclass of the field's `targetClassUid`.
 *
 * Production-shape on the plugin side: the REAL `ObsidianCommandPromptAdapter`
 * opens the REAL `DynamicFormModal` (its DEFAULT `candidatesResolver`, i.e.
 * `findAssetRefCandidates` — nothing injected) which renders the REAL
 * `DynamicForm` / `ReferencePicker` through the REAL `ReactRenderer` into the
 * jsdom modal; only the Obsidian `App` (metadata cache + vault file list) is a
 * fake, seeded with the live exoas-public/ems class hierarchy and one Task +
 * one Project + one Area. The schema is the shape `CommandResolver` projects
 * for the `set-parent` grounding (exoas-exocmd 18f12de2) once its `parent`
 * property declares `targetClassUid = ems__Effort` (loader projection is
 * locked by req c4adae42).
 *
 * Revert-verify (PR body): M4 (exact-class matching, no subsumption) → P1 RED
 * (0 options — nothing is a direct ems__Effort instance); M5 (modal does not
 * hand `targetClassUid` to the resolver) → P1 RED.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import type { UserInput } from "@kitelev/exocortex-core";
import { ObsidianCommandPromptAdapter } from "@plugin/infrastructure/adapters/ObsidianCommandPromptAdapter";
import { DynamicFormModal } from "@plugin/presentation/modals/DynamicFormModal";

const REQ = "@req:15f48fa1-a3a6-4df1-972e-efd639bfa344";

const AREA_AWARE = "f3892308-7a8b-4b81-8a01-a088d4bad97b";
const EFFORT = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const PROJECT = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const PARENT_EFFORT = "17c5cf45-ce6a-4142-8d2a-65ac447f1168";
const AREA = "aaaaaaaa-0000-4000-8000-000000000001";
const EXO_CLASS = "8619c4fc-0000-4000-8000-000000000000";

// The test tsconfig sees two DOM type sets, so `fireEvent(HTMLElement)` /
// `appendChild(HTMLElement)` are a baselined TS2345 in this package; the cast
// keeps these axes off that debt (same idiom as DynamicForm.test.tsx).
const asEl = (node: unknown): Element => node as Element;

interface FakeFile {
  basename: string;
  path: string;
}
interface Seed {
  file: FakeFile;
  fm: Record<string, unknown>;
}

const classFile = (uid: string, label: string, supers: string[]): Seed => ({
  file: { basename: uid, path: `assetspaces/kitelev/exoas-public/ems/${uid}.md` },
  fm: {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [`"[[${EXO_CLASS}]]"`],
    ...(supers.length > 0
      ? { exo__Class_superClass: supers.map((u) => `"[[${u}]]"`) }
      : {}),
  },
});
const instance = (uid: string, label: string, cls: string): Seed => ({
  file: { basename: uid, path: `assetspaces/kitelev/exoas-my/my-efforts/${uid}.md` },
  fm: {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [`"[[${cls}]]"`],
  },
});

const SEEDS: Seed[] = [
  classFile(AREA_AWARE, "ems__AreaAware", []),
  classFile(EFFORT, "ems__Effort", [AREA_AWARE]),
  classFile(TASK, "ems__Task", [EFFORT]),
  classFile(PROJECT, "ems__Project", [EFFORT, PARENT_EFFORT]),
  classFile(PARENT_EFFORT, "ems__ParentEffort", [EFFORT]),
  classFile(AREA, "ems__Area", [AREA_AWARE]),
  instance("t1", "Task one", TASK),
  instance("p1", "Project one", PROJECT),
  instance("a1", "Area one", AREA),
];

function makeApp(seeds: Seed[]): App {
  const files = seeds.map((s) => s.file);
  const byBasename = new Map(seeds.map((s) => [s.file.basename, s.fm]));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file: FakeFile) => ({
        frontmatter: byBasename.get(file.basename),
      }),
    },
  } as unknown as App;
}

/** The set-parent input schema as `CommandResolver` projects it with `targetClassUid` declared. */
function setParentSchema(targetClassUid: string): ReadonlyArray<unknown> {
  return [
    {
      name: "parent",
      type: "assetRef",
      label: "Parent",
      required: true,
      targetClassUid,
    },
  ];
}

// The jsdom `Modal` mock (tests/__mocks__/obsidian.ts) attaches only `modalEl`
// to the document; real Obsidian nests `contentEl` inside it. Nest it here so
// the React tree the REAL modal renders is reachable through `screen`.
// (`beforeEach`, not `beforeAll`: the plugin jest config restores spies
// before every test.)
// eslint-disable-next-line @typescript-eslint/unbound-method -- captured only to be re-bound via `.call(this)` inside the spy
const originalOnOpen = DynamicFormModal.prototype.onOpen;
beforeEach(() => {
  jest
    .spyOn(DynamicFormModal.prototype, "onOpen")
    .mockImplementation(function (this: DynamicFormModal) {
      asEl(this.modalEl).appendChild(asEl(this.contentEl));
      originalOnOpen.call(this);
    });
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("ObsidianCommandPromptAdapter × DynamicFormModal × findAssetRefCandidates (req 15f48fa1, production wiring)", () => {
  it(`P1 the prompted form's picker for targetClassUid = ems__Effort offers the Task and the Project (subclass instances) and submits the picked "[[uid]]" ${REQ}`, async () => {
    const adapter = new ObsidianCommandPromptAdapter(makeApp(SEEDS));

    let result: Promise<UserInput | null> | undefined;
    await act(async () => {
      result = adapter.promptInputSchema(setParentSchema(EFFORT));
    });
    if (!result) throw new Error("promptInputSchema did not return a promise");
    const pending = result;

    const input = await waitFor(() => screen.getByTestId("field-parent"));
    // Picker mode (ARIA combobox), not the plain text fallback.
    expect(input.getAttribute("role")).toBe("combobox");

    await act(async () => {
      fireEvent.focus(asEl(input));
    });
    // Both subclass instances are offered; the Area (foreign hierarchy) is not.
    await waitFor(() => screen.getByTestId("option-parent-p1"));
    expect(screen.getByTestId("option-parent-t1").textContent).toBe("Task one");
    expect(screen.getByTestId("option-parent-p1").textContent).toBe("Project one");
    expect(screen.queryByTestId("option-parent-a1")).toBeNull();

    await act(async () => {
      fireEvent.mouseDown(asEl(screen.getByTestId("option-parent-p1")));
    });
    const form = asEl(input).closest("form");
    if (!form) throw new Error("picker input is not inside the form");
    await act(async () => {
      fireEvent.submit(asEl(form));
    });
    await expect(pending).resolves.toEqual({ parent: '"[[p1]]"' });
  });

  it(`P2 (control) targetClassUid = ems__Area offers only the Area — subsumption never widens to a sibling hierarchy ${REQ}`, async () => {
    const adapter = new ObsidianCommandPromptAdapter(makeApp(SEEDS));
    await act(async () => {
      void adapter.promptInputSchema(setParentSchema(AREA));
    });
    const input = await waitFor(() => screen.getByTestId("field-parent"));
    await act(async () => {
      fireEvent.focus(asEl(input));
    });
    await waitFor(() => screen.getByTestId("option-parent-a1"));
    expect(screen.queryByTestId("option-parent-t1")).toBeNull();
    expect(screen.queryByTestId("option-parent-p1")).toBeNull();
  });
});
