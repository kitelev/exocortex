---
name: Bug report
about: Report a problem with the plugin, CLI, or core
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps to reproduce the behavior:
1. …
2. …
3. See error

**Expected behavior**
What you expected to happen.

**Environment**
- Component: Obsidian plugin / CLI / core
- Plugin version (Settings → Community plugins → Exocortex, or `manifest.json`): 
- CLI version (`npx @kitelev/exocortex-cli --version`): 
- Obsidian version (Settings → About): 
- OS / platform (desktop / iOS / Android): 

**Logs**
For plugin issues, attach the relevant lines of `exocortex-logs.txt` (vault root):

```
grep -iE "Failed|Error" exocortex-logs.txt
```

For CLI issues, paste the command and its full output (redact any secrets).

**Additional context**
Frontmatter of the affected note, screenshots, or anything else that helps.
