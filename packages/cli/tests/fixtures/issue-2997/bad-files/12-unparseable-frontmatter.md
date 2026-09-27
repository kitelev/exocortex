---
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Asset_uid: bad00012-0000-0000-0000-000000000012
exo__Asset_createdAt: 2026-05-02T00:00:00+0500
exo__Instance_class: "[[c1c1c1c1-0000-0000-0000-000000000001|ems__Task]]"
exo__Asset_label: Bad — unquoted scalar with a colon: it breaks the block
aliases:
  - "Bad — unparseable frontmatter"
---

The label above is an UNQUOTED YAML scalar containing `": "`, so the whole
frontmatter block fails to parse. The two parsers word it differently on
this very shape — pyyaml: `mapping values are not allowed here`; js-yaml 5
(YAML11, the one the loader runs): `bad indentation of a mapping entry` —
which is why the axis asserts the `(line:column)` suffix rather than the
prose.

⛔ This is the shape measured in the real vault on 2026-09-27 — two live assets
(`aiknow/72b1a937`, `pmbok/8fdfa0d8`) carried exactly it. Before the fix the
loader dropped such a file while recording NOTHING: no `skippedFiles` entry, no
log line, although every other rejection was named. Keep the defect REALISTIC
here rather than synthesising a simpler break: a fixture that fails for a
different reason would not exercise the branch that was silent.
