# Custom Buttons Tutorial

> Step-by-step guide to adding custom buttons to Exocortex without writing TypeScript code.

## Prerequisites

- Exocortex plugin installed in Obsidian
- Basic understanding of RDF/Turtle syntax
- Access to your vault's ontology folder

## Overview

Custom buttons are defined in RDF (Turtle format) and automatically appear in the Exocortex UI. This tutorial covers:

1. Creating a simple button
2. Defining actions (what happens when clicked)
3. Defining conditions (when the button appears)
4. Advanced patterns

## Quick Start

### Step 1: Create Your Ontology File

Create a new file `my-buttons.ttl` in your vault's ontology folder:

```turtle
@prefix my: <https://my-vault.example/ontology/my#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ems: <https://exocortex.my/ontology/ems#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

# My first custom button
my:HelloButton a exo-ui:Button ;
    rdfs:label "Hello World" ;
    exo-ui:Button_variant "primary" ;
    exo-ui:Button_group exo-ui:MaintenanceButtonGroup ;
    exo-ui:Button_action my:HelloAction ;
    exo-ui:Button_condition my:AlwaysShowCondition .

# Action: Show a notification
my:HelloAction a exo-ui:CustomHandlerAction ;
    exo-ui:Action_handler "notify" ;
    exo-ui:Action_headless false .

# Condition: Always visible
my:AlwaysShowCondition a exo-ui:Condition ;
    exo-ui:Condition_sparql "ASK { ?s ?p ?o }" .
```

### Step 2: Import the Ontology

Exocortex automatically loads `.ttl` files from the ontology folder on startup. Restart Obsidian or use the "Reload Exocortex" command.

### Step 3: Test Your Button

Open any asset note. Your "Hello World" button should appear in the Maintenance button group.

## Detailed Guide

### Button Properties

| Property | Required | Description |
|----------|----------|-------------|
| `rdfs:label` | Yes | Button text displayed in UI |
| `exo-ui:Button_variant` | Yes | Visual style: `primary`, `secondary`, `success`, `warning`, `danger` |
| `exo-ui:Button_group` | Yes | Which group: `CreationButtonGroup`, `StatusButtonGroup`, `PlanningButtonGroup`, `MaintenanceButtonGroup` |
| `exo-ui:Button_action` | Yes | What happens when clicked |
| `exo-ui:Button_condition` | Yes | When the button is visible |
| `exo-ui:Button_icon` | No | Lucide icon name (e.g., `eye`, `check`, `trash`) |
| `exo-ui:Button_order` | No | Sort order within group (lower = first) |
| `exo-ui:Button_tooltip` | No | Hover text |

### Action Types

#### UpdatePropertyAction — Change a Property

Most common action. Updates a property on the current asset.

```turtle
my:SetPriorityHighAction a exo-ui:UpdatePropertyAction ;
    exo-ui:Action_targetProperty ems:Effort_priority ;
    exo-ui:Action_targetValue "high" ;
    exo-ui:Action_headless true .
```

**Parameters:**
- `Action_targetProperty` — Property URI to update
- `Action_targetValue` — New value (literal or wikilink)
- `Action_targetAsset` — (Optional) Different asset to update

#### CreateAssetAction — Create New Asset

Create a new asset based on a template.

```turtle
my:CreateMeetingNoteAction a exo-ui:CreateAssetAction ;
    exo-ui:Action_targetClass ems:Meeting ;
    exo-ui:Action_template "[[templates/Meeting Template]]" ;
    exo-ui:Action_location "meetings/{{date}}" ;
    exo-ui:Action_headless true .
```

**Parameters:**
- `Action_targetClass` — Class of new asset
- `Action_template` — Template note to use
- `Action_location` — Folder path (supports `{{date}}`, `{{asset.label}}`)

#### NavigateAction — Open Another Asset

Navigate to a related asset or SPARQL query result.

```turtle
my:GoToProjectAction a exo-ui:NavigateAction ;
    exo-ui:Action_target "{{asset.partOf}}" ;
    exo-ui:Action_headless true .
```

**Parameters:**
- `Action_target` — Asset URI, wikilink, or SPARQL SELECT query

#### CompositeAction — Multiple Actions

Execute several actions in sequence.

```turtle
my:CompleteAndArchiveAction a exo-ui:CompositeAction ;
    exo-ui:Action_actions (
        my:MarkDoneAction
        my:ArchiveAction
    ) ;
    exo-ui:Action_headless true .
```

### Condition Types

#### Asset Class Condition

Show button only for specific asset types.

```turtle
my:IsTaskCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task .
```

Multiple classes (OR logic):
```turtle
my:IsTaskOrProjectCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task, ems:Project .
```

#### Property Value Condition

Show button when property has specific value.

```turtle
my:IsDoingCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task ;
    exo-ui:Condition_hasProperty ems:Effort_status ;
    exo-ui:Condition_propertyValue "[[emsstatus__Doing]]" .
```

#### SPARQL Condition

Most flexible — use any SPARQL ASK query.

```turtle
my:HasBlockersCondition a exo-ui:Condition ;
    exo-ui:Condition_sparql """
        ASK {
            ?asset ems:Task_blockedBy ?blocker .
            ?blocker ems:Effort_status ?status .
            FILTER(?status != "[[emsstatus__Done]]")
        }
    """ .
```

The `?asset` variable is automatically bound to the current asset.

#### Compound Conditions

Combine conditions with AND/OR/NOT:

```turtle
# AND: Both conditions must be true
my:TaskInDoingCondition a exo-ui:Condition ;
    exo-ui:Condition_and (
        my:IsTaskCondition
        my:StatusIsDoingCondition
    ) .

# OR: At least one must be true
my:TaskOrProjectCondition a exo-ui:Condition ;
    exo-ui:Condition_or (
        my:IsTaskCondition
        my:IsProjectCondition
    ) .

# NOT: Condition must be false
my:NotArchivedCondition a exo-ui:Condition ;
    exo-ui:Condition_not my:IsArchivedCondition .
```

## Real-World Examples

### Example 1: "Request Review" Button

Add a button that sets a custom "review-requested" status.

```turtle
@prefix my: <https://my-vault.example/ontology/my#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ems: <https://exocortex.my/ontology/ems#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

my:RequestReviewButton a exo-ui:Button ;
    rdfs:label "Request Review" ;
    exo-ui:Button_icon "eye" ;
    exo-ui:Button_variant "warning" ;
    exo-ui:Button_group exo-ui:StatusButtonGroup ;
    exo-ui:Button_action my:SetReviewRequestedAction ;
    exo-ui:Button_condition my:CanRequestReviewCondition ;
    exo-ui:Button_order "50" .

my:SetReviewRequestedAction a exo-ui:UpdatePropertyAction ;
    exo-ui:Action_targetProperty my:review_status ;
    exo-ui:Action_targetValue "requested" ;
    exo-ui:Action_headless true .

my:CanRequestReviewCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task ;
    exo-ui:Condition_sparql """
        ASK {
            ?asset ems:Effort_status "[[emsstatus__Doing]]" .
            FILTER NOT EXISTS { ?asset my:review_status "requested" }
        }
    """ .
```

### Example 2: "Quick Meeting Note" Button

Create a meeting note linked to the current project.

```turtle
my:QuickMeetingButton a exo-ui:Button ;
    rdfs:label "Meeting Note" ;
    exo-ui:Button_icon "calendar" ;
    exo-ui:Button_variant "primary" ;
    exo-ui:Button_group exo-ui:CreationButtonGroup ;
    exo-ui:Button_action my:CreateMeetingAction ;
    exo-ui:Button_condition my:IsProjectCondition ;
    exo-ui:Button_order "100" .

my:CreateMeetingAction a exo-ui:CreateAssetAction ;
    exo-ui:Action_targetClass ems:Meeting ;
    exo-ui:Action_template "[[templates/Meeting]]" ;
    exo-ui:Action_location "meetings/{{date}}" ;
    exo-ui:Action_headless true .

my:IsProjectCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Project .
```

### Example 3: "Bump Priority" Toggle Button

Cycle through priority levels: low → medium → high → low.

```turtle
my:BumpPriorityButton a exo-ui:Button ;
    rdfs:label "Bump Priority" ;
    exo-ui:Button_icon "arrow-up" ;
    exo-ui:Button_variant "secondary" ;
    exo-ui:Button_group exo-ui:PlanningButtonGroup ;
    exo-ui:Button_action my:BumpPriorityAction ;
    exo-ui:Button_condition my:IsEffortCondition .

my:BumpPriorityAction a exo-ui:CustomHandlerAction ;
    exo-ui:Action_handler "cyclePriority" ;
    exo-ui:Action_headless false .

my:IsEffortCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task, ems:Project .
```

> Note: `CustomHandlerAction` requires a registered TypeScript handler. For property updates, use `UpdatePropertyAction`.

## Best Practices

### Naming Conventions

- Use a consistent prefix for your custom ontology (`my:`, `workflow:`, etc.)
- Name buttons descriptively: `my:RequestReviewButton`, not `my:Button1`
- Name actions by what they do: `my:SetReviewRequestedAction`
- Name conditions by what they check: `my:CanRequestReviewCondition`

### Button Order

- Use `Button_order` to control position within group
- Built-in buttons use orders 10-90
- Use 100+ for custom buttons to appear after built-ins
- Use negative numbers to appear before built-ins

### Headless Support

- Set `Action_headless true` for actions that should work in CLI
- Interactive actions (modals, confirmations) must use `Action_headless false`

### Testing

1. Check the browser console for RDF parsing errors
2. Use SPARQL queries in Obsidian to verify conditions
3. Test with assets in different states

## Troubleshooting

### Button Not Appearing

1. **Check condition** — Is the condition satisfied for current asset?
   ```sparql
   ASK { <current-asset-uri> ems:Effort_status "[[emsstatus__Doing]]" }
   ```

2. **Check RDF syntax** — Look for Turtle parsing errors in console

3. **Check group** — Is the button in a valid group?

4. **Reload plugin** — Changes require restart or "Reload Exocortex"

### Action Not Working

1. **Check action type** — Is it the right action class?

2. **Check parameters** — All required parameters present?

3. **Check headless flag** — CLI usage requires `Action_headless true`

### Condition Always False

1. **Test SPARQL** — Run the condition query manually:
   ```sparql
   ASK {
     # Your condition query with ?asset bound to actual URI
   }
   ```

2. **Check variable binding** — `?asset` is automatically bound

## See Also

- **[Button Reference](../BUTTONS.md)** — Complete button reference
- **[RDF-Driven Commands](../COMMANDS.md)** — Custom commands
- **[exo-ui Ontology](https://github.com/kitelev/exocortex-public-ontologies/tree/main/exo-ui)** — Schema definition
