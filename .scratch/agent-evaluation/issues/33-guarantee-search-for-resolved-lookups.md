# 33 · Guarantee record search after identity resolution

**What to build:** Once a lookup has resolved at least one exact provider source ID, the graph must search those records even if the assistant model returns a prose answer without calling the search tool.

**Blocked by:** None.

**Status:** resolved

## Answer

The lookup node now replaces a no-tool model response with a bounded `search_player_records` tool call using the exact identity-resolved source IDs and supported explicit season. It does not override malformed tool calls or repeat a search already executed in the turn. A full graph regression reproduces the Mbappé failure and asserts one search with the selected IDs and requested season.
