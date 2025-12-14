import { Triple } from "../../domain/models/rdf/Triple";
import { IRI } from "../../domain/models/rdf/IRI";
import { Namespace } from "../../domain/models/rdf/Namespace";

export class RDFVocabularyMapper {
  private readonly propertyMappings: Map<string, IRI>;

  constructor() {
    this.propertyMappings = new Map([
      ["exo__Instance_class", Namespace.RDF.term("type")],
      ["exo__Asset_isDefinedBy", Namespace.RDFS.term("isDefinedBy")],
      ["exo__Class_superClass", Namespace.RDFS.term("subClassOf")],
      ["exo__Property_range", Namespace.RDFS.term("range")],
      ["exo__Property_domain", Namespace.RDFS.term("domain")],
      ["exo__Property_superProperty", Namespace.RDFS.term("subPropertyOf")],
    ]);
  }

  generateClassHierarchyTriples(): Triple[] {
    const triples: Triple[] = [];

    triples.push(
      new Triple(
        Namespace.EXO.term("Asset"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.RDFS.term("Resource"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Class"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.RDFS.term("Class"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Property"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.RDF.term("Property"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EMS.term("Task"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EMS.term("Project"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EMS.term("Area"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      ),
    );

    return triples;
  }

  generatePropertyHierarchyTriples(): Triple[] {
    const triples: Triple[] = [];

    triples.push(
      new Triple(
        Namespace.EXO.term("Instance_class"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDF.term("type"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Asset_isDefinedBy"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("isDefinedBy"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Class_superClass"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("subClassOf"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Property_range"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("range"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Property_domain"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("domain"),
      ),
    );

    triples.push(
      new Triple(
        Namespace.EXO.term("Property_superProperty"),
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("subPropertyOf"),
      ),
    );

    return triples;
  }

  generateMappedTriple(
    subject: IRI,
    exoProperty: string,
    value: string | IRI,
  ): Triple | null {
    const rdfPredicate = this.propertyMappings.get(exoProperty);
    if (!rdfPredicate) {
      return null;
    }

    let objectIRI: IRI;
    if (value instanceof IRI) {
      objectIRI = value;
    } else {
      const classMatch = value.match(/^(ems|exo)__(.+)$/);
      if (classMatch) {
        const [, nsPrefix, className] = classMatch;
        const namespace = nsPrefix === "ems" ? Namespace.EMS : Namespace.EXO;
        objectIRI = namespace.term(className);
      } else {
        objectIRI = new IRI(value);
      }
    }

    return new Triple(subject, rdfPredicate, objectIRI);
  }

  hasMappingFor(property: string): boolean {
    return this.propertyMappings.has(property);
  }
}
