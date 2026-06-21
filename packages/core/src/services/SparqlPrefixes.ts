/**
 * Standard RDF/Exocortex prefixes for SPARQL queries.
 *
 * Generic query infrastructure consumed by the CLI `query` command
 * (QueryPrefixInjector + sparql-query). Previously co-located in the
 * now-removed natural-language SPARQLTemplateLibrary.
 */
export const SPARQL_PREFIXES = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX ims: <https://exocortex.my/ontology/ims#>
PREFIX gtd: <https://exocortex.my/ontology/gtd#>
PREFIX period: <https://exocortex.my/ontology/period#>
PREFIX lit: <https://exocortex.my/ontology/lit#>
PREFIX inbox: <https://exocortex.my/ontology/inbox#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;
