/**
 * SPARQL Template Library for common query patterns
 *
 * This library contains pre-built SPARQL query templates based on
 * accumulated knowledge from EXOCORTEX-KNOWLEDGE.md and common use cases.
 */

/**
 * Standard RDF/Exocortex prefixes for SPARQL queries
 */
export const SPARQL_PREFIXES = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX ims: <https://exocortex.my/ontology/ims#>
PREFIX gtd: <https://exocortex.my/ontology/gtd#>
PREFIX period: <https://exocortex.my/ontology/period#>
PREFIX lit: <https://exocortex.my/ontology/lit#>
PREFIX inbox: <https://exocortex.my/ontology/inbox#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;

/**
 * Common Exocortex predicates
 */
export const PREDICATES = {
  // Core predicates
  ASSET_LABEL: "exo:Asset_label",
  ASSET_UID: "exo:Asset_uid",
  ASSET_PROTOTYPE: "exo:Asset_prototype",
  INSTANCE_CLASS: "exo:Instance_class",

  // Effort predicates
  EFFORT_START_TIMESTAMP: "ems:Effort_startTimestamp",
  EFFORT_END_TIMESTAMP: "ems:Effort_endTimestamp",
  EFFORT_STATUS: "ems:Effort_status",
  EFFORT_PARENT: "ems:Effort_parent",

  // Task predicates
  TASK_ESTIMATED_DURATION: "ems:Task_estimatedDuration",

  // Class predicates
  PROPERTY_DOMAIN: "exo:Property_domain",
  PROPERTY_RANGE: "exo:Property_range",
  CLASS_SUPERCLASS: "exo:Class_superClass",
} as const;

/**
 * Known asset classes in Exocortex
 */
export const ASSET_CLASSES = {
  TASK: "ems__Task",
  MEETING: "ems__Meeting",
  PROJECT: "ems__Project",
  AREA: "ems__Area",
  TASK_PROTOTYPE: "ems__TaskPrototype",
  MEETING_PROTOTYPE: "ems__MeetingPrototype",
  PERSON: "ims__Person",
  DAY: "period__Day",
  CLASS: "exo__Class",
  OBJECT_PROPERTY: "exo__ObjectProperty",
  DATA_PROPERTY: "exo__DataProperty",
  DEPRECATED_PROPERTY: "exo__DeprecatedProperty",
} as const;

/**
 * Effort status values
 */
export const EFFORT_STATUSES = {
  DOING: "ems:EffortStatusDoing",
  DONE: "ems:EffortStatusDone",
  BACKLOG: "ems:EffortStatusBacklog",
} as const;

/**
 * Known prototypes with their UUIDs
 */
export const KNOWN_PROTOTYPES = {
  MORNING_SHOWER: "2d369bb0-159f-4639-911d-ec2c585e8d00",
  CUT_NAILS: "1d7b739c-0e3e-46f2-ba88-e66f30b732f9",
} as const;

/**
 * SPARQL query template interface
 */
export interface SPARQLTemplate {
  /** Template name */
  name: string;
  /** Description of what the template does */
  description: string;
  /** The SPARQL query template with placeholders */
  template: string;
  /** Parameters that can be substituted */
  parameters: {
    name: string;
    description: string;
    required: boolean;
    example?: string;
  }[];
  /** Example natural language queries that map to this template */
  examples: string[];
  /** Keywords that trigger this template */
  keywords: string[];
}

/**
 * Library of SPARQL query templates
 */
export const SPARQL_TEMPLATES: SPARQLTemplate[] = [
  {
    name: "search_by_label",
    description: "Search entities by label containing a keyword",
    template: `${SPARQL_PREFIXES}

SELECT ?s ?label WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  FILTER(CONTAINS(?label, "{{keyword}}"))
}
ORDER BY ?label
LIMIT {{limit}}`,
    parameters: [
      {
        name: "keyword",
        description: "Keyword to search for in labels",
        required: true,
        example: "Поспать",
      },
      {
        name: "limit",
        description: "Maximum number of results",
        required: false,
        example: "100",
      },
    ],
    examples: [
      "найди все задачи со словом душ",
      "поиск по названию поспать",
      "покажи записи содержащие слово йога",
    ],
    keywords: ["найди", "найти", "поиск", "искать", "содержащие", "со словом"],
  },
  {
    name: "find_by_prototype_uuid",
    description:
      "Find all instances of a specific prototype by UUID (most reliable method)",
    template: `${SPARQL_PREFIXES}

SELECT ?s ?label ?start ?end
WHERE {
  ?s ${PREDICATES.ASSET_PROTOTYPE} ?proto .
  FILTER(CONTAINS(STR(?proto), "{{prototypeUuid}}"))
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  OPTIONAL { ?s ${PREDICATES.EFFORT_START_TIMESTAMP} ?start }
  OPTIONAL { ?s ${PREDICATES.EFFORT_END_TIMESTAMP} ?end }
}
ORDER BY DESC(?start)
LIMIT {{limit}}`,
    parameters: [
      {
        name: "prototypeUuid",
        description: "UUID of the prototype (or part of it)",
        required: true,
        example: "2d369bb0",
      },
      {
        name: "limit",
        description: "Maximum number of results",
        required: false,
        example: "100",
      },
    ],
    examples: [
      "все инстансы прототипа с UUID 2d369bb0",
      "задачи с прототипом 2d369bb0-159f-4639-911d-ec2c585e8d00",
    ],
    keywords: ["прототип", "prototype", "UUID", "инстансы"],
  },
  {
    name: "average_duration_by_prototype",
    description:
      "Calculate average duration of tasks by prototype UUID using built-in functions",
    template: `${SPARQL_PREFIXES}

SELECT (AVG(?durationMin) AS ?avgMinutes) (COUNT(?s) AS ?count) (MIN(?durationMin) AS ?minMin) (MAX(?durationMin) AS ?maxMin) (SUM(?durationMin) AS ?totalMin)
WHERE {
  ?s ${PREDICATES.ASSET_PROTOTYPE} ?proto .
  FILTER(CONTAINS(STR(?proto), "{{prototypeUuid}}"))
  ?s ${PREDICATES.EFFORT_START_TIMESTAMP} ?start .
  ?s ${PREDICATES.EFFORT_END_TIMESTAMP} ?end .
  BIND(exo:dateDiffMinutes(?start, ?end) AS ?durationMin)
}`,
    parameters: [
      {
        name: "prototypeUuid",
        description: "UUID of the prototype",
        required: true,
        example: "2d369bb0-159f-4639-911d-ec2c585e8d00",
      },
    ],
    examples: [
      "среднее время утреннего душа",
      "сколько в среднем занимает задача",
      "статистика по длительности",
      "среднее время сна",
    ],
    keywords: [
      "среднее",
      "средняя",
      "average",
      "статистика",
      "длительность",
      "duration",
      "сколько занимает",
    ],
  },
  {
    name: "sleep_analysis",
    description: "Analyze sleep patterns (tasks starting with Поспать)",
    template: `${SPARQL_PREFIXES}

SELECT ?label ?start ?end
WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  FILTER(STRSTARTS(?label, "Поспать {{yearMonth}}"))
  ?s ${PREDICATES.EFFORT_START_TIMESTAMP} ?start .
  ?s ${PREDICATES.EFFORT_END_TIMESTAMP} ?end .
}
ORDER BY ?start`,
    parameters: [
      {
        name: "yearMonth",
        description: "Year-month prefix for filtering (e.g., 2025-12)",
        required: false,
        example: "2025-12",
      },
    ],
    examples: [
      "анализ сна за декабрь",
      "статистика сна",
      "когда я спал",
      "сколько я спал в ноябре",
    ],
    keywords: ["сон", "спать", "поспать", "sleep", "спал"],
  },
  {
    name: "active_projects",
    description: "Find active projects with status Doing",
    template: `${SPARQL_PREFIXES}

SELECT ?project ?label
WHERE {
  ?project ${PREDICATES.INSTANCE_CLASS} "[[${ASSET_CLASSES.PROJECT}]]" .
  ?project ${PREDICATES.EFFORT_STATUS} ${EFFORT_STATUSES.DOING} .
  ?project ${PREDICATES.ASSET_LABEL} ?label .
}
ORDER BY ?label`,
    parameters: [],
    examples: [
      "активные проекты",
      "проекты в работе",
      "над чем работаю",
      "текущие проекты",
    ],
    keywords: [
      "активные",
      "активных",
      "проекты",
      "projects",
      "в работе",
      "doing",
    ],
  },
  {
    name: "projects_without_tasks",
    description: "Find active projects that have no child tasks",
    template: `${SPARQL_PREFIXES}

SELECT ?project ?label
WHERE {
  ?project ${PREDICATES.INSTANCE_CLASS} "[[${ASSET_CLASSES.PROJECT}]]" .
  ?project ${PREDICATES.EFFORT_STATUS} ${EFFORT_STATUSES.DOING} .
  ?project ${PREDICATES.ASSET_LABEL} ?label .
  FILTER NOT EXISTS {
    ?task ${PREDICATES.EFFORT_PARENT} ?project .
  }
}
ORDER BY ?label`,
    parameters: [],
    examples: [
      "проекты без задач",
      "пустые проекты",
      "проекты которым нужны задачи",
    ],
    keywords: ["без задач", "пустые", "нет задач"],
  },
  {
    name: "recent_activities",
    description: "Get recent activities ordered by start time",
    template: `${SPARQL_PREFIXES}

SELECT ?label ?start ?end
WHERE {
  ?s ${PREDICATES.EFFORT_START_TIMESTAMP} ?start .
  ?s ${PREDICATES.EFFORT_END_TIMESTAMP} ?end .
  ?s ${PREDICATES.ASSET_LABEL} ?label .
}
ORDER BY DESC(?start)
LIMIT {{limit}}`,
    parameters: [
      {
        name: "limit",
        description: "Maximum number of results",
        required: false,
        example: "50",
      },
    ],
    examples: [
      "последние активности",
      "что делал недавно",
      "недавние задачи",
      "история активностей",
    ],
    keywords: ["последние", "недавние", "recent", "история", "недавно"],
  },
  {
    name: "tasks_by_label_pattern",
    description: "Find tasks matching a specific label pattern",
    template: `${SPARQL_PREFIXES}

SELECT ?label ?start ?end
WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  FILTER(CONTAINS(?label, "{{pattern}}"))
  ?s ${PREDICATES.EFFORT_START_TIMESTAMP} ?start .
  ?s ${PREDICATES.EFFORT_END_TIMESTAMP} ?end .
}
ORDER BY ?start`,
    parameters: [
      {
        name: "pattern",
        description: "Pattern to match in task labels",
        required: true,
        example: "йога",
      },
    ],
    examples: [
      "все занятия йогой",
      "тренировки пресса",
      "практики МОЧИ",
      "встречи 1-2-1",
    ],
    keywords: ["занятия", "тренировки", "практики", "встречи"],
  },
  {
    name: "count_by_class",
    description: "Count entities by their class type",
    template: `${SPARQL_PREFIXES}

SELECT ?class (COUNT(?s) AS ?count)
WHERE {
  ?s ${PREDICATES.INSTANCE_CLASS} ?class .
}
GROUP BY ?class
ORDER BY DESC(?count)
LIMIT {{limit}}`,
    parameters: [
      {
        name: "limit",
        description: "Maximum number of results",
        required: false,
        example: "20",
      },
    ],
    examples: [
      "сколько записей каждого типа",
      "статистика по классам",
      "типы сущностей",
    ],
    keywords: ["сколько", "count", "статистика", "типы", "классы"],
  },
  {
    name: "find_prototype",
    description: "Find prototype URI by task label",
    template: `${SPARQL_PREFIXES}

SELECT DISTINCT ?prototype ?label
WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  FILTER(CONTAINS(?label, "{{taskLabel}}"))
  ?s ${PREDICATES.ASSET_PROTOTYPE} ?prototype .
}
LIMIT 5`,
    parameters: [
      {
        name: "taskLabel",
        description: "Task label to search for",
        required: true,
        example: "Утренний душ",
      },
    ],
    examples: [
      "какой прототип у задачи утренний душ",
      "найди прототип для",
      "UUID прототипа",
    ],
    keywords: ["прототип", "prototype", "шаблон", "template"],
  },
  {
    name: "entity_properties",
    description: "Get all properties of an entity by label",
    template: `${SPARQL_PREFIXES}

SELECT ?p ?o
WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  FILTER(CONTAINS(?label, "{{entityLabel}}"))
  ?s ?p ?o .
}`,
    parameters: [
      {
        name: "entityLabel",
        description: "Entity label to search for",
        required: true,
        example: "Поспать 2025-11-30",
      },
    ],
    examples: [
      "все свойства задачи",
      "покажи детали записи",
      "информация о",
    ],
    keywords: ["свойства", "properties", "детали", "информация"],
  },
  {
    name: "properties_by_uuid",
    description: "Get all properties of an entity by UUID",
    template: `${SPARQL_PREFIXES}

SELECT ?p ?o
WHERE {
  ?s ?p ?o .
  FILTER(CONTAINS(STR(?s), "{{uuid}}"))
}`,
    parameters: [
      {
        name: "uuid",
        description: "UUID of the entity",
        required: true,
        example: "2d369bb0-159f-4639-911d-ec2c585e8d00",
      },
    ],
    examples: [
      "свойства по UUID",
      "покажи запись с UUID",
    ],
    keywords: ["UUID", "uid"],
  },
  {
    name: "areas",
    description: "List all areas in the knowledge base",
    template: `${SPARQL_PREFIXES}

SELECT ?area ?label
WHERE {
  ?area ${PREDICATES.INSTANCE_CLASS} "[[${ASSET_CLASSES.AREA}]]" .
  ?area ${PREDICATES.ASSET_LABEL} ?label .
}
ORDER BY ?label`,
    parameters: [],
    examples: ["все области", "области ответственности", "areas"],
    keywords: ["области", "areas", "area"],
  },
  {
    name: "persons",
    description: "List all persons in the knowledge base",
    template: `${SPARQL_PREFIXES}

SELECT ?person ?label
WHERE {
  ?person ${PREDICATES.INSTANCE_CLASS} "[[${ASSET_CLASSES.PERSON}]]" .
  ?person ${PREDICATES.ASSET_LABEL} ?label .
}
ORDER BY ?label`,
    parameters: [],
    examples: ["все люди", "контакты", "persons"],
    keywords: ["люди", "контакты", "persons", "person"],
  },
];

/**
 * Get a template by name
 */
export function getTemplateByName(
  name: string
): SPARQLTemplate | undefined {
  return SPARQL_TEMPLATES.find((t) => t.name === name);
}

/**
 * Find templates matching keywords from a natural language query
 */
export function findMatchingTemplates(
  query: string,
  maxResults = 3
): SPARQLTemplate[] {
  const normalizedQuery = query.toLowerCase();
  const scores = new Map<SPARQLTemplate, number>();

  for (const template of SPARQL_TEMPLATES) {
    let score = 0;

    // Check keywords
    for (const keyword of template.keywords) {
      if (normalizedQuery.includes(keyword.toLowerCase())) {
        score += 2;
      }
    }

    // Check examples similarity
    for (const example of template.examples) {
      const exampleWords = example.toLowerCase().split(/\s+/);
      const queryWords = normalizedQuery.split(/\s+/);
      const matchingWords = exampleWords.filter((w) =>
        queryWords.some((qw) => qw.includes(w) || w.includes(qw))
      );
      score += matchingWords.length * 0.5;
    }

    if (score > 0) {
      scores.set(template, score);
    }
  }

  // Sort by score and return top matches
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([template]) => template);
}

/**
 * Fill template with parameters
 */
export function fillTemplate(
  template: SPARQLTemplate,
  params: Record<string, string>
): string {
  let query = template.template;

  // Apply default values for optional parameters
  for (const param of template.parameters) {
    if (!param.required && !params[param.name]) {
      // Set default values
      if (param.name === "limit") {
        params[param.name] = "100";
      }
    }
  }

  // Replace placeholders
  for (const [key, value] of Object.entries(params)) {
    query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return query;
}

/**
 * Validate that all required parameters are provided
 */
export function validateParameters(
  template: SPARQLTemplate,
  params: Record<string, string>
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const param of template.parameters) {
    if (param.required && !params[param.name]) {
      missing.push(param.name);
    }
  }

  return { valid: missing.length === 0, missing };
}
