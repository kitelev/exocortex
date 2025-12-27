# Natural Language to SPARQL Guide

This guide documents the NLToSPARQLService and SPARQLTemplateLibrary - components that convert natural language questions into SPARQL queries for querying the Exocortex knowledge base.

## Quick Start

### Using the CLI

The simplest way to use NL to SPARQL is through the `exocortex-cli ask` command:

```bash
# Ask a question in natural language
exocortex-cli ask "активные проекты" --vault ~/vault-2025

# Show the generated SPARQL query
exocortex-cli ask "сколько всего задач" --vault ~/vault-2025 --show-query

# Get explanation of the query conversion
exocortex-cli ask "среднее время сна" --vault ~/vault-2025 --explain

# Output as JSON (for programmatic use)
exocortex-cli ask "последние 10 активностей" --vault ~/vault-2025 --output json
```

### Using the API

```typescript
import { NLToSPARQLService } from "exocortex";

const service = new NLToSPARQLService();

// Convert natural language to SPARQL
const result = service.convert("найди все задачи со словом душ");

console.log(result.query);        // Generated SPARQL
console.log(result.templateName); // Template used (e.g., "search_by_label")
console.log(result.confidence);   // Confidence score (0-1)
console.log(result.explanation);  // Human-readable explanation
```

## Supported Query Types

### Search Queries

Find entities by name/label:

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `найди все задачи со словом душ` | `search_by_label` | Search by keyword in label |
| `поиск по названию поспать` | `search_by_label` | Search for label containing text |
| `покажи записи содержащие йога` | `search_by_label` | Find records with keyword |

Example:
```bash
exocortex-cli ask "найди записи с 'утренний душ'" --vault ~/vault-2025
```

### Prototype-Based Queries

Find instances of a specific prototype (most reliable for recurring tasks):

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `все инстансы прототипа с UUID 2d369bb0` | `find_by_prototype_uuid` | Find by prototype UUID |
| `среднее время утреннего душа` | `average_duration_by_prototype` | Calculate average duration |

Known prototype mappings:
- `утренний душ`, `morning shower`, `душ` → `2d369bb0-159f-4639-911d-ec2c585e8d00`
- `подстричь ногти`, `ногти` → `1d7b739c-0e3e-46f2-ba88-e66f30b732f9`

Example:
```bash
exocortex-cli ask "среднее время утреннего душа" --vault ~/vault-2025 --show-query
```

### Statistics and Aggregation

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `сколько записей каждого типа` | `count_by_class` | Count entities by class |
| `среднее время задачи` | `average_duration_by_prototype` | Average duration |
| `статистика по классам` | `count_by_class` | Class statistics |

Example:
```bash
exocortex-cli ask "сколько записей каждого типа" --vault ~/vault-2025
```

### Project Queries

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `активные проекты` | `active_projects` | Projects with status Doing |
| `проекты без задач` | `projects_without_tasks` | Active projects with no child tasks |
| `текущие проекты` | `active_projects` | Current projects |

Example:
```bash
exocortex-cli ask "проекты без задач" --vault ~/vault-2025
```

### Activity Analysis

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `анализ сна за декабрь` | `sleep_analysis` | Sleep patterns analysis |
| `последние активности` | `recent_activities` | Recent activities |
| `все занятия йогой` | `tasks_by_label_pattern` | Activities matching pattern |

Example:
```bash
exocortex-cli ask "последние 10 активностей" --vault ~/vault-2025
```

### Entity Details

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `свойства задачи "Поспать 2025-11-30"` | `entity_properties` | All properties of entity |
| `покажи запись с UUID ...` | `properties_by_uuid` | Properties by UUID |
| `какой прототип у задачи` | `find_prototype` | Find prototype URI |

Example:
```bash
exocortex-cli ask "свойства по UUID 2d369bb0-159f-4639-911d-ec2c585e8d00" --vault ~/vault-2025
```

### People and Areas

| Natural Language | Template | Description |
|-----------------|----------|-------------|
| `все люди` | `persons` | List all persons |
| `контакты` | `persons` | List persons |
| `области ответственности` | `areas` | List all areas |

Example:
```bash
exocortex-cli ask "все люди" --vault ~/vault-2025
```

## Date Filtering

The service recognizes various date formats:

| Format | Example |
|--------|---------|
| `YYYY-MM` | `2025-12` |
| `YYYY-MM-DD` | `2025-12-15` |
| Russian month names | `декабрь`, `январь` |
| English month names | `december`, `january` |

Examples:
```bash
exocortex-cli ask "статистика сна за декабрь 2025" --vault ~/vault-2025
exocortex-cli ask "сон за 2025-12" --vault ~/vault-2025
```

## Confidence Scoring

The conversion result includes a confidence score (0-1):

- **0.7-1.0**: High confidence - template matched well with parameters
- **0.5-0.7**: Medium confidence - template matched, some parameters inferred
- **0.3-0.5**: Low confidence - fallback or partial match
- **< 0.3**: Fallback query - no good template match

When confidence is low, check:
1. The `explanation` field for details
2. The `alternatives` array for other possible queries
3. The `suggestions` from `getSuggestions()` for improving your query

## Advanced Usage

### Custom Configuration

```typescript
import { NLToSPARQLService, NLToSPARQLConfig } from "exocortex";

const config: Partial<NLToSPARQLConfig> = {
  defaultLimit: 50,           // Default result limit
  includeExplanation: true,   // Include explanation in results
  confidenceThreshold: 0.4,   // Minimum confidence threshold
};

const service = new NLToSPARQLService(config);
```

### Adding Custom Templates

```typescript
import { NLToSPARQLService, SPARQLTemplate } from "exocortex";

const service = new NLToSPARQLService();

const customTemplate: SPARQLTemplate = {
  name: "my_custom_query",
  description: "Custom query description",
  template: `PREFIX exo: <https://exocortex.my/ontology/exo#>
    SELECT ?s ?label WHERE {
      ?s exo:Asset_label ?label .
      FILTER(CONTAINS(?label, "{{keyword}}"))
    } LIMIT {{limit}}`,
  parameters: [
    { name: "keyword", description: "Search keyword", required: true },
    { name: "limit", description: "Result limit", required: false },
  ],
  examples: ["my custom query type"],
  keywords: ["custom", "specific"],
};

service.addTemplate(customTemplate);
```

### Getting Query Suggestions

```typescript
const service = new NLToSPARQLService();

// Get suggestions for improving a query
const suggestions = service.getSuggestions("сколько всего");
// Returns: ["Добавьте период времени (например: 'за декабрь' или 'за 2025-12')"]
```

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

1. **Use prototype UUIDs for recurring tasks** - Labels can change, but prototype UUID is stable
2. **Add date context for statistics** - "среднее время душа за декабрь" is more precise
3. **Use `--show-query` to debug** - See the generated SPARQL to understand what's being queried
4. **Use `--explain` for transparency** - Understand how your query was interpreted
5. **Check alternatives for low confidence** - The service suggests alternative queries

## Troubleshooting

### Query returns no results

1. Check `--show-query` to see the generated SPARQL
2. Verify the entity names/patterns exist in your vault
3. Try a more general query first, then refine

### Low confidence score

1. Add more specific keywords
2. Include date/time context
3. Use known activity names from the mapping

### Performance issues

1. Add result limits: "последние 10 активностей"
2. Use prototype UUID instead of label search for recurring tasks
3. Add date filters to narrow the search

## See Also

- [EXOCORTEX-KNOWLEDGE.md](/Users/kitelev/Developer/EXOCORTEX-KNOWLEDGE.md) - Accumulated SPARQL query knowledge
- [exocortex-cli documentation](../../../cli/README.md) - CLI command reference
