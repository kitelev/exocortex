/**
 * CommandShape SHACL Definition
 *
 * SHACL shapes for validating Command class instances in RDF.
 * Ensures command definitions have required properties and correct datatypes.
 *
 * @see https://github.com/kitelev/exocortex/issues/1435
 * @module services/shacl/shapes
 * @since 1.4.0
 */

/**
 * SHACL shape for exo-ui:Command class.
 *
 * Required properties:
 * - exo-ui:Command_id (xsd:string, exactly 1)
 * - exo-ui:Command_name (xsd:string, min 1)
 * - exo-ui:Command_action (IRI, min 1)
 *
 * Optional properties:
 * - exo-ui:Command_icon (xsd:string)
 * - exo-ui:Command_hotkey (xsd:string)
 * - exo-ui:Command_condition (IRI or string)
 * - exo-ui:Command_headless (xsd:boolean)
 *
 * Note: This shape is defined using named blank nodes for compatibility
 * with the basic TurtleParser. Each sh:property is defined as a separate
 * blank node with explicit sh:property triples linking to the main shape.
 */
export const COMMAND_SHAPE_TURTLE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .

exo-ui:CommandShape rdf:type sh:NodeShape .
exo-ui:CommandShape sh:targetClass exo-ui:Command .

exo-ui:CommandShape sh:property _:prop_id .
_:prop_id sh:path exo-ui:Command_id .
_:prop_id sh:datatype xsd:string .
_:prop_id sh:minCount "1" .
_:prop_id sh:maxCount "1" .
_:prop_id sh:message "Command must have exactly one id (xsd:string)" .

exo-ui:CommandShape sh:property _:prop_name .
_:prop_name sh:path exo-ui:Command_name .
_:prop_name sh:datatype xsd:string .
_:prop_name sh:minCount "1" .
_:prop_name sh:message "Command must have a name (xsd:string)" .

exo-ui:CommandShape sh:property _:prop_action .
_:prop_action sh:path exo-ui:Command_action .
_:prop_action sh:nodeKind sh:IRI .
_:prop_action sh:minCount "1" .
_:prop_action sh:message "Command must have an action IRI" .

exo-ui:CommandShape sh:property _:prop_icon .
_:prop_icon sh:path exo-ui:Command_icon .
_:prop_icon sh:datatype xsd:string .
_:prop_icon sh:maxCount "1" .
_:prop_icon sh:message "Command icon must be a string" .

exo-ui:CommandShape sh:property _:prop_hotkey .
_:prop_hotkey sh:path exo-ui:Command_hotkey .
_:prop_hotkey sh:datatype xsd:string .
_:prop_hotkey sh:maxCount "1" .
_:prop_hotkey sh:message "Command hotkey must be a string" .

exo-ui:CommandShape sh:property _:prop_condition .
_:prop_condition sh:path exo-ui:Command_condition .
_:prop_condition sh:maxCount "1" .
_:prop_condition sh:message "Command condition should be an IRI reference or SPARQL string" .

exo-ui:CommandShape sh:property _:prop_headless .
_:prop_headless sh:path exo-ui:Command_headless .
_:prop_headless sh:datatype xsd:boolean .
_:prop_headless sh:maxCount "1" .
_:prop_headless sh:message "Command headless flag must be a boolean" .
`;

/**
 * Raw SHACL shape as a TypeScript object for programmatic access.
 * Useful for unit testing and runtime shape generation.
 */
export const COMMAND_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#Command",
  properties: {
    id: {
      path: "https://exocortex.my/ontology/exo-ui#Command_id",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    name: {
      path: "https://exocortex.my/ontology/exo-ui#Command_name",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      required: true,
    },
    action: {
      path: "https://exocortex.my/ontology/exo-ui#Command_action",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
    icon: {
      path: "https://exocortex.my/ontology/exo-ui#Command_icon",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    hotkey: {
      path: "https://exocortex.my/ontology/exo-ui#Command_hotkey",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    condition: {
      path: "https://exocortex.my/ontology/exo-ui#Command_condition",
      maxCount: 1,
      required: false,
    },
    headless: {
      path: "https://exocortex.my/ontology/exo-ui#Command_headless",
      datatype: "http://www.w3.org/2001/XMLSchema#boolean",
      maxCount: 1,
      required: false,
    },
  },
};
