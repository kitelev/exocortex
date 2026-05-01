import { DEFAULT_SETTINGS } from "../../src/domain/settings/ExocortexSettings";

describe("enableSparqlAutoExecute setting (Issue #2992)", () => {
  it("defaults to false (opt-in auto-execute)", () => {
    expect(DEFAULT_SETTINGS.enableSparqlAutoExecute).toBe(false);
  });

  it("is a boolean field", () => {
    expect(typeof DEFAULT_SETTINGS.enableSparqlAutoExecute).toBe("boolean");
  });
});

describe("SPARQL code block gating logic (Issue #2992)", () => {
  // The actual processor registration lives in ExocortexPlugin.ts and is
  // exercised end-to-end via E2E. Here we verify the gating predicate
  // semantics in isolation: when the setting is true the legacy processor
  // path runs; when false a plain <pre><code> is appended to the host
  // element with the source verbatim (no SPARQL execution).
  type FakeEl = {
    children: FakeEl[];
    classes: string[];
    text: string;
    tag: string;
    addClass: (c: string) => void;
    setText: (t: string) => void;
    createEl: (tag: string) => FakeEl;
  };
  const makeEl = (tag = "div"): FakeEl => {
    const el: FakeEl = {
      children: [],
      classes: [],
      text: "",
      tag,
      addClass(c: string) {
        this.classes.push(c);
      },
      setText(t: string) {
        this.text = t;
      },
      createEl(t: string) {
        const child = makeEl(t);
        this.children.push(child);
        return child;
      },
    };
    return el;
  };

  // Replicates the inline `renderSparqlBlock` logic in ExocortexPlugin.ts.
  function renderSparqlBlock(
    enabled: boolean,
    source: string,
    el: FakeEl,
    language: "sparql" | "exoql",
    process: (s: string, e: FakeEl) => string,
  ): string {
    if (enabled) {
      return process(source, el);
    }
    const pre = el.createEl("pre");
    pre.addClass(`language-${language}`);
    const code = pre.createEl("code");
    code.addClass(`language-${language}`);
    code.setText(source);
    return "plain";
  }

  it("when disabled (default), renders <pre><code> with the source verbatim", () => {
    const el = makeEl();
    const processSpy = jest.fn(() => "executed");
    const result = renderSparqlBlock(
      false,
      "ASK { ?s ?p ?o }",
      el,
      "sparql",
      processSpy,
    );
    expect(result).toBe("plain");
    expect(processSpy).not.toHaveBeenCalled();
    expect(el.children).toHaveLength(1);
    const pre = el.children[0]!;
    expect(pre.tag).toBe("pre");
    expect(pre.classes).toContain("language-sparql");
    expect(pre.children).toHaveLength(1);
    const code = pre.children[0]!;
    expect(code.tag).toBe("code");
    expect(code.classes).toContain("language-sparql");
    expect(code.text).toBe("ASK { ?s ?p ?o }");
  });

  it("when disabled, exoql blocks also render plain with language-exoql class", () => {
    const el = makeEl();
    const processSpy = jest.fn(() => "executed");
    renderSparqlBlock(
      false,
      "SELECT ?x WHERE { ?x ?p ?o }",
      el,
      "exoql",
      processSpy,
    );
    expect(processSpy).not.toHaveBeenCalled();
    const pre = el.children[0]!;
    expect(pre.classes).toContain("language-exoql");
    const code = pre.children[0]!;
    expect(code.classes).toContain("language-exoql");
  });

  it("when enabled, delegates to the SPARQL processor (legacy behaviour)", () => {
    const el = makeEl();
    const processSpy = jest.fn(() => "executed");
    const result = renderSparqlBlock(
      true,
      "ASK { ?s ?p ?o }",
      el,
      "sparql",
      processSpy,
    );
    expect(result).toBe("executed");
    expect(processSpy).toHaveBeenCalledWith("ASK { ?s ?p ?o }", el);
    // No plain <pre> appended when delegated
    expect(el.children).toHaveLength(0);
  });
});
