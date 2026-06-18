# RFC 0002 — UX onboarding improvements

| | |
| --- | --- |
| **Status** | Proposed |
| **Author** | UX onboarding audit (Lead UX Designer persona, AI), 2026-06-19 |
| **Scope** | `kitelev/exocortex` Obsidian plugin — first-run / onboarding UX (commands, dialogs, settings, profile, PAT). Not docs (RFC 0001), not the RDF engine. |
| **Supersedes** | — |
| **Tracking** | Alpha Launch UX subproject (vault `ems__Project`, child of Alpha Launch `[[f33732f4-410e-424a-91e2-9e894f68e2de]]`) |

> **Why in-repo:** this is a plugin product-UX proposal versioned alongside the
> code it changes (command registration, modals, settings tab). Feature/ontology
> RFCs live in the vault; this one touches `packages/obsidian-plugin/**`
> presentation code, so it ships in-repo next to RFC 0001.

> **Revision 2 (2026-06-19):** refined after a 3-lens adversarial panel
> (UX-rigor/evidence-grounding · engineering-feasibility/source-accuracy ·
> structure/priority). Two CRITICAL source-contradictions fixed: **P5** ("silent
> Bootstrap") was *inferred from config, not observed*, and source disproves it —
> the bootstrap `notify` fires an **unconditional** `Notice` *and* records to the
> always-on activity log (#3540), so it is neither silent nor channel-suppressed;
> P5 is re-grounded and downgraded to MED. **§3.3** ("pre-fill canonical URLs")
> collided with the modal's deliberate **EC7** decision (fields start empty
> because `kitelev/exoas-*` is Andrey's own ontology, not a generic floor) — the
> "use recommended" affordance is moved to the registry-based starter path and
> the Bootstrap modal keeps EC7 empty fields. Added the completeness gaps the
> panel flagged (mobile onboarding P14, error-recovery/undo P15, accessibility
> P16), split the cross-tester profile-visibility leak out of P7 (→ P7b), fixed
> the `exocortex-logs.txt` path-mismatch in P12, made §6 metrics mechanically
> checkable, and extended the §7 DoD across all four phases.

> **Method note:** findings come from a live `computer-control` audit of the
> Exocortex plugin (v16.98.1) in a real EKA alpha vault (`vault-my`, Obsidian
> 1.12.7) on 2026-06-19, plus source-grounding against `origin/main`. The live
> vault was **not** destructively re-bootstrapped (zero-data-loss); claims about
> the Bootstrap/Add-AssetSpace dialog and the bootstrap-feedback path are
> source-grounded (cited file:line) rather than reproduced. Every proposal cites
> the observation (P-id) that grounds it.

---

## 1. Context & problem

The canonical alpha-tester onboarding flow (`docs/tutorials/Getting-Started.md`)
is the **3-step starter path**: install plugin via BRAT → `Bootstrap vault`
(pull the public **exo** floor) → `Add assetspace by URL`
(**`exoas-starter-registry`**) → `Apply profile` (**`starter`**, which materializes
7 AssetSpaces) → create-instance buttons → configure PAT → `Sync`. Walking that
flow as a *new* tester through the live plugin surfaces a recurring theme: **the
engine is solid, but every onboarding touchpoint assumes the user already knows
the system.** Time-to-first-value is gated on external knowledge (the command
sequence, which repos to pull, PAT scopes, which profile is "theirs") that the UI
never supplies.

### What already works (credited — keep these)

- **Inline COMMANDS buttons** render grouped by purpose (`CREATE` / `STATUS` / `MISC`)
  with icons and clear borders — a strong, scannable affordance (observed on a live
  `ems__Project`). *[no pain — preserve]*
- **Apply-profile picker marks the active profile** `✓ (active)` — good current-state
  indication (live; `ProfileFuzzyModal.ts:70`). *[counter-balances P7]*
- **PAT "Test connection" button** exists, and the token is stored in `data.local.json`
  (Sync-excluded), stated in the settings copy — good security affordance. *[counter-balances P9]*
- **Property *keys* are humanized** in the Properties block (`status`, `class`,
  `parentEffort`) via "Replace predicate names with display labels". *[counter-balances P11]*
- **Quick-switcher shows asset labels**, not UUID filenames (live). *[preserve]*
- **The activity log** (`Exocortex: Open activity log`, #3540) is an always-on,
  channel-independent, mobile-parity feedback surface (`ActivityLogService.ts`).
  *[underused — see P5/§3.3]*

### Pain inventory (each grounded in a live observation or cited source)

| # | Finding | Severity | Touchpoint |
| --- | --- | --- | --- |
| **P1** | **First-run empty-state has zero Exocortex orientation.** `Welcome.md` is the *stock Obsidian default* ("This is your new vault…"); the empty New-tab pane shows only generic Obsidian (Create note / Go to file / Close). On plugin enable there is **no** welcome panel, ribbon wizard, or "Start here" prompt. A freshly-enabled plugin gives the tester nothing to act on. | **HIGH** | First-run / empty-state |
| **P2** | **Command palette is not onboarding-ordered.** Filtering `Exocortex` shows Sync/Pull/Push first; `Bootstrap vault` is **6th**, `Add assetspace by URL` **12th**, `Apply profile` **4th**. The canonical Bootstrap → Add → Apply sequence is scattered and out of order, and there is **no** single "Getting started / Setup" command. The user cannot infer the sequence. | **HIGH** | Setup discoverability |
| **P3** | **Heavy internal jargon in command names** + inconsistent casing. "Bootstrap vault", "Add assetspace by URL", "Unmount assetspace", "Push current assetspace", "Sync parity report", "Clear switch cache (wipe-all)", "Show current state". Source-verified casing bug: `Exocortex: edit properties` is lowercase (`EditPropertiesCommand.ts:9`) vs Title-Case siblings (`ReloadLayoutCommand.ts:6`). | **MED** | Command naming |
| **P4** | **Destructive commands are visually indistinguishable from benign ones.** `Unmount assetspace` and `Clear switch cache (wipe-all)` sit in the same flat list as `Reload layout`, with no warning styling or grouping — a new user can fire a destructive op unaware. | **MED** | Palette safety |
| **P5** | **Bootstrap setup feedback is a transient toast + a non-default log, not a durable, in-context result.** *(Corrected, rev-2.)* `invokeBootstrap()` guards an already-bootstrapped vault with a message via `this.d.notify` → `notifier.info()` → an **unconditional** `new Notice` (`ObsidianNotificationService.ts:7-9` — *not* gated by `logChannels`) **and** an always-on `activityLog.record` (`ExocortexPlugin.ts:3322-3325`). So feedback *does* fire. The residual UX gap is weaker than first reported: the toast is **transient (~4–5 s)** and easy to miss mid-action, and the activity log is a surface a first-run user won't think to open. There is no durable, in-context setup-result panel that states "what happened + what to do next". | **MED** | Bootstrap feedback |
| **P6** | **The Bootstrap modal requires a GitHub URL with dense jargon and no in-context guidance.** (Source: `BootstrapVaultModal.ts`.) Fields "exo ontology URL (required)" / "exocmd ontology URL (optional)" are empty with grey placeholder examples. Per **EC7** the empty start is *deliberate* (the placeholder `kitelev/exoas-*` is Andrey's own ontology, not a generic floor — see §3.3), but the copy ("ontology URL", "SDK/engine floor") is jargon and the modal offers no inline "what should I enter / where do I get a floor repo" guidance, nor a pointer to the next steps (registry → starter profile). | **HIGH** | Bootstrap dialog |
| **P7** | **Apply-profile picker exposes cryptic `$$`-prefixed names with no descriptions.** Live picker lists `$$core`, `$$kitelev-my ✓ (active)`, `$$kitelev-tbank`, …, plus legacy `profile-base/personal/reading/work` — **two** naming conventions mixed (`$$` sigil + bare), and **no** per-entry description of what each mounts or which to pick. `ProfileChoice` carries only `{uid,label,isActive}` (`ProfileCommands.ts`) — there is nowhere for a description today. | **HIGH** | Apply-profile discoverability |
| **P7b** | **The profile picker leaks every tester's personal profile (scope/privacy).** *(Split from P7, rev-2.)* The live picker shows `$$levina-tbank`, `$$mudriy-tbank`, `$$kalashnikova-my` — *other* testers' personal profiles — to anyone in this vault. Beyond discoverability noise, this is a scope/privacy leak: a tester sees (and could apply) profiles that aren't theirs. | **HIGH** | Profile scope / privacy |
| **P8** | **Settings is a long flat power-user list with leaked internal references and dangerous free-text editors; the onboarding-critical PAT is buried at the bottom.** ~25 toggles as one undifferentiated scroll, no sections. Source-verified leaks of **internal IDs into user-facing strings**: "Issue #2992" (`ExocortexSettingTab.ts:173`), "Issue #3539" (`:192`), "Vision Lock #1, Security #1" (`:646-647`), "(D17)" (`:730`). Free-text path editors ("Lazy bootstrap folders", "Excluded folders") let a tester break indexing; a "Warn"/"Error" log-channel matrix exposes **3 unlabeled toggles per row**. The "GitHub PAT" + "ExoSync" section is at the very bottom. | **HIGH** | Settings clarity / jargon |
| **P9** | **PAT setup has no inline "create token" helper or scope guidance.** The PAT field (placeholder `github_pat_…`, "Save PAT" / "Test connection") describes "fine-grained PAT with per-repository allowlist scoped to your exoas-* repos" but offers **no link** to GitHub's token page and **no inline list of required scopes**. PAT creation is the hardest onboarding step and the UI provides no scaffolding. | **HIGH** | PAT / private flow |
| **P10** | **Active profile shown as a raw UUID in settings.** "Active profile — Last applied: `49bd4414-…`" (`ExocortexSettingTab.ts:812`) — the UUID, not the human label `$$kitelev-my`. | **LOW** | Settings feedback |
| **P11** | **Status/class *values* render as raw jargon in the Properties block.** Property *keys* are humanized, but *values* are not: live asset shows "status: **ems__EffortStatusDoing**", "class: **ems__Project**" instead of "Doing" / "Project". Inconsistent humanization. *(General layout-readability defect — affects all asset views, not just onboarding; see §3.7 scope note.)* | **MED** | Layout readability |
| **P12** | **`exocortex-logs.txt` — the documented "first file to read" — is both absent by default and pointed at the wrong directory.** The tutorial (Getting-Started.md:461/497) tells users to read it "in your **vault root**", but the file sink is written to the **plugin data folder** (`ExocortexSettingTab.ts:521`), and info-file logging is off by default (only warn/error have `file:true`). A tester following the guidance hits a dead-end *and* looks in the wrong place. | **MED** | Troubleshooting / recoverability |
| **P13** | **First-run / cold-start button latency (partial-store window, #3588).** The "Lazy bootstrap folders" setting itself warns "buttons may take 10-20s to appear on mobile"; Known-Limitations warns first-run buttons "look stale". During the partial-store window a create-instance button can be absent with no progress indication. (Documented + source-grounded; not reproduced — the audited vault was warm, buttons rendered instantly.) | **MED** | Create-instance latency |
| **P14** | **No mobile-specific onboarding.** *(Added rev-2, panel completeness.)* The entire audit is desktop (`computer-control`, Obsidian 1.12.7). The plugin runs on mobile via a git-free REST path, but mobile onboarding is harder (PAT entry on a phone keyboard; the "10-20s buttons" warning is mobile-specific) and **no proposal addresses it**. Per the project's **Desktop↔Mobile Command Parity** invariant, onboarding parity must be stated, not assumed. (Note: bootstrap/add/sync commands *are* registered on both platforms — `ExocortexPlugin.ts:3139` — so this is a UX-completeness gap, not a parity *violation*.) | **HIGH** | Mobile onboarding |
| **P15** | **No error-recovery / "undo" loops for the failure paths a new user will hit.** *(Added rev-2.)* (a) **Wrong profile applied** — `Apply profile` is a mount-state strict replace; a novice who applies the wrong profile (P7/P7b scenario) has no obvious "undo / revert to previous profile". (b) **Bootstrap pull fails** (bad URL / network / missing PAT) — downstream failure UX is unexamined. (c) **PAT passes "Test connection" but push later 403s.** The inventory was happy-path-only. | **HIGH** | Error recovery |
| **P16** | **Zero accessibility consideration in the onboarding surface.** *(Added rev-2.)* No keyboard-nav / focus-management / screen-reader-label plan for the proposed first-run panel, and destructive-command flagging must not rely on a lone emoji glyph (AT-unreliable). | **MED** | Accessibility |

## 2. Goals

- **Cut time-to-first-value (TTFV):** a new tester reaches a working Areas → Projects →
  Tasks vault (rendered layout + action buttons) with the fewest possible *external-knowledge*
  gates (no memorizing the command sequence; recommended repos offered in-product where they
  are genuinely generic; PAT scaffolded).
- **Durable, in-context setup feedback:** every onboarding action leaves a result the user
  can read *after the toast fades* and that tells them what to do next.
- **Guide the sequence:** the plugin tells the user *what to do next* at each step.
- **De-jargon the user-facing surface:** command names, dialog copy, settings descriptions
  speak the user's language; internal IDs (Vision Lock / D-numbers / issue #s) never reach users.
- **Protect novices:** destructive and power-user controls are flagged (not by glyph alone)
  or gated behind "Advanced"; failure paths have a recovery.
- **Parity & a11y:** onboarding works on mobile and is keyboard/AT-navigable.

## 3. Proposed changes (prioritized)

Each change cites the pain point(s) it resolves.

### 3.1 First-run onboarding panel — **[P1, P2]**
On plugin enable in a not-yet-bootstrapped vault, show a **one-time "Welcome to
Exocortex" panel** (a `Modal` or a dedicated leaf) with a 3-step checklist that runs
the canonical **starter** path:
1. **Set up the engine** → opens the Bootstrap dialog (3.3), with the panel supplying
   in-context guidance on the floor repo (since the modal keeps empty fields per EC7).
2. **Add the starter content** → runs `Add assetspace by URL` pre-filled with the
   public, stable **`exoas-starter-registry`** URL (this is genuinely recommended for
   everyone — no EC7 conflict; see §3.3).
3. **Apply the starter profile** → opens the profile picker on **`starter`** (3.4).

The panel persists a "completed" flag and is re-openable via the `Setup` command (3.2).
This converts an inert empty vault (P1) into a guided path and supplies the sequence the
palette cannot convey (P2). The panel must be keyboard-navigable with managed focus (P16).

### 3.2 A guided `Setup` command + palette grooming — **[P2, P3, P4]** *(in Phase 1 — see §4)*
- Add **`Exocortex: Setup (Getting Started)`** that opens the panel from 3.1 — the one
  command a new user can find by intuition, and the re-entry point 3.1 depends on (so it
  ships **with** 3.1 in Phase 1).
- **Rename for plain language** — change the display `name` only; command **ids**
  (`exocortex:bootstrap-vault`, …) stay fixed so hotkeys/automation don't break. Verified
  safe: Obsidian `addCommand({id,name})` are independent keys with no id-from-name
  derivation (`CommandManager.ts:66`). Fix the casing bug (`edit properties` → `Edit properties`).
- **Flag destructive commands** with **both** a text marker *and* (where the palette
  allows) styling — not an emoji alone (P16): "Unmount assetspace" → "Remove knowledge
  pack (advanced)", "Clear switch cache (wipe-all)" → "Reset profile cache (advanced)".

### 3.3 Bootstrap dialog: keep EC7 empty fields, fix copy + durable result — **[P6, P5]**
- **Honor EC7** — do **not** pre-fill the Bootstrap fields with `kitelev/exoas-*` (those
  materialize Andrey's own ontology and are not a generic floor; `BootstrapVaultModal.ts:19-21`).
  The "use recommended" one-click affordance lives in the **registry** step (3.1 step 2),
  where `exoas-starter-registry` *is* a stable public default.
- **De-jargon + guide the floor field:** replace "exo ontology URL" copy with plain language
  and an inline explainer ("the engine floor — use the public floor repo or your own fork"),
  plus a link to the floor repo.
- **Durable result + next-step nudge (P5-corrected):** on success/guard, in addition to the
  existing transient toast + always-on activity-log entry, show a **persistent in-context
  result** ("exo@<sha> landed — next: Add the starter content →") so the feedback survives
  the toast fade and dead-ends nowhere. *(Note: feedback already fires unconditionally — this
  adds durability, it does not fix a "silent" action.)*

### 3.4 Profile picker: descriptions, recommended badge, scope to the user — **[P7, P7b, P10]**
- Add a **one-line description** per profile (via a new RDF profile-description property in
  the vault — consistent with the Homoiconicity invariant; the picker already sources items
  from vault `listProfileFiles()`) and a **"recommended for new users"** badge on `starter`.
- **Scope the list to the user (P7b):** by default show only profiles relevant to this vault
  (e.g. whose includes resolve locally) behind a "Show all profiles" expander, so a tester
  isn't choosing among — or accidentally applying — `$$levina-tbank` / `$$mudriy-tbank`.
- In the picker **and** the settings "Active profile" line, show the **human label**
  (`$$kitelev-my`), not the raw UUID (P10).

### 3.5 PAT setup: create-token helper + scope list — **[P9]**
- Add a **"Create token on GitHub"** link deep-linking to GitHub's *fine-grained* token page,
  plus an **inline list of required scopes** (Contents: read/write for the relevant `exoas-*`
  repos). Keep "Test connection".

### 3.6 Settings information architecture — **[P8, P10, P3]**
- **Section the settings**: **Onboarding & Sync** (PAT, profile, registry — *moved to the
  top*), **Display**, **Advanced** (lazy-bootstrap folders, excluded folders, log channels,
  SHACL, templates).
- **Strip internal references** from user-facing copy: remove "Vision Lock #1", "(D17)",
  "Issue #NNNN" (greppable — see §7); replace raw predicate names in descriptions with plain
  language *where practical* (the latter is a judgment call, not DoD-gated — see §6/§7).
- **Label the log-channel matrix** columns (Notice / Console / File); gate free-text path
  editors behind Advanced with a "you can break indexing here" caution.

### 3.7 Humanize enum/class values in the layout — **[P11]** *(cross-cutting — track separately)*
Render `ems__EffortStatusDoing` → "Doing", `ems__Project` → "Project" (reuse the existing
key-humanization). **Scope note:** P11 is a *general* layout-readability defect affecting all
asset views, not strictly onboarding — recommend a standalone tracking issue; included here
because it disproportionately confuses new users.

### 3.8 Diagnostics & cold-start polish — **[P12, P13]**
- **P12 — reconcile the logs path, don't fight it.** The sink is the plugin data folder, not
  vault root (`ExocortexSettingTab.ts:521`). Fix the **docs/troubleshooting** to point at the
  correct location and at the always-on activity log (3540), and/or add an **"Open logs"**
  command. (Do *not* force a vault-root file — that contradicts the actual sink.)
- **P13 — cold-start skeleton (best-effort, blocked on #3588).** Show a "indexing… buttons
  will appear shortly" placeholder in the COMMANDS region during the partial-store window so
  the first-run user isn't staring at a blank layout. Depends on #3588 engine timing — scope
  as best-effort.

### 3.9 Mobile onboarding parity — **[P14]**
State and verify the onboarding parity contract: the 3.1 panel renders on mobile; the Bootstrap
/ Add / Apply / Sync path uses the REST/tarball route (no git binary); PAT entry has a
mobile-friendly affordance (paste-from-clipboard hint). No proposal may introduce a
desktop-only-gated `addCommand` (parity invariant).

### 3.10 Error-recovery & undo — **[P15]**
- **Undo last profile apply:** offer a "revert to previous profile" action (the previous
  `activeProfileUid` is already cached) after an Apply, so a wrong choice is one click to undo.
- **Bootstrap/add failure UX:** on pull failure surface the cause (bad URL / network / PAT) and
  the recovery step, routed through the durable result panel (3.3), not just a toast.
- **PAT push 403 after a green "Test connection":** detect and explain (scope/expiry) rather
  than failing opaquely.

### 3.11 Accessibility & internationalization — **[P16]**
- **A11y:** the first-run panel and new modals are keyboard-navigable with managed focus and
  screen-reader labels; destructive flagging uses text + styling, never an emoji glyph alone.
- **i18n (scoped out, with rationale):** all new strings are English-only; the audited vault
  has Russian-speaking testers (`$$kalashnikova-my`, Russian asset content). Full i18n is
  **out of scope** for this RFC (no i18n framework exists in the plugin yet) but is recorded
  here as a known limitation so it isn't silently dropped.

## 4. Phasing

| Phase | Contents | Why |
| --- | --- | --- |
| **1 — TTFV core** | 3.1 first-run panel · **3.2 `Setup` command + renames/destructive-flags** (3.1 depends on it for re-entry) · 3.3 Bootstrap copy + durable result · 3.5 PAT create-token helper · 3.9 mobile parity check | Removes the biggest external-knowledge gates (sequence, recommended repos, PAT) and ships the panel with its re-entry command. Mostly presentation code. |
| **2 — Discoverability & recovery** | 3.4 profile descriptions/scope/label · 3.10 error-recovery/undo | Makes profile choice self-explanatory and gives failure paths a recovery. |
| **3 — Clarity** | 3.6 settings IA + strip internal refs · 3.11 a11y polish | Broad but mostly mechanical copy/IA + a11y work. |
| **4 — Polish (some blocked)** | 3.8 logs/path + cold-start skeleton (skeleton blocked on #3588) · 3.7 humanize values *(may be split to its own issue)* | Recoverability + first-impression polish; partly engine-dependent. |

## 5. Alternatives considered

- **Docs-only fix (expand Getting-Started).** Rejected as *sufficient*: RFC 0001 already
  hardened the docs, yet the audit shows the *in-product* flow still strands a user who
  doesn't read docs. Onboarding must work in-product (P1/P2). Docs remain the backstop.
- **Auto-run Bootstrap on enable (zero-click) / pre-fill the floor URL.** Rejected: silently
  mutating a vault / pulling repos without consent violates the plugin's "never silently
  destroy/modify" stance (Apply-profile's uncommitted-changes guard), and pre-filling
  `kitelev/exoas-*` is explicitly wrong by design (EC7 — it is Andrey's ontology, not a
  generic floor). The first-run panel asks first; "recommended" defaults live only where a
  repo is genuinely generic (`exoas-starter-registry`).
- **Rename command *ids* (not just display names).** Rejected: breaks hotkeys/automation.
  Only display `name` strings change (3.2; verified safe).
- **Ship a "starter" profile only.** Helps, but doesn't fix the picker's missing descriptions,
  the cross-tester leak (P7b), or the sequence problem — orthogonal; 3.1/3.4 still needed.

## 6. Success metrics

Framed as **mechanically checkable** predicates (the unobservable "wall-clock TTFV / counts of
user alt-tabs" framing of rev-1 is replaced — the plugin cannot observe a user leaving Obsidian).

- **M1 — Recommended path requires zero free-text URL entry beyond the floor.** On the
  recommended starter path, steps 2 and 3 (registry + profile) require **0** typed URLs
  (registry pre-filled; profile picked from a list). *Checkable:* the 3.1 panel's Add step
  defaults `exoas-starter-registry`. (The floor URL in step 1 stays user-supplied per EC7.)
- **M2 — Step-count to first value.** A first-time tester reaches a rendered layout with action
  buttons in **≤ the 3 documented commands** driven from a single entry point (the `Setup`
  panel), versus today's "find 3 scattered, mis-ordered commands with no guide". *Checkable:*
  the panel exists and chains the 3 steps.
- **M3 — Every onboarding action leaves a durable in-context result** (not only a 4–5 s toast).
  *Checkable:* Bootstrap/Add/Apply results render a persistent panel/log entry the user can
  re-read.
- **M4 — Zero internal IDs in user-facing strings** (Vision Lock / D-numbers / issue #s).
  *Checkable by grep gate* (§7).
- **M5 — 100% of destructive commands carry a text marker** (not glyph-only). *Checkable.*
- **M6 — Active profile renders as a label, not a UUID**, in picker and settings. *Checkable.*

> Directional (not gated): reduce subjective jargon in settings/dialog descriptions ("plain
> language" is a judgment call); lower first-run abandonment. These guide design but are not
> DoD predicates.

## 7. Definition of Done

Phase 1:
- [ ] `Exocortex: Setup (Getting Started)` command exists and opens the first-run panel (3.1/3.2).
- [ ] The panel chains Bootstrap → Add (`exoas-starter-registry` pre-filled) → Apply (`starter`) and is keyboard-navigable (3.1, 3.9, 3.11).
- [ ] Bootstrap success/guard renders a durable in-context result with a next-step nudge; Bootstrap fields remain empty per EC7 (3.3).
- [ ] PAT section has a "Create token on GitHub" link + inline scope list (3.5).
- [ ] No onboarding command/dialog introduces a desktop-only-gated `addCommand` (3.9).

Phase 2:
- [ ] Profile picker shows a description per profile + a "recommended" badge on `starter`, scopes out other testers' profiles behind "Show all", and renders labels not UUIDs (3.4 — resolves P7/P7b/P10).
- [ ] An "undo last profile apply" action exists; Bootstrap/add failures surface cause + recovery (3.10 — resolves P15).

Phase 3:
- [ ] Settings are sectioned (Onboarding & Sync / Display / Advanced) with PAT+Sync at top; log-channel matrix columns labeled (3.6).
- [ ] **Grep gate:** no user-facing string in `ExocortexSettingTab.ts` (or other UI) contains `Vision Lock`, `Security #`, `(D[0-9]`, or `Issue #[0-9]` (3.6 — resolves P8 internal-ID leak; M4).
- [ ] Destructive commands carry a visible text marker (not emoji-only) (3.2 — M5).

Phase 4:
- [ ] Docs/troubleshooting point `exocortex-logs.txt` at the real sink + the activity log; an "Open logs" affordance exists (3.8 — resolves P12).
- [ ] Cold-start COMMANDS skeleton ships *or* is explicitly deferred to #3588 with a note (3.8 — P13).
- [ ] Enum/class values humanized in the layout, **or** split to a standalone layout-readability issue and linked (3.7 — P11).

Each shipped item links back to the pain point (P-id) it resolves in the PR body.
