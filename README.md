# claude-project-bootstrap

A Claude Code plugin that turns an empty directory into a fully set-up
project: GitHub repository, branch protection, project board, CI,
tag-based releases, coding standards, privacy and security docs, and Claude
configuration. You pick the building blocks; Claude does the setup and walks
you through the few steps only you can do.

## Install

```
/plugin marketplace add ravendarque/claude-project-bootstrap
/plugin install claude-project-bootstrap@claude-project-bootstrap
```

Each GitHub Release also carries the plugin as a zip.

## Use

Open a new Claude Code session in an empty directory and ask Claude to
bootstrap a project. It will:

1. check your tools (`git`, `gh` with the `project` scope, commit signing,
   and whatever the chosen modules need);
2. ask for the project's name, description, owner, visibility and modules;
3. show you everything it will create, and what's public, before doing
   anything;
4. render the project, create the repository, push the initial commit, and
   configure protections, labels and the board;
5. walk you through each manual step (tokens, secrets) and check each one;
6. ship the first change through the project's own PR process, which cuts
   `v0.1.0`.

A run can stop and resume: progress is kept in `.bootstrap/state.json`.

## Modules

| Module | What it adds |
|---|---|
| `core` (always) | Workflow, versioning and release labels, tag-based releases, coding standards, definition of done, privacy, record of processing, threat model, ADRs, incident runbooks, security policy, licence, Claude configuration, GitHub rulesets, board and security workflows |
| `js-toolchain` | Any JavaScript project: pnpm with supply-chain controls, Biome, `tsc` over JSDoc, Vitest |
| `web-app` | A browser app: Vite, and WebdriverIO end-to-end tests in Chromium and Firefox with axe-core accessibility checks |
| `cloudflare-opentofu` | A Cloudflare Worker deployed from release tags, optional beta environment with promotion, PR previews, and the zone's DNS, TLS, headers and cache rules in OpenTofu |

To add a stack, see [adding a module](docs/adding-a-module.md).

## Develop

`npm test` runs the test suite (Node's built-in runner; no dependencies).

## Licence

[Ravendarque Noncommercial Licence](LICENSE.md).
