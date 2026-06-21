import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/** HTML-escape text destined for element/attribute content. */
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render a markdown body to HTML (GFM: tables, fenced code, inline code). */
export function mdToHtml(md) {
  return marked.parse(String(md ?? ""), { async: false });
}

/** Slug-safe id for an anchor (only used for ADR ids / uids — already safe). */
export function slug(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Sanitize a uid/id into a single SAFE path segment for an output filename + its
 * matching href. Strips any path separator or other unsafe character (so a
 * malformed `exo__Asset_uid: "../../etc/x"` cannot escape the output directory),
 * while preserving case — identity for real data (UUIDs, `ARCH-001`). A segment
 * that is empty or only dots is replaced with a literal marker. Used by both the
 * filename writer (`site.mjs`) and the index hrefs so links always resolve.
 */
export function safeSegment(s) {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]/g, "-");
  if (cleaned === "" || /^\.+$/.test(cleaned)) return "_invalid_";
  return cleaned;
}

// SDD feature-lifecycle statuses (proposed → approved → active → deprecated).
// `Draft` retained as a legacy alias of `Proposed`.
const STATUS_CLASS = {
  Active: "ok", // in force — merged + revert-verified test green (CI-hard-gated)
  Approved: "ok", // human-approved prose; implementation in progress
  Proposed: "warn", // drafted, awaiting human review/approval
  Draft: "warn", // legacy alias of Proposed
  Deprecated: "muted", // explicitly withdrawn
};

export function statusBadge(status) {
  const s = status ?? "Unknown";
  const cls = STATUS_CLASS[s] ?? "neutral";
  return `<span class="badge badge-${cls}" title="lifecycle status">${escapeHtml(s)}</span>`;
}

export function priorityBadge(priority) {
  if (!priority) return "";
  const cls = priority === "P0" ? "p0" : "neutral";
  return `<span class="badge badge-${cls}" title="priority">${escapeHtml(priority)}</span>`;
}

export function coverageBadge(covered, n) {
  return covered
    ? `<span class="badge badge-ok" title="verified by ${n} binding(s)">✓ covered</span>`
    : `<span class="badge badge-warn" title="no verification binding yet">○ uncovered</span>`;
}

/**
 * Render the "Awaiting review" queue — the requirements that need human approval
 * (status `Proposed`, plus the legacy `Draft` alias). This is the morning-approve
 * surface of the SDD feature-lifecycle (RFC 0003): a focused, deep-linkable list
 * separated from the full reference table so a reviewer sees exactly what awaits
 * their sign-off and can open each to read its Gherkin and approve. Already-
 * `Active`/`Approved`/`Deprecated` requirements are intentionally excluded.
 * Renders a positive "nothing awaiting" note when the queue is empty.
 *
 * @param {Array<{uid:string,label:string,status:string|null,priority:string|null,covered:boolean,verifiedBy?:string[]}>} reqs
 */
export function awaitingReviewSection(reqs) {
  const awaiting = (reqs ?? []).filter(
    (r) => r.status === "Proposed" || r.status === "Draft",
  );
  if (awaiting.length === 0) {
    return `
<section id="awaiting-review" class="review-queue reviewed">
  <h2>Awaiting review <span class="badge badge-ok">✓ none</span></h2>
  <p class="note">The review queue is empty — no requirement is in the <em>Proposed</em> state awaiting approval.</p>
</section>`;
  }
  const items = awaiting
    .map(
      (r) => `<li>
  <a href="requirements/${safeSegment(r.uid)}.html">${escapeHtml(r.label)}</a>
  ${[priorityBadge(r.priority), coverageBadge(r.covered, (r.verifiedBy ?? []).length)]
    .filter(Boolean)
    .join(" ")}
</li>`,
    )
    .join("\n");
  return `
<section id="awaiting-review" class="review-queue">
  <h2>Awaiting review <span class="chip">${awaiting.length}</span></h2>
  <p class="note">Requirements drafted and <strong>awaiting approval</strong> (status <em>Proposed</em>). Open one to read its <code>Given / When / Then</code> statement, then approve. Sorted by priority.</p>
  <ul class="review-list">
${items}
  </ul>
</section>`;
}

/** A full HTML page shell (Jekyll-free static output). */
export function layout({ title, content, relRoot = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Publicly reachable by link, but kept out of search engines: noindex (do not
     index), nofollow (do not follow links for indexing), noarchive (no cached
     copy). The content is public, but discoverability is deliberately not. -->
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${escapeHtml(title)} · Exocortex Living Docs</title>
<link rel="stylesheet" href="${relRoot}assets/style.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="${relRoot}index.html">Exocortex · Living Documentation</a>
  <nav>
    <a href="${relRoot}index.html#awaiting-review">Review queue</a>
    <a href="${relRoot}index.html#requirements">Requirements</a>
    <a href="${relRoot}index.html#adrs">Architecture</a>
    <a href="${relRoot}ontology.html">Ontology</a>
  </nav>
</header>
<main class="container">
${content}
</main>
<footer class="site-footer">
  <p>Generated from the graph (RFC 0004) — public requirements + architectural decisions of <code>kitelev/exocortex</code>. Built by a PAT-less, fail-closed-by-absence pipeline.</p>
</footer>
</body>
</html>
`;
}

/** Render a single requirement detail page. */
export function requirementPage(req, relRoot = "../") {
  const meta = [
    statusBadge(req.status),
    priorityBadge(req.priority),
    coverageBadge(req.covered, req.verifiedBy.length),
    ...req.bindingClasses.map(
      (b) => `<span class="badge badge-neutral" title="binding class">${escapeHtml(b)}</span>`,
    ),
  ]
    .filter(Boolean)
    .join(" ");

  const list = (label, items) =>
    items && items.length
      ? `<section class="kv"><h3>${escapeHtml(label)}</h3><ul>${items
          .map((i) => `<li><code>${escapeHtml(i)}</code></li>`)
          .join("")}</ul></section>`
      : "";

  const content = `
<article class="req">
  <p class="crumbs"><a href="${relRoot}index.html#requirements">← all requirements</a></p>
  <h1>${escapeHtml(req.label)}</h1>
  <p class="badges">${meta}</p>
  <p class="uid">uid <code>${escapeHtml(req.uid)}</code>${
    req.area ? ` · area ${escapeHtml(req.area)}` : ""
  }${req.author ? ` · author ${escapeHtml(req.author)}` : ""}</p>
  <div class="body">${mdToHtml(req.body)}</div>
  ${list("Covers", req.covers)}
  ${list("Verified by", req.verifiedBy)}
  ${list("Implemented by", req.implementedBy)}
</article>`;
  return layout({ title: req.label, content, relRoot });
}

/** Render a single ADR detail page. */
export function adrPage(adr, relRoot = "../") {
  const rulesBadge = adr.rules
    ? `<span class="badge badge-ok" title="machine-enforced by archgate">⚙ enforced</span>`
    : `<span class="badge badge-muted" title="documented, not auto-enforced">documented</span>`;
  const content = `
<article class="adr">
  <p class="crumbs"><a href="${relRoot}index.html#adrs">← all architectural decisions</a></p>
  <h1>${escapeHtml(adr.id)} — ${escapeHtml(adr.title)}</h1>
  <p class="badges"><span class="badge badge-neutral" title="domain">${escapeHtml(
    adr.domain,
  )}</span> ${rulesBadge}</p>
  <div class="body">${mdToHtml(adr.body)}</div>
</article>`;
  return layout({ title: `${adr.id} — ${adr.title}`, content, relRoot });
}

/** Render the ontology reference page (flat class + property listing). */
export function ontologyPage({ classes, properties }) {
  const classRows = classes
    .map(
      (c) =>
        `<tr><td><code>${escapeHtml(c.label)}</code></td><td class="uid">${escapeHtml(c.uid)}</td></tr>`,
    )
    .join("\n");
  const propRows = properties
    .map(
      (p) => `<tr>
  <td><code>${escapeHtml(p.label)}</code></td>
  <td>${p.domain ? escapeHtml(p.domain) : "—"}</td>
  <td>${p.range ? escapeHtml(p.range) : "—"}</td>
</tr>`,
    )
    .join("\n");
  const content = `
<article class="ontology">
  <p class="crumbs"><a href="index.html">← home</a></p>
  <h1>Ontology reference</h1>
  <p class="note">Browsable class &amp; property reference rendered from the public <code>exoas-exo</code> ontology submodule. Requirements above reference these terms.</p>
  <h2>Classes <span class="chip">${classes.length}</span></h2>
  <table class="grid"><thead><tr><th>Class</th><th>uid</th></tr></thead><tbody>
${classRows || '<tr><td colspan="2">No classes found.</td></tr>'}
  </tbody></table>
  <h2>Properties <span class="chip">${properties.length}</span></h2>
  <table class="grid"><thead><tr><th>Property</th><th>Domain</th><th>Range</th></tr></thead><tbody>
${propRows || '<tr><td colspan="3">No properties found.</td></tr>'}
  </tbody></table>
</article>`;
  return layout({ title: "Ontology reference", content, relRoot: "" });
}

/** Render the landing/index page with summary tables. */
export function indexPage({ reqs, adrs, stats, ontology, generatedNote }) {
  const statusChips = Object.entries(stats.byStatus)
    .map(([k, v]) => `<span class="chip">${escapeHtml(k)}: ${v}</span>`)
    .join(" ");
  const reqRows = reqs
    .map(
      (r) => `<tr>
  <td><a href="requirements/${safeSegment(r.uid)}.html">${escapeHtml(r.label)}</a></td>
  <td>${statusBadge(r.status)}</td>
  <td>${priorityBadge(r.priority) || "—"}</td>
  <td>${coverageBadge(r.covered, r.verifiedBy.length)}</td>
</tr>`,
    )
    .join("\n");
  const adrRows = adrs
    .map(
      (a) => `<tr>
  <td><a href="adrs/${safeSegment(a.id)}.html">${escapeHtml(a.id)}</a></td>
  <td><a href="adrs/${safeSegment(a.id)}.html">${escapeHtml(a.title)}</a></td>
  <td><span class="chip">${escapeHtml(a.domain)}</span></td>
  <td>${a.rules ? "⚙ enforced" : "documented"}</td>
</tr>`,
    )
    .join("\n");

  const content = `
<section class="hero">
  <h1>Exocortex — Living Documentation</h1>
  <p class="lede">The public requirements and architectural decisions of <code>kitelev/exocortex</code>, rendered <strong>from the graph</strong> (RFC 0004). Privacy is guaranteed <strong>by construction</strong>: this site is built by a PAT-less pipeline that physically cannot fetch any private repository.</p>
  <div class="stats">
    <div class="stat"><b>${stats.total}</b><span>requirements</span></div>
    <div class="stat"><b>${Math.round(stats.coverage * 100)}%</b><span>covered</span></div>
    <div class="stat"><b>${adrs.length}</b><span>architectural decisions</span></div>
    ${
      ontology && (ontology.classes.length || ontology.properties.length)
        ? `<a class="stat" href="ontology.html"><b>${ontology.classes.length + ontology.properties.length}</b><span>ontology terms</span></a>`
        : ""
    }
  </div>
  <p class="chips">${statusChips}</p>
</section>

${awaitingReviewSection(reqs)}

<section id="requirements">
  <h2>Functional requirements</h2>
  <p class="note">Each requirement carries a Gherkin <code>Given/When/Then</code> statement. <em>Coverage</em> reflects the <code>verifiedBy</code> binding declared on the requirement (from-graph). All lifecycle statuses are shown, explicitly labelled.</p>
  <table class="grid">
    <thead><tr><th>Requirement</th><th>Status</th><th>Priority</th><th>Coverage</th></tr></thead>
    <tbody>
${reqRows || '<tr><td colspan="4">No requirements found.</td></tr>'}
    </tbody>
  </table>
</section>

<section id="adrs">
  <h2>Architectural &amp; NFR decisions</h2>
  <p class="note">Architecture Decision Records from <code>.archgate/adrs</code>. Those marked <em>⚙ enforced</em> are machine-checked by the archgate CI gate.</p>
  <table class="grid">
    <thead><tr><th>ID</th><th>Title</th><th>Domain</th><th>Enforcement</th></tr></thead>
    <tbody>
${adrRows || '<tr><td colspan="4">No ADRs found.</td></tr>'}
    </tbody>
  </table>
</section>

${generatedNote ? `<p class="note generated">${escapeHtml(generatedNote)}</p>` : ""}
`;
  return layout({ title: "Living Documentation", content, relRoot: "" });
}

/** Minimal, dependency-free stylesheet for the static site. */
export const STYLESHEET = `:root{
  --bg:#fff; --fg:#1a1d23; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb;
  --ok-bg:#dcfce7; --ok-fg:#166534; --warn-bg:#fef9c3; --warn-fg:#854d0e;
  --p0-bg:#fee2e2; --p0-fg:#991b1b; --neutral-bg:#eef2ff; --neutral-fg:#3730a3;
  --muted-bg:#f3f4f6; --muted-fg:#6b7280; --code-bg:#f6f8fa;
}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
.site-header{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;padding:.9rem 1.4rem;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
.brand{font-weight:700;color:var(--fg);text-decoration:none}
.site-header nav a{margin-left:1rem;color:var(--accent);text-decoration:none;font-size:.95rem}
.container{max-width:880px;margin:0 auto;padding:1.6rem 1.4rem 4rem}
.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding:1.4rem;max-width:880px;margin:0 auto}
h1{font-size:1.7rem;line-height:1.25;margin:.2rem 0 .6rem}
h2{font-size:1.3rem;margin:2rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.4rem 0 .4rem}
a{color:var(--accent)}
code{background:var(--code-bg);padding:.12em .35em;border-radius:4px;font-size:.88em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--code-bg);padding:.9rem 1rem;border-radius:8px;overflow:auto;border:1px solid var(--line)}
pre code{background:none;padding:0}
.hero .lede{color:#374151;font-size:1.05rem}
.stats{display:flex;gap:1.2rem;flex-wrap:wrap;margin:1.2rem 0}
.stat{background:var(--muted-bg);border:1px solid var(--line);border-radius:10px;padding:.7rem 1.1rem;text-align:center;min-width:90px}
.stat b{display:block;font-size:1.5rem}
.stat span{color:var(--muted);font-size:.8rem}
.chips,.chip{display:inline-block}
.chip{background:var(--neutral-bg);color:var(--neutral-fg);border-radius:999px;padding:.1rem .6rem;font-size:.8rem;margin:.1rem .2rem .1rem 0}
.badge{display:inline-block;border-radius:6px;padding:.1rem .5rem;font-size:.78rem;font-weight:600;margin-right:.2rem}
.badge-ok{background:var(--ok-bg);color:var(--ok-fg)}
.badge-warn{background:var(--warn-bg);color:var(--warn-fg)}
.badge-p0{background:var(--p0-bg);color:var(--p0-fg)}
.badge-neutral{background:var(--neutral-bg);color:var(--neutral-fg)}
.badge-muted{background:var(--muted-bg);color:var(--muted-fg)}
table.grid{width:100%;border-collapse:collapse;margin:.6rem 0}
table.grid th,table.grid td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
table.grid th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.body table{border-collapse:collapse;margin:.6rem 0}
.body th,.body td{border:1px solid var(--line);padding:.4rem .6rem}
.body blockquote{margin:.6rem 0;padding:.2rem .9rem;border-left:3px solid var(--line);color:#374151}
.crumbs{font-size:.85rem;margin:0 0 .6rem}
.uid{color:var(--muted);font-size:.85rem;margin:.2rem 0 1.2rem}
.note{color:var(--muted);font-size:.9rem}
.kv ul{margin:.2rem 0 0;padding-left:1.1rem}
.kv li{margin:.2rem 0}
.review-queue{border-left:4px solid var(--warn-fg);background:#fffdf5;border-radius:0 10px 10px 0;padding:.2rem 1.1rem 1rem;margin:1.4rem 0}
.review-queue.reviewed{border-left-color:var(--ok-fg);background:#f6fef9}
.review-queue h2{border-bottom:none;margin:1rem 0 .3rem;font-size:1.2rem}
.review-list{list-style:none;margin:.4rem 0 0;padding:0}
.review-list li{padding:.45rem 0;border-bottom:1px solid var(--line)}
.review-list li:last-child{border-bottom:none}
`;
