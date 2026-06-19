/**
 * Unit tests for the RFC 13da049f Phase 6.2/6.3 modals (BootstrapVaultModal,
 * AddAssetSpaceModal, SimpleConfirmModal).
 *
 * Local `jest.mock("obsidian")` provides a Modal that mounts `contentEl` into
 * `document.body` on `open()` and a `createEl` helper that copies the
 * attributes these modals rely on (type / placeholder / cls / text), so DOM
 * queries and `.value` reads behave like real Obsidian.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  interface CreateOpts {
    cls?: string;
    text?: string;
    type?: string;
    placeholder?: string;
    href?: string;
    attr?: Record<string, string>;
  }
  function augment(el: HTMLElement): void {
    (el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }).createEl =
      function (tag: string, o?: CreateOpts): HTMLElement {
        const child = document.createElement(tag);
        if (o?.cls) child.className = o.cls;
        if (o?.text) child.textContent = o.text;
        if (o?.type) child.setAttribute("type", o.type);
        if (o?.placeholder) child.setAttribute("placeholder", o.placeholder);
        // Mirror Obsidian's createEl `href` + `attr` support so links and
        // aria-labels are queryable (RFC 0002 §3.3 floor-link + a11y).
        if (o?.href) child.setAttribute("href", o.href);
        if (o?.attr) {
          for (const [k, v] of Object.entries(o.attr)) {
            child.setAttribute(k, v);
          }
        }
        this.appendChild(child);
        augment(child);
        return child;
      }.bind(el);
    // Obsidian augments HTMLElement with `.empty()` and `.addClass()`; mirror
    // them for onOpen/onClose.
    (el as unknown as { empty: () => void }).empty = function (): void {
      while (this.firstChild) this.removeChild(this.firstChild);
    }.bind(el);
    (el as unknown as { addClass: (c: string) => void }).addClass = function (
      c: string,
    ): void {
      this.classList.add(c);
    }.bind(el);
  }
  class MockModal {
    app: unknown;
    contentEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.contentEl = document.createElement("div");
      augment(this.contentEl);
    }
    open(): void {
      document.body.appendChild(this.contentEl);
      this.onOpen();
    }
    close(): void {
      this.onClose();
      if (this.contentEl.parentNode) {
        this.contentEl.parentNode.removeChild(this.contentEl);
      }
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return { Modal: MockModal, App: class {} };
});

import type { App } from "obsidian";
import {
  BootstrapVaultModal,
  isLikelyGitHubUrl,
  PUBLIC_EXO_FLOOR_URL,
} from "../../../../src/presentation/modals/BootstrapVaultModal";
import {
  BootstrapResultModal,
  resultCopy,
} from "../../../../src/presentation/modals/BootstrapResultModal";
import type { BootstrapResultInfo } from "../../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";
import { AddAssetSpaceModal } from "../../../../src/presentation/modals/AddAssetSpaceModal";
import { SimpleConfirmModal } from "../../../../src/presentation/modals/SimpleConfirmModal";

const fakeApp = {} as unknown as App;

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isLikelyGitHubUrl", () => {
  it.each([
    "https://github.com/kitelev/exoas-exo",
    "https://github.com/a/b",
  ])("accepts %s", (u) => expect(isLikelyGitHubUrl(u)).toBe(true));

  it.each([
    "",
    "http://github.com/a/b",
    "https://gitlab.com/a/b",
    "https://github.com/a",
    "https://github.com/a/b/c",
  ])("rejects %s", (u) => expect(isLikelyGitHubUrl(u)).toBe(false));
});

describe("BootstrapVaultModal", () => {
  it("exo-only — exactly one URL field, starts empty with the kitelev example placeholder", () => {
    let result: unknown;
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();

    const inputs = Array.from(
      document.querySelectorAll("input"),
    ) as HTMLInputElement[];
    // Exo-only clean bootstrap (2026-06-20): the misleading exocmd-URL field is
    // gone — a single exo field remains.
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("");
    expect(inputs[0].getAttribute("placeholder")).toBe(
      "https://github.com/kitelev/exoas-exo",
    );
    // No exocmd placeholder anywhere — the field was removed, not just blanked.
    expect(document.body.textContent).not.toMatch(/exoas-exocmd/);
    expect(result).toBeUndefined(); // not settled yet
  });

  it("R31 — shows the no-transitive note", () => {
    new BootstrapVaultModal(fakeApp, () => undefined).open();
    expect(document.body.textContent).toMatch(
      /dependencies are not added automatically/i,
    );
  });

  // RFC 0002 §3.3 / P6 — de-jargon the floor-field copy. The old jargon
  // ("exo ontology URL", "SDK/engine floor") must be gone, replaced with plain
  // language. Revert-verify: restoring the "exo ontology URL" label / "SDK"
  // intro makes these assertions FAIL.
  it("de-jargon — plain-language label + intro, no «SDK» / «ontology URL» jargon", () => {
    new BootstrapVaultModal(fakeApp, () => undefined).open();
    const text = document.body.textContent ?? "";
    // Plain-language field label replaces the jargon "exo ontology URL".
    expect(text).toMatch(/Engine repository URL \(required\)/);
    expect(text).not.toMatch(/ontology URL/i);
    expect(text).not.toMatch(/SDK/);
  });

  // RFC 0002 §3.3 — inline explainer + a link to the floor repo guide the user
  // on what to enter and where to get a floor, WITHOUT pre-filling (EC7).
  it("inline explainer + floor-repo link present, field still empty (EC7)", () => {
    new BootstrapVaultModal(fakeApp, () => undefined).open();
    // Explainer text guides the floor field in plain language.
    expect(document.body.textContent).toMatch(/engine floor/i);
    expect(document.body.textContent).toMatch(/public floor repo/i);
    // A real, focusable link to the floor repo (not a pre-fill).
    const link = document.querySelector(
      "a.bootstrap-vault-floor-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(PUBLIC_EXO_FLOOR_URL);
    // Opens GitHub safely (no reverse-tabnabbing) + screen-reader labelled (P16).
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("aria-label")).toMatch(/opens GitHub/i);
    // EC7 — the link/placeholder are pointers; the field itself is NOT pre-filled.
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  // P16 a11y — the URL field carries a screen-reader label matching its visible
  // <label>, so it is named out of visual context.
  it("a11y — the URL input has an aria-label", () => {
    new BootstrapVaultModal(fakeApp, () => undefined).open();
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe(
      "Engine repository URL (required)",
    );
  });

  it("empty field → Bootstrap shows error, does not settle", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel"); // unchanged — not resolved
    expect(document.body.textContent).toMatch(/exo URL is required/i);
  });

  it("invalid URL → error, does not settle", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "not-a-url";
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel");
  });

  it("valid exo URL → resolves { exoUrl } (exo-only, no exocmd in the result)", () => {
    let result: { exoUrl: string } | null | undefined;
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "https://github.com/me/exo";
    findButton("Bootstrap")!.click();
    expect(result).toEqual({ exoUrl: "https://github.com/me/exo" });
  });

  it("Cancel → resolves null", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    findButton("Cancel")!.click();
    expect(result).toBeNull();
  });
});

// RFC 0002 §3.3 / P5 — the durable, in-context bootstrap result panel. Adds a
// persistent surface ON TOP of the (already-firing) toast + activity log, with a
// next-step nudge. Revert-verify: removing the panel's next-step button (or its
// `onAddStarterContent` wiring) makes the next-step assertions FAIL.
describe("BootstrapResultModal", () => {
  const BOOTSTRAPPED: BootstrapResultInfo = {
    kind: "bootstrapped",
    folderName: "assetspaces/kitelev/exoas-exo",
    sha: "abc1234",
  };

  it("bootstrapped — durable summary states what landed + a next-step nudge", () => {
    new BootstrapResultModal(fakeApp, BOOTSTRAPPED, {
      onAddStarterContent: () => undefined,
    }).open();
    const text = document.body.textContent ?? "";
    // Durable "what happened" — folder + sha survive the toast fade.
    expect(text).toMatch(/assetspaces\/kitelev\/exoas-exo/);
    expect(text).toMatch(/abc1234/);
    // "What next" nudge points at the starter content.
    expect(text).toMatch(/Next:/);
    expect(text).toMatch(/starter content/i);
  });

  it("next-step button fires onAddStarterContent and closes the panel", () => {
    let nextCalls = 0;
    new BootstrapResultModal(fakeApp, BOOTSTRAPPED, {
      onAddStarterContent: () => {
        nextCalls++;
      },
    }).open();
    findButton("Add the starter content")!.click();
    expect(nextCalls).toBe(1);
    // Panel closed (handed off to the Add-AssetSpace flow) — content torn down.
    expect(document.querySelector(".bootstrap-result-title")).toBeNull();
  });

  it("Done button closes without firing the next step", () => {
    let nextCalls = 0;
    new BootstrapResultModal(fakeApp, BOOTSTRAPPED, {
      onAddStarterContent: () => {
        nextCalls++;
      },
    }).open();
    findButton("Done")!.click();
    expect(nextCalls).toBe(0);
    expect(document.querySelector(".bootstrap-result-title")).toBeNull();
  });

  it("already-bootstrapped — durable «already set up» result + next-step nudge", () => {
    new BootstrapResultModal(
      fakeApp,
      { kind: "already-bootstrapped" },
      { onAddStarterContent: () => undefined },
    ).open();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/already/i);
    expect(text).toMatch(/Next:/);
    // The forward action is still offered.
    expect(findButton("Add the starter content")).toBeDefined();
  });

  it("fetched — durable restore summary with the count + next-step nudge", () => {
    new BootstrapResultModal(
      fakeApp,
      { kind: "fetched", fetched: 2, total: 3 },
      { onAddStarterContent: () => undefined },
    ).open();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/2 of 3/);
    expect(text).toMatch(/Next:/);
  });

  it("a11y — both buttons carry explicit aria-labels (P16)", () => {
    new BootstrapResultModal(fakeApp, BOOTSTRAPPED, {
      onAddStarterContent: () => undefined,
    }).open();
    expect(
      findButton("Add the starter content")!.getAttribute("aria-label"),
    ).toMatch(/Add the starter content/i);
    expect(findButton("Done")!.getAttribute("aria-label")).toMatch(
      /Close the setup result/i,
    );
  });
});

// resultCopy is the pure per-outcome wording — unit-testable without DOM.
describe("resultCopy", () => {
  it("every BootstrapResultInfo kind yields a title, summary and next-step hint", () => {
    const kinds: BootstrapResultInfo[] = [
      { kind: "bootstrapped", folderName: "assetspaces/x", sha: "deadbee" },
      { kind: "fetched", fetched: 1, total: 4 },
      { kind: "already-bootstrapped" },
    ];
    for (const k of kinds) {
      const copy = resultCopy(k);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.summary.length).toBeGreaterThan(0);
      // Every outcome dead-ends nowhere — there is always a "Next:" hint.
      expect(copy.nextHint).toMatch(/Next:/);
    }
  });

  it("bootstrapped copy embeds the folder + sha", () => {
    const copy = resultCopy({
      kind: "bootstrapped",
      folderName: "assetspaces/kitelev/exoas-exo",
      sha: "abc1234",
    });
    expect(copy.summary).toMatch(/assetspaces\/kitelev\/exoas-exo/);
    expect(copy.summary).toMatch(/abc1234/);
  });
});

describe("AddAssetSpaceModal", () => {
  const derive = (u: string): string => {
    const repo = u.split("/").pop() ?? "x";
    return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  };

  it("live-previews the canonical Maven target folder (#3538)", () => {
    new AddAssetSpaceModal(fakeApp, derive, () => undefined).open();
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "https://github.com/kitelev/exoas-pmbok-ontology";
    input.dispatchEvent(new Event("input"));
    // #3538: the preview must match the actual mount path — the canonical
    // `assetspaces/<owner>/<repo>` (real derivePath), NOT the old flat
    // `assetspaces/<name>` (the injected `derive` fake is only the fallback now).
    expect(document.body.textContent).toMatch(
      /Target folder: assetspaces\/kitelev\/exoas-pmbok-ontology/,
    );
  });

  it("empty state — preview reads as an auto-derived placeholder hint (F4)", () => {
    new AddAssetSpaceModal(fakeApp, derive, () => undefined).open();
    const preview = document.querySelector(
      ".add-assetspace-preview",
    ) as HTMLElement;
    // F4: the empty preview must read as a live auto-preview hint, not as an
    // unfinished "(enter a URL)" placeholder field.
    expect(preview.textContent).toBe(
      "Target folder: auto-derived from the repository URL",
    );
    // Hint, not a real path → muted placeholder styling.
    expect(preview.classList.contains("is-placeholder")).toBe(true);
  });

  it("invalid URL — preview shows a placeholder hint, not a path (F4)", () => {
    new AddAssetSpaceModal(fakeApp, derive, () => undefined).open();
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "ftp://nope";
    input.dispatchEvent(new Event("input"));
    const preview = document.querySelector(
      ".add-assetspace-preview",
    ) as HTMLElement;
    expect(preview.textContent).toBe("Target folder: enter a valid GitHub URL");
    expect(preview.classList.contains("is-placeholder")).toBe(true);
  });

  it("valid URL clears the placeholder styling on the live preview (F4)", () => {
    new AddAssetSpaceModal(fakeApp, derive, () => undefined).open();
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "https://github.com/kitelev/exoas-pmbok-ontology";
    input.dispatchEvent(new Event("input"));
    const preview = document.querySelector(
      ".add-assetspace-preview",
    ) as HTMLElement;
    expect(preview.classList.contains("is-placeholder")).toBe(false);
  });

  it("valid URL → resolves it", () => {
    let result: { url: string } | null | undefined;
    new AddAssetSpaceModal(fakeApp, derive, (r) => {
      result = r;
    }).open();
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "https://github.com/me/thing";
    findButton("Add")!.click();
    expect(result).toEqual({ url: "https://github.com/me/thing" });
  });

  it("initialUrl pre-fills the field + live-previews it (onboarding §3.1 step 2)", () => {
    const REGISTRY = "https://github.com/kitelev/exoas-starter-registry";
    new AddAssetSpaceModal(fakeApp, derive, () => undefined, REGISTRY).open();
    const input = document.querySelector("input") as HTMLInputElement;
    // The recommended registry URL is pre-filled; the user still confirms.
    expect(input.value).toBe(REGISTRY);
    // Preview reflects the pre-filled value immediately (not a placeholder hint).
    const preview = document.querySelector(
      ".add-assetspace-preview",
    ) as HTMLElement;
    expect(preview.classList.contains("is-placeholder")).toBe(false);
    expect(preview.textContent).toMatch(
      /Target folder: assetspaces\/kitelev\/exoas-starter-registry/,
    );
  });

  it("pre-filled URL → Add resolves it without retyping", () => {
    const REGISTRY = "https://github.com/kitelev/exoas-starter-registry";
    let result: { url: string } | null | undefined;
    new AddAssetSpaceModal(
      fakeApp,
      derive,
      (r) => {
        result = r;
      },
      REGISTRY,
    ).open();
    findButton("Add")!.click();
    expect(result).toEqual({ url: REGISTRY });
  });

  it("no initialUrl → field starts empty (unchanged default)", () => {
    new AddAssetSpaceModal(fakeApp, derive, () => undefined).open();
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("invalid URL → error, no resolve", () => {
    let result: unknown = "sentinel";
    new AddAssetSpaceModal(fakeApp, derive, (r) => {
      result = r;
    }).open();
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "ftp://nope";
    findButton("Add")!.click();
    expect(result).toBe("sentinel");
  });

  it("Cancel → resolves null", () => {
    let result: unknown = "sentinel";
    new AddAssetSpaceModal(fakeApp, derive, (r) => {
      result = r;
    }).open();
    findButton("Cancel")!.click();
    expect(result).toBeNull();
  });
});

describe("SimpleConfirmModal", () => {
  it("confirm button → resolves true", () => {
    let result: boolean | undefined;
    new SimpleConfirmModal(
      fakeApp,
      { title: "T", body: "B", confirmLabel: "Fetch" },
      (r) => {
        result = r;
      },
    ).open();
    findButton("Fetch")!.click();
    expect(result).toBe(true);
  });

  it("cancel / dismiss → resolves false exactly once", () => {
    let calls = 0;
    let result: boolean | undefined;
    const modal = new SimpleConfirmModal(
      fakeApp,
      { title: "T", body: "B" },
      (r) => {
        calls++;
        result = r;
      },
    );
    modal.open();
    findButton("Cancel")!.click();
    expect(result).toBe(false);
    expect(calls).toBe(1);
  });
});
