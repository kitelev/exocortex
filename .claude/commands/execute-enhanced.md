---
description: Execute task with BABOK requirements interview, PMBOK planning, and complete delivery pipeline
allowed-tools: Task, TodoWrite, Read, Write, Edit, MultiEdit, Grep, Glob, LS, Bash, WebSearch, WebFetch
argument-hint: [task description]
---

# EXECUTE-ENHANCED-REQUIREMENTS-DRIVEN-PIPELINE

## Task: $ARGUMENTS

## Execution Mode: REQUIREMENTS-FIRST-DELIVERY

### PHASE 0: REQUIREMENTS ELICITATION (BABOK v3 COMPLIANT)

#### Stage 0.1: Initial Requirements Understanding

**ALWAYS START WITH BABOK-AGENT for requirements interview:**

```yaml
BABOK_Requirements_Interview:
  agent: babok-agent
  mode: interactive_elicitation
  
  initial_analysis:
    - Parse initial task description
    - Identify stakeholder (user) needs
    - Determine business context
    - Assess current state vs desired state
  
  interview_questions:
    functional_requirements:
      - "What specific functionality do you need?"
      - "What should the system do differently?"
      - "What are the expected inputs and outputs?"
      - "Are there any specific user interactions?"
    
    non_functional_requirements:
      - "What performance expectations do you have?"
      - "Are there any security or compliance needs?"
      - "What quality attributes are important?"
      - "Any specific technology constraints?"
    
    acceptance_criteria:
      - "How will you know when this is complete?"
      - "What are the success criteria?"
      - "What would constitute failure?"
      - "Any specific test scenarios to consider?"
    
    priorities_and_constraints:
      - "What's the priority of this feature?"
      - "Are there any deadlines or time constraints?"
      - "Any dependencies on other features?"
      - "Budget or resource constraints?"
```

#### Stage 0.2: Requirements Documentation

```yaml
Requirements_Documentation:
  babok_deliverables:
    - Business Requirements Document (BRD)
    - Functional Requirements Specification (FRS)
    - Use Case Specifications
    - Requirements Traceability Matrix
    - Acceptance Test Criteria
  
  validation_with_user:
    - Present requirements summary
    - Confirm understanding
    - Get explicit approval to proceed
    - Document any clarifications
```

### PHASE 1: PROJECT PLANNING (PMBOK 7th EDITION)

#### Stage 1.1: Project Charter Development

**DEPLOY PRODUCT-MANAGER after requirements approval:**

```yaml
PMBOK_Project_Planning:
  agent: product-manager
  dependencies: [babok-agent-output]
  
  project_charter:
    - Project objectives from requirements
    - Success criteria mapping
    - Stakeholder registry
    - High-level risks
    - Preliminary scope statement
  
  work_breakdown_structure:
    - Decompose requirements into tasks
    - Identify deliverables
    - Define work packages
    - Estimate effort and duration
  
  risk_management_plan:
    - Risk identification from requirements
    - Risk assessment and prioritization
    - Mitigation strategies
    - Contingency planning
```

#### Stage 1.2: Resource and Schedule Planning

```yaml
Resource_Planning:
  agent_allocation:
    - Map tasks to specialized agents
    - Identify parallel execution opportunities
    - Define agent dependencies
    - Allocate resources per agent
  
  schedule_development:
    - Critical path identification
    - Milestone definition
    - Buffer allocation
    - Progress tracking plan
```

### PHASE 2: ENGINEERING DESIGN (SWEBOK v4)

#### Stage 2.1: Software Design

**DEPLOY SWEBOK-ENGINEER after project planning:**

```yaml
SWEBOK_Engineering:
  agent: swebok-engineer
  dependencies: [product-manager-output, babok-agent-output]
  
  design_activities:
    - Architecture design from requirements
    - Component specification
    - Interface design
    - Data structure design
    - Algorithm selection
  
  design_validation:
    - Design review against requirements
    - Architectural decision records (ADRs)
    - Design pattern selection
    - SOLID principle compliance check
```

#### Stage 2.2: Implementation Planning

```yaml
Implementation_Strategy:
  coding_standards:
    - Clean Architecture alignment
    - SOLID principles application
    - Design pattern usage
    - Code organization structure
  
  quality_assurance_plan:
    - Test strategy from acceptance criteria
    - Code review checkpoints
    - Quality metrics definition
    - Continuous integration setup
```

### PHASE 3: PARALLEL AGENT EXECUTION (ORCHESTRATED)

#### Stage 3.1: Multi-Agent Deployment

**DEPLOY ORCHESTRATOR with selected agents:**

```yaml
Orchestrated_Execution:
  agent: orchestrator
  dependencies: [swebok-engineer-output]
  
  parallel_agents:
    - architect-agent: System design refinement
    - refactoring-specialist: Code quality improvements
    - qa-engineer: Test development
    - performance-agent: Optimization analysis
    - security-agent: Security validation
  
  coordination:
    max_parallel: 5
    conflict_resolution: automatic
    progress_monitoring: real-time
    resource_allocation: dynamic
```

### PHASE 4: QUALITY GATES & VALIDATION

[Continues with existing Stage 2-5 from original execute.md]

### INTERACTIVE WORKFLOW EXAMPLE:

```typescript
// Pseudo-code for enhanced execution flow
async function executeEnhanced(task: string) {
  // Phase 0: Requirements Gathering
  console.log("🎯 Starting BABOK Requirements Interview...");
  const babokAgent = await deployAgent('babok-agent');
  
  const requirements = await babokAgent.conductInterview({
    initialTask: task,
    interviewMode: 'comprehensive',
    questions: [
      "What problem are you trying to solve?",
      "What are the expected outcomes?",
      "Are there any specific constraints?",
      "How will success be measured?"
    ]
  });
  
  // User confirmation point
  console.log("📋 Requirements Summary:");
  console.log(requirements.summary);
  const approved = await getUserConfirmation("Do these requirements look correct?");
  
  if (!approved) {
    return babokAgent.refineRequirements();
  }
  
  // Phase 1: Project Planning
  console.log("📊 Starting PMBOK Project Planning...");
  const productManagerAgent = await deployAgent('product-manager');
  
  const projectPlan = await productManagerAgent.createProjectPlan({
    requirements: requirements,
    includeWBS: true,
    riskAnalysis: true,
    resourcePlanning: true
  });
  
  // Phase 2: Engineering Design
  console.log("🔧 Starting SWEBOK Engineering Design...");
  const swebokAgent = await deployAgent('swebok-engineer');
  
  const engineeringDesign = await swebokAgent.designSolution({
    requirements: requirements,
    projectPlan: projectPlan,
    architectureLevel: 'detailed',
    includeADRs: true
  });
  
  // Phase 3: Parallel Execution
  console.log("🚀 Deploying Implementation Agents...");
  const orchestrator = await deployAgent('orchestrator');
  
  await orchestrator.executeParallel({
    design: engineeringDesign,
    agents: selectAgentsFromDesign(engineeringDesign),
    monitoring: 'real-time',
    conflictResolution: 'automatic'
  });
  
  // Continue with existing quality gates and release process...
}
```

### CONSOLE INTERACTION EXAMPLE:

```
$ /execute-enhanced Add a new feature for tracking user metrics

🎯 Starting BABOK Requirements Interview...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Hello! I'm the BABOK agent. Let me help you define clear requirements.

Q1: What specific metrics do you want to track?
> [User types: page views, time spent, feature usage]

Q2: How should these metrics be stored?
> [User types: in a local database, exportable to CSV]

Q3: What visualizations do you need?
> [User types: charts and graphs, daily/weekly/monthly views]

Q4: Are there any privacy considerations?
> [User types: yes, all data must be anonymous and local-only]

Q5: What are your success criteria?
> [User types: accurate tracking, <100ms performance impact, easy export]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Requirements Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FUNCTIONAL REQUIREMENTS:
• Track page views, time spent, and feature usage
• Store metrics in local database
• Export functionality to CSV format
• Visualization with charts (daily/weekly/monthly)

NON-FUNCTIONAL REQUIREMENTS:
• Performance impact < 100ms
• Privacy-first: anonymous, local-only data
• No external data transmission

ACCEPTANCE CRITERIA:
✓ Metrics tracking accuracy ≥ 99%
✓ Export generates valid CSV files
✓ Charts render within 2 seconds
✓ Zero privacy violations

Do these requirements look correct? (y/n): y

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Starting PMBOK Project Planning...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT CHARTER:
Project: User Metrics Tracking Feature
Objective: Implement privacy-first metrics tracking system
Timeline: 3 sprint cycles
Risk Level: Medium (privacy concerns)

WORK BREAKDOWN STRUCTURE:
1. Database Schema Design (2 days)
2. Metrics Collection Service (3 days)
3. Export Functionality (1 day)
4. Visualization Components (3 days)
5. Testing & Validation (2 days)

RESOURCE ALLOCATION:
• architect-agent: Database design
• swebok-engineer: Service implementation
• technical-writer-agent: Documentation
• qa-engineer: Testing strategy
• security-agent: Privacy validation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 Starting SWEBOK Engineering Design...
[Continues with implementation...]
```

### BENEFITS OF ENHANCED APPROACH:

1. **Requirements Clarity**: No ambiguity about what needs to be built
2. **User Alignment**: Explicit confirmation before implementation
3. **Structured Planning**: PMBOK ensures nothing is missed
4. **Engineering Excellence**: SWEBOK guarantees best practices
5. **Traceability**: Requirements → Design → Implementation → Testing
6. **Risk Mitigation**: Issues identified early in planning phase
7. **Quality Assurance**: Built into every phase, not bolted on

### FALLBACK TO STANDARD EXECUTION:

If user wants to skip requirements gathering:
```
$ /execute --skip-requirements [task]
```

This will use the original execute.md flow for quick tasks.

### CONFIGURATION OPTIONS:

```yaml
execution_modes:
  comprehensive:  # Full BABOK → PMBOK → SWEBOK → Implementation
    for: [features, major-changes, complex-bugs]
  
  standard:  # Original execute.md flow
    for: [quick-fixes, minor-updates, documentation]
  
  emergency:  # Skip planning, direct to implementation
    for: [critical-bugs, hotfixes]
    requires: explicit-flag
```

Execute the requirements-driven delivery pipeline for professional software development.