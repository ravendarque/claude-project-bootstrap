# 3. Enforce model routing with an executor agent and a plugin mod

## Status

Accepted

## Context

The rule in [working with Claude](../working-with-claude.md) is that an
Opus-class main session plans, decides and verifies, and at most one
Sonnet-class worker does the mechanical work. In a dry run of the bootstrap
skill the rule was ignored: the main session did the mechanical phases
itself. The skill asked the user to switch the session to Sonnet instead,
which spends the wrong model on the judgement work and relies on the model
reading and obeying prose. Issue #14 asked for enforcement.

Options considered:

1. **A skill check only.** Instruct the main session to delegate. This is
   what failed: nothing stops the model ignoring it.
2. **A hook only.** A mod can force a model and refuse a spawn, but without
   an agent to spawn there is nothing defined to route to, and nothing
   tells the main session what to hand over.
3. **Both.** A defined executor agent and skill text that routes to it, plus
   a mod that enforces the model and the one-at-a-time limit.

## Decision

Option 3. The plugin ships:

- `agents/bootstrap-executor.md`, a `model: sonnet` agent that does the
  mechanical phases, never takes a public, paid or irreversible step
  without the main session stating the user's yes, and reports real
  command output;
- a mod (`hooks/hooks.json` and `hooks/register.js`) whose `agent.spawn`
  hook acts only on a `subagentType` ending in `:bootstrap-executor`. It
  forces the model to Sonnet, overriding the per-call model, and denies the
  spawn while another executor is `pending`, `running`, `waiting` or `idle`.
  Only `completed`, `failed` and `killed` free the slot. Every other agent
  type passes through untouched, and a `.catch` passes the event through
  unchanged if the hook fails;
- the decision logic as a pure function in `hooks/routing.js`, unit-tested
  with node's test runner;
- a routing section in the skill that replaces the "switch to Sonnet"
  suggestion.

## Consequences

- The model and the single-executor limit hold whatever the main session
  writes in its call. The skill text still decides what is delegated; the
  mod cannot tell whether the main session did mechanical work itself.
- A spike on Claude Code 2.1.312, run headless with `--plugin-dir`, showed:
  the hook sees `subagentType` as `project-bootstrap:bootstrap-executor`;
  returning `{ model }` overrides the model the call asked for (an Opus
  main session and an `opus` per-call model both ran the executor on
  Sonnet); a second parallel executor was denied with the hook's message;
  an Explore agent passed through untouched; and `$.agent.list()` reports
  `type` and `status`. Matching is on `subagentType`, not on the plugin's
  origin, which differs for an installed plugin.
- **Notice not built.** A `turn.complete` note ("the main session ran a
  mechanical phase itself") was dropped. `tool.call` carries no agent id,
  so the mod cannot tell the main session's commands from the executor's,
  and a returned `{ text }` did not appear in headless `-p` output, so
  whether it renders anywhere is unproven.
- **Not verified in the Claude desktop app.** The spike ran headless only,
  and a headless run turns approval prompts into denials. Whether the
  desktop app loads the mod and enforces it the same way must be checked by
  hand (steps in the pull request) before this is relied on.
- The mod can only be shipped by a plugin, so a generated project gets the
  guidance and an executor agent definition but not the enforcement.
- The mods API is versioned with Claude Code and can change between
  releases; revisit this if the `agent.spawn` hook changes.
