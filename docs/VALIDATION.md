# SHACL Validation System

This document covers the SHACL (Shapes Constraint Language) validation system in Exocortex, introduced in Milestone v1.4. SHACL validation ensures that RDF data conforms to defined shapes, catching errors early in the development process.

---

## Table of Contents

- [Introduction to SHACL](#introduction-to-shacl)
- [How Validation Works](#how-validation-works)
- [Available Shapes](#available-shapes)
  - [Button Shape](#button-shape)
  - [Command Shape](#command-shape)
  - [Action Shapes](#action-shapes)
- [Creating Custom Shapes](#creating-custom-shapes)
- [CLI validate Command](#cli-validate-command)
- [Error Messages Guide](#error-messages-guide)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Introduction to SHACL

**SHACL (Shapes Constraint Language)** is a W3C standard for validating RDF data against a set of conditions called "shapes". Think of shapes as schemas that define:

- What properties an instance **must have** (required properties)
- What properties an instance **may have** (optional properties)
- What **datatypes** property values must use
- **Cardinality** constraints (how many values are allowed)

### Why SHACL?

In Exocortex, UI elements (Commands, Buttons, Actions) are defined declaratively in RDF ontologies. SHACL validation ensures:

1. **Early error detection** - Catch typos and missing properties before runtime
2. **Self-documenting** - Shapes serve as executable documentation
3. **Consistent data** - All instances conform to expected structure
4. **Better error messages** - Specific information about what's wrong

### Example

Without validation, a button missing its `action` property would fail silently or produce confusing errors at runtime. With SHACL:

```
VIOLATION in exo-ui:MyButton
  Path: Button_action
  Message: Button must have an action IRI
```

---

## How Validation Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Validation Pipeline                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐     ┌─────────────────┐     ┌─────────────┐  │
│   │   Ontology  │────▶│  ShaclValidator │────▶│  Validation │  │
│   │    (TTL)    │     │                 │     │   Result    │  │
│   └─────────────┘     └────────┬────────┘     └─────────────┘  │
│                                │                                │
│   ┌─────────────┐              │                                │
│   │   Shapes    │──────────────┘                                │
│   │    (TTL)    │                                               │
│   └─────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Validation Process

1. **Parse ontology** - The Turtle file containing your RDF data is parsed into triples
2. **Parse shapes** - SHACL shape definitions are parsed
3. **Find targets** - For each shape, find all instances of the target class
4. **Validate instances** - Check each instance against the shape's property constraints
5. **Report violations** - Collect and format all validation errors

### Code Example

```typescript
import { ShaclValidator, BUTTON_SHAPE_TURTLE } from "exocortex";

const validator = new ShaclValidator();

// Your ontology data
const ontologyTurtle = `
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

exo-ui:MyButton a exo-ui:Button ;
    exo-ui:Button_id "my-button"^^xsd:string ;
    exo-ui:Button_label "Click Me"^^xsd:string ;
    exo-ui:Button_action exo-ui:SomeAction .
`;

// Validate against shape
const result = await validator.validate(ontologyTurtle, BUTTON_SHAPE_TURTLE);

if (result.conforms) {
  console.log("Validation passed!");
} else {
  console.log("Violations found:");
  result.violations.forEach(v => {
    console.log(`  ${v.focusNode}: ${v.message}`);
  });
}
```

---

## Available Shapes

Exocortex provides built-in SHACL shapes for all UI component classes. These shapes are exported from the `exocortex` package.

### Button Shape

**Target Class:** `exo-ui:Button`

Buttons are interactive UI elements that trigger actions when clicked.

#### Required Properties

| Property | Datatype | Cardinality | Description |
|----------|----------|-------------|-------------|
| `exo-ui:Button_id` | `xsd:string` | Exactly 1 | Unique identifier for the button |
| `exo-ui:Button_action` | IRI | At least 1 | Reference to the action to execute |

#### Optional Properties

| Property | Datatype | Cardinality | Description |
|----------|----------|-------------|-------------|
| `exo-ui:Button_label` | `xsd:string` | 0..1 | Display text for the button |
| `exo-ui:Button_icon` | `xsd:string` | 0..1 | Icon name (Lucide icon) |
| `exo-ui:Button_tooltip` | `xsd:string` | 0..1 | Tooltip text on hover |
| `exo-ui:Button_condition` | IRI | 0..1 | Visibility condition reference |
| `exo-ui:Button_group` | IRI | 0..1 | Button group assignment |
| `exo-ui:Button_order` | `xsd:integer` | 0..1 | Sort order within group |
| `exo-ui:Button_variant` | `xsd:string` | 0..1 | Visual style (primary, secondary, etc.) |

#### Valid Button Example

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

exo-ui:MyReviewButton a exo-ui:Button ;
    exo-ui:Button_id "review-button"^^xsd:string ;
    exo-ui:Button_label "Request Review"^^xsd:string ;
    exo-ui:Button_icon "eye"^^xsd:string ;
    exo-ui:Button_tooltip "Send for code review"^^xsd:string ;
    exo-ui:Button_variant "primary"^^xsd:string ;
    exo-ui:Button_action exo-ui:SetReviewStatusAction ;
    exo-ui:Button_group exo-ui:StatusButtonGroup ;
    exo-ui:Button_order "10"^^xsd:integer .
```

#### Invalid Button Example

```turtle
# Missing required Button_action - will fail validation
exo-ui:BrokenButton a exo-ui:Button ;
    exo-ui:Button_id "broken"^^xsd:string ;
    exo-ui:Button_label "This button is broken"^^xsd:string .
```

Error message:
```
VIOLATION in exo-ui:BrokenButton
  Path: Button_action
  Message: Button must have an action IRI
```

### Command Shape

**Target Class:** `exo-ui:Command`

Commands are palette actions triggered via hotkeys or command palette.

#### Required Properties

| Property | Datatype | Cardinality | Description |
|----------|----------|-------------|-------------|
| `exo-ui:Command_id` | `xsd:string` | Exactly 1 | Unique command identifier |
| `exo-ui:Command_name` | `xsd:string` | At least 1 | Display name in command palette |
| `exo-ui:Command_action` | IRI | At least 1 | Reference to the action to execute |

#### Optional Properties

| Property | Datatype | Cardinality | Description |
|----------|----------|-------------|-------------|
| `exo-ui:Command_icon` | `xsd:string` | 0..1 | Icon name (Lucide icon) |
| `exo-ui:Command_hotkey` | `xsd:string` | 0..1 | Keyboard shortcut |
| `exo-ui:Command_condition` | IRI/string | 0..1 | Visibility condition |
| `exo-ui:Command_headless` | `xsd:boolean` | 0..1 | Whether command runs without UI |

#### Valid Command Example

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

exo-ui:CreateTaskCommand a exo-ui:Command ;
    exo-ui:Command_id "create-task"^^xsd:string ;
    exo-ui:Command_name "Create Task"^^xsd:string ;
    exo-ui:Command_icon "plus-circle"^^xsd:string ;
    exo-ui:Command_hotkey "Ctrl+Shift+T"^^xsd:string ;
    exo-ui:Command_action exo-ui:CreateTaskAction ;
    exo-ui:Command_headless false^^xsd:boolean .
```

### Action Shapes

Actions define what happens when a button is clicked or command executed. There's a base `Action` shape and specialized shapes for each action type.

#### Base Action Shape

**Target Class:** `exo-ui:Action`

| Property | Datatype | Cardinality | Description |
|----------|----------|-------------|-------------|
| `exo-ui:Action_headless` | `xsd:boolean` | Exactly 1 | **Required:** Whether action works without UI |
| `exo-ui:Action_cliCommand` | `xsd:string` | 0..1 | CLI command alternative |
| `exo-ui:Action_cliAlternative` | `xsd:string` | 0..1 | CLI argument syntax |

#### Specialized Action Shapes

| Action Type | Target Class | Required Properties |
|-------------|--------------|---------------------|
| UpdatePropertyAction | `exo-ui:UpdatePropertyAction` | `Action_targetProperty` (IRI) |
| CreateAssetAction | `exo-ui:CreateAssetAction` | `Action_targetClass` (IRI) |
| ExecuteSPARQLAction | `exo-ui:ExecuteSPARQLAction` | `Action_query` (string) |
| CompositeAction | `exo-ui:CompositeAction` | `Action_actions` (IRI list) |
| ShowModalAction | `exo-ui:ShowModalAction` | `Action_modalType` (string) |
| CustomHandlerAction | `exo-ui:CustomHandlerAction` | `Action_handler` (string) |
| NavigateAction | `exo-ui:NavigateAction` | `Action_target` (IRI) |
| TriggerHookAction | `exo-ui:TriggerHookAction` | (none beyond base) |

#### Valid Action Example

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ems: <https://exocortex.my/ontology/ems#> .

exo-ui:SetDoneStatusAction a exo-ui:UpdatePropertyAction ;
    exo-ui:Action_headless true^^xsd:boolean ;
    exo-ui:Action_targetProperty ems:Effort_status ;
    exo-ui:Action_targetValue <https://exocortex.my/ontology/emsstatus#Done> .
```

---

## Creating Custom Shapes

You can create custom SHACL shapes for your own RDF classes. This is useful when extending the ontology with custom types.

### Shape Structure

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix my: <https://example.org/ontology/my#> .

# 1. Declare the shape as a NodeShape targeting your class
my:MyClassShape rdf:type sh:NodeShape .
my:MyClassShape sh:targetClass my:MyClass .

# 2. Define property constraints using blank nodes
my:MyClassShape sh:property _:prop_name .
_:prop_name sh:path my:MyClass_name .
_:prop_name sh:datatype xsd:string .
_:prop_name sh:minCount "1" .
_:prop_name sh:maxCount "1" .
_:prop_name sh:message "MyClass must have exactly one name" .
```

### Constraint Components

| Constraint | Purpose | Example |
|------------|---------|---------|
| `sh:minCount` | Minimum number of values | `sh:minCount "1"` = required |
| `sh:maxCount` | Maximum number of values | `sh:maxCount "1"` = single value |
| `sh:datatype` | Value datatype | `sh:datatype xsd:string` |
| `sh:nodeKind` | Node type | `sh:nodeKind sh:IRI` = must be IRI |
| `sh:message` | Custom error message | Human-readable violation text |

### Full Custom Shape Example

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix my: <https://example.org/ontology/my#> .

# Shape for a custom Widget class
my:WidgetShape rdf:type sh:NodeShape .
my:WidgetShape sh:targetClass my:Widget .

# Required: widget ID (string, exactly one)
my:WidgetShape sh:property _:prop_id .
_:prop_id sh:path my:Widget_id .
_:prop_id sh:datatype xsd:string .
_:prop_id sh:minCount "1" .
_:prop_id sh:maxCount "1" .
_:prop_id sh:message "Widget must have exactly one id (string)" .

# Required: widget type (IRI, at least one)
my:WidgetShape sh:property _:prop_type .
_:prop_type sh:path my:Widget_type .
_:prop_type sh:nodeKind sh:IRI .
_:prop_type sh:minCount "1" .
_:prop_type sh:message "Widget must have a type IRI" .

# Optional: widget title (string, at most one)
my:WidgetShape sh:property _:prop_title .
_:prop_title sh:path my:Widget_title .
_:prop_title sh:datatype xsd:string .
_:prop_title sh:maxCount "1" .
_:prop_title sh:message "Widget title must be a string" .

# Optional: widget priority (integer, at most one)
my:WidgetShape sh:property _:prop_priority .
_:prop_priority sh:path my:Widget_priority .
_:prop_priority sh:datatype xsd:integer .
_:prop_priority sh:maxCount "1" .
_:prop_priority sh:message "Widget priority must be an integer" .
```

### Using Custom Shapes

```typescript
import { ShaclValidator } from "exocortex";

const customShapes = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
// ... your shape definition ...
`;

const myOntology = `
@prefix my: <https://example.org/ontology/my#> .
// ... your RDF data ...
`;

const validator = new ShaclValidator();
const result = await validator.validate(myOntology, customShapes);
```

---

## CLI validate Command

The CLI provides a `validate` command for validating ontology files against SHACL shapes.

### Basic Usage

```bash
exocortex-cli validate --ontology <path> --shapes <path>
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--ontology <path>` | Yes | - | Path to the ontology file (Turtle format) |
| `--shapes <path>` | Yes | - | Path to the SHACL shapes file (Turtle format) |
| `--format <type>` | No | `table` | Output format: `table` or `json` |

### Examples

**Validate with table output (default):**

```bash
exocortex-cli validate --ontology ./my-ontology.ttl --shapes ./shapes/button-shape.ttl
```

Output when validation passes:
```
Validation Results: 0 violations, 0 warnings

All validations passed
```

Output when validation fails:
```
Validation Results: 2 violations

VIOLATION in https://exocortex.my/ontology/exo-ui#BrokenButton
  Path: Button_action
  Message: Button must have an action IRI

VIOLATION in https://exocortex.my/ontology/exo-ui#AnotherBroken
  Path: Button_id
  Message: Button must have exactly one id (xsd:string)
```

**Validate with JSON output:**

```bash
exocortex-cli validate --ontology ./my-ontology.ttl --shapes ./shapes.ttl --format json
```

Output:
```json
{
  "conforms": false,
  "summary": {
    "violationCount": 1,
    "warningCount": 0,
    "infoCount": 0,
    "total": 1
  },
  "violations": [
    {
      "focusNode": "https://exocortex.my/ontology/exo-ui#BrokenButton",
      "path": "Button_action",
      "message": "Button must have an action IRI",
      "severity": "Violation",
      "sourceConstraintComponent": "MinCountConstraintComponent"
    }
  ]
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Validation passed (conforms) |
| 9 | Validation failed (violations found) |
| 2 | File not found error |
| 1 | Other error |

### CI/CD Integration

Use the validate command in your CI pipeline:

```yaml
# GitHub Actions example
- name: Validate ontology
  run: |
    exocortex-cli validate \
      --ontology ./ontologies/ems-ui.ttl \
      --shapes ./shapes/all-shapes.ttl
```

The command will exit with code 9 if validation fails, failing the pipeline.

---

## Error Messages Guide

Understanding validation error messages helps quickly fix issues.

### Error Message Structure

```
VIOLATION in <focus-node>
  Path: <property-name>
  Message: <human-readable-description>
```

### Common Errors and Solutions

#### MinCountConstraintComponent

**Error:**
```
VIOLATION in exo-ui:MyButton
  Path: Button_action
  Message: Button must have an action IRI
```

**Cause:** A required property is missing.

**Solution:** Add the missing property:
```turtle
exo-ui:MyButton a exo-ui:Button ;
    exo-ui:Button_id "my-button"^^xsd:string ;
    exo-ui:Button_action exo-ui:SomeAction .  # Add this line
```

#### MaxCountConstraintComponent

**Error:**
```
VIOLATION in exo-ui:MyButton
  Path: Button_id
  Message: Expected at most 1 value(s) for property Button_id
```

**Cause:** A property that should have at most one value has multiple values.

**Solution:** Remove duplicate values:
```turtle
# Wrong - multiple ids
exo-ui:MyButton a exo-ui:Button ;
    exo-ui:Button_id "id1"^^xsd:string ;
    exo-ui:Button_id "id2"^^xsd:string .  # Remove this

# Correct - single id
exo-ui:MyButton a exo-ui:Button ;
    exo-ui:Button_id "id1"^^xsd:string .
```

#### DatatypeConstraintComponent

**Error:**
```
VIOLATION in exo-ui:MyButton
  Path: Button_id
  Message: Value must be of type string
```

**Cause:** Property value has wrong datatype.

**Solution:** Use correct datatype annotation:
```turtle
# Wrong - missing datatype
exo-ui:Button_id "my-button" .

# Correct - explicit string datatype
exo-ui:Button_id "my-button"^^xsd:string .
```

#### NodeKindConstraintComponent

**Error:**
```
VIOLATION in exo-ui:MyButton
  Path: Button_action
  Message: Value must be an IRI
```

**Cause:** Property expects an IRI reference but received a literal.

**Solution:** Use IRI reference instead of string:
```turtle
# Wrong - string value
exo-ui:Button_action "SomeAction"^^xsd:string .

# Correct - IRI reference
exo-ui:Button_action exo-ui:SomeAction .
```

#### Parse Error

**Error:**
```
VIOLATION in (empty)
  Message: Parse error: Unexpected token at line 5, column 3
```

**Cause:** Invalid Turtle syntax.

**Solution:** Check for:
- Missing periods at end of statements
- Unclosed strings or URIs
- Invalid prefix declarations
- Typos in property names

---

## Best Practices

### 1. Validate Early and Often

Run validation as part of your development workflow:

```bash
# Add to package.json scripts
"scripts": {
  "validate:ontology": "exocortex-cli validate --ontology ./ontologies/ems-ui.ttl --shapes ./shapes/all-shapes.ttl"
}
```

### 2. Combine Shapes for Comprehensive Validation

Create a combined shapes file for validating all your RDF:

```turtle
# all-shapes.ttl
# Import all shape definitions

@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
# ... ButtonShape ...
# ... CommandShape ...
# ... ActionShapes ...
```

### 3. Write Custom Shapes for Custom Classes

Whenever you create a new RDF class, create a corresponding SHACL shape:

```
New Class → New Shape → Add to validation pipeline
```

### 4. Use Meaningful Error Messages

Custom `sh:message` values make debugging easier:

```turtle
# Good - specific message
_:prop_id sh:message "Widget must have exactly one id (string), used for programmatic reference" .

# Avoid - generic message
_:prop_id sh:message "Property constraint violated" .
```

### 5. Test Shapes Against Valid and Invalid Data

Create test files with both valid and intentionally invalid RDF to verify shapes work:

```
tests/
  valid-buttons.ttl      # Should pass
  invalid-buttons.ttl    # Should fail with expected errors
```

### 6. Document Shape Requirements

Add comments explaining why constraints exist:

```turtle
# Button_id is required for programmatic button identification.
# Must be unique across all buttons in the ontology.
_:prop_id sh:message "Button must have exactly one id (xsd:string)" .
```

---

## Troubleshooting

### Validation Always Passes (No Violations Found)

**Possible causes:**

1. **Shape targetClass doesn't match data class:**
   ```turtle
   # Shape targets exo-ui:Button
   sh:targetClass exo-ui:Button .

   # But data uses different class
   my:Thing a my:Widget .  # Not validated!
   ```

2. **Prefix mismatch:**
   ```turtle
   # Shape uses full IRI
   sh:targetClass <https://exocortex.my/ontology/exo-ui#Button> .

   # Data uses different prefix
   @prefix ui: <https://exocortex.my/ontology/exo-ui#> .
   my:Thing a ui:Button .  # Same class, should match
   ```

3. **Empty data graph:**
   - Empty or whitespace-only ontology files return `{ conforms: true }`

**Solution:** Check that class IRIs match exactly, including namespaces.

### Shapes Not Finding Properties

**Possible cause:** Property path IRI mismatch.

```turtle
# Shape expects
sh:path exo-ui:Button_id .

# But data uses
exo-ui:ButtonId "value" .  # Different property name!
```

**Solution:** Ensure property IRIs in shapes exactly match those in data.

### Parse Errors

**Symptoms:**
```
Parse error: Unexpected character at line X
```

**Common causes:**
1. Missing `.` at end of triple
2. Unclosed `<` URI or `"` string
3. Invalid escape sequences
4. Wrong line endings (Windows vs Unix)

**Solution:** Use a Turtle validator like [Turtle Validator](http://www.oxygenxml.com/xml_editor/xml_schema_validator.html) to find syntax errors.

### CLI Command Not Found

**Error:**
```
Error: command "validate" not found
```

**Solution:** Update to latest CLI version:
```bash
npm update -g @kitelev/exocortex-cli
```

The `validate` command was added in version 1.4.0.

---

## API Reference

### ShaclValidator

```typescript
import { ShaclValidator } from "exocortex";

const validator = new ShaclValidator();
const result = await validator.validate(dataTurtle, shapesTurtle);
```

#### Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `validate(data, shapes)` | `data: string, shapes: string` | `Promise<ValidationResult>` | Validate RDF data against SHACL shapes |

### ValidationResult

```typescript
interface ValidationResult {
  conforms: boolean;         // true if no violations
  violations: ValidationViolation[];  // list of violations
}
```

### ValidationViolation

```typescript
interface ValidationViolation {
  focusNode: string;         // The node that failed validation
  path?: string;             // Property path that was violated
  message: string;           // Human-readable error message
  severity: "Violation" | "Warning" | "Info";
  sourceConstraintComponent?: string;  // SHACL constraint type
}
```

### ValidationErrorFormatter

```typescript
import { ValidationErrorFormatter } from "exocortex";

const formatter = new ValidationErrorFormatter();

// Format for console output
console.log(formatter.formatForConsole(result));

// Format as JSON
console.log(formatter.formatAsJson(result));

// Format for Obsidian notices
const notices = formatter.formatForNotice(result);
```

### Built-in Shape Exports

```typescript
import {
  // Button shape
  BUTTON_SHAPE_TURTLE,
  BUTTON_SHAPE_DEFINITION,

  // Command shape
  COMMAND_SHAPE_TURTLE,
  COMMAND_SHAPE_DEFINITION,

  // Action shapes
  ACTION_SHAPE_TURTLE,
  ACTION_SUBCLASS_SHAPES_TURTLE,
  ALL_ACTION_SHAPES_TURTLE,

  // Action subclass definitions
  ACTION_SHAPE_DEFINITION,
  UPDATE_PROPERTY_ACTION_SHAPE_DEFINITION,
  CREATE_ASSET_ACTION_SHAPE_DEFINITION,
  EXECUTE_SPARQL_ACTION_SHAPE_DEFINITION,
  COMPOSITE_ACTION_SHAPE_DEFINITION,
  SHOW_MODAL_ACTION_SHAPE_DEFINITION,
  CUSTOM_HANDLER_ACTION_SHAPE_DEFINITION,
  NAVIGATE_ACTION_SHAPE_DEFINITION,
  TRIGGER_HOOK_ACTION_SHAPE_DEFINITION,
} from "exocortex";
```

---

## See Also

- [BUTTONS.md](./BUTTONS.md) - RDF-driven button system
- [COMMANDS.md](./COMMANDS.md) - RDF-driven command system
- [W3C SHACL Specification](https://www.w3.org/TR/shacl/) - Official standard
