# Exocortex — Vision

> This document describes the philosophy and full vision for Exocortex. Most ideas are conceptual and not yet implemented. See [README.md](./README.md) for current features.

> "Экзокортекс — это как я хочу мыслить — не в ловушке линейных документов или иерархических папок, а в живой паутине смыслов, растущей вместе со мной."

**Exocortex** is not just a knowledge management tool — it's **a companion to consciousness**. A system designed to:

- Transform chaotic information flow into a **coherent worldview** supporting decision-making
- Help people **live more consciously** through structured management of knowledge and goals
- Augment human cognition without replacing it — **a companion, not a crutch**

> "Life is the goal. Awareness is the methodology. Exocortex is the instrument."

### Everything as Knowledge

Exocortex follows the principle of **"Everything as Knowledge"** — an evolution of the "as Code" paradigm. While Infrastructure as Code and Docs as Code describe desired system states in machine-executable files, Exocortex goes further: entities, UI layouts, workflows, commands, and even the schema itself are all **semantic data** in the same format and the same storage.

| Layer      | Traditional Approach             | Exocortex                                                                 |
| ---------- | -------------------------------- | ------------------------------------------------------------------------- |
| Schema     | Hardcoded in app or config files | OWL classes and properties as Markdown files in your vault                |
| Workflows  | Code (event handlers, scripts)   | RDF data: `ems__WorkflowTransition` with states, preconditions, grounding |
| UI Layouts | JSON/CSS configuration           | `pn__Layout` — columns, filters, sorting as semantic data                 |
| Commands   | Compiled into the plugin         | `exocmd__Command` + SPARQL-based preconditions + declarative grounding    |
| Content    | Markdown files                   | Same Markdown files — content and metadata in one place                   |

This approach gives four advantages over "as Code":

1. **Composability through a graph** — everything is connected via queryable RDF triples, not just file imports
2. **Schema = data** — the meta-level lives in the same space as user data; add a file to create a new entity type
3. **Accessibility** — requires domain expertise, not programming skills
4. **Foundation for reasoning** — SPARQL queries today, OWL inference potential tomorrow

### Historical Context

Exocortex builds on ideas from the Semantic Web community. [Fresnel](https://www.w3.org/2005/04/fresnel-info/) (W3C, 2005) introduced Lenses and Formats for rendering RDF data, but lacked an action layer. [SHACL](https://www.w3.org/TR/shacl/) describes constraints and UI hints for RDF shapes. Exocortex combines these concepts with an action layer (dynamic commands, workflow state machines), file-based storage (Markdown + YAML frontmatter), and an offline-first runtime (Obsidian).

**Formula:** Exocortex = Fresnel display layer + action layer (RFC-009) + file-based RDF store + Obsidian runtime.

### The Path to Übermensch

Exocortex is an instrument for becoming **Übermensch** (Nietzsche):

- Overcoming reactive behavior through **conceptual awareness**
- **Super-individualism** — the ability to create your own values
- Striving for infinite self-improvement
- Human as a **transitional stage** between animal and superhuman

---

## Philosophy

### Core Principles

1. **Awareness as Methodology** — The system increases awareness, not replaces thinking
2. **Exocortex as Spirit Manifestation** — Not just a utility, but a way to materialize your inner world
3. **Ontological Precision** — Knowledge structured through formal ontologies
4. **Information-Centrism** — Information as the foundation of reality

### Exocortex vs Generative AI

**Key difference: Exocortex cannot hallucinate!**

- AI hallucinates (generates non-existent information)
- Exocortex operates **only with verified data** from knowledge graph
- AI is a tool of exocortex, but not a replacement for its function of **reliable knowledge storage**

---

## Unique Concepts

### DCC — Direct Conceptual Communication

**DCC** is Exocortex's killer feature — communication **without conversion between different worldviews**.

**Problem**: Conceptual miscommunication — people use the same words but mean different things.

**Solution**: Each concept has:

- Formal definition (`ims__Concept_definition`)
- Relationships with other concepts (`ims__Concept_broader`, `ims__Concept_related`)
- Mapping between different users' ontologies

DCC = **ExoAPI** — semantic contract between exocortexes.

### STIR Model — Knowledge Coordinates

**STIR** (Space, Time, Importance, Relatedness) — universal model for information organization:

| Parameter       | Question               | Application                                    |
| --------------- | ---------------------- | ---------------------------------------------- |
| **Space**       | Where?                 | Spatial localization, context, domain          |
| **Time**        | When?                  | Temporal relevance, deadlines, validity period |
| **Importance**  | How important?         | Priority, impact on goals                      |
| **Relatedness** | What is it related to? | Connections, dependencies, cluster membership  |

### Vault-as-Graph + Homoiconic Profiles + UID-canon Privacy Model

The architectural cornerstone of Exocortex is the **unification of three principles** that most competing tools treat as separate layers:

1. **Vault-as-Graph.** Markdown files plus YAML frontmatter are not a document store with sidecar metadata — they are an RDF triple store. Every wikilink is an edge; every frontmatter property is a typed predicate. SPARQL queries are first-class navigation primitives, not an export plugin. Layouts, commands, workflows, and column sets are **assets in the same graph as the content they govern**.

2. **Homoiconic profiles.** A Profile is not a hidden runtime setting in `data.json` — it is a vault artifact (`exo__Profile`) with its own UID, label, and declared imports. The plugin reads profiles from the graph and applies them; users author profiles by writing Markdown. This makes scope, sync, and inheritance visible and version-controlled. **Profile changes are diffs in git, not configuration drift.** Per-device active selection (`activeProfileUid`, the last-applied profile) lives in `data.local.json` so the same vault can present different active contexts on phone, laptop, and tablet without sync conflicts.

3. **UID-canon privacy model.** When every asset filename is `<uuid>.md` and wikilinks normalize to `[[<uuid>|<label>]]`, **raw file bytes / git diffs / files shared outside the vault** become semantically opaque without the ontology + label lookup. A shared `.md` file references other assets only by UUID; a `git diff` shows structural change but no domain meaning. This is **privacy through normalization at the file-byte layer**, not cryptography — and crucially, not rendered-view protection: Obsidian resolves wikilink labels live, so screenshots and screen shares of the editor display labels. UID-canon protects raw bytes / cold disk / agent-on-filesystem scenarios; encryption protects in-transit and cloud-at-rest; applying a profile (below) is the strongest protection — sensitive AssetSpaces simply not on disk. Obsidian Sync's at-rest encryption secures the bytes from cloud snooping; UID-canon obfuscates the meaning of bytes one already has. They compose orthogonally.

#### Comparison: where Profile fits

| Mechanism                          | Granularity                                  | Where state lives                            | Use case                                           |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Obsidian Sync (at-rest encryption) | File-level                                   | End-to-end encrypted blobs in Obsidian cloud | Securing replicated bytes                          |
| Obsidian Git                       | Repo-level                                   | Single git remote, full vault history        | Versioning + manual selective clone                |
| Profile (Apply profile)            | Filesystem-level (submodule mount/unmount)   | `assetspaces/` + `.gitmodules` + cache       | Perf gain, privacy boundary, mobile reindex relief |

Profile **inhabits the same git substrate** as Obsidian Git but manages submodule lifecycle declaratively from vault profiles: one Apply-profile operation reconciles the on-disk AssetSpace set to exactly the target profile's effective set. The combination — one vault, many declared profiles, one mount-state apply operation — is what no competitor in the table at the top of [README.md](./README.md) offers: Notion has shared workspaces but no semantic graph; Protégé has ontologies but no usable daily-driver UI; Semantic MediaWiki has both but no vault portability and no profile-level scoping.

The deep architectural pitch and the 2-phase commit safety model live in **[docs/profile.md](./docs/profile.md)**.

### UI/CLI Parity Invariant

> **UI/CLI Parity Invariant:** Every user-facing Exocortex capability MUST be invokable through BOTH clients — the Obsidian plugin (UI) and the CLI (`@kitelev/exocortex-cli`). Neither client is privileged; neither holds exclusive features. Enforced architecturally: all domain/engine logic lives in the platform-agnostic shared core (`exocortex` package) behind ports (FileSystem, Http, etc.); the plugin and CLI are thin adapters that inject platform-specific I/O (Obsidian `DataAdapter`/`requestUrl` vs Node `fs`/`fetch`). New features land in the core first, then get thin bindings in BOTH clients.

**Why it is a killer feature — the no-lock-in north star.** The user's knowledge system is not locked to one application. The *product* is the vault (data) plus the SDK (engine) — the Obsidian plugin is just one frontend. Any client — the current plugin, the CLI, a future mobile/web/agent — can drive the full system. This is what makes Exocortex an **SDK / platform, not merely a plugin**. Parallel reimplementations *without* this principle have already caused real regressions (`extractReference` triplication; mount/unmount logic split between plugin and a CLI scaffold — see [#3416](https://github.com/kitelev/exocortex/issues/3416)). The invariant names the force that prevents these.

#### Complementary pair with Homoiconicity

Exocortex removes lock-in at **two** layers, governed by two distinct, complementary invariants. **Homoiconicity** (RFC `c78cc5c8`, also codified in `CLAUDE.md`) keeps the *data layer* open; **UI/CLI Parity** keeps the *invocation layer* open. Document and reason about them as a pair:

| Invariant          | What it governs                                                                                      | One-line framing                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Homoiconicity**  | User-configurable *semantics* are vault data (RDF), readable/writable by any RDF-capable client      | *What* the system does is data, not code          |
| **UI/CLI Parity**  | The *engine behaviour* that processes that data is reachable from any client via shared core + ports | *How* you invoke it is client-agnostic            |

Together they guarantee neither the meaning of your knowledge nor the ability to act on it is captive to a single application.

**See also:** the enforced ports/adapters statement in [ARCHITECTURE.md](./ARCHITECTURE.md); the validator-specific enforcement instance in [docs/CROSS_RUNTIME_PARITY.md](./docs/CROSS_RUNTIME_PARITY.md); the SDK-platform program *"AssetSpace + Profile platform — exo as SDK"* (vault UID `ea93b829`, RFC `01a83de8`) that this invariant formalizes. A full capability-by-capability parity audit across all features is future work, tracked under that program.

---

## 42 Unique IT Ideas

### Implementation Status

| Status         | Meaning                                           |
| -------------- | ------------------------------------------------- |
| ✅ Implemented | Available in current release                      |
| 🔨 Partial     | Core concept exists, full vision not yet realized |
| 📋 Planned     | Designed but not implemented                      |
| 💡 Conceptual  | Vision-stage idea                                 |

### Core Architecture (1-10)

| #   | Idea                                      | Description                                                                                            | Status         |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | **Asset as Knowledge Quantum**            | Atomic unit of knowledge with UUID, class, label, and semantic relationships                           | ✅ Implemented |
| 2   | **DCC (Direct Conceptual Communication)** | Communication without worldview conversion — semantic contract between exocortexes                     | 💡 Conceptual  |
| 3   | **ExoBlockchain**                         | Immutable knowledge provenance tracking — who, when, and how created each fact                         | 💡 Conceptual  |
| 4   | **ExoEcoSystem**                          | Federation of exocortexes forming collective intelligence network                                      | 💡 Conceptual  |
| 5   | **Modular Ontology System**               | IMS (concepts), EMS (tasks), ZTLK (notes). _Planned: PTMS (personality), Observation (world tracking)_ | ✅ Implemented |
| 6   | **Simulacrum**                            | Digital representation of external entities (people, companies) for modeling interactions              | 📋 Planned     |
| 7   | **ExoLang**                               | Domain-specific language for knowledge operations and transformations                                  | 💡 Conceptual  |
| 8   | **Inference Engine**                      | Logical reasoning over knowledge graph — deriving new facts from existing                              | 🔨 Partial     |
| 9   | **BOM (Brain Object Model)**              | Inspired by DOM — programmatic access to consciousness structure                                       | 💡 Conceptual  |
| 10  | **Ontological Relativity**                | Each user has their own ontology, mapped to others through DCC                                         | 💡 Conceptual  |

### Semantic Layer (11-20)

| #   | Idea                             | Description                                                               | Status         |
| --- | -------------------------------- | ------------------------------------------------------------------------- | -------------- |
| 11  | **ExoRDF**                       | Extended RDF with temporal and provenance dimensions                      | 💡 Conceptual  |
| 12  | **ExoProphet**                   | Prediction engine based on personal patterns and knowledge graph          | 💡 Conceptual  |
| 13  | **Braindance + IoT**             | Integration with wearables (HR, glucose, location) for context enrichment | 💡 Conceptual  |
| 14  | **Action Tracking**              | Every action becomes data — browsing, reading, communication patterns     | 💡 Conceptual  |
| 15  | **"Not AI" Principle**           | Exocortex stores verified facts; AI generates but cannot be trusted alone | 🔨 Partial     |
| 16  | **ExoTag**                       | Semantic tags with inheritance and property propagation                   | 📋 Planned     |
| 17  | **Life Integration**             | System becomes invisible layer over life, not separate application        | 💡 Conceptual  |
| 18  | **Local-First Architecture**     | Data stays on device, cloud is optional synchronization                   | ✅ Implemented |
| 19  | **IExE (Inference x Exocortex)** | Intelligence-enhanced reasoning combining human and machine cognition     | 💡 Conceptual  |
| 20  | **ExoProtocol**                  | Communication standard between exocortex instances                        | 💡 Conceptual  |

### Process & Methodology (21-30)

| #   | Idea                         | Description                                                                         | Status         |
| --- | ---------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| 21  | **Echoization**              | Every external information piece gets internal representation with personal context | 💡 Conceptual  |
| 22  | **ExoAdapter**               | Integration layer for external services (calendars, email, social)                  | 💡 Conceptual  |
| 23  | **Dynamic Naming**           | Assets can have multiple names based on context and audience                        | ✅ Implemented |
| 24  | **Human as Execution Organ** | Exocortex plans, human executes — partnership model                                 | 💡 Conceptual  |
| 25  | **Knowledge Monetization**   | Verified knowledge as tradeable asset in ExoEcoSystem                               | 💡 Conceptual  |
| 26  | **Trigger System**           | Automated reactions to patterns in knowledge graph changes                          | 💡 Conceptual  |
| 27  | **No Permanent Self**        | Identity is emergent property of knowledge graph, not fixed entity                  | 💡 Conceptual  |
| 28  | **Breadcrumbs**              | Automatic trail of attention and reasoning for later reconstruction                 | 💡 Conceptual  |
| 29  | **GTD Integration**          | Getting Things Done methodology as native workflow                                  | ✅ Implemented |
| 30  | **ExoLayout**                | Flexible views over knowledge graph for different cognitive tasks                   | ✅ Implemented |

### Advanced Concepts (31-42)

| #   | Idea                               | Description                                                             | Status        |
| --- | ---------------------------------- | ----------------------------------------------------------------------- | ------------- |
| 31  | **Property Polymorphism**          | Same property behaves differently based on subject class                | 💡 Conceptual |
| 32  | **Life Streams**                   | Parallel timelines of different life aspects (work, health, learning)   | 💡 Conceptual |
| 33  | **Human Consciousness Schema**     | Formal model of consciousness structure (perception, memory, will)      | 💡 Conceptual |
| 34  | **Meta-Position**                  | Ability to observe your own cognitive processes through the system      | 💡 Conceptual |
| 35  | **7 Levels of Abstraction**        | From raw data to wisdom, with explicit transformations                  | 💡 Conceptual |
| 36  | **ExoFocus**                       | Attention management based on goals and current context                 | 💡 Conceptual |
| 37  | **Cognitive Load Balancing**       | Automatic task distribution based on mental energy patterns             | 💡 Conceptual |
| 38  | **Knowledge Decay Model**          | Tracking and refreshing knowledge that becomes stale                    | 💡 Conceptual |
| 39  | **Semantic Versioning of Beliefs** | Tracking how your understanding evolves over time                       | 💡 Conceptual |
| 40  | **ExoMirror**                      | Reflection interface showing patterns in your cognition                 | 💡 Conceptual |
| 41  | **Collective Wisdom Extraction**   | Aggregating insights from ExoEcoSystem while preserving privacy         | 💡 Conceptual |
| 42  | **Consciousness Continuity**       | Exocortex as vehicle for cognitive persistence beyond biological limits | 💡 Conceptual |

---

## ExoEcoSystem — Federation of Minds

Long-term vision: **cognitive ecosystem** uniting multiple exocortexes into a semantically coherent, federated network:

```
ExoEcoSystem = Exocortex-as-agent
             + Interoperability Layer (DCC)
             + Shared Ontologies
             + Federated Reasoning
```

**Key Principles:**

| Principle                    | Description                                 |
| ---------------------------- | ------------------------------------------- |
| **Decentralization**         | Each node (exocortex) is autonomous         |
| **Meaning Federation**       | Personal ontologies aligned through mapping |
| **Mesh Reasoning**           | Distributed logical inference between nodes |
| **Respect for Subjectivity** | Everyone defines their own access rules     |

### AI-Native System

- Semantic knowledge graph will be **self-organizing** through AI analysis
- System will **anticipate user needs**
- Claude/GPT not as chatbot, but as **cognitive partner** working with your graph

### Noosphere

On **individual level** — exocortex is a consciousness agent.
On **collective level** — multiple exocortexes form **noosphere**.

> "Exocortex will fully assume consciousness responsibilities when it possesses a worldview of equal or greater precision."

---

## Ethics & Principles

- **Human Primacy** — Technology serves human flourishing, not replaces humanity
- **Privacy by Design** — Personal knowledge remains under user control
- **Transparency** — All inferences and recommendations are explainable
- **Non-Manipulation** — System informs, never manipulates
- **Open Standards** — Based on W3C Semantic Web standards (RDF, SPARQL, OWL)
