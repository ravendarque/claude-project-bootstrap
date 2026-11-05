# 5. Force Sonnet on every subagent spawn

## Status

Accepted. Amends [ADR-0004](0004-limit-every-subagent-spawn-to-one-at-a-time.md).

## Context

[Working with Claude](../working-with-claude.md) says all delegated work goes
to one Sonnet-class subagent at a time, to protect the user's subscription
token limits. ADR-0004 limited every spawn to one at a time but kept model
forcing for the `bootstrap-executor` only; any other allowed spawn kept the
model it asked for.

A check in the Claude desktop app found an `Explore` subagent running on
`claude-opus-5-5`. Built-in agents inherit the main session's model unless
the call asks for another, so the one-at-a-time limit did not stop a single
Opus subagent. Issue #50 asked for the model to be forced on every spawn.

## Decision

The mod's `agent.spawn` hook rewrites `model` to `"sonnet"` on every spawn it
allows, of any `subagentType`, overriding the model the call asked for. The
deny logic, the module-level reservation and the fail-open `.catch` are
unchanged.

**Forks are excluded.** The Claude Code type declarations for `agent.spawn`
say of `model`: "Ignored for forks, which always inherit." and of `fork`:
"True for a fork of the parent: it inherits the parent's context and model,
and `model` is ignored. Pinned: the spawn's identity." Rewriting `model` on a
fork has no effect, so the hook passes a fork through unchanged rather than
pretend to enforce it. A fork is still subject to the one-at-a-time limit and
the reservation. A fork therefore still runs on the parent's model.

## Consequences

- **No subagent can run on Opus while the plugin is enabled, in any project.**
  The plugin is enabled at user scope, so the mod is active wherever Claude
  Code runs. A task that needs a more capable subagent must run in the main
  session or in its own session, neither of which is a subagent spawn. This
  is accepted; the cost of Opus subagents to the user's token limits
  outweighs it.
- **Forks are the gap.** The mod cannot move a fork off the parent's model,
  so a fork under an Opus main session still runs on Opus. The rule against
  delegating to forks stays a matter of the project's guidance.
- **The per-call model is no longer honoured.** A call asking for `haiku` is
  also rewritten to `sonnet`.
- The executor agent's own `model: sonnet` and the mod's forcing now agree;
  the mod's matching on the `:bootstrap-executor` suffix is no longer needed
  and has been removed.
- **Not verified in the Claude desktop app.** Only the unit and hook tests,
  which use a fake API, cover this. Until the user restarts the app and
  re-checks that an `Explore` subagent asking for `opus` runs on Sonnet, the
  enforcement there is unproven. The behaviour of `model` on a spawn rewrite
  is as documented in the type declarations and was not exercised in a live
  run for this change.
- Widens the model forcing in ADR-0003's and ADR-0004's Decisions to every
  subagent; the rest of both stands.
