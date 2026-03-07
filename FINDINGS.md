# Research Chat: Long-lived Claude Process Findings

## Goal
Replace spawn-per-message with a persistent Claude CLI process per session to eliminate spawn latency on follow-up messages.

## What was tested (inside Docker container, claude 2.1.47)

### `--input-format stream-json` (bidirectional streaming)
- **Accepts** `{"role":"user","content":"..."}` without error (parses the JSON)
- **Rejects** `{"type":"user","content":"..."}` with `Cannot read properties of undefined (reading 'role')`
- **Produces zero stdout output** regardless of whether stdin stays open or closes
- Tested with and without `--dangerously-skip-permissions`, `--include-partial-messages`, `--verbose`
- Conclusion: this mode appears non-functional or requires undocumented message schema

### `--session-id <uuid>` (session persistence)
- Process runs and produces output with regular `-p "prompt"` mode
- Session file is saved under `~/.claude/projects/<project-dir>/` but with a **different UUID** as the filename, not the one passed via `--session-id`
- The `--session-id` value appears in the session file contents but is not used as the lookup key

### `--resume <uuid>` (session resumption)
- Returns `"No conversation found with session ID: <uuid>"` for both:
  - The UUID passed via `--session-id`
  - The auto-generated UUID used as the session filename
- Conclusion: `--resume` does not work with `-p` mode sessions

### What does work
- `claude -p "prompt" --output-format stream-json --verbose` works reliably
- Output format: `{"type":"system",...}` init event, then `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`, then `{"type":"result",...}`
- No `content_block_delta` events are emitted; the full response comes in a single `assistant` event
- Spawning with `env` that has `CLAUDECODE` deleted (not empty string) avoids nested session errors

## Viable approaches for persistent sessions

1. **Anthropic API directly** (`@anthropic-ai/sdk`) - proper streaming, multi-turn via message array replay, but requires separate API billing (not subscription)

2. **Claude Code SDK** (`@anthropic-ai/claude-code`) - if it supports subscription auth, could provide proper agent lifecycle. Needs investigation.

3. **Spawn per message with optimizations**:
   - Keep the current spawn-per-message + replay approach
   - Reduce perceived latency with optimistic UI (show user message immediately, typing indicator)
   - Could trim older messages from history to reduce token replay
   - Could cache/summarize older turns to compress context

## Environment details
- Claude Code version: 2.1.47
- Container: node:22-slim, Docker
- Auth: subscription (not API key), `apiKeySource: "none"` in init event
