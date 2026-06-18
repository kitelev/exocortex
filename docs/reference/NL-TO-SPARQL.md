# Natural Language to SPARQL

This document describes the NL to SPARQL feature that allows querying the Exocortex knowledge base using natural language questions in Russian or English.

## Overview

The NL to SPARQL system converts natural language questions into SPARQL queries using template matching and parameter extraction. This makes it easy to query your knowledge base without knowing SPARQL syntax.

## Quick Start

### Using the CLI

```bash
# Basic question
npx @kitelev/exocortex-cli ask "среднее время утреннего душа" --vault /path/to/vault

# Show the generated SPARQL query
npx @kitelev/exocortex-cli ask "активные проекты" --show-query

# Get explanation of conversion
npx @kitelev/exocortex-cli ask "статистика сна за декабрь" --explain

# JSON output for automation
npx @kitelev/exocortex-cli ask "последние 10 активностей" --output json
```

### Using the Service Programmatically

```typescript
import { NLToSPARQLService } from "exocortex";

const service = new NLToSPARQLService();
const result = service.convert("среднее время утреннего душа");

console.log(result.query);       // Generated SPARQL query
console.log(result.templateName); // Template used
console.log(result.confidence);   // Conversion confidence (0-1)
console.log(result.explanation);  // Human-readable explanation
```

## Supported Query Types

### 1. Search Queries

Find entities by keyword in their label.

**Examples:**
- "найди все задачи со словом йога"
- "поиск по названию Утренний душ"
- "покажи записи содержащие слово практика"

**Generated SPARQL:**
```sparql
SELECT ?s ?label WHERE {
  ?s exo:Asset_label ?label .
  FILTER(CONTAINS(?label, "keyword"))
}
ORDER BY ?label
LIMIT 100
```

### 2. Statistics by Prototype

Calculate average, min, max duration for tasks of a specific type.

**Examples:**
- "среднее время утреннего душа"
- "сколько в среднем занимает сон"
- "статистика по длительности задачи"

**Generated SPARQL:**
```sparql
SELECT (AVG(?dur) AS ?avgMinutes) (COUNT(?s) AS ?count)
       (MIN(?dur) AS ?minMin) (MAX(?dur) AS ?maxMin)
WHERE {
  ?s exo:Asset_prototype ?proto .
  FILTER(CONTAINS(STR(?proto), "prototype-uuid"))
  ?s ems:Effort_startTimestamp ?start .
  ?s ems:Effort_endTimestamp ?end .
  BIND(exo:dateDiffMinutes(?start, ?end) AS ?dur)
}
```

### 3. Sleep Analysis

Analyze sleep patterns over a period.

**Examples:**
- "анализ сна за декабрь"
- "сколько я спал в ноябре"
- "статистика сна за 2025-12"

**Generated SPARQL:**
```sparql
SELECT ?label ?start ?end WHERE {
  ?s exo:Asset_label ?label .
  FILTER(STRSTARTS(?label, "Поспать 2025-12"))
  ?s ems:Effort_startTimestamp ?start .
  ?s ems:Effort_endTimestamp ?end .
}
ORDER BY ?start
```

### 4. Project Queries

Find active projects or projects without tasks.

**Examples:**
- "активные проекты"
- "проекты в работе"
- "проекты без задач"

### 5. Recent Activities

Get chronologically ordered list of recent activities.

**Examples:**
- "последние 10 активностей"
- "что делал недавно"
- "история активностей"

### 6. Entity Properties

Get all properties of a specific entity.

**Examples:**
- "все свойства задачи Поспать 2025-11-30"
- "информация о сущности"
- "свойства по UUID 2d369bb0-159f"

### 7. Count Queries

Count entities by type or class.

**Examples:**
- "сколько записей каждого типа"
- "статистика по классам"

### 8. Areas and Contacts

List areas of responsibility or persons.

**Examples:**
- "все области ответственности"
- "все контакты"

## Date Filtering

The service recognizes various date formats and applies them as filters:

| Format | Example |
|--------|---------|
| `YYYY-MM` | `2025-12` |
| `YYYY-MM-DD` | `2025-12-15` |
| Russian month names | `декабрь`, `январь` |
| English month names | `december`, `january` |

```bash
npx @kitelev/exocortex-cli ask "статистика сна за декабрь 2025" --vault /path/to/vault
npx @kitelev/exocortex-cli ask "сон за 2025-12" --vault /path/to/vault
```

## Known Prototypes

The system automatically recognizes these activity names and their prototypes:

| Activity | Prototype UUID |
|----------|---------------|
| Утренний душ / Morning Shower | 2d369bb0-159f-4639-911d-ec2c585e8d00 |
| Подстричь ногти / Cut Nails | 1d7b739c-0e3e-46f2-ba88-e66f30b732f9 |

## Configuration

```typescript
import { NLToSPARQLService, NLToSPARQLConfig } from "exocortex";

const config: Partial<NLToSPARQLConfig> = {
  defaultLimit: 100,           // Default result limit
  includeExplanation: true,    // Include explanation in results
  confidenceThreshold: 0.3,    // Minimum confidence for template matching
};

const service = new NLToSPARQLService(config);
```

## Adding Custom Templates

You can extend the template library with custom query patterns:

```typescript
import { NLToSPARQLService, SPARQLTemplate } from "exocortex";

const service = new NLToSPARQLService();

const customTemplate: SPARQLTemplate = {
  name: "my_custom_query",
  description: "Find entities by custom criteria",
  template: `PREFIX exo: <https://exocortex.my/ontology/exo#>
SELECT ?s ?label WHERE {
  ?s exo:Asset_label ?label .
  FILTER(CONTAINS(?label, "{{keyword}}"))
}
LIMIT {{limit}}`,
  parameters: [
    { name: "keyword", description: "Search keyword", required: true },
    { name: "limit", description: "Result limit", required: false },
  ],
  examples: ["custom search for X"],
  keywords: ["custom", "special"],
};

service.addTemplate(customTemplate);
```

### Getting Query Suggestions

When a query is ambiguous or low-confidence, ask the service how to improve it:

```typescript
const service = new NLToSPARQLService();

// Get suggestions for improving a query
const suggestions = service.getSuggestions("сколько всего");
// Returns: ["Добавьте период времени (например: 'за декабрь' или 'за 2025-12')"]
```

## API Reference

### NLToSPARQLService

#### Methods

| Method | Description |
|--------|-------------|
| `convert(query: string)` | Convert natural language to SPARQL |
| `getSuggestions(query: string)` | Get suggestions for improving a query |
| `getAvailableTemplates()` | List all available templates |
| `getTemplate(name: string)` | Get a specific template |
| `addTemplate(template)` | Add a custom template |
| `setConfig(config)` | Update configuration |
| `getConfig()` | Get current configuration |

#### NLToSPARQLResult

| Property | Type | Description |
|----------|------|-------------|
| query | string | Generated SPARQL query |
| templateName | string | null | Template used |
| parameters | Record<string, string> | Extracted parameters |
| confidence | number | Conversion confidence (0-1) |
| explanation | string | Human-readable explanation |
| isFallback | boolean | Whether fallback was used |
| alternatives | string[] | Alternative queries |

### SPARQLTemplateLibrary

#### Exports

| Export | Description |
|--------|-------------|
| `SPARQL_TEMPLATES` | Array of all templates |
| `SPARQL_PREFIXES` | Standard RDF prefixes |
| `PREDICATES` | Common predicates |
| `ASSET_CLASSES` | Known asset classes |
| `EFFORT_STATUSES` | Effort status values |
| `KNOWN_PROTOTYPES` | Known prototype UUIDs |
| `findMatchingTemplates(query, maxResults)` | Find matching templates |
| `fillTemplate(template, params)` | Fill template with parameters |
| `validateParameters(template, params)` | Validate required parameters |
| `getTemplateByName(name)` | Get template by name |

## Template Library Reference

### Available Templates

| Name | Required Params | Description |
|------|----------------|-------------|
| `search_by_label` | `keyword` | Search by label substring |
| `find_by_prototype_uuid` | `prototypeUuid` | Find instances by prototype |
| `average_duration_by_prototype` | `prototypeUuid` | Average duration stats |
| `sleep_analysis` | - | Sleep pattern analysis |
| `active_projects` | - | Active projects list |
| `projects_without_tasks` | - | Projects without child tasks |
| `recent_activities` | - | Recent activities |
| `tasks_by_label_pattern` | `pattern` | Tasks matching pattern |
| `count_by_class` | - | Count by entity class |
| `find_prototype` | `taskLabel` | Find prototype by task label |
| `entity_properties` | `entityLabel` | All properties of entity |
| `properties_by_uuid` | `uuid` | Properties by UUID |
| `areas` | - | List all areas |
| `persons` | - | List all persons |

### Template Structure

```typescript
interface SPARQLTemplate {
  name: string;           // Unique template name
  description: string;    // Human-readable description
  template: string;       // SPARQL with {{param}} placeholders
  parameters: {
    name: string;
    description: string;
    required: boolean;
    example?: string;
  }[];
  examples: string[];     // Example natural language queries
  keywords: string[];     // Keywords that trigger this template
}
```

## Best Practices

1. **Use prototype UUIDs** instead of labels for reliable results (labels can change)
2. **Add date context** for statistical queries ("за декабрь")
3. **Specify limits** for large result sets ("первые 50")
4. **Use quotes** for exact phrase matching ("Утренний душ")
5. **Use `--show-query` to debug** — inspect the generated SPARQL to see what is actually queried
6. **Use `--explain` for transparency** — understand how your query was interpreted

## Confidence Scoring

The conversion result includes a confidence score (0-1):

- **0.7-1.0**: High confidence — template matched well with parameters
- **0.5-0.7**: Medium confidence — template matched, some parameters inferred
- **0.3-0.5**: Low confidence — fallback or partial match
- **< 0.3**: Fallback query — no good template match

When confidence is low, check:

1. The `explanation` field for details
2. The `alternatives` array for other possible queries
3. The `suggestions` from `getSuggestions()` for improving your query

## Troubleshooting

### Low Confidence Results

If confidence is below 0.5:
- The query may be ambiguous
- Check the `alternatives` array for other interpretations
- Use more specific keywords

### No Results

If query returns no results:
- Check the `suggestions` for improvements
- Verify the vault path is correct
- Try using UUID instead of label

### Fallback Queries

If `isFallback` is true:
- The system couldn't match a specific template
- A generic search is performed
- Consider rephrasing the question

## Integration

### With Telegram Bot

The NL to SPARQL service can be integrated with the @kitelev_bot Telegram bot:

1. User sends a question: "Среднее время утреннего душа"
2. Bot calls `NLToSPARQLService.convert()`
3. Bot executes the generated SPARQL via exocortex-cli
4. Bot formats and returns the results

### With n8n Workflows

Create an HTTP webhook that:
1. Receives natural language questions
2. Uses NLToSPARQLService to generate SPARQL
3. Executes via exocortex-cli
4. Returns formatted results
