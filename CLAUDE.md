# Working in claude-project-bootstrap

Claude skill for bootstrapping new projects using Ravendarque defined patterns and practices

This file is an index. Each line is a rule; the linked doc has the detail.
Read a doc when the work touches it, not up front.

## Process

- Every change starts as a GitHub issue, then a branch, then a PR. Never commit to `main`: [workflow](docs/workflow.md).
- Branches are named by what the change does for users: `feature/`, `fix/`, `ci/`, `spike/`, `docs/`: [workflow](docs/workflow.md#branches).
- Open every PR as a draft with its `release:` label set at creation, then mark it ready: [versioning](docs/versioning.md).
- Work through the definition of done before marking a PR ready: [definition of done](docs/definition-of-done.md).
- Never force-push without asking first, every time. Update a pushed branch by merging `main`, not rebasing: [workflow](docs/workflow.md#git).
- Pace GitHub API mutations and never retry into a rate limit: [workflow](docs/workflow.md#github-api).
- Propose before building when there's an open design question; concrete fixes with clear direction go straight ahead: [workflow](docs/workflow.md#ways-of-working).
- Change only what was asked. Flag wider improvements and wait for an answer.

## Standards

- Code is reviewed against [coding standards](docs/coding-standards.md); hold it to the [engineering standards](.claude/skills/engineering-standards/SKILL.md).
- No comments by default; one line for a "why" the code can't express: [comments](docs/coding-standards.md#comments-and-docs).
- Privacy and data rules: [privacy](docs/privacy.md), [record of processing](docs/data-protection.md).
- Keep the [threat model](docs/threat-model.md) current whenever a trust boundary moves.
- Screen new dependencies and vendors: [ADR-0002](docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md).
- Significant decisions get an [ADR](docs/adr/README.md).
- Verify before claiming anything works; report failures and unverified steps plainly.

## Working with Claude

- An Opus-class main session plans, decides and verifies; at most one Sonnet-class subagent does the scripted work, and open-ended work gets its own session: [working with Claude](docs/working-with-claude.md).
- Memory is one fact per file with `MEMORY.md` as the index: [working with Claude](docs/working-with-claude.md#memory).

## This repository

- It's a Claude Code plugin. The bootstrap skill is `skills/bootstrap/`, and each module is a folder under `skills/bootstrap/modules/`: [adding a module](docs/adding-a-module.md).
- Run `npm test` before pushing. It needs no install: the plugin has no dependencies, by design.
- The identifier guard keeps personal and source-project details out (inside a git work tree it scans tracked files only; elsewhere it walks the directory): `IDENTIFIER_DENYLIST_FILE=<your list> node skills/bootstrap/scripts/check-identifiers.mjs .`. The list itself is never committed.
