import {
  ParkedLinkPlaceholder,
  PARKED_PLACEHOLDER_CLASS,
  PARKED_SPACE_ATTR,
} from "../../../../src/presentation/parked/ParkedLinkPlaceholder";
import { BodyLinkPatch } from "../../../../src/presentation/body/BodyLinkPatch";
import { PropertiesLinkPatch } from "../../../../src/presentation/properties/PropertiesLinkPatch";
import type { ParkedAssetHit } from "@kitelev/exocortex-core";

/**
 * req `c171e24d-15d3-4073-a34b-f6e78d3bc15f` — an unresolved link into a PARKED
 * AssetSpace renders as "<label> ⏸ / activate"; an unresolved link to an asset
 * that exists nowhere stays exactly as Obsidian left it.
 *
 * Both render channels are covered through their REAL entry points
 * (`BodyLinkPatch.enable()` / `PropertiesLinkPatch.enable()`), not by calling the
 * placeholder directly — the wiring being present in the production path is a
 * separate guarantee from the placeholder doing its job, and only these two
 * suites lock it.
 */

const PARKED_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const HIT: ParkedAssetHit = {
  path: `.exocortex/parked/kitelev/exoas-concepts/concepts/${PARKED_UID}.md`,
  assetSpace: "kitelev/exoas-concepts",
  label: "МОЧИ",
};

/** Let the fire-and-forget lookup settle. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function makeLink(): HTMLElement {
  const link = document.createElement("a");
  link.className = "internal-link";
  link.setAttribute("data-href", PARKED_UID);
  link.textContent = PARKED_UID;
  return link;
}

describe("ParkedLinkPlaceholder", () => {
  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f renders the ASSET's own label with a pause glyph", async () => {
    const link = makeLink();
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(HIT),
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    expect(link.textContent).toBe("МОЧИ ⏸");
    expect(link.classList.contains(PARKED_PLACEHOLDER_CLASS)).toBe(true);
    expect(link.getAttribute(PARKED_SPACE_ATTR)).toBe("kitelev/exoas-concepts");
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f keeps the AssetSpace name OUT of the tooltip — a touch device generates no hover", async () => {
    const link = makeLink();
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(HIT),
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    const tooltip = `${link.getAttribute("aria-label") ?? ""}${link.getAttribute("title") ?? ""}`;
    expect(tooltip).not.toContain("exoas-concepts");
    expect(tooltip).not.toContain("kitelev/");
    expect(tooltip).toContain("МОЧИ");
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f routes a tap to the activate action instead of Obsidian's create-missing-note", async () => {
    const link = makeLink();
    const activated: ParkedAssetHit[] = [];
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(HIT),
      activate: (hit) => activated.push(hit),
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(activated).toEqual([HIT]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f NEGATIVE CONTROL — a link to an asset that exists nowhere is left untouched (stays broken)", async () => {
    const link = makeLink();
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(null),
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    expect(link.textContent).toBe(PARKED_UID);
    expect(link.classList.contains(PARKED_PLACEHOLDER_CLASS)).toBe(false);
    expect(link.hasAttribute(PARKED_SPACE_ATTR)).toBe(false);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f NEGATIVE CONTROL — a failed lookup is not evidence of parking, the link is left untouched", async () => {
    const link = makeLink();
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.reject(new Error("adapter unavailable")),
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    expect(link.textContent).toBe(PARKED_UID);
    expect(link.classList.contains(PARKED_PLACEHOLDER_CLASS)).toBe(false);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f falls back to the file's own basename when the parked asset carries no label", async () => {
    const link = makeLink();
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve({ ...HIT, label: null }),
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    await settle();

    expect(link.textContent).toBe(`${PARKED_UID} ⏸`);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f checks a given link only once, however many times the patch re-runs", async () => {
    const link = makeLink();
    let lookups = 0;
    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => {
        lookups += 1;
        return Promise.resolve(HIT);
      },
      activate: () => undefined,
    });

    placeholder.decorate(link, PARKED_UID);
    placeholder.decorate(link, PARKED_UID);
    await settle();
    placeholder.decorate(link, PARKED_UID);
    await settle();

    expect(lookups).toBe(1);
  });
});

/**
 * Both channels, through their real entry points. These are the axes that lock
 * the WIRING: deleting the `decorate(...)` call from either patch reddens the
 * corresponding test while everything above stays green.
 */
describe("parked placeholder reaches BOTH render channels", () => {
  let container: HTMLElement;

  function makePlugin(
    placeholder: ParkedLinkPlaceholder | undefined,
    root: HTMLElement,
  ): Record<string, unknown> {
    return {
      app: {
        workspace: {
          getLeavesOfType: () => [{ view: { containerEl: root } }],
          on: () => ({ id: "t" }),
        },
        vault: { getAbstractFileByPath: () => null },
        metadataCache: {
          // The parked asset is invisible to the index BY CONSTRUCTION — that
          // asymmetry is the whole mechanism, so the fake must reproduce it.
          getFirstLinkpathDest: () => null,
          getFileCache: () => null,
          on: () => ({ id: "t" }),
        },
      },
      registerEvent: () => undefined,
      settings: {
        displayNameSettings: { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      },
      parkedLinkPlaceholder: placeholder,
    };
  }

  afterEach(() => {
    if (container.parentNode !== null) container.parentNode.removeChild(container);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f body channel — a wikilink in the note body renders the placeholder", async () => {
    const preview = document.createElement("div");
    preview.className = "markdown-preview-view";
    const link = makeLink();
    preview.appendChild(link);
    container = document.createElement("div");
    container.appendChild(preview);
    document.body.appendChild(container);

    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(HIT),
      activate: () => undefined,
    });
    const patch = new BodyLinkPatch(
      makePlugin(placeholder, container) as never,
    );
    patch.enable();
    await settle();
    patch.cleanup();

    expect(link.textContent).toBe("МОЧИ ⏸");
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f body channel NEGATIVE CONTROL — with no parked hit the body link stays broken", async () => {
    const preview = document.createElement("div");
    preview.className = "markdown-preview-view";
    const link = makeLink();
    preview.appendChild(link);
    container = document.createElement("div");
    container.appendChild(preview);
    document.body.appendChild(container);

    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(null),
      activate: () => undefined,
    });
    const patch = new BodyLinkPatch(
      makePlugin(placeholder, container) as never,
    );
    patch.enable();
    await settle();
    patch.cleanup();

    expect(link.textContent).toBe(PARKED_UID);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f frontmatter channel — a link in the Properties block renders the placeholder", async () => {
    const metadata = document.createElement("div");
    metadata.className = "metadata-container";
    const link = makeLink();
    metadata.appendChild(link);
    container = document.createElement("div");
    container.appendChild(metadata);
    document.body.appendChild(container);

    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(HIT),
      activate: () => undefined,
    });
    const patch = new PropertiesLinkPatch(
      makePlugin(placeholder, container) as never,
    );
    patch.enable();
    await settle();
    patch.cleanup();

    expect(link.textContent).toBe("МОЧИ ⏸");
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f frontmatter channel NEGATIVE CONTROL — with no parked hit the property link stays broken", async () => {
    const metadata = document.createElement("div");
    metadata.className = "metadata-container";
    const link = makeLink();
    metadata.appendChild(link);
    container = document.createElement("div");
    container.appendChild(metadata);
    document.body.appendChild(container);

    const placeholder = new ParkedLinkPlaceholder({
      lookup: () => Promise.resolve(null),
      activate: () => undefined,
    });
    const patch = new PropertiesLinkPatch(
      makePlugin(placeholder, container) as never,
    );
    patch.enable();
    await settle();
    patch.cleanup();

    expect(link.textContent).toBe(PARKED_UID);
  });

  it("@req:c171e24d-15d3-4073-a34b-f6e78d3bc15f NEGATIVE CONTROL — an unwired placeholder leaves both channels byte-identical", async () => {
    const preview = document.createElement("div");
    preview.className = "markdown-preview-view";
    const link = makeLink();
    preview.appendChild(link);
    container = document.createElement("div");
    container.appendChild(preview);
    document.body.appendChild(container);

    const patch = new BodyLinkPatch(makePlugin(undefined, container) as never);
    patch.enable();
    await settle();
    patch.cleanup();

    expect(link.textContent).toBe(PARKED_UID);
    expect(link.hasAttribute("data-parked-checked")).toBe(false);
  });
});
