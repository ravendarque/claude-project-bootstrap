# claude-project-bootstrap: design

Date: 2026-10-28. Status: draft for review.

## Intent

A reusable Claude Code skill that stands up a new project with the engineering
approach, repo configuration, release pipeline, standards and Claude working
process proven in an existing production project. The owner opens a fresh
Claude session pointed at an empty local directory, invokes the skill, answers
a short interview, and Claude performs the entire setup, pausing only for the
steps Claude cannot or must not do itself (creating cloud tokens, setting
secrets, anything public, paid or irreversible), with exact instructions for
each.

Why: the approach took months to settle. Rebuilding it by hand per project is
slow and drifts; encoding it once makes every new project start at the same
bar.

## Goals

- One invocation in an empty directory produces a working repo: GitHub repo,
  protections, board, labels, CI, release pipeline, docs, standards and Claude
  config, with the first change going through the project's own PR process.
- Composable **modules** selected at the interview. v1 ships:
  - `core` (always on, stack-agnostic)
  - `js-toolchain` (pnpm, Vite, Biome, tsc-over-JSDoc, Vitest, Playwright + axe)
  - `cloudflare-terraform` (Workers, wrangler, Terraform-managed Cloudflare
    infra, R2 remote state, previews, tag-based deploy)
- New stacks are added later as new module folders without touching existing
  ones.
- Every manual step is given as an exact, copy-pasteable instruction, then
  verified by Claude before continuing, and also written into the generated
  repo's docs so a rebuild or disaster recovery follows the same steps.
- Context-light by construction, both in the skill itself and in what it
  generates.

## Non-goals

- Retrofitting an existing repo (adding a module to a project already set up).
  Possible later; v1 assumes an empty directory.
- Application scaffolding beyond a minimal "hello" that proves the pipeline
  (one route, one test, one e2e spec).
- Supporting non-GitHub hosts or non-Cloudflare clouds in v1.

## Anti-goals (failure even if it technically works)

- Anything identifying the author or their projects in the skill repo: no
  names, handles, hostnames, issue numbers, ADR numbers, product copy or
  history narrative. The generic rule survives; the anecdote does not.
- Personal conversational preferences (tone, banter, ID conventions for
  questions) leaking into generated project files. Those belong to the user's
  global `~/.claude/CLAUDE.md`, never a project.
- Claude creating tokens, entering secrets, making a repo public or spending
  money without an explicit go-ahead.
- A bloated `CLAUDE.md` that costs context on every turn.
- Templates that silently diverge from the rules in the docs they ship with.

## Constraints

- Distributed as a Claude Code plugin from a public GitHub repo
  `claude-project-bootstrap`, installable with `/plugin marketplace add
  <owner>/claude-project-bootstrap`. Each release also attaches a zip of the
  plugin to its GitHub Release as the build artefact.
- Must work in the Claude desktop app and in the plain CLI/web (see model
  routing fallback).
- Respects GitHub's secondary rate limits: mutations paced (≥1s apart), never
  in parallel, no retry into a rate limit.
- Requires the `project` OAuth scope on `gh` for the board.
- All generated copy, docs and commit messages in British English and a
  professional register.

## Shape of the skill repo

```
.claude-plugin/plugin.json, marketplace.json
skills/bootstrap/SKILL.md          short orchestrator: phases, module contract, rules
skills/bootstrap/modules/<name>/
    MODULE.md                      questions, files, GitHub config, required checks,
                                   manual steps + verification, standards fragment
    templates/...                  files copied/rendered into the new project
skills/engineering-standards/SKILL.md   generic version, also copied into projects
LICENSE.md, LICENSE-SCHEDULE.md, README.md, SECURITY.md, CLAUDE.md, docs/
```

`SKILL.md` stays small and only loads a module's `MODULE.md` once that module
is selected. Templates use simple `{{placeholder}}` substitution performed by
Claude; no templating engine dependency.

### Module contract

Each `MODULE.md` declares, in fixed sections:

1. **Depends on** (e.g. `cloudflare-terraform` needs `js-toolchain` in v1).
2. **Interview questions** it adds.
3. **Files** it writes (template → destination, conditionals).
4. **GitHub configuration**: required status checks it contributes to the
   ruleset, secrets/variables/environments it needs.
5. **Manual steps**: exact instructions, and the command Claude runs to verify
   each.
6. **Standards fragment**: its section of `docs/coding-standards.md` and its
   platform persona for the review framework.
7. **Smoke check**: how to prove the module works end to end after setup.

## Bootstrap flow

1. **Preflight.** Confirm the directory is empty; check `git`, `gh` (logged in,
   `project` scope), commit signing configured, plus each selected module's
   tools (`pnpm`, `node`, `terraform`, `wrangler`). Report every gap at once with
   the fix; don't improvise around a missing tool.
2. **Interview.** Project name, one-line description, GitHub owner, visibility,
   licensor notice for the licence, modules, and module questions (for
   `cloudflare-terraform`: zone/domain, and **beta environment yes/no**).
3. **Plan and confirm.** Show everything that will be created, what is public,
   and the manual steps ahead. Nothing external happens before a yes.
4. **Scaffold locally**: render all templates, install dependencies, run lint,
   typecheck and tests so the first commit is green.
5. **Create the GitHub repo and push the initial commit to `main`.** This is
   the only direct push to `main`, before protections exist; it is stated as
   such in the plan.
6. **Configure GitHub**: merge settings, ruleset, security features, labels,
   environments, board and its status field, issue/PR templates.
7. **Manual steps**, one at a time: instruction → user says done → Claude
   verifies → next. Progress is recorded in `.bootstrap/state.json`
   (gitignored) so a session can stop and a new one resume.
8. **First change through the process**: issue → branch → draft PR with
   release label → CI green → ready → merge → `v0.1.0` tag → release
   (and deploy, for `cloudflare-terraform`). This proves the pipeline.
9. **Hand-over summary**: what exists, what was verified, anything skipped.

## Module: core

**Repo and GitHub**
- Squash-only merges, delete branch on merge, auto-merge off.
- Ruleset on the default branch: no deletion, no force-push, PR required
  (0 approvals), signed commits, required status checks = `check-label` plus
  each module's contributed checks.
- Secret scanning, push protection, Dependabot security updates on.
- Projects v2 board: Backlog, Ready, In Progress, In Review, Done; built-in
  workflows for Done on close/merge; a status-sync workflow for In Progress on
  branch create and In Review on PR open (needs a classic PAT with `project`
  scope when the board is user-owned; manual step).
- Labels: `release: major|minor|patch|none`.
- Issue templates, PR template carrying the definition-of-done checklist.

**CI (all modules share)**
- `require-release-label.yml` (skips drafts; runs on ready-for-review),
  `release.yml` (on labelled merge: compute next semver from the latest tag,
  tag the merge commit, create a GitHub Release with generated notes and the
  build artefact, pushing via a GitHub App token so the tag triggers deploys),
  `zizmor.yml`, `scorecard.yml`, `dependency-review.yml`, `dependabot.yml`
  (weekly, 3-day cooldown, minor+patch grouped). Actions pinned by SHA,
  least-privilege `permissions:`.
- `release: none` only for paths that never reach users; CI rejects it on any
  other path (path list declared per module).

**Docs generated**
- `CLAUDE.md`: an index, one line per rule linking to `docs/`.
- `docs/workflow.md`: issues first, branch naming (`feature/`, `fix/`, `ci/`,
  `spike/`, `docs/` only for never-user-facing), PR flow (draft → label →
  ready), merge-main-not-rebase on pushed branches, never force-push without
  asking, check remote/PR state before resuming, board transitions, GitHub API
  pacing.
- `docs/versioning.md`: semver meaning for a continuously deployed product,
  tag as the single source of truth, label-driven release, expand-and-contract
  migrations.
- `docs/coding-standards.md`: Part 1 the persona review framework (platform
  persona supplied by modules), severity levels, output format; Part 2 generic
  rules: SOLID/KISS/DRY/YAGNI/Tell-Don't-Ask, comments policy (default none,
  one-line "why" only, no narrative), docs describe current state, logging via
  an allowlisting structured logger with no PII and stable dotted event names,
  errors reach the boundary, validation at trust boundaries, test pyramid
  against the real runtime with mocks only for unproducible states, WCAG 2.2 AA
  where there is UI, verify empirically and in a browser for user-facing work.
- `docs/definition-of-done.md`: tracked, reviewed (a real code-review run),
  tested, verified, documented, clean, labelled, and new dependencies or
  vendors screened (see below).
- `docs/adr/0001-record-architecture-decisions.md` and a README index.
- `docs/threat-model.md` (STRIDE skeleton, updated whenever a trust boundary
  moves), `docs/data-protection.md` (record of processing skeleton, processors
  table), `docs/privacy.md` (rules below), `SECURITY.md`,
  `docs/runbooks/incident-response.md`, `docs/runbooks/post-incident-review.md`.
- `LICENSE.md` + `LICENSE-SCHEDULE.md` from the standard licence template.

**Privacy rules (core)**
- No personal data in logs, URLs/query strings, the public repo, or test data.
- No email addresses published in the repo, site or DNS.
- No provider/supplier names or detailed architecture in user-facing copy.
- Cross-user features only via anonymised aggregates; never expose one user's
  raw data to another.
- Test setup never reaches real external services; local secrets files are
  gitignored and treated as real.

**Claude configuration**
- `.claude/settings.json` hook blocking edits while on `main`.
- `.claude/skills/engineering-standards/SKILL.md` (generic).
- Model routing rule in `CLAUDE.md`:
  - Main session on Opus owns design, scoping, architecture, review judgement,
    security/privacy-sensitive work and final verification.
  - At most one linked Sonnet session at a time (desktop app) takes mechanical
    work: dependency bumps, running suites and reporting output, board/label
    housekeeping, executing an agreed plan step by step, bulk renames, doc
    updates from settled decisions, CI log digging. Follow-ups go to the
    existing session, not a new one; it gets its own worktree when it writes
    code; the two never write the same files. Opus checks its results before
    reporting them.
  - Fallback where linked sessions don't exist (CLI, web): at most one
    subagent with `model: sonnet` at a time, same split.
  - Briefs are self-contained; slow commands run in the foreground.
- Memory convention: one fact per file, `MEMORY.md` as a one-line index.
- Generic operational lessons included in `docs/workflow.md`/`CLAUDE.md`:
  no "flaky", only bad tests (capture full output, find the cause); wait on CI
  with `--watch --fail-fast`; run typecheck before push; one e2e run per
  verification pass; check for duplicate dev servers before blaming watchers;
  never `pgrep -f` inside `bash -c` wait loops; check platform features before
  building ops tooling; prefer the platform's newest feature; latest stable
  dependencies, breaking bumps as tracked issues; Claude-authored docs are not
  ground truth until confirmed; ask before widening scope or improvising
  workarounds; don't mark done before the item's full stated scope is met.

## Module: js-toolchain

- pnpm pinned via `packageManager`; `pnpm-workspace.yaml` with
  `minimumReleaseAge: 4320`, an explicit `allowBuilds` list (deny by default,
  each approval justified), and an `overrides` block for transitive advisories.
- Biome (recommended preset, warnings fail CI), `tsc` over JSDoc-typed JS with
  `strictNullChecks`, Vite, Vitest (+ coverage), Playwright with an axe WCAG
  2.2 AA spec at phone width in light and dark.
- `.github/actions/setup-node-pnpm`, `test.yml` contributing `lint`,
  `typecheck`, `test`; `e2e.yml` contributing `e2e`.
- Standards fragment: escape all user-controlled data before HTML
  interpolation; validate URL schemes server-side; client-generated UUIDs for
  entity IDs; buttons are `<button>`; modals have dialog role, focus trap,
  Escape; links in text underlined; type scale only; `aria-expanded` vs
  `aria-pressed`.
- `.claude/launch.json` for the dev server.

## Module: cloudflare-terraform

- Depends on `js-toolchain`.
- `wrangler.jsonc` with environments: `production`, optional `beta`,
  `preview`, `e2e`; `workers_dev: false` at the top; every binding repeated
  per environment (a missing one inherits production's); build-time env
  selection that refuses an unknown value.
- `infra/`: provider, R2 S3-compatible backend, zone looked up by name, DNS
  placeholders for app hosts (`beta.` only if beta), TLS minimum 1.2, HSTS,
  DNSSEC, security headers, CAA, cache rules, `prevent_destroy` on data
  stores, `terraform.tfvars.example`, README with the manual setup and
  disaster recovery steps.
- Workflows: `bootstrap-state.yml`, `infra.yml` (plan on PR, apply on main in
  the `infra` environment), `preview.yml` (version upload per PR under alias
  `pr-<n>`, URL commented), `deploy.yml` on `v*` tags.
  - **No beta**: tag → production.
  - **Beta**: tag → beta; `promote.yml` (manual) sends a chosen tag to
    production.
- `release: none` forbidden on `infra/` and `migrations/`; merging either is a
  production release and the docs say so.
- Manual steps with verification:
  1. Cloudflare API tokens, least privilege, account-owned, one-year expiry:
     preview, deploy, infra plan (read-only), infra apply; exact permission
     rows listed per token. Verify with the token verify endpoint and
     `GET /accounts/{id}/tokens/{id}`, not dashboard labels. Never add a
     per-Worker granular policy by editing a token in place.
  2. R2 state bucket via `bootstrap-state.yml`, then R2 S3 credentials. Verify
     `terraform init` succeeds.
  3. (The release GitHub App is a core manual step.)
  4. `gh secret set` / `gh variable set` for each, into the right GitHub
     environment (`production`, `infra`). Verify with `gh secret list`.
  5. `wrangler secret put <name> --env <env>` for each runtime secret per
     environment; `.dev.vars` for local. Verify with `wrangler secret list`.
  6. Enable Worker preview URLs if the dashboard default is off.
- Standards fragment: the Cloudflare platform persona (routing vs static asset
  precedence, D1 consistency and batching, runtime limits, caching, secrets),
  everything provisionable in Terraform, least-privilege tokens, verify
  platform behaviour empirically.

## Dependency and vendor ethics screening (core)

Generated as `docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md`
plus a coding-standards rule and a definition-of-done item:

- Before adopting a dependency or vendor of any weight (non-trivial runtime
  package, hosting/platform vendor, identity provider, third-party API),
  check it against the BDS consumer boycott priority targets and the No Tech
  for Oppression, Apartheid or Genocide campaign.
- Record the check (dependency → maintainer → on-list Y/N) in the PR, ADR or
  doc that records the adoption.
- A hit is surfaced and weighed against alternatives, never skipped.
- Exception: free, industry-standard tools with no viable alternative (e.g.
  GitHub, `tsc`) are allowed and recorded where adopted, since using them
  pays nothing to the listed company.
- The bootstrap runs this check over the modules' own default dependencies
  and vendors and records the result in that ADR.
- No product or brand on the lists is named or recommended in generated copy.

It's a recorded manual check, not an automated CI gate: there's no
machine-readable list to check against.

## Licence

`LICENSE.md` is the **Ravendarque Noncommercial Licence**: one fixed name for
all projects, generalised from the source licence with product-specific text
removed. The Required Notice defaults to `Copyright Ravendarque
(https://github.com/ravendarque)`. Never use a real name. The "copies of these
terms" URLs point at the generated project's own `LICENSE.md` and
`LICENSE-SCHEDULE.md` (`{{repo_url}}`). `LICENSE-SCHEDULE.md` ships as-is with its
"as at" date; the bootstrap flags it if older than six months. The skill repo
itself is published under the same licence.

## Acceptance

1. The skill repo contains nothing identifying the author or their projects
   beyond the licensor notice agreed for the licence (checked by a grep list
   run before every release).
2. Dogfood: the skill bootstraps its own repo with `core` only; the skill
   files then land through that repo's first issue → PR → `v0.1.0` release
   with the plugin zip attached.
3. Dry run: a throwaway project with all three modules and beta = yes reaches
   a deployed `v0.1.0` on beta, promoted to production, with every manual step
   verified; then torn down. Repeat with beta = no.
4. A fresh session can resume a half-finished bootstrap from
   `.bootstrap/state.json`.

## Decided by the owner

- Building blocks/modules chosen at bootstrap; v1 = core, js-toolchain,
  cloudflare-terraform; more stacks added later.
- Full setup run by Claude from a fresh session in an empty directory.
- Beta environment is a bootstrap question shaping Terraform and release.
- Manual setup (tokens, R2, secrets) given as instructions during setup.
- Public repo `claude-project-bootstrap`, generic content only.
- Dogfood: use the skill to create its own repo.
- Release artefact attached to the GitHub Release; for this repo, whatever is
  easiest to install the skill (the plugin zip + marketplace install).
- Model routing: Opus main, at most one nested Sonnet session for work that
  doesn't need Opus; subagent fallback where sessions don't exist.
- The standard licence for all the author's work, generalised, included in
  the bootstrap.
- Licence named "Ravendarque Noncommercial Licence"; notice uses the GitHub
  handle and URL, never a real name.
- BDS dependency and vendor screening is a standing rule in core.

## Calls made by Claude (check these)

- Plugin layout with one orchestrator skill and per-module folders loaded on
  demand.
- `cloudflare-terraform` depends on `js-toolchain` in v1.
- The single initial push to `main` before protections exist.
- `.bootstrap/state.json` for resumability.
- Retrofitting existing repos is out of scope for v1.
- Which memory lessons were promoted to generic rules, and which were left
  out as project-specific (button colours, phone viewport, brand lists,
  specific dashboards, domain copy rules).
- Spec lives in the scratchpad until the new repo exists, then moves into its
  `docs/` in the first PR.
- **Core owns the release machinery**: `release.yml`, the release GitHub App
  manual step (creation, client ID variable, private key secret) and the base
  `release: none` path list (`docs/`, `.github/`, `test/`, root Markdown).
  Modules extend the list (`js-toolchain` adds `e2e/`) and add forbidden paths
  (`cloudflare-terraform` forbids `none` on `infra/`, `migrations/`).
- **Release artefact is a module hook**: core's `release.yml` attaches whatever
  the selected modules declare, default none. `js-toolchain` declares a zip of
  the production build output. The skill repo's own artefact (the plugin zip)
  is a repo-local addition to its generated `release.yml`, not a template
  feature.
- **User-owned repos and boards only in v1**; organisation owners later.
- **Commit signing**: preflight accepts SSH or GPG signing, checking that
  `git config commit.gpgsign` is true and a test signature succeeds.
  GitHub's squash merges are signed by GitHub. No tag ruleset in v1 (parity
  with the source project); the App pushes tags without a bypass actor.
- **Private repos supported with stated degradation**: the plan step checks
  the account's plan and lists any feature that's unavailable on it (rulesets,
  secret scanning, push protection, dependency review on a free private repo)
  before anything is created. Nothing paid gets turned on without a yes.
- **engineering-standards is a template, not a plugin skill**: it's copied
  into each generated project's `.claude/skills/`. The plugin doesn't expose
  it, so there are no same-named duplicates.
- **Model routing is a default section in the generated `CLAUDE.md`**, edited
  per project like any other line. It names tiers ("Opus-class main session",
  "Sonnet-class nested session") so it doesn't need rewriting at every model
  release.
- **Resumability**: `.bootstrap/state.json` records completed steps. On
  resume, an incomplete step attempts its create and treats "already exists"
  as success, rather than doing a read before every write. A rate-limit error
  stops the run and is reported, never retried.
- **Teardown**: the generated `infra/README.md` gets the deliberate-delete
  procedure: lift `prevent_destroy`, destroy, delete the state bucket, revoke
  the tokens. The dry run uses it.
- **No database in the hello app**: no `migrations/` folder is generated. The
  `release: none` guard on `migrations/` is still declared, so it applies once
  one exists.
- **"Reviewed" in the definition of done** means a `/code-review` run.

## Left to the builder

- Exact template wording, workflow YAML details and Terraform resources,
  ported from the source project and generalised.
- The ordering of interview questions and how the plan summary is presented.
- The grep list for personal/project identifiers.
