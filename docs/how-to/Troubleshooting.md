# User Troubleshooting Guide

**Common issues and solutions for Exocortex users.**
For **development / CI** issues, see [DEV-TROUBLESHOOTING.md](../../DEV-TROUBLESHOOTING.md).

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
   ems__Effort_status: "[[ems__EffortStatusToDo]]"  # Correct
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
