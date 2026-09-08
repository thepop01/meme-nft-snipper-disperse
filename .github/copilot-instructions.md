# Project memory (Hindsight MCP server "hindsight")

A persistent memory layer is available as MCP tools: `recall` (search),
`retain` (store), `reflect` (synthesize). The project bank is `bot`.

- BEFORE starting work: `recall` with the current task/topic.
- DURING work, `retain` durable items with tags:
  `type:<ARCHITECTURE_DECISION|PROJECT_DECISION|PROJECT_REQUIREMENT|USER_PREFERENCE|KNOWN_PROBLEM|LESSON_LEARNED|IMPLEMENTATION_PATTERN|TEMPORAL_CHANGE|SESSION_SUMMARY>`,
  `project:bot`, `importance:<LOW|MEDIUM|HIGH|CRITICAL>`, `scope:<PROJECT|USER|SESSION>`.
- BEFORE storing: `recall` first; update/supersede instead of duplicating.
  Contradictions: mark old `valid_until:<today>`, new `valid_from:<today>` + `supersedes:<old-id>`, add a `TEMPORAL_CHANGE`.
- NEVER store: routine commands, tentative thoughts, debug output, secrets/keys/tokens.
- Code is source of truth for implementation; memory is source of truth for why/history.
