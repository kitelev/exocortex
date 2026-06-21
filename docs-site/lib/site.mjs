import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadRequirements, requirementStats } from "./requirements.mjs";
import { loadAdrs } from "./adrs.mjs";
import { loadOntology } from "./ontology.mjs";
import {
  indexPage,
  requirementPage,
  adrPage,
  ontologyPage,
  STYLESHEET,
} from "./render.mjs";

/**
 * @typedef {Object} BuildOptions
 * @property {string} reqs       path to the requirements ABox (exoas-exo-reqs submodule)
 * @property {string} archgate   path to the `.archgate` dir (its `adrs/` is read)
 * @property {string} [ontology] optional path to the ontology submodule (exoas-exo)
 * @property {string} out        output directory for the static site
 * @property {string} [generatedNote]
 */

/**
 * Build the full static Living-Documentation site into `out`. Reads ONLY the
 * provided (public, checked-out) paths — no network, no cross-repo fetch. This is
 * the from-graph render of RFC 0004: the privacy guarantee is upstream (a PAT-less
 * build can only have checked out public data), so this generator never needs a
 * filter.
 *
 * @param {BuildOptions} opts
 * @returns {Promise<{requirements:number, adrs:number, ontologyTerms:number, coverage:number, files:number}>}
 */
export async function buildSite(opts) {
  const { reqs, archgate, ontology, out, generatedNote } = opts;

  const requirements = await loadRequirements(reqs);
  const stats = requirementStats(requirements);
  const adrs = await loadAdrs(join(archgate, "adrs"));
  const onto = await loadOntology(ontology);

  // Clean output dir for reproducible builds.
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "requirements"), { recursive: true });
  await mkdir(join(out, "adrs"), { recursive: true });
  await mkdir(join(out, "assets"), { recursive: true });

  let files = 0;
  const write = async (rel, content) => {
    await writeFile(join(out, rel), content, "utf-8");
    files++;
  };

  // Jekyll-free marker so GitHub Pages serves the static HTML verbatim.
  await write(".nojekyll", "");
  await write("assets/style.css", STYLESHEET);
  await write(
    "index.html",
    indexPage({ reqs: requirements, adrs, stats, ontology: onto, generatedNote }),
  );

  for (const r of requirements) {
    await write(join("requirements", `${r.uid}.html`), requirementPage(r));
  }
  for (const a of adrs) {
    await write(join("adrs", `${a.id}.html`), adrPage(a));
  }
  if (onto.classes.length || onto.properties.length) {
    await write("ontology.html", ontologyPage(onto));
  }

  return {
    requirements: requirements.length,
    adrs: adrs.length,
    ontologyTerms: onto.classes.length + onto.properties.length,
    coverage: stats.coverage,
    files,
  };
}
