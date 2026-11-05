# 4. Limit every subagent spawn to one at a time

## Status

Accepted. Amends [ADR-0003](0003-enforce-model-routing-with-executor-agent-and-mod.md).

## Context

[Working with Claude](../working-with-claude.md) says all delegated work goes
to at most one Sonnet-class subagent at a time, with no parallel workers.
Extra or parallel subagents use up the user's subscription token limits.
ADR-0003 enforced that only for the `bootstrap-executor`; any other agent
type passed through untouched, so the main session could still fan out
`general-purpose` or `Explore` agents.

## Decision

The mod's `agent.spawn` hook refuses a spawn of any `subagentType` while any
subagent is `pending`, `running`, `waiting` or `idle`. Only `completed`,
`failed` and `killed` free the slot. The module-level reservation, set
synchronously before any `await` and released in `finally`, now covers every
spawn, so of several parallel spawns in one message, of any types, exactly one
goes ahead.

Model forcing is unchanged: only the executor is forced onto Sonnet. Another
spawn that is allowed keeps the model it asked for. The deny message names the
rule and its reason (one subagent at a time, to protect token limits) and tells
Claude to wait for the running subagent or send it follow-ups instead. The
`.catch` still fails open.

Relied on in the Claude Code 2.1.312 type declarations: `$.agent.list()`
returns `AgentInfo[]` whose `type` is `agent.spawn`'s `subagentType` and
whose `status` is an `AgentStatus`
(`'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'`).

## Consequences

- **The limit applies in every project.** The plugin is enabled at user
  scope, so the mod is active wherever Claude Code runs. Tools that fan out
  subagents on purpose, such as a security-scan plugin's parallel workflow,
  are refused after the first spawn. The deny message says the limit is
  global so the cause is clear. This is accepted; the cost of parallel
  workers to the user's token limits outweighs it.
- **Sessions are not covered.** Starting a session is not a subagent spawn,
  so the hook never sees it. Open-ended work given its own session is
  unaffected by this limit.
- **Other loops can occupy the slot.** `$.agent.list()` also includes loops
  the engine tracks as agents without an `agent.spawn` (a forked skill). One
  of those that is still active blocks a spawn until it finishes.
- **Not verified in the Claude desktop app.** The unit and hook tests cover
  the logic with a fake API only. Until the user restarts the app and re-checks
  (two subagents of different types in one message, one refused), the
  enforcement there is unproven. The reservation still relies on the module
  instance persisting across hook calls, as noted in ADR-0003.
- Widens the single-executor limit in ADR-0003's Decision to every subagent; the rest of
  ADR-0003 stands.
