# RDF-Driven Layouts System

The Exocortex Layouts system provides an RDF-driven approach to asset presentation, inspired by the [LODE (Live OWL Documentation Environment)](https://essepuntato.it/lode/) pattern. This system allows flexible, ontology-driven layouts that adapt to different asset types.

## Overview

The Layouts system separates **what** to display from **how** to display it:

- **Layout**: Defines which blocks to show for a specific asset class
- **LayoutBlock**: Defines a reusable UI component with its SPARQL query
- **LayoutSelector**: Runtime service that selects the appropriate layout for an asset

### Architecture Diagram

```
Asset (rdf:type) ──► LayoutSelector ──► Layout
                           │
                           ▼
                   ┌───────────────┐
                   │   Layout      │
                   │ (e.g., Area)  │
                   └───────┬───────┘
                           │ Layout_blocks
                           ▼
            ┌──────────────────────────────┐
            │         LayoutBlock[]         │
            │  ┌─────────────────────────┐ │
            │  │ IdentityBlock           │ │
            │  │  └─ query + renderer    │ │
            │  ├─────────────────────────┤ │
            │  │ ClassificationBlock     │ │
            │  │  └─ query + renderer    │ │
            │  ├─────────────────────────┤ │
            │  │ RelationsBlock          │ │
            │  │  └─ query + renderer    │ │
            │  └─────────────────────────┘ │
            └──────────────────────────────┘
```

## Layout Classes

### exo-ui:Layout (Abstract)

The base class for all layouts. Properties:

| Property | Type | Description |
|----------|------|-------------|
| `Layout_appliesTo` | Class URI | Asset class this layout applies to |
| `Layout_blocks` | rdf:List | Ordered list of LayoutBlock references |
| `rdfs:label` | String | Human-readable layout name |

### exo-ui:DefaultAssetLayout

The default layout applied to all assets unless a more specific layout exists:

```turtle
exo-ui:DefaultAssetLayout a exo-ui:Layout ;
    rdfs:label "Default Asset Layout" ;
    exo-ui:Layout_appliesTo exo:Asset ;
    exo-ui:Layout_blocks (
        exo-ui:IdentityBlock
        exo-ui:ClassificationBlock
        exo-ui:InboundRelationsBlock
        exo-ui:OutboundRelationsBlock
        exo-ui:UsageContextBlock
        exo-ui:BodyContentBlock
    ) .
```

### exo-ui:AreaLayout

Layout for Area assets showing hierarchical structure:

```turtle
exo-ui:AreaLayout a exo-ui:Layout ;
    rdfs:label "Area Layout" ;
    exo-ui:Layout_appliesTo ems:Area ;
    exo-ui:Layout_blocks (
        exo-ui:IdentityBlock
        exo-ui:AreaTreeBlock
        exo-ui:RelationsBlock
    ) .
```

### exo-ui:DailyNoteLayout

Layout for Daily Notes showing tasks and projects:

```turtle
exo-ui:DailyNoteLayout a exo-ui:Layout ;
    rdfs:label "Daily Note Layout" ;
    exo-ui:Layout_appliesTo pn:DailyNote ;
    exo-ui:Layout_blocks (
        exo-ui:DailyNavigationBlock
        exo-ui:DailyTasksBlock
        exo-ui:DailyProjectsBlock
    ) .
```

## Layout Blocks

### Block Definition

Each LayoutBlock defines:

| Property | Type | Description |
|----------|------|-------------|
| `LayoutBlock_query` | String | SPARQL query template with `?asset` placeholder |
| `LayoutBlock_renderer` | String | Renderer component name |
| `LayoutBlock_order` | Integer | Display order (1-based) |
| `LayoutBlock_headless` | Boolean | Can render in CLI mode (default: true) |
| `rdfs:label` | String | Human-readable block name |

### Standard Blocks

#### IdentityBlock

Displays core asset identity: label, UID, creation date.

```turtle
exo-ui:IdentityBlock a exo-ui:LayoutBlock ;
    rdfs:label "Identity" ;
    exo-ui:LayoutBlock_renderer "identity" ;
    exo-ui:LayoutBlock_order 1 ;
    exo-ui:LayoutBlock_query """
        SELECT ?label ?uid ?created WHERE {
            ?asset exo:Asset_label ?label .
            ?asset exo:Asset_uid ?uid .
            OPTIONAL { ?asset dcterms:created ?created }
        }
    """ .
```

#### ClassificationBlock

Displays asset classification: class, prototype.

```turtle
exo-ui:ClassificationBlock a exo-ui:LayoutBlock ;
    rdfs:label "Classification" ;
    exo-ui:LayoutBlock_renderer "classification" ;
    exo-ui:LayoutBlock_order 2 ;
    exo-ui:LayoutBlock_query """
        SELECT ?class ?prototype WHERE {
            ?asset rdf:type ?class .
            OPTIONAL { ?asset exo:Instance_prototype ?prototype }
        }
    """ .
```

#### InboundRelationsBlock (Backlinks)

Displays assets that reference the current asset.

```turtle
exo-ui:InboundRelationsBlock a exo-ui:LayoutBlock ;
    rdfs:label "Inbound Relations" ;
    exo-ui:LayoutBlock_renderer "relations-table" ;
    exo-ui:LayoutBlock_order 3 ;
    exo-ui:LayoutBlock_query """
        SELECT ?source ?sourceLabel ?predicate WHERE {
            ?source ?predicate ?asset .
            ?source exo:Asset_label ?sourceLabel .
            FILTER(STRSTARTS(STR(?predicate), "https://exocortex.my/ontology/"))
        }
        ORDER BY ?sourceLabel
    """ .
```

#### OutboundRelationsBlock (References)

Displays assets that the current asset references.

```turtle
exo-ui:OutboundRelationsBlock a exo-ui:LayoutBlock ;
    rdfs:label "Outbound Relations" ;
    exo-ui:LayoutBlock_renderer "relations-table" ;
    exo-ui:LayoutBlock_order 4 ;
    exo-ui:LayoutBlock_query """
        SELECT ?target ?targetLabel ?predicate WHERE {
            ?asset ?predicate ?target .
            ?target exo:Asset_label ?targetLabel .
            FILTER(STRSTARTS(STR(?predicate), "https://exocortex.my/ontology/"))
        }
        ORDER BY ?targetLabel
    """ .
```

#### UsageContextBlock

Displays usage context: collections, body mentions, parent.

```turtle
exo-ui:UsageContextBlock a exo-ui:LayoutBlock ;
    rdfs:label "Usage Context" ;
    exo-ui:LayoutBlock_renderer "usage-context" ;
    exo-ui:LayoutBlock_order 5 .
```

#### BodyContentBlock

Displays the markdown body content.

```turtle
exo-ui:BodyContentBlock a exo-ui:LayoutBlock ;
    rdfs:label "Body Content" ;
    exo-ui:LayoutBlock_renderer "markdown" ;
    exo-ui:LayoutBlock_order 6 ;
    exo-ui:LayoutBlock_headless false .
```

## Renderer Components

The Obsidian plugin provides these renderer implementations:

| Renderer | Component | Description |
|----------|-----------|-------------|
| `identity` | `PropertiesRenderer` | Asset properties table |
| `classification` | `PropertiesRenderer` | Class and prototype info |
| `relations-table` | `RelationsRenderer` | Relations table with grouping |
| `backlinks-table` | `RelationsRenderer` | Legacy backlinks table |
| `area-tree` | `AreaTreeRenderer` | Hierarchical area tree |
| `usage-context` | `RelationsRenderer` | Usage context display |
| `markdown` | Native | Markdown body content |

### UniversalLayoutRenderer

The main renderer that orchestrates all block renderers:

```typescript
// packages/obsidian-plugin/src/presentation/renderers/UniversalLayoutRenderer.ts

export class UniversalLayoutRenderer {
  async render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    // 1. Parse configuration
    const config = LayoutConfigParser.parse(source);

    // 2. Render navigation (for daily notes)
    this.dailyNavRenderer.render(el, currentFile);

    // 3. Render properties section
    await this.propertiesRenderer.render(el, currentFile, options, renderHeader, isCollapsed);

    // 4. Render action buttons (RDF-driven)
    const buttonGroups = await this.buildButtonGroups(currentFile);

    // 5. Render daily sections
    await this.dailyTasksRenderer.render(el, currentFile, renderHeader, isCollapsed);
    await this.dailyProjectsRenderer.render(el, currentFile, renderHeader, isCollapsed);

    // 6. Render relations
    const relations = await this.relationsRenderer.getAssetRelations(currentFile, config);
    await this.areaTreeRenderer.render(el, currentFile, relations, renderHeader, isCollapsed);
    await this.relationsRenderer.render(el, relations, config, renderHeader, isCollapsed);
  }
}
```

## CLI Commands

The CLI provides commands to query layout data programmatically:

### Asset Relations Commands

```bash
# Get all relations (inbound and outbound)
exocortex asset relations --file "03 Knowledge/concepts/my-concept.md" --vault ~/vault-2025

# Get inbound relations (backlinks)
exocortex asset backlinks --file "03 Knowledge/tasks/task.md" --format json

# Get outbound relations (references)
exocortex asset references --file "03 Knowledge/concepts/concept.md" --predicate "exo:Asset_relates"
```

#### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--file <path>` | Path to asset file (relative to vault root) | **Required** |
| `--vault <path>` | Path to Obsidian vault | Current directory |
| `--format <type>` | Output format: `table` or `json` | `table` |
| `--output <type>` | Response format: `text` or `json` (for MCP) | `text` |
| `--predicate <uri>` | Filter by predicate URI (references only) | None |

#### Example Output

**Table format:**
```
📥 Inbound Relations (Backlinks):

| Source                | Predicate                           |
|-----------------------|-------------------------------------|
| Morning Routine       | ems__Effort_area                    |
| Project Alpha         | ems__Project_area                   |
| Task: Review docs     | ems__Task_parent                    |

📤 Outbound Relations (References):

| Target                | Predicate                           |
|-----------------------|-------------------------------------|
| Knowledge Management  | exo__Asset_relates                  |
| PKM                   | ims__Concept_broader                |
```

**JSON format:**
```json
{
  "success": true,
  "data": {
    "file": "03 Knowledge/concepts/my-concept.md",
    "assetUri": "file:///Users/user/vault/03 Knowledge/concepts/my-concept.md",
    "inbound": [
      {
        "source": "Morning Routine",
        "sourceUri": "file:///Users/user/vault/03 Knowledge/efforts/morning-routine.md",
        "predicate": "https://exocortex.my/ontology/ems#Effort_area"
      }
    ],
    "outbound": [
      {
        "target": "Knowledge Management",
        "targetUri": "file:///Users/user/vault/03 Knowledge/concepts/km.md",
        "predicate": "https://exocortex.my/ontology/exo#Asset_relates"
      }
    ]
  },
  "meta": {
    "itemCount": 4
  }
}
```

### Daily Review Commands

```bash
# List today's practices
exocortex daily practices --vault ~/vault-2025

# Show daily summary
exocortex daily summary --date 2025-01-08

# Quick capture an activity
exocortex daily log "Morning workout" --start

# Start a practice from prototype
exocortex daily start <prototype-uid>

# Mark practice as done
exocortex daily done <prototype-uid>
```

## LayoutSelector Service

The `LayoutSelector` service in `@exocortex/core` handles layout selection:

```typescript
// packages/exocortex/src/domain/services/LayoutSelector.ts

import { LayoutSelector } from 'exocortex';

const selector = new LayoutSelector(tripleStore);

// Select layout for an asset based on its rdf:type
const layout = await selector.selectLayout('https://exocortex.my/assets/task-123');
console.log(layout?.uri); // 'exo-ui:TaskLayout' or 'exo-ui:DefaultAssetLayout'

// Load specific layout with blocks
const defaultLayout = await selector.loadLayout('exo-ui:DefaultAssetLayout');
for (const block of defaultLayout.blocks) {
  console.log(`${block.renderer} (order: ${block.order})`);
  // identity (order: 1)
  // classification (order: 2)
  // relations-table (order: 3)
  // ...
}
```

### Selection Algorithm

1. **Get asset classes**: Query all `rdf:type` values for the asset
2. **Find matching layout**: For each class, check if a Layout with `Layout_appliesTo` exists
3. **Class priority**: Most specific class takes precedence (e.g., `pn:DailyNote` before `exo:Asset`)
4. **Fallback**: If no specific layout found, use `DefaultAssetLayout`

```
Asset: task-123
  rdf:type: ems:Task, ems:Effort, exo:Asset

  Check: ems:Task → TaskLayout? (not found)
  Check: ems:Effort → EffortLayout? (not found)
  Check: exo:Asset → DefaultAssetLayout ✓

  Result: DefaultAssetLayout
```

## Configuration

### Layout Configuration in Markdown

Configure layout behavior in the code block:

```markdown
```exocortex-layout
sortBy: created
sortOrder: desc
showProperties:
  - ems__Effort_status
  - ems__Effort_area
useRdfQueries: true
```
```

### Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `sortBy` | String | Property to sort relations by | `title` |
| `sortOrder` | `asc` \| `desc` | Sort order | `asc` |
| `showProperties` | String[] | Additional properties to display | `[]` |
| `useRdfQueries` | Boolean | Use RDF SPARQL queries for relations | `false` |

## Creating Custom Layouts

### 1. Define Layout in Ontology

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix myont: <https://exocortex.my/ontology/my#> .

myont:CustomLayout a exo-ui:Layout ;
    rdfs:label "My Custom Layout" ;
    exo-ui:Layout_appliesTo myont:MyAssetClass ;
    exo-ui:Layout_blocks (
        exo-ui:IdentityBlock
        myont:CustomBlock
    ) .

myont:CustomBlock a exo-ui:LayoutBlock ;
    rdfs:label "Custom Data" ;
    exo-ui:LayoutBlock_renderer "custom" ;
    exo-ui:LayoutBlock_order 2 ;
    exo-ui:LayoutBlock_query """
        SELECT ?property ?value WHERE {
            ?asset myont:customProperty ?value .
        }
    """ .
```

### 2. Implement Custom Renderer

```typescript
// packages/obsidian-plugin/src/presentation/renderers/layout/CustomRenderer.ts

export class CustomRenderer {
  async render(
    el: HTMLElement,
    file: TFile,
    block: LayoutBlock,
    renderHeader?: RenderHeaderFn,
    isCollapsed?: boolean,
  ): Promise<void> {
    // Execute block's SPARQL query
    const results = await this.sparqlService.query(
      block.query.replace('?asset', `<${this.buildAssetUri(file)}>`)
    );

    // Render results
    const container = el.createDiv({ cls: 'custom-block' });
    if (renderHeader) {
      renderHeader(container, 'custom', block.label);
    }

    // ... render your custom UI
  }
}
```

### 3. Register Renderer

```typescript
// Register in UniversalLayoutRenderer or LayoutBlockService
this.renderers.set('custom', new CustomRenderer(...));
```

## Best Practices

### Query Optimization

1. **Use OPTIONAL for non-required fields**: Prevents missing data from excluding results
2. **Filter early**: Apply FILTER clauses as early as possible in the query
3. **Limit results**: Use LIMIT for large datasets
4. **Use indexes**: Asset UID and label queries are optimized

### Layout Design

1. **Order by importance**: Most important blocks first (lower order numbers)
2. **Group related blocks**: Keep identity/classification together
3. **Consider headless mode**: Mark blocks that can render in CLI with `headless: true`
4. **Test with different asset types**: Ensure layouts work across your asset classes

### Performance

1. **Cache layouts**: LayoutSelector caches loaded layouts
2. **Lazy loading**: Only query blocks when they're rendered
3. **Incremental updates**: Use `FrontmatterDeltaDetector` to only update changed sections

## Related Documentation

- [PROPERTY_SCHEMA.md](./PROPERTY_SCHEMA.md) - Frontmatter property definitions
- [sparql/User-Guide.md](./sparql/User-Guide.md) - SPARQL query guide
- [BUTTONS.md](./BUTTONS.md) - RDF-driven action buttons
- [cli/Command-Reference.md](./cli/Command-Reference.md) - Full CLI reference
