/**
 * ButtonShape SHACL Definition
 *
 * SHACL shapes for validating Button class instances in RDF.
 * Ensures button definitions have required properties and correct datatypes.
 *
 * @see https://github.com/kitelev/exocortex/issues/1444
 * @module services/shacl/shapes
 * @since 1.4.0
 */

/**
 * SHACL shape for exo-ui:Button class.
 *
 * Required properties:
 * - exo-ui:Button_id (xsd:string, exactly 1)
 * - exo-ui:Button_action (IRI, min 1)
 *
 * Optional properties:
 * - exo-ui:Button_label (xsd:string)
 * - exo-ui:Button_icon (xsd:string)
 * - exo-ui:Button_tooltip (xsd:string)
 * - exo-ui:Button_condition (IRI)
 * - exo-ui:Button_group (IRI)
 * - exo-ui:Button_order (xsd:integer)
 * - exo-ui:Button_variant (xsd:string)
 *
 * Note: This shape is defined using named blank nodes for compatibility
 * with the basic TurtleParser. Each sh:property is defined as a separate
 * blank node with explicit sh:property triples linking to the main shape.
 */
export const BUTTON_SHAPE_TURTLE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .

exo-ui:ButtonShape rdf:type sh:NodeShape .
exo-ui:ButtonShape sh:targetClass exo-ui:Button .

exo-ui:ButtonShape sh:property _:prop_id .
_:prop_id sh:path exo-ui:Button_id .
_:prop_id sh:datatype xsd:string .
_:prop_id sh:minCount "1" .
_:prop_id sh:maxCount "1" .
_:prop_id sh:message "Button must have exactly one id (xsd:string)" .

exo-ui:ButtonShape sh:property _:prop_action .
_:prop_action sh:path exo-ui:Button_action .
_:prop_action sh:nodeKind sh:IRI .
_:prop_action sh:minCount "1" .
_:prop_action sh:message "Button must have an action IRI" .

exo-ui:ButtonShape sh:property _:prop_label .
_:prop_label sh:path exo-ui:Button_label .
_:prop_label sh:datatype xsd:string .
_:prop_label sh:maxCount "1" .
_:prop_label sh:message "Button label must be a string" .

exo-ui:ButtonShape sh:property _:prop_icon .
_:prop_icon sh:path exo-ui:Button_icon .
_:prop_icon sh:datatype xsd:string .
_:prop_icon sh:maxCount "1" .
_:prop_icon sh:message "Button icon must be a string" .

exo-ui:ButtonShape sh:property _:prop_tooltip .
_:prop_tooltip sh:path exo-ui:Button_tooltip .
_:prop_tooltip sh:datatype xsd:string .
_:prop_tooltip sh:maxCount "1" .
_:prop_tooltip sh:message "Button tooltip must be a string" .

exo-ui:ButtonShape sh:property _:prop_condition .
_:prop_condition sh:path exo-ui:Button_condition .
_:prop_condition sh:nodeKind sh:IRI .
_:prop_condition sh:maxCount "1" .
_:prop_condition sh:message "Button condition must be an IRI reference" .

exo-ui:ButtonShape sh:property _:prop_group .
_:prop_group sh:path exo-ui:Button_group .
_:prop_group sh:nodeKind sh:IRI .
_:prop_group sh:maxCount "1" .
_:prop_group sh:message "Button group must be an IRI reference" .

exo-ui:ButtonShape sh:property _:prop_order .
_:prop_order sh:path exo-ui:Button_order .
_:prop_order sh:datatype xsd:integer .
_:prop_order sh:maxCount "1" .
_:prop_order sh:message "Button order must be an integer" .

exo-ui:ButtonShape sh:property _:prop_variant .
_:prop_variant sh:path exo-ui:Button_variant .
_:prop_variant sh:datatype xsd:string .
_:prop_variant sh:maxCount "1" .
_:prop_variant sh:message "Button variant must be a string" .
`;

/**
 * Raw SHACL shape as a TypeScript object for programmatic access.
 * Useful for unit testing and runtime shape generation.
 */
export const BUTTON_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#Button",
  properties: {
    id: {
      path: "https://exocortex.my/ontology/exo-ui#Button_id",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    action: {
      path: "https://exocortex.my/ontology/exo-ui#Button_action",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
    label: {
      path: "https://exocortex.my/ontology/exo-ui#Button_label",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    icon: {
      path: "https://exocortex.my/ontology/exo-ui#Button_icon",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    tooltip: {
      path: "https://exocortex.my/ontology/exo-ui#Button_tooltip",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    condition: {
      path: "https://exocortex.my/ontology/exo-ui#Button_condition",
      nodeKind: "IRI",
      maxCount: 1,
      required: false,
    },
    group: {
      path: "https://exocortex.my/ontology/exo-ui#Button_group",
      nodeKind: "IRI",
      maxCount: 1,
      required: false,
    },
    order: {
      path: "https://exocortex.my/ontology/exo-ui#Button_order",
      datatype: "http://www.w3.org/2001/XMLSchema#integer",
      maxCount: 1,
      required: false,
    },
    variant: {
      path: "https://exocortex.my/ontology/exo-ui#Button_variant",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
  },
};
