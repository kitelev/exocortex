---
description: Execute task with complete delivery pipeline from code to production
allowed-tools: Task, TodoWrite, Read, Write, Edit, MultiEdit, Grep, Glob, LS, Bash, WebSearch, WebFetch
argument-hint: [task description]
---

# EXECUTE-COMPLETE-DELIVERY-PIPELINE

## Task: $ARGUMENTS

## Execution Mode: FULL-PIPELINE-DELIVERY

### CRITICAL: This command does NOT stop until ALL delivery stages are complete:

#### Stage 0: Requirements Elicitation & Planning (MANDATORY FIRST STEP)

##### 0.1: BABOK Requirements Interview (FOR PLUGIN ENHANCEMENTS)

**For plugin development tasks, ALWAYS start with BABOK agent:**

1. **Deploy babok-agent FIRST** for requirements clarification
2. **Conduct structured interview** to understand:
   - Functional requirements (what it should do)
   - Non-functional requirements (performance, quality)
   - Acceptance criteria (definition of done)
   - Priorities and constraints
3. **Document requirements** and get user confirmation
4. **Create Requirements Traceability Matrix** for validation

##### 0.2: PMBOK Project Planning

**After requirements approval, deploy product-manager:**

1. **Create project charter** from requirements
2. **Develop Work Breakdown Structure (WBS)**
3. **Identify risks** and mitigation strategies
4. **Plan resource allocation** and agent selection

##### 0.3: SWEBOK Engineering Design

**With approved plan, deploy swebok-engineer:**

1. **Design technical solution** aligned with requirements
2. **Create architectural decisions** (ADRs)
3. **Define implementation approach** with patterns
4. **Establish quality criteria** and metrics

##### 0.4: Meta-Agent Orchestration

1. **Meta-agent receives** requirements, plan, and design
2. **Analyzes and selects** optimal agent configuration
3. **If no suitable agent exists**, delegates to agent-factory
4. **Monitors execution** with requirements traceability
5. **Post-execution validation** against acceptance criteria

#### Stage 1: Task Analysis & Agent Deployment

1. **Meta-agent determines complexity** and domain requirements
2. **Meta-agent deploys 3-5 specialized agents** selected or created dynamically
3. **Execute implementation** with continuous quality monitoring by meta-agent
4. **Validate implementation** meets all requirements
5. **Meta-agent collects feedback** for continuous improvement

#### Stage 2: Quality Gate Validation (WITH RETRY LOGIC)

1. **Run comprehensive tests** - RETRY up to 3 times if failures
2. **Verify test coverage >70%** - FIX coverage gaps if below threshold
3. **Build verification** - RETRY build if compilation errors
4. **Code quality checks** - ADDRESS all quality issues before proceeding

#### Stage 3: Local Release Preparation (MANDATORY FOR ALL CODE CHANGES)

1. **Version bump** in package.json (patch/minor/major based on changes)
2. **Update CHANGELOG.md** with user-focused release notes
3. **Validate manifest.json** version sync
4. **Stage all changes** and commit with conventional commit message
5. **VERIFY**: Local git state is clean and ready for push
6. **CRITICAL**: Any code modification REQUIRES immediate release preparation

#### Stage 4: GitHub Release & CI/CD Pipeline (MONITORED - SINGLE DEVOPS AGENT)

1. **Push to main branch** triggering auto-release workflow
2. **Deploy SINGLE devops-engineer agent** to monitor GitHub Actions:
   - auto-release.yml (REQUIRED: SUCCESS)
   - ci.yml (REQUIRED: SUCCESS)
   - quality-gate.yml (REQUIRED: SUCCESS)
   - all-tests.yml (REQUIRED: SUCCESS)
   - bdd-coverage.yml (REQUIRED: SUCCESS if exists)
3. **MANDATORY GITHUB ACTIONS VALIDATION**:
   - **CHECK ALL WORKFLOWS**: `gh run list --limit 10 --json status,conclusion,name`
   - **WAIT FOR COMPLETION**: Monitor until all workflows finish
   - **VERIFY ALL GREEN**: Every workflow must show "success" conclusion
   - **IF ANY WORKFLOW FAILS**:
     a. Analyze failure logs: `gh run view [run-id] --log-failed`
     b. Fix identified issues immediately
     c. Push fixes and monitor new workflow runs
     d. REPEAT until ALL workflows are green
   - **NEVER PROCEED** with any workflow showing "failure" or "cancelled"
4. **Verify GitHub Release** created with correct assets
5. **RETRY FAILED WORKFLOWS** up to 3 times with fixes:
   - First retry: Fix obvious issues (imports, syntax, test timeouts)
   - Second retry: Address deeper issues (logic errors, missing dependencies)
   - Third retry: Emergency fixes (stub implementations, skip problematic tests)
6. **IMPORTANT**: Only ONE devops-engineer agent at a time for CI/CD monitoring
7. **CRITICAL**: Task is NOT complete until ALL GitHub Actions show green checkmarks

#### Stage 5: Production Validation (COMPLETION GATE)

1. **Confirm GitHub Release** is published and accessible
2. **Validate release assets** (main.js, manifest.json, .zip package)
3. **Check workflow status** - ALL must be green ✅
4. **Generate delivery report** with complete audit trail

### RETRY & RECOVERY LOGIC:

```bash
# Test Retry Pattern (Max 3 attempts) with elevated priority
for attempt in 1 2 3; do
  # Run with highest priority and 1GB memory allocation
  if nice -n -20 ionice -c 1 npm test; then break; fi
  echo "Test attempt $attempt failed, analyzing and fixing..."
  # Apply common fixes: memory limits, test isolation, mock updates
done

# Build Retry Pattern (Max 2 attempts) with resource guarantees
for attempt in 1 2; do
  # Build with real-time priority and dedicated resources
  if nice -n -20 ionice -c 1 npm run build; then break; fi
  echo "Build attempt $attempt failed, checking dependencies..."
  # Clear cache, reinstall if needed
done

# CI/CD Monitoring Pattern (Max 30 minutes) with priority boost
timeout=1800  # 30 minutes
# Set highest scheduling priority for monitoring process
renice -n -20 -p $$
while [ $timeout -gt 0 ]; do
  status=$(gh run list --limit 1 --json status --jq '.[0].status')
  if [ "$status" = "completed" ]; then break; fi
  sleep 30; timeout=$((timeout-30))
done
```

### PARALLEL EXECUTION CONFIGURATION:

```yaml
Thread_Pool_Architecture:
  max_parallel_agents: 5
  thread_allocation:
    domain_parallel: 3 # Multi-domain requirements
    pipeline_parallel: 2 # Sequential stages with parallel substeps
    investigation_parallel: 4 # Analysis tasks

  resource_management:
    memory_per_agent: "1GB" # Enhanced memory allocation for complex operations
    cpu_allocation: "20% per agent"
    process_priority: "HIGHEST" # System-level highest priority
    nice_value: -20 # Unix/Linux highest priority (-20 to 19)
    ionice_class: "RT" # Real-time I/O scheduling class
    scheduler_policy: "SCHED_FIFO" # First-in-first-out real-time scheduling
    file_lock_coordination: "active"

  conflict_detection:
    file_access_monitor: "enabled"
    dependency_graph: "real-time"
    resource_contention: "auto-resolve"

Real_Time_Monitoring:
  status_refresh_interval: "2s"
  progress_granularity: "10%"
  performance_tracking: "agent_level"
  bottleneck_detection: "automatic"

System_Priority_Configuration:
  process_priority_level: "REALTIME" # Highest available system priority
  thread_priority_boost: "ENABLED" # Windows thread priority boost
  cpu_affinity: "DEDICATED_CORES" # Dedicate CPU cores to agent threads
  memory_locking: "ENABLED" # Prevent memory swapping to disk
  resource_limits:
    memory_per_agent: "1024MB" # 1GB guaranteed RAM allocation
    memory_max_per_agent: "2048MB" # 2GB maximum with swap prevention
    virtual_memory: "4096MB" # 4GB virtual memory space
    stack_size: "32MB" # Increased stack for deep recursion
    heap_size: "768MB" # Dedicated heap allocation
  scheduling_guarantees:
    preemption_disabled: false # Allow preemption for system stability
    time_slice: "100ms" # Guaranteed CPU time slice
    quantum_boost: "2x" # Double the standard time quantum
```

### CONSOLE STATUS DISPLAY:

```bash
# Live Progress Tracking Format
┌─────────────────────────────────────────────────────────┐
│ EXECUTE Pipeline Status - Real-Time Monitoring         │
├─────────────────────────────────────────────────────────┤
│ Stage 1: Task Analysis    [██████████] 100% ✅         │
│ Stage 2: Agent Deploy     [████████▒▒] 80%  🔄         │
│   ├─ architect-agent      [██████████] 100% ✅         │
│   ├─ swebok-engineer    [██████▒▒▒▒] 60%  🔄         │
│   ├─ qa-engineer            [▒▒▒▒▒▒▒▒▒▒] 0%   ⏳         │
│   └─ devops-engineer        [▒▒▒▒▒▒▒▒▒▒] 0%   ⏳         │
│ Stage 3: Quality Gate     [▒▒▒▒▒▒▒▒▒▒] 0%   ⏳         │
│ Stage 4: Release Prep     [▒▒▒▒▒▒▒▒▒▒] 0%   ⏳         │
│ Stage 5: CI/CD Pipeline   [▒▒▒▒▒▒▒▒▒▒] 0%   ⏳         │
├─────────────────────────────────────────────────────────┤
│ Performance Metrics:                                    │
│ • Execution Time: 2m 14s                               │
│ • Agents Active: 2/5                                   │
│ • Memory Usage: 2GB/5GB (1GB per agent)               │
│ • Process Priority: REALTIME (highest)                 │
│ • CPU Affinity: Dedicated cores allocated              │
│ • Conflict Detection: 0 conflicts                      │
│ • Auto-Resolves: 3 successful                          │
└─────────────────────────────────────────────────────────┘

# Agent Status Indicators
✅ Complete    🔄 In Progress    ⏳ Pending    ❌ Failed    🔧 Retrying
```

### PARALLEL EXECUTION RULES:

```yaml
Parallel_vs_Sequential_Decision_Matrix:
  parallel_execution_criteria:
    - Independent file modifications
    - Non-overlapping domain expertise
    - No shared resource dependencies
    - Task complexity >3 subtasks
    - Estimated duration >5 minutes

  sequential_execution_criteria:
    - File system conflicts detected
    - Sequential dependencies identified
    - Single-threaded operations required
    - Resource constraints present
    - Risk level: HIGH

Safety_Checks_Before_Parallelization:
  pre_flight_validation:
    - Dependency graph analysis
    - Resource availability check
    - File lock status verification
    - Agent capability assessment

  conflict_prevention:
    - Exclusive file access locks
    - Shared state coordination
    - Race condition detection
    - Rollback mechanisms

  resource_allocation:
    - CPU usage monitoring with dedicated core assignment
    - Memory threshold enforcement (1GB minimum, 2GB maximum per agent)
    - I/O bandwidth management with RT (real-time) priority
    - Network request limiting with QoS guarantees
    - Process priority elevation to REALTIME class
    - Thread scheduling with SCHED_FIFO policy
    - Memory locking to prevent swap-out
    - CPU affinity binding for performance isolation
```

### REQUIREMENTS-DRIVEN ORCHESTRATION PROTOCOL:

```yaml
Requirements_First_Pipeline:
  priority: HIGHEST
  timing: SEQUENTIAL_WITH_GATES
  
  phase_0_requirements:
    babok_agent:
      - Conduct requirements interview
      - Clarify functional/non-functional needs
      - Define acceptance criteria
      - Get user confirmation
    
    product-manager:
      - Create project charter
      - Develop WBS from requirements
      - Risk assessment and planning
      - Resource allocation strategy
    
    swebok-engineer:
      - Technical design from requirements
      - Architecture decision records
      - Implementation patterns selection
      - Quality metrics definition

Meta_Agent_Invocation:
  priority: HIGHEST
  timing: AFTER_REQUIREMENTS_PLANNING

  responsibilities:
    requirements_integration:
      - Receive BABOK/PMBOK/SWEBOK outputs
      - Validate requirements coverage
      - Map requirements to agent capabilities
      - Ensure traceability throughout
    
    task_analysis:
      - Parse validated requirements
      - Identify domain and complexity
      - Determine agent needs from WBS
      - Analyze parallelization potential

    execution_strategy_selection:
      - Evaluate task for parallel execution eligibility
      - Identify independent work streams
      - Calculate optimal thread allocation
      - Assess resource requirements and conflicts

    agent_selection:
      - Query existing agent capabilities
      - Calculate fitness scores (SOLID/GRASP metrics)
      - Select optimal agent configuration
      - Plan parallel vs sequential execution

    agent_creation:
      - If fitness < 0.60, invoke agent-factory
      - Validate new agent specifications
      - Deploy experimental agents with monitoring
      - Configure parallel execution parameters

    parallel_execution_monitoring:
      - Real-time status tracking across all agents
      - Performance metrics collection (throughput, latency)
      - Bottleneck identification and auto-resolution
      - Resource contention monitoring and prevention
      - Inter-agent communication coordination

    conflict_resolution:
      - File access conflict detection
      - Dependency chain validation
      - Resource allocation arbitration
      - Automatic rollback on deadlocks

    continuous_improvement:
      - Analyze task completion metrics
      - Extract success patterns from parallel execution
      - Update agent instructions and coordination rules
      - Document learnings in CLAUDE-knowledge.md
      - Optimize thread pool configuration based on performance

Parallel_Execution_Directives:
  default_mode: "intelligent_parallel"
  fallback_mode: "validated_sequential"

  parallel_coordination:
    - Deploy 3-5 agents simultaneously when conditions are met
    - Monitor real-time progress with 2s refresh intervals
    - Implement automatic conflict detection and resolution
    - Provide live console status updates
    - Collect performance metrics for optimization

  sequential_fallback:
    - Triggered by resource conflicts or high-risk operations
    - Maintains agent coordination but enforces serial execution
    - Preserves all monitoring and quality gate functionality
    - Provides clear reasoning for execution mode selection
```

### AGENT SELECTION MATRIX (DYNAMICALLY DETERMINED BY META-AGENT):

| Task Type          | Meta-Agent Selected Configuration           | Execution Pattern         |
| ------------------ | ------------------------------------------- | ------------------------- |
| **Bug fixes**      | Based on error analysis and system state    | ✅ Adaptive parallel      |
| **Features**       | Based on requirements and architecture      | ✅ Intelligent pipeline   |
| **Refactoring**    | refactoring-specialist for SOLID/Clean Code | ✅ Systematic improvement |
| **Performance**    | Based on bottleneck identification          | ✅ Targeted optimization  |
| **Documentation**  | Based on content type and audience          | ✅ Context-aware          |
| **Infrastructure** | Based on system dependencies                | ✅ Risk-managed           |
| **Release**        | Based on change scope and risk              | ⚠️ Validated sequential   |
| **Novel Tasks**    | Agent-factory creates specialized agent     | 🆕 Dynamic creation       |

### QUALITY GATES (NON-NEGOTIABLE):

```yaml
Code_Quality:
  - TypeScript compilation: CLEAN
  - Test suite: >70% coverage, ALL PASSING
  - ESLint: CLEAN (if configured)
  - Build output: main.js generated successfully

Release_Quality:
  - Version: Properly incremented
  - CHANGELOG.md: Updated with user-focused notes
  - Manifest sync: Version consistency across files
  - Git state: Clean working directory

Production_Quality:
  - GitHub Release: Published with assets
  - CI/CD Pipeline: ALL workflows GREEN
  - Package integrity: All required files present
  - Documentation: Updated and accurate
```

### MONITORING & REPORTING:

#### Real-time Status Updates:

- ⏳ Stage progress with timestamps
- ✅ Completed steps with validation
- ❌ Failed steps with retry attempts
- 🔄 Retry operations with rationale
- 📊 Final delivery metrics

#### Completion Report:

1. **Execution Summary**: Tasks completed, agents used, time elapsed
2. **Quality Metrics**: Test results, coverage, build status
3. **Release Details**: Version, changelog, GitHub release URL
4. **CI/CD Status**: All workflow results with links
5. **Production Validation**: Final system state confirmation

### FAILURE HANDLING:

The command will NOT complete until:

- All tests pass (with retry logic)
- Code builds successfully
- Local release is prepared
- GitHub push succeeds
- CI/CD pipelines complete successfully
- GitHub Release is published

**If any step fails after all retries**: Command reports detailed failure analysis and provides specific remediation steps for manual intervention.

### SUCCESS CRITERIA:

✅ **COMPLETE DELIVERY** achieved when:

1. Code changes implemented and tested
2. Local version incremented and committed
3. GitHub Release published with assets
4. ALL CI/CD workflows showing green status
5. Production system validated and operational

Execute the complete delivery pipeline with maximum reliability and transparency.
