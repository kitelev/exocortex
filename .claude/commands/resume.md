# /resume - Session Continuity Command

## Purpose
Restore full working context and continue work from previous session with complete state recovery.

## Functionality
When invoked, this command:
1. Loads critical project state from memory bank
2. Restores todo list and progress tracking
3. Reloads active bug fixes and patches
4. Re-establishes agent configurations
5. Continues work exactly where left off

## Usage
```
/resume
```

## Implementation

### Phase 1: Context Loading
```typescript
interface SessionState {
  projectRoot: string;
  activeIssues: BugReport[];
  todoList: TodoItem[];
  agentStates: Map<string, AgentState>;
  turboConfig: TurboModeConfig;
  lastActivity: {
    timestamp: Date;
    action: string;
    files: string[];
  };
}
```

### Phase 2: State Recovery Steps
1. **Load Memory Bank**
   - Read CLAUDE-SESSION-STATE.md
   - Parse active bugs and fixes
   - Restore todo progress

2. **Reload Project Context**
   - Scan for recent changes
   - Check git status
   - Verify test results

3. **Restore Agent Configuration**
   - Reload turbo mode settings
   - Re-initialize parallel agents
   - Restore performance metrics

4. **Continue Work**
   - Resume from last todo item
   - Apply pending fixes
   - Run validation checks

## Memory Bank Integration

Similar to `/anthropic:update-memory-bank`, the resume command uses persistent state storage:

```bash
# Save session state
cat > .claude/CLAUDE-SESSION-STATE.md << EOF
# Session State - $(date)

## Active Issues
$(cat .turbo-cache/bugs-found.json)

## Todo Progress
$(cat .turbo-cache/todo-state.json)

## Configuration
TURBO_MODE: enabled
PARALLEL_AGENTS: 4
LAST_TASK: "find potential bugs"

## Files Modified
$(git status --short)
EOF
```

## Auto-Resume Triggers
- On new session start
- After context switch
- Following system interruption
- When requested explicitly

## State Persistence Format

```yaml
session:
  id: "uuid-v4"
  started: "2024-08-23T00:00:00Z"
  project: "exocortex"
  
bugs:
  critical:
    - memory_leaks: ["CreateAssetModal.ts:200-207", "GraphVisualizationProcessor.ts:742-744"]
    - race_conditions: ["SPARQLEngine:cache", "AgentOrchestrator:state"]
    - circular_deps: ["meta-agent->factory->meta-agent"]
  
  medium:
    - null_safety: ["NativeQueryEngine.ts:22-25,331,662"]
    - performance: ["IndexedGraph:O(n log n)", "repositories:O(n)"]
    - security: ["XSS:NativeQueryEngine", "PathInjection:FileOperationUtils"]
    
progress:
  completed: ["analysis", "bug_identification"]
  in_progress: ["fix_implementation"]
  pending: ["testing", "validation", "release"]
  
config:
  makefile: "turbo mode configured"
  agents: "parallel execution ready"
  monitoring: "fswatch enabled"
```

## Related Commands
- `/execute` - Run new tasks
- `/status` - Check current state
- `/anthropic:update-memory-bank` - Update persistent memory
- `/enterprise` - Enterprise execution mode

## Error Recovery
If resume fails:
1. Check .claude/CLAUDE-SESSION-STATE.md exists
2. Verify git repository state
3. Run `make diag` for system check
4. Fallback to manual context reload