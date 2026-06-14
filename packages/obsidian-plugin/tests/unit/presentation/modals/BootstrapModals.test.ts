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
  }
  function augment(el: HTMLElement): void {
    (el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }).createEl =
      function (tag: string, o?: CreateOpts): HTMLElement {
        const child = document.createElement(tag);
        if (o?.cls) child.className = o.cls;
        if (o?.text) child.textContent = o.text;
        if (o?.type) child.setAttribute("type", o.type);
        if (o?.placeholder) child.setAttribute("placeholder", o.placeholder);
        this.appendChild(child);
        augment(child);
        return child;
      }.bind(el);
    // Obsidian augments HTMLElement with `.empty()`; mirror it for onClose.
    (el as unknown as { empty: () => void }).empty = function (): void {
      while (this.firstChild) this.removeChild(this.firstChild);
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
} from "../../../../src/presentation/modals/BootstrapVaultModal";
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
  it("EC7 — URL fields start empty with kitelev example placeholders", () => {
    let result: unknown;
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();

    const inputs = Array.from(
      document.querySelectorAll("input"),
    ) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("");
    expect(inputs[1].value).toBe("");
    expect(inputs[0].getAttribute("placeholder")).toBe(
      "https://github.com/kitelev/exoas-exo",
    );
    expect(inputs[1].getAttribute("placeholder")).toBe(
      "https://github.com/kitelev/exoas-exocmd",
    );
    expect(result).toBeUndefined(); // not settled yet
  });

  it("R31 — shows the no-transitive note", () => {
    new BootstrapVaultModal(fakeApp, () => undefined).open();
    expect(document.body.textContent).toMatch(
      /dependencies are not added automatically/i,
    );
  });

  it("empty fields → Bootstrap shows error, does not settle", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel"); // unchanged — not resolved
    expect(document.body.textContent).toMatch(/required/i);
  });

  it("invalid URL → error, does not settle", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "not-a-url";
    (inputs[1] as HTMLInputElement).value =
      "https://github.com/kitelev/exoas-exocmd";
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel");
  });

  it("valid URLs → resolves the entered pair", () => {
    let result: { exoUrl: string; exocmdUrl: string } | null | undefined;
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "https://github.com/me/exo";
    (inputs[1] as HTMLInputElement).value = "https://github.com/me/exocmd";
    findButton("Bootstrap")!.click();
    expect(result).toEqual({
      exoUrl: "https://github.com/me/exo",
      exocmdUrl: "https://github.com/me/exocmd",
    });
  });

  it("B3 core-only — exo filled, exocmd blank → resolves knowledge-only (empty exocmdUrl)", () => {
    let result: { exoUrl: string; exocmdUrl: string } | null | undefined;
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "https://github.com/me/exo";
    (inputs[1] as HTMLInputElement).value = ""; // knowledge-only
    findButton("Bootstrap")!.click();
    expect(result).toEqual({
      exoUrl: "https://github.com/me/exo",
      exocmdUrl: "",
    });
  });

  it("B3 core-only — exo blank → still errors (exo required even when exocmd given)", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[1] as HTMLInputElement).value = "https://github.com/me/exocmd";
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel");
    expect(document.body.textContent).toMatch(/exo URL is required/i);
  });

  it("B3 core-only — exocmd present but malformed → errors", () => {
    let result: unknown = "sentinel";
    new BootstrapVaultModal(fakeApp, (r) => {
      result = r;
    }).open();
    const inputs = document.querySelectorAll("input");
    (inputs[0] as HTMLInputElement).value = "https://github.com/me/exo";
    (inputs[1] as HTMLInputElement).value = "not-a-url";
    findButton("Bootstrap")!.click();
    expect(result).toBe("sentinel");
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
