# User Troubleshooting Guide

**Common issues and solutions for Exocortex users.**

This page has two halves:

- **[Setup, auth & sync](#setup-auth--sync)** — the _operational_ issues you hit
  while getting a vault running: GitHub auth/PAT, ExoSync conflicts, applying a
  profile, bootstrapping, and mobile. **Start here if you're an early tester.**
- **Layout & usage** (the sections below the divider) — display/behaviour issues
  once a vault is up: layouts, buttons, wiki-links, daily tasks, graph view.

> **First-run hiccups during install** (no buttons yet, grey class links, plugin
> not loading, BRAT URL doing nothing) are walked through in the
> [Getting Started → Troubleshooting](../tutorials/Getting-Started.md#troubleshooting)
> section — that's the place for setup-time problems.
>
> For new vocabulary (AssetSpace, Profile, mount-state, TS-floor, PAT, …) see the
> [Concepts glossary](../explanation/Concepts.md).
>
> For **development / CI** issues, see [DEV-TROUBLESHOOTING.md](../../DEV-TROUBLESHOOTING.md).

---

## Setup, auth & sync

These are the issues early testers hit most. They are grouped by the command
that surfaces them: **GitHub auth**, **Sync**, **Apply profile**, **Bootstrap**,
and **Mobile**.

### GitHub auth — Personal Access Token (PAT)

**Problem**: Adding or syncing a **private** AssetSpace fails with _"repository
does not exist"_, **404**, or **401**.

**Cause**: A **fine-grained** PAT whose repository allowlist doesn't cover the
repo gets a **404** from GitHub (it hides the existence of repos you can't see) —
so a "does not exist" error usually means the token is _missing that repo_, not
that the repo is gone. A genuine **401/403** means the token is expired, revoked,
or under-scoped. Public onboarding (`$$core`, the registry, the profiles space)
needs **no** PAT at all.

**Solutions**:

1. **Settings → Exocortex → GitHub PAT.** Use a **fine-grained** token from
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   (not the classic `/settings/tokens/new` page). Scope it to your `exoas-*`
   repos with a **per-repository allowlist** and grant exactly:

   | Permission   | Access         | Why                                            |
   | ------------ | -------------- | ---------------------------------------------- |
   | **Contents** | Read and write | Pull private AssetSpaces and push your commits |
   | **Metadata** | Read-only      | Mandatory baseline (GitHub auto-selects it)    |

2. Click **Save PAT**, then **Test connection** to confirm it reaches GitHub
   before you rely on it.
3. **If a private repo "does not exist"** during Apply/Sync, check the token's
   repository allowlist first — that is the most common cause.

The token is stored device-local in
`.obsidian/plugins/exocortex/data.local.json` (key `pat`); the `.local.` infix
keeps it out of Obsidian Sync replication, and it is never committed.

---

### "I saved a PAT but the plugin still acts unauthenticated"

**Problem**: You entered a valid PAT, but a Bootstrap / Add-pack / Apply of a
private repo still fails as if no token were set.

**Cause & fix**:

- **Current builds read the _currently-stored_ PAT at command time on every
  path** — Bootstrap, Add a knowledge pack, Sync, **and Apply profile (both
  desktop and mobile)** rebuild their GitHub client from the PAT you just saved,
  so a freshly-entered token works **without a reload**
  ([#3382](https://github.com/kitelev/exocortex/issues/3382) for Bootstrap/Add,
  [#3557](https://github.com/kitelev/exocortex/issues/3557) for the apply
  materialize path). **Just re-run the command.**
- **If it still fails unauthenticated, you're probably on an older build** where
  apply used an onload-captured client. **Reload Obsidian** (Cmd/Ctrl + P →
  "Reload app without saving") so the PAT is picked up, then re-apply — and
  update via BRAT so the per-command PAT rebuild applies.

---

### Sync (`Exocortex: Sync`)

**Problem**: `Exocortex: Sync` reports an error status, or conflicts pile up.

**Reading the result**: One run syncs every mounted AssetSpace (pull → merge →
push, best-effort). The summary notice shows `pushed / pulled / merged /
quarantined`; per-repo detail goes to the developer console
(`[ExoSync] …`, Ctrl/Cmd + Shift + I). Common statuses:

1. **`auth-required` (HTTP 401 / 403)** — the PAT is expired, revoked, or
   under-scoped. (A _fine-grained_ PAT missing a private repo surfaces as a
   generic **404**, not `auth-required` — see [GitHub auth](#github-auth--personal-access-token-pat) above.)
2. **`full-conflict`** — the first sync over a tree that already diverged from
   the remote, or a watermark whose base commit no longer matches the remote
   (e.g. after a backup restore). **Nothing is touched.** Align the local tree
   with the remote (or delete the watermark file
   `exosync-watermarks.local.json` in the plugin folder) and re-sync.
3. **Conflicts → quarantine** — a real conflict is preserved, not guessed; it
   **re-derives on every sync until you resolve it**. Resolve it with
   **Cmd/Ctrl + P → "Exocortex: Resolve sync conflicts"**, which lists each
   conflict and shows the two versions side-by-side (local | remote) with
   **Keep local / Keep remote / Merge** (an editable field seeded with the local
   version); choosing writes the kept version to disk **and** the remote.
   Alternatively, resolve by making the two sides **converge** by hand (edit the
   local file and/or the remote so they agree) — once they match, the pin clears
   and the entry auto-tombstones as `resolved`. Optionally set a
   **Quarantine repo URL** (Settings → Exocortex → ExoSync) to keep conflict
   copies cross-device. **FileSpaces refuse to sync without a quarantine repo**,
   because their remote-wins policy would otherwise destroy the only local copy.
4. **First sync is safe** — on a freshly-mounted AssetSpace the first sync just
   bootstraps the baseline; nothing is overwritten unless the local tree already
   diverged from the remote.
5. **Local deletes/renames are not pushed** — the write primitive cannot express
   deletions, so they appear as `deferredDeletes` warnings and re-surface every
   sync. Remote deletes _are_ applied locally.

For the full sync model (3-way merge, FileSpaces, CLI usage), see
[ExoSync](exosync.md).

---

### Apply profile (`Exocortex: Apply profile`)

> A **profile** is a vault-declared set of AssetSpaces to mount, and **Apply
> profile** is a **mount-state strict replace**: it materializes the profile's
> AssetSpaces and **unmounts everything else**. See the
> [Concepts glossary → Profile](../explanation/Concepts.md) and
> [profile.md](../explanation/profile.md).

**"My assets disappeared after I applied a profile"**

- They are **not lost** — Apply _unmounted_ the AssetSpaces that the new profile
  doesn't include (their folders are removed from disk but re-pullable from
  GitHub / restored from cache). **Re-apply a profile that includes them** (one
  whose `exo__Profile_includes` lists their AssetSpace) to bring them back.

**"Apply aborted — N uncommitted file(s) …" (`UncommittedChangesAbortError`)**

- On a **git-backed** vault, Apply refuses to unmount an AssetSpace with
  uncommitted changes — it never destroys un-pushed work. A fresh setup pulls
  AssetSpaces in as **untracked** files, which git counts as "uncommitted", so
  the very first Apply aborts. **Fix — commit the vault once first:**

  ```bash
  # Add a .gitignore so your PAT (data.local.json) is never committed:
  printf '.obsidian/\n.exocortex/\n' >> .gitignore
  git add -A && git commit -m "vault setup"
  ```

  Then re-run **Apply profile**. (Apply never auto-commits — committing is a
  deliberate, user-owned git action.)

**"Apply refused — profile omits the floor" (`TsFloorViolationError`)**

- Every profile must include the **TS-floor** — `exo`, the core class/property
  definitions the engine needs. Apply **refuses** a profile that would strip the
  floor rather than silently re-adding it, because stripping it would self-brick
  the plugin (no class defs, no commands). Add `exo` back to the profile, or pick
  a profile that includes it.

**Apply failed or was interrupted**

- Nothing is silently corrupted (2-phase commit + journal + on-load recovery).
  In order:
  1. **Reload Obsidian** ("Reload app without saving"). The recovery worker
     restores any AssetSpace that was destroyed-but-not-yet-materialized.
  2. **Re-run "Apply profile"** to the same target — Apply is a strict reconcile,
     so re-running converges the vault regardless of the partial state.
  3. **Desktop only** — if `git status` shows uncommitted
     `.gitmodules` / `assetspaces/` changes afterwards, re-running Apply
     recommits cleanly (or commit manually once the mount-state is correct).

**Obsidian hangs at "Loading plugins…" right after an Apply**

- **Fixed in the #3554 build** — update via BRAT (Cmd/Ctrl + P → "BRAT: Check
  for updates to all beta plugins"). On an older build, the one-time manual
  recovery is to quit Obsidian, set `"activeProfileUid": null` in
  `.obsidian/plugins/exocortex/data.local.json` (this does **not** undo the
  apply — the reduced mount stays as applied), and relaunch.

---

### Bootstrap & knowledge packs

**"I bootstrapped but there are no action buttons"**

- A clean bootstrap is **exo-only** (the floor). Action buttons (Create Task,
  Set Status, Plan on Today, …) come from the **`exocmd`** AssetSpace — add it
  via **Cmd/Ctrl + P → "Exocortex: Add a knowledge pack"**, or pull it
  transitively by **applying a profile**. (The small filter/toggle buttons at the
  top of widgets are built into the plugin and don't need `exocmd`.)

**Bootstrapping a vault that already has notes**

- The first-run wizard auto-shows only on a _genuinely fresh_ vault, but the
  commands always work from the palette. Run **"Exocortex: Set up the engine"**
  manually; re-open the wizard any time with **"Exocortex: Setup (getting
  started)"**.

**"Add a knowledge pack" didn't pull dependencies**

- It pulls **one public repo** and does **not** follow `dependsOn`. For a
  dependency-resolved set, add the **registry** and **profiles** AssetSpaces
  first, then **Apply profile** (it resolves the closure over the descriptors
  already in your vault). This is the standard bootstrap order — see
  [Getting Started → Step 2b](../tutorials/Getting-Started.md#step-2b-add-the-registry--profiles-then-apply-a-profile-recommended).

**First-run indexing placeholder**

- Right after a bootstrap the buttons area shows _"indexing… buttons will appear
  shortly"_ for a few seconds while 150+ ontology files index; the real buttons
  replace it automatically. If links still look stale after that, switch tabs or
  run **Reload layout** once.

---

### Mobile (iPhone / iPad)

**Everything runs over REST — no `git` binary needed.** Sync, Apply profile,
Bootstrap and Add-knowledge-pack all work on mobile (Desktop↔Mobile command
parity); sync and apply use a REST/tarball transport instead of `git`.

- **A PAT saved after the plugin loaded is honoured without a reload** — the
  mobile apply path rebuilds its GitHub client from the currently-stored PAT on
  each apply (#3382 pattern), just like desktop. If a private apply still fails
  unauthenticated, you're likely on an older build — reload Obsidian and update
  via BRAT (see
  ["I saved a PAT…"](#i-saved-a-pat-but-the-plugin-still-acts-unauthenticated)).
- **Keep mounts lean for fast reindexing** — a phone reindexes everything it
  mounts, so a large mount can take noticeably longer than on desktop. Apply a
  **lean profile** (only the AssetSpaces you actually need) to keep indexing
  fast. This is one of the core reasons Profiles exist.

---

## Layout Not Showing

**Problem**: Exocortex layout doesn't appear below metadata.

**Solutions**:

1. **Switch to Reading Mode**: Press Cmd/Ctrl + E
   - Layout only works in Reading Mode

2. **Check Plugin Enabled**: Settings → Community plugins → Exocortex (ON)

3. **Verify Frontmatter**: Must include `exo__Instance_class`

   ```yaml
   exo__Instance_class:
     - "[[ems__Task]]"
   ```

4. **Reload layout**: Cmd/Ctrl + P → "Reload layout"

5. **Check Console**: Ctrl/Cmd + Shift + I → Console tab for errors

---

## Buttons Not Working

**Problem**: Action buttons don't respond to clicks.

**Solutions**:

1. **Check Command Visibility**: Button may not apply to current note type
2. **Reload layout**: Force refresh with "Reload layout" command
3. **Check Console Errors**: Look for JavaScript errors
4. **Restart Obsidian**: Sometimes required after plugin updates

---

## Wiki-Links Not Resolving

**Problem**: Links show as `[[Page]]` instead of resolved labels.

**Solutions**:

1. **Check Target Exists**: Verify linked note exists
2. **Check Target Label**: Target must have `exo__Asset_label` property
3. **Add `.md` Extension**: See [Obsidian File Lookup Pattern](../../PATTERNS.md#obsidian-file-lookup-pattern)
4. **Reload layout**: Refresh after creating target note

---

## Daily Tasks Not Showing

**Problem**: Tasks don't appear in daily note.

**Solutions**:

1. **Check Date Match**: Task's `ems__Effort_plannedStartTimestamp` must match daily note's `pn__DailyNote_day`

   ```yaml
   # Task
   ems__Effort_plannedStartTimestamp: "2025-11-10"

   # Daily Note
   pn__DailyNote_day: "2025-11-10"
   ```

2. **Check Note Class**: Daily note must have `exo__Instance_class` with `"[[pn__DailyNote]]"`

3. **Check Archive Status**: Toggle "Show Archived" if task is archived

4. **Check Focus Filter**: Clear focus area filter (Set Focus Area → No focus)

---

## Status Won't Change

**Problem**: Status buttons don't update task status.

**Solutions**:

1. **Check Status Format**: Must be wiki-link format

   ```yaml
   ems__Effort_status: "[[ems__EffortStatusBacklog]]"  # Correct
   ems__Effort_status: "ToDo"  # Wrong
   ```

2. **Check Workflow Rules**: Some transitions not allowed (e.g., Draft → Done)

3. **Manual Fix**: Edit frontmatter directly if buttons fail

---

## Task Disappeared

**Problem**: Task no longer visible in daily note or relations.

**Solutions**:

1. **Check Archived**: Look for `exo__Asset_archived: true`
   - Toggle "Show Archived" in daily note
   - Remove property to un-archive

2. **Check Folder**: Task may have moved
   - Use Quick Switcher (Cmd/Ctrl + O) to find
   - Run "Repair Folder" command

3. **Check Deleted**: Look in Obsidian trash (`.trash/`)

---

## Properties Showing Empty

**Problem**: Properties table shows empty values or `undefined`.

**Solutions**:

1. **Run Clean Properties**: Cmd/Ctrl + P → "Clean Properties"
2. **Check Frontmatter Syntax**: Verify YAML format
3. **Remove Null Values**: Delete properties with no value

---

## Slow Performance

**Problem**: Plugin feels laggy or slow.

**Solutions**:

1. **Reduce Visible Items**: Archive completed tasks
2. **Clear Focus**: Remove daily note focus filter when not needed
3. **Disable Other Plugins**: Test with other plugins disabled
4. **Check Vault Size**: Performance degrades with 10,000+ notes

---

## Graph View Shows UUIDs Instead of Labels

**Problem**: Graph View displays UUID filenames like `84e75603-0103-4594-8499-09dc404800b0` instead of readable labels.

**Solutions**:

1. **Enable Setting**: Settings → Exocortex → "Show labels in graph view" (ON)

2. **Close and Reopen Graph**: After enabling setting, close Graph View tab and reopen
   - Use Cmd/Ctrl + G (local graph) or "Open graph view" command

3. **Check Label Property**: Notes must have `exo__Asset_label` in frontmatter

   ```yaml
   exo__Asset_label: "My Project"
   ```

4. **Reload Plugin**: Settings → Community plugins → Exocortex → Toggle off/on

5. **Check Both Graph Types**:
   - **Global graph** (full vault): May have different behavior than local graph
   - **Local graph** (current note): Should show immediate connections

**Note**: Graph View labels update when you open the graph, not automatically when settings change.

---

## Wikilinks in Tables Show UUIDs

**Problem**: Wikilinks inside markdown tables display raw UUIDs while links in regular paragraphs show labels.

**Example**:

```markdown
| Link          | Shows UUID?   |
| ------------- | ------------- |
| [[uuid-here]] | ❌ Shows UUID |

But [[uuid-here]] in text shows label correctly ✅
```

**Solutions**:

1. **Update Plugin**: Ensure you're on the latest version
   - Settings → Community plugins → Check for updates

2. **Switch View Mode**: Toggle between Reading/Live Preview and back
   - Press Cmd/Ctrl + E twice

3. **Reload layout**: Cmd/Ctrl + P → "Reload layout"

**Note**: If the issue persists after updating, reload the layout or toggle the view mode.

---

## SPARQL Queries Failing

**Problem**: SPARQL code blocks show errors.

**Solutions**:

1. **Check Syntax**: Use Query Builder to validate
2. **Check Triple Store**: Reload layout to refresh data

---

## Build Errors

**Problem**: `npm run build` fails.

**Solutions**:

1. **Clean Install**:

   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Check Node Version**: Requires Node.js 18+

   ```bash
   node --version  # Should be v18+
   ```

3. **Check TypeScript**: Run `npm run check:types`

---

## Getting More Help

1. **Check Console**: Ctrl/Cmd + Shift + I → Console tab
2. **Enable Debug**: Settings → Exocortex → Debug mode
3. **GitHub Issues**: https://github.com/kitelev/exocortex/issues
4. **Forum**: https://forum.obsidian.md/

---

**See also:**

- [Getting Started Guide](../tutorials/Getting-Started.md)
