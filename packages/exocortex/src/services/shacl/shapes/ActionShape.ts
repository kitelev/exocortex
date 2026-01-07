/**
 * ActionShape SHACL Definition
 *
 * SHACL shapes for validating Action class instances and subclasses in RDF.
 * Ensures action definitions have required properties and correct datatypes.
 *
 * Action class hierarchy:
 * - exo-ui:Action (base class)
 *   - exo-ui:UpdatePropertyAction
 *   - exo-ui:CreateAssetAction
 *   - exo-ui:ExecuteSPARQLAction
 *   - exo-ui:CompositeAction
 *   - exo-ui:ShowModalAction
 *   - exo-ui:CustomHandlerAction
 *   - exo-ui:NavigateAction
 *   - exo-ui:TriggerHookAction
 *
 * @see https://github.com/kitelev/exocortex/issues/1445
 * @module services/shacl/shapes
 * @since 1.4.0
 */

/**
 * SHACL shape for base exo-ui:Action class.
 *
 * Required properties:
 * - exo-ui:Action_headless (xsd:boolean) - Whether action runs without UI (Issue #1446)
 *
 * Optional properties (inherited by all subclasses):
 * - exo-ui:Action_cliCommand (xsd:string) - CLI command alternative
 * - exo-ui:Action_cliAlternative (xsd:string) - CLI argument syntax
 *
 * Note: This shape is defined using named blank nodes for compatibility
 * with the basic TurtleParser. Each sh:property is defined as a separate
 * blank node with explicit sh:property triples linking to the main shape.
 */
export const ACTION_SHAPE_TURTLE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .

exo-ui:ActionShape rdf:type sh:NodeShape .
exo-ui:ActionShape sh:targetClass exo-ui:Action .

exo-ui:ActionShape sh:property _:prop_cliCommand .
_:prop_cliCommand sh:path exo-ui:Action_cliCommand .
_:prop_cliCommand sh:datatype xsd:string .
_:prop_cliCommand sh:maxCount "1" .
_:prop_cliCommand sh:message "Action cliCommand must be a string" .

exo-ui:ActionShape sh:property _:prop_cliAlternative .
_:prop_cliAlternative sh:path exo-ui:Action_cliAlternative .
_:prop_cliAlternative sh:datatype xsd:string .
_:prop_cliAlternative sh:maxCount "1" .
_:prop_cliAlternative sh:message "Action cliAlternative must be a string" .

exo-ui:ActionShape sh:property _:prop_headless .
_:prop_headless sh:path exo-ui:Action_headless .
_:prop_headless sh:datatype xsd:boolean .
_:prop_headless sh:minCount "1" .
_:prop_headless sh:maxCount "1" .
_:prop_headless sh:message "Action must declare headless capability" .
`;

/**
 * SHACL shapes for Action subclasses with their specific required properties.
 *
 * UpdatePropertyAction:
 * - exo-ui:Action_targetProperty (IRI, required) - Property to update
 * - exo-ui:Action_targetValue (any) - New value
 * - exo-ui:Action_targetAsset (IRI) - Target asset
 *
 * CreateAssetAction:
 * - exo-ui:Action_targetClass (IRI, required) - Class of asset to create
 * - exo-ui:Action_template (IRI) - Template/prototype
 * - exo-ui:Action_location (xsd:string) - Folder path
 *
 * ExecuteSPARQLAction:
 * - exo-ui:Action_query (xsd:string, required) - SPARQL query
 *
 * CompositeAction:
 * - exo-ui:Action_actions (IRI, required) - List of actions
 *
 * ShowModalAction:
 * - exo-ui:Action_modalType (xsd:string, required) - Type of modal
 * - exo-ui:Action_modalParams (xsd:string) - JSON parameters
 *
 * CustomHandlerAction:
 * - exo-ui:Action_handler (xsd:string, required) - Handler ID
 *
 * NavigateAction:
 * - exo-ui:Action_target (IRI, required) - Navigation target
 *
 * TriggerHookAction:
 * - (No specific required properties beyond base Action)
 */
export const ACTION_SUBCLASS_SHAPES_TURTLE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .

exo-ui:UpdatePropertyActionShape rdf:type sh:NodeShape .
exo-ui:UpdatePropertyActionShape sh:targetClass exo-ui:UpdatePropertyAction .

exo-ui:UpdatePropertyActionShape sh:property _:upd_prop_targetProperty .
_:upd_prop_targetProperty sh:path exo-ui:Action_targetProperty .
_:upd_prop_targetProperty sh:nodeKind sh:IRI .
_:upd_prop_targetProperty sh:minCount "1" .
_:upd_prop_targetProperty sh:message "UpdatePropertyAction must have a targetProperty IRI" .

exo-ui:UpdatePropertyActionShape sh:property _:upd_prop_targetAsset .
_:upd_prop_targetAsset sh:path exo-ui:Action_targetAsset .
_:upd_prop_targetAsset sh:nodeKind sh:IRI .
_:upd_prop_targetAsset sh:maxCount "1" .
_:upd_prop_targetAsset sh:message "UpdatePropertyAction targetAsset must be an IRI" .

exo-ui:CreateAssetActionShape rdf:type sh:NodeShape .
exo-ui:CreateAssetActionShape sh:targetClass exo-ui:CreateAssetAction .

exo-ui:CreateAssetActionShape sh:property _:create_prop_targetClass .
_:create_prop_targetClass sh:path exo-ui:Action_targetClass .
_:create_prop_targetClass sh:nodeKind sh:IRI .
_:create_prop_targetClass sh:minCount "1" .
_:create_prop_targetClass sh:message "CreateAssetAction must have a targetClass IRI" .

exo-ui:CreateAssetActionShape sh:property _:create_prop_template .
_:create_prop_template sh:path exo-ui:Action_template .
_:create_prop_template sh:nodeKind sh:IRI .
_:create_prop_template sh:maxCount "1" .
_:create_prop_template sh:message "CreateAssetAction template must be an IRI" .

exo-ui:CreateAssetActionShape sh:property _:create_prop_location .
_:create_prop_location sh:path exo-ui:Action_location .
_:create_prop_location sh:datatype xsd:string .
_:create_prop_location sh:maxCount "1" .
_:create_prop_location sh:message "CreateAssetAction location must be a string" .

exo-ui:ExecuteSPARQLActionShape rdf:type sh:NodeShape .
exo-ui:ExecuteSPARQLActionShape sh:targetClass exo-ui:ExecuteSPARQLAction .

exo-ui:ExecuteSPARQLActionShape sh:property _:sparql_prop_query .
_:sparql_prop_query sh:path exo-ui:Action_query .
_:sparql_prop_query sh:datatype xsd:string .
_:sparql_prop_query sh:minCount "1" .
_:sparql_prop_query sh:maxCount "1" .
_:sparql_prop_query sh:message "ExecuteSPARQLAction must have exactly one query (xsd:string)" .

exo-ui:CompositeActionShape rdf:type sh:NodeShape .
exo-ui:CompositeActionShape sh:targetClass exo-ui:CompositeAction .

exo-ui:CompositeActionShape sh:property _:composite_prop_actions .
_:composite_prop_actions sh:path exo-ui:Action_actions .
_:composite_prop_actions sh:nodeKind sh:IRI .
_:composite_prop_actions sh:minCount "1" .
_:composite_prop_actions sh:message "CompositeAction must have an actions list reference" .

exo-ui:ShowModalActionShape rdf:type sh:NodeShape .
exo-ui:ShowModalActionShape sh:targetClass exo-ui:ShowModalAction .

exo-ui:ShowModalActionShape sh:property _:modal_prop_modalType .
_:modal_prop_modalType sh:path exo-ui:Action_modalType .
_:modal_prop_modalType sh:datatype xsd:string .
_:modal_prop_modalType sh:minCount "1" .
_:modal_prop_modalType sh:maxCount "1" .
_:modal_prop_modalType sh:message "ShowModalAction must have exactly one modalType (xsd:string)" .

exo-ui:ShowModalActionShape sh:property _:modal_prop_modalParams .
_:modal_prop_modalParams sh:path exo-ui:Action_modalParams .
_:modal_prop_modalParams sh:datatype xsd:string .
_:modal_prop_modalParams sh:maxCount "1" .
_:modal_prop_modalParams sh:message "ShowModalAction modalParams must be a string (JSON)" .

exo-ui:CustomHandlerActionShape rdf:type sh:NodeShape .
exo-ui:CustomHandlerActionShape sh:targetClass exo-ui:CustomHandlerAction .

exo-ui:CustomHandlerActionShape sh:property _:handler_prop_handler .
_:handler_prop_handler sh:path exo-ui:Action_handler .
_:handler_prop_handler sh:datatype xsd:string .
_:handler_prop_handler sh:minCount "1" .
_:handler_prop_handler sh:maxCount "1" .
_:handler_prop_handler sh:message "CustomHandlerAction must have exactly one handler (xsd:string)" .

exo-ui:NavigateActionShape rdf:type sh:NodeShape .
exo-ui:NavigateActionShape sh:targetClass exo-ui:NavigateAction .

exo-ui:NavigateActionShape sh:property _:nav_prop_target .
_:nav_prop_target sh:path exo-ui:Action_target .
_:nav_prop_target sh:nodeKind sh:IRI .
_:nav_prop_target sh:minCount "1" .
_:nav_prop_target sh:message "NavigateAction must have a target IRI" .

exo-ui:TriggerHookActionShape rdf:type sh:NodeShape .
exo-ui:TriggerHookActionShape sh:targetClass exo-ui:TriggerHookAction .
`;

/**
 * Combined SHACL shapes for all Action types.
 * Use this for comprehensive validation of all action types.
 */
export const ALL_ACTION_SHAPES_TURTLE = `${ACTION_SHAPE_TURTLE}

${ACTION_SUBCLASS_SHAPES_TURTLE}`;

/**
 * Raw SHACL shape definitions as TypeScript objects for programmatic access.
 * Useful for unit testing and runtime shape generation.
 */
export const ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#Action",
  properties: {
    cliCommand: {
      path: "https://exocortex.my/ontology/exo-ui#Action_cliCommand",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    cliAlternative: {
      path: "https://exocortex.my/ontology/exo-ui#Action_cliAlternative",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
    headless: {
      path: "https://exocortex.my/ontology/exo-ui#Action_headless",
      datatype: "http://www.w3.org/2001/XMLSchema#boolean",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  },
};

export const UPDATE_PROPERTY_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#UpdatePropertyAction",
  properties: {
    targetProperty: {
      path: "https://exocortex.my/ontology/exo-ui#Action_targetProperty",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
    targetValue: {
      path: "https://exocortex.my/ontology/exo-ui#Action_targetValue",
      required: false,
    },
    targetAsset: {
      path: "https://exocortex.my/ontology/exo-ui#Action_targetAsset",
      nodeKind: "IRI",
      maxCount: 1,
      required: false,
    },
  },
};

export const CREATE_ASSET_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
  properties: {
    targetClass: {
      path: "https://exocortex.my/ontology/exo-ui#Action_targetClass",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
    template: {
      path: "https://exocortex.my/ontology/exo-ui#Action_template",
      nodeKind: "IRI",
      maxCount: 1,
      required: false,
    },
    location: {
      path: "https://exocortex.my/ontology/exo-ui#Action_location",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
  },
};

export const EXECUTE_SPARQL_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#ExecuteSPARQLAction",
  properties: {
    query: {
      path: "https://exocortex.my/ontology/exo-ui#Action_query",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  },
};

export const COMPOSITE_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#CompositeAction",
  properties: {
    actions: {
      path: "https://exocortex.my/ontology/exo-ui#Action_actions",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
  },
};

export const SHOW_MODAL_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#ShowModalAction",
  properties: {
    modalType: {
      path: "https://exocortex.my/ontology/exo-ui#Action_modalType",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    modalParams: {
      path: "https://exocortex.my/ontology/exo-ui#Action_modalParams",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      maxCount: 1,
      required: false,
    },
  },
};

export const CUSTOM_HANDLER_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#CustomHandlerAction",
  properties: {
    handler: {
      path: "https://exocortex.my/ontology/exo-ui#Action_handler",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  },
};

export const NAVIGATE_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#NavigateAction",
  properties: {
    target: {
      path: "https://exocortex.my/ontology/exo-ui#Action_target",
      nodeKind: "IRI",
      minCount: 1,
      required: true,
    },
  },
};

export const TRIGGER_HOOK_ACTION_SHAPE_DEFINITION = {
  targetClass: "https://exocortex.my/ontology/exo-ui#TriggerHookAction",
  properties: {},
};
