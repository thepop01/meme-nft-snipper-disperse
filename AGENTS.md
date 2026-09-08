# Agent Memory Instructions

## Memory System

A persistent memory layer is available via MCP (Hindsight). It remembers durable project knowledge across sessions.

## Before Starting Work

1. Call `hindsight_recall` with the current task/topic to load relevant memories
2. Read the recalled memories to understand project context

## During Work

When you make or discover something durable:
- Architecture decisions → call `hindsight_retain` with type `ARCHITECTURE_DECISION`
- Project decisions → call `hindsight_retain` with type `PROJECT_DECISION`
- Requirements discovered → call `hindsight_retain` with type `PROJECT_REQUIREMENT`
- Problems found → call `hindsight_retain` with type `KNOWN_PROBLEM`
- Lessons learned → call `hindsight_retain` with type `LESSON_LEARNED`
- Patterns observed → call `hindsight_retain` with type `IMPLEMENTATION_PATTERN`

## Before Storing

1. Search existing memories first: `hindsight_recall` with relevant query
2. If similar memory exists, update it instead of creating duplicate
3. If new memory contradicts existing, note the supersession

## What to Remember

- Architecture decisions and their reasons
- Project requirements and constraints
- User preferences
- Discovered problems and solutions
- Implementation patterns and conventions
- Lessons from failures
- Decisions that changed (with reason)

## What NOT to Remember

- Routine commands (npm install, git push, etc.)
- Temporary thoughts
- Error messages / debug output
- Information obvious from reading the source code
- Secrets, passwords, API keys, tokens

## Contradictions (bitemporal: close + link, never overwrite)

When you detect a new memory contradicts an old one:
1. Mark old as superseded with `valid_until:<today>`
2. Store new with `valid_from:<today>` and `supersedes:<old-id>`
3. Store a `TEMPORAL_CHANGE` with old value, new value, reason, and both dates

## Source of Truth

- **Code:** Source of truth for implementation
- **Config:** Source of truth for configured behavior
- **Memory:** Source of truth for why/history/constraints
- **Memory never overrides code without verification**

## Graceful Degradation

If memory is unavailable (Hindsight down), continue working without it. Memory is enhancement, not a requirement.

## Session Lifecycle

### Session Start
When a new session begins:
1. Hindsight plugin auto-recalls relevant memories
2. You see relevant memories in your context
3. Use these to understand project state before working

### During Session
When you encounter durable knowledge:
1. Check if similar memory exists: `hindsight_recall`
2. If new: `hindsight_retain` with appropriate type and tags
3. If contradiction: supersede old, store new, store TEMPORAL_CHANGE

### Session End
When session becomes idle:
1. Hindsight auto-retains durable knowledge from the session
2. Extraction pipeline runs (classify → dedup → contradiction → persist)
3. Obsidian export triggered async
