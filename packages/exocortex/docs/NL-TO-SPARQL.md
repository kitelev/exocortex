# Natural Language to SPARQL (engine internals)

> **Moved.** The NL→SPARQL guide is now a single canonical document:
> **[../../../docs/NL-TO-SPARQL.md](../../../docs/NL-TO-SPARQL.md)**.
> It covers the CLI/API usage, supported query types, date filtering,
> confidence scoring, configuration, custom templates, query suggestions, the
> template-library reference, and troubleshooting — including the sections that
> previously lived only here.

**Engine entry points** (`exocortex` core package):

- `NLToSPARQLService` — `convert()`, `getSuggestions()`, `addTemplate()`, config.
- `SPARQLTemplateLibrary` — `SPARQL_TEMPLATES`, `findMatchingTemplates()`,
  `fillTemplate()`, `validateParameters()`.

See the canonical guide above for the full API reference and template catalogue.
