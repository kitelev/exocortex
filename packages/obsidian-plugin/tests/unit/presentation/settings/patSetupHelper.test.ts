/**
 * Unit tests for the RFC 0002 §3.5 PAT setup create-token helper (resolves P9).
 *
 * The helper renders into a caller-supplied element using Obsidian's `createEl`
 * DOM extension, so the test augments a plain jsdom element with a recursive
 * `createEl` (honouring `cls` / `text` / `href`) — mirroring the pattern used by
 * FirstRunOnboardingModal.test.ts — and asserts the real resulting DOM
 * (link href + target/rel/aria, permission list contents).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  renderPatSetupHelper,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  PAT_CREATE_TOKEN_LABEL,
  PAT_REQUIRED_SCOPES,
} from "../../../../src/presentation/settings/patSetupHelper";

interface CreateOpts {
  cls?: string;
  text?: string;
  href?: string;
}

/** Give a jsdom element Obsidian's `createEl` (recursive, attribute-copying). */
function augment(el: HTMLElement): HTMLElement {
  (
    el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }
  ).createEl = function (tag: string, o?: CreateOpts): HTMLElement {
    const child = document.createElement(tag);
    if (o?.cls) child.className = o.cls;
    if (o?.text) child.textContent = o.text;
    if (o?.href) (child as HTMLAnchorElement).setAttribute("href", o.href);
    this.appendChild(child);
    augment(child);
    return child;
  }.bind(el);
  return el;
}

function makeContainer(): HTMLElement {
  return augment(document.createElement("div"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("patSetupHelper — data exports", () => {
  it("deep-links to GitHub's fine-grained (not classic) token page", () => {
    // Fine-grained path is required for per-repo allowlist scoping; the classic
    // page is /settings/tokens/new and must NOT be used.
    expect(GITHUB_FINE_GRAINED_TOKEN_URL).toBe(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(GITHUB_FINE_GRAINED_TOKEN_URL).toContain("personal-access-tokens");
    expect(GITHUB_FINE_GRAINED_TOKEN_URL).not.toMatch(/\/settings\/tokens\/new/);
  });

  it("requires Contents: Read and write (the load-bearing push permission)", () => {
    const contents = PAT_REQUIRED_SCOPES.find(
      (s) => s.permission === "Contents",
    );
    expect(contents).toBeDefined();
    expect(contents?.access).toBe("Read and write");
    expect(contents?.why).toMatch(/exoas-\*/);
  });

  it("lists Metadata as the auto-selected baseline permission", () => {
    const metadata = PAT_REQUIRED_SCOPES.find(
      (s) => s.permission === "Metadata",
    );
    expect(metadata).toBeDefined();
    expect(metadata?.access).toBe("Read-only");
  });
});

describe("renderPatSetupHelper — DOM", () => {
  it("renders a create-token link with the correct href + label", () => {
    const container = makeContainer();
    renderPatSetupHelper(container);

    const link = container.querySelector(
      "a.exocortex-pat-setup-create-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(PAT_CREATE_TOKEN_LABEL);
    expect(link?.getAttribute("href")).toBe(GITHUB_FINE_GRAINED_TOKEN_URL);
  });

  it("opens the link safely in a new tab (a11y + security)", () => {
    const container = makeContainer();
    renderPatSetupHelper(container);

    const link = container.querySelector(
      "a.exocortex-pat-setup-create-link",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // Screen-reader label states the link leaves Obsidian (P16).
    expect(link.getAttribute("aria-label")).toMatch(/GitHub/i);
  });

  it("renders the required-permissions as a labelled list, one <li> per scope", () => {
    const container = makeContainer();
    renderPatSetupHelper(container);

    const list = container.querySelector("ul.exocortex-pat-setup-scopes");
    expect(list).not.toBeNull();
    expect(list?.getAttribute("aria-label")).toMatch(/permission/i);

    const items = container.querySelectorAll("li.exocortex-pat-setup-scope");
    expect(items).toHaveLength(PAT_REQUIRED_SCOPES.length);
  });

  it("each scope <li> shows '<permission>: <access>' in <strong> + the reason", () => {
    const container = makeContainer();
    renderPatSetupHelper(container);

    const items = Array.from(
      container.querySelectorAll("li.exocortex-pat-setup-scope"),
    );
    items.forEach((li, index) => {
      const scope = PAT_REQUIRED_SCOPES[index];
      const strong = li.querySelector("strong");
      expect(strong?.textContent).toBe(`${scope.permission}: ${scope.access}`);
      expect(li.textContent).toContain(scope.why);
    });
  });

  it("returns the wrapper element so callers can position it (reusable contract)", () => {
    const container = makeContainer();
    const wrapper = renderPatSetupHelper(container);

    expect(wrapper.classList.contains("exocortex-pat-setup-helper")).toBe(true);
    expect(wrapper.parentElement).toBe(container);
  });
});
