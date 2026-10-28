# claude-project-bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin whose `bootstrap` skill turns an empty directory into a fully configured project (GitHub repo, protections, board, CI, tag-based releases, standards, Claude config), built from selectable modules: `core`, `js-toolchain`, `cloudflare-terraform`.

**Architecture:** A short orchestrator `SKILL.md` drives fixed phases and loads each selected module's `MODULE.md` on demand. Files are produced by a zero-dependency Node script (`scripts/render.mjs`) from per-module manifests and `{{placeholder}}` templates, so rendering is deterministic and testable. Everything that needs judgement or a human (interview, GitHub calls, manual steps, verification) is instructions in the Markdown that Claude follows.

**Tech Stack:** Node 22 (built-in `node:test`, no npm dependencies in the plugin), Markdown, GitHub Actions YAML, Terraform (Cloudflare provider), wrangler, `gh` CLI.

**Spec:** `2026-10-28-claude-project-bootstrap-design.md` (same folder; moves to `docs/superpowers/specs/` in the first PR of the new repo).

## Global Constraints

- Nothing identifying the author or their projects anywhere except the licence notice `Copyright Ravendarque (https://github.com/ravendarque)`. Never a real name, email, hostname, issue/ADR number from the source project, or source-project product copy.
- No personal conversational preferences in any generated file.
- British English, professional register, in every template, doc and commit message.
- Comments policy applies to this repo too: no comment by default, one line for a non-obvious "why".
- Plugin has no runtime npm dependencies; scripts use Node 22 built-ins only.
- GitHub mutations paced ≥1s apart, never in parallel, never retried into a rate limit.
- Claude never creates tokens, sets secrets, makes anything public or spends money without an explicit yes in chat.
- Actions pinned by full commit SHA with a version comment; every workflow declares least-privilege `permissions:`.
- Model routing names tiers ("Opus-class", "Sonnet-class"), not model IDs.
- Licence title: "Ravendarque Noncommercial Licence".
- Development happens in a local staging repo `~/git/ravendarque/claude-project-bootstrap-staging` (git, no remote) until Task 11 creates the real repo.

## Review Focus

1. **Non-empty or existing-git target directory**: bootstrap refuses and says why, and never overwrites files. Test owned by Task 3 (`preflight refuses non-empty dir`).
2. **Project names that aren't valid repo/Worker/package names** (spaces, capitals, leading digits, >63 chars): the interview normalises them to a slug and shows it back for confirmation. Test owned by Task 1 (`validateAnswers` cases).
3. **A module selected without its dependency** (`cloudflare-terraform` without `js-toolchain`): render fails with a message naming the missing module, rather than producing a half project. Test owned by Task 1.
4. **Rate limit or crash midway through GitHub configuration**: the run stops, `.bootstrap/state.json` shows exactly what's done, and a fresh session resumes without duplicating anything. Test owned by Task 3 (`state` tests) and verified in Task 12.
5. **A placeholder left unresolved or a template path that renders outside the target dir**: render fails loudly; nothing is written. Test owned by Task 1.

---

## File structure (plugin repo)

```
.claude-plugin/plugin.json               plugin metadata
.claude-plugin/marketplace.json          single-plugin marketplace for /plugin marketplace add
skills/bootstrap/SKILL.md                orchestrator: phases, rules, how to use scripts
skills/bootstrap/reference/module-contract.md
skills/bootstrap/reference/manual-step-format.md
skills/bootstrap/scripts/render.mjs      render(), validateAnswers(), resolveModules()
skills/bootstrap/scripts/state.mjs       loadState(), markDone(), nextStep()
skills/bootstrap/scripts/preflight.mjs   checkTarget(), checkTools()
skills/bootstrap/scripts/check-identifiers.mjs
skills/bootstrap/modules/<module>/MODULE.md
skills/bootstrap/modules/<module>/manifest.json
skills/bootstrap/modules/<module>/templates/**
tests/*.test.mjs                         node:test suites
tests/fixtures/answers-*.json            sample interview answers
```

### Manifest format (decided here; every module task uses it)

```json
{
  "name": "core",
  "dependsOn": [],
  "questions": [{ "key": "beta", "type": "boolean", "prompt": "Beta environment?" }],
  "files": [
    { "from": "templates/CLAUDE.md", "to": "CLAUDE.md" },
    { "from": "templates/github/promote.yml", "to": ".github/workflows/promote.yml", "when": "beta" }
  ],
  "requiredChecks": ["check-label"],
  "releasePaths": { "noneAllowed": ["docs/", ".github/", "test/", "*.md"], "noneForbidden": [] },
  "claudeIndexLines": ["- Workflow: [docs/workflow.md](docs/workflow.md)"],
  "artefact": null
}
```

`when` is a single answer key (truthy) or `"!key"` (falsy). Templates may contain `{{key}}` and two derived keys the renderer computes: `{{required_checks_json}}` (union of all selected modules' `requiredChecks`) and `{{claude_index}}` (concatenated `claudeIndexLines` in module order).

---

### Task 1: Plugin skeleton and renderer

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/bootstrap/scripts/render.mjs`, `package.json` (scripts only: `"test": "node --test tests/"`), `.gitignore`
- Test: `tests/render.test.mjs`, `tests/fixtures/modules/{a,b}/…` (tiny fake modules)

**Interfaces:**
- Produces:
  - `resolveModules(selected: string[], modulesDir: string) => Manifest[]`: always includes `core` first, follows `dependsOn`, throws `Missing dependency: <mod> requires <dep>`
  - `validateAnswers(answers: object) => { answers: object, slug: string }`: slug = lowercase, `[a-z0-9-]`, starts with a letter, ≤63 chars; throws on empty
  - `render({ modules: Manifest[], answers, modulesDir, destDir, dryRun? }) => string[]` (relative paths written): throws `Unresolved placeholder {{x}} in <file>` and `Path escapes destination: <to>`; writes nothing if any file fails (render all to memory first)
  - CLI: `node render.mjs --modules core,js-toolchain --answers answers.json --dest <dir> [--dry-run]`

- [ ] **Step 1: Write failing tests** in `tests/render.test.mjs`: `resolveModules orders core first and pulls dependencies`; `resolveModules throws on missing dependency` (assert message `Missing dependency: b requires a` when `a` absent from selection *and* the modules dir); `validateAnswers slugs "My Cool App!" to "my-cool-app"`; `validateAnswers rejects "123" with Project name must start with a letter`; `render substitutes placeholders and derived keys`; `render honours when and !when`; `render throws on unresolved placeholder and writes nothing`; `render rejects ../ escape`.
- [ ] **Step 2: Run** `node --test tests/render.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `render.mjs` exports above. Binary files (by extension: png, ico, woff2, zip) copied without substitution.
- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.
- [ ] **Step 5: Commit** `Renderer: render module templates from manifests and answers`.

### Task 2: Identifier guard

**Files:**
- Create: `skills/bootstrap/scripts/check-identifiers.mjs`
- Test: `tests/check-identifiers.test.mjs`

**Interfaces:**
- Produces: `findIdentifiers(rootDir: string, patterns: RegExp[], allow: { path: string, pattern: RegExp }[]) => { file, line, match }[]`; CLI reads patterns one per line from the file named by env `IDENTIFIER_DENYLIST_FILE` or the env `IDENTIFIER_DENYLIST` (newline-separated), exits 1 on any hit, 2 if no patterns supplied. The pattern list is **never committed**; it lives in a local file outside the repo and in an Actions secret.

- [ ] **Step 1: Failing tests**: hit reported with file and line; `allow` exempts `LICENSE.md`'s notice line only; exit code 2 with no patterns; `node_modules/` and `.git/` skipped.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test tests/`, expect pass. Then create the local denylist at `~/.config/claude-project-bootstrap/denylist` (the author's real name, email, source project name/domains, `#\d{3,4}` issue refs) and run the CLI over the repo. Expected: exit 0.
- [ ] **Step 5: Commit** `Identifier guard: fail on author or source-project identifiers`.

### Task 3: Preflight, state and the orchestrator skill

**Files:**
- Create: `skills/bootstrap/scripts/preflight.mjs`, `skills/bootstrap/scripts/state.mjs`, `skills/bootstrap/SKILL.md`, `skills/bootstrap/reference/module-contract.md`, `skills/bootstrap/reference/manual-step-format.md`
- Test: `tests/preflight.test.mjs`, `tests/state.test.mjs`

**Interfaces:**
- Produces:
  - `checkTarget(dir) => { ok: boolean, reason?: string }`: not ok if any entry other than `.bootstrap/` exists
  - `checkTools(modules: Manifest[]) => { tool, ok, fix }[]`: core: `git`, `gh` (`gh auth status` shows `project` scope), signing (`git config commit.gpgsign` true and `echo test | git commit-tree` style signature test in a temp repo); js-toolchain: `node>=22`, `pnpm`; cloudflare-terraform: `terraform`, `pnpm dlx wrangler --version`
  - `loadState(dir) => { steps: Record<string, 'done'>, answers, modules }`, `markDone(dir, stepId)`, `nextStep(dir, orderedStepIds) => string|null`
- Phase step IDs (fixed, used by every MODULE.md): `preflight`, `interview`, `plan-confirmed`, `scaffold`, `repo-created`, `initial-push`, `github-configured`, `manual:<module>:<n>`, `first-pr-merged`, `handover`

- [ ] **Step 1: Failing tests**: `preflight refuses non-empty dir` (dir with `README.md` → `{ ok:false, reason:'Directory is not empty: README.md' }`); `.bootstrap/` alone is allowed; `markDone` persists and `nextStep` returns the first not-done ID; state survives reload from disk; corrupt state.json throws `Corrupt .bootstrap/state.json` rather than resetting.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** the scripts. `checkTools` is exercised manually (it shells out); keep it thin.
- [ ] **Step 4: Write `SKILL.md`** (≤150 lines): trigger description; the phase list with step IDs; "load a module's MODULE.md only once selected"; plan-and-confirm gate listing everything public/paid; the single initial push to `main` before protections; GitHub pacing and stop-on-rate-limit; "already exists" counts as success on resume; manual steps one at a time with verification; the first change through the project's own PR process; hand-over summary listing anything unverified; before the plan is confirmed, read the "as at" date in `modules/core/templates/LICENSE-SCHEDULE.md` and warn if it is more than six months old. `module-contract.md`: the seven MODULE.md sections from the spec plus the manifest fields. `manual-step-format.md`: each step = why, exact commands/console clicks, what Claude runs to verify, the expected verify output.
- [ ] **Step 5: Run** `node --test tests/`, expect pass. **Commit** `Bootstrap orchestrator, preflight and resumable state`.

### Task 4: core module: docs, Claude config and licence

**Files:**
- Create: `skills/bootstrap/modules/core/{MODULE.md,manifest.json}` and templates: `CLAUDE.md`, `docs/workflow.md`, `docs/versioning.md`, `docs/coding-standards.md`, `docs/definition-of-done.md`, `docs/privacy.md`, `docs/data-protection.md`, `docs/threat-model.md`, `docs/adr/README.md`, `docs/adr/0001-record-architecture-decisions.md`, `docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md`, `docs/runbooks/incident-response.md`, `docs/runbooks/post-incident-review.md`, `SECURITY.md`, `README.md`, `LICENSE.md`, `LICENSE-SCHEDULE.md`, `.claude/settings.json`, `.claude/skills/engineering-standards/SKILL.md`, `.gitignore` (includes `.bootstrap/`, `.dev.vars`, `.env*`)
- Test: `tests/core-docs.test.mjs`

- Modify: `skills/bootstrap/scripts/render.mjs`, `tests/render.test.mjs` (derived keys below)

**Interfaces:**
- Consumes: `render`, `resolveModules` (Task 1).
- Produces: core `manifest.json` with `claudeIndexLines`; `{{claude_index}}` is where modules add their lines; `docs/coding-standards.md` has a `{{coding_standards_modules}}` placeholder. **Add that derived key to Task 1's renderer** (concatenation of each selected module's `templates/standards-fragment.md`, in module order) with a test.

Content sources (port and generalise; strip every source-specific reference):
- Coding standards: source `docs/coding-standards.md` Part 1 (personas: platform persona text comes from the module fragment, the other four generic), Part 2 generic rules listed in the spec's "Docs generated" bullet.
- Workflow: source `CLAUDE.md` + `engineering-standards` skill + the operational lessons listed in the spec.
- Versioning: source `docs/versioning.md` sections "Deploys vs releases", "What SemVer means", "Where the version lives", "Cutting a release", "Database migrations: expand and contract" with source history removed.
- DoD: spec list including the screening item; "Reviewed" = `/code-review` run.
- Model routing + memory convention: verbatim from the spec's "Claude configuration" bullets, in `CLAUDE.md` under `## Working with Claude`.
- ADR 0002: the spec's screening section; leave a `## Screening record` table with `{{screening_table}}` filled by a per-module `screening` array in manifest (`[{ "dependency", "maintainer", "listed": "N", "note" }]`). Add the derived key to the renderer with a test.
- Licence: source licence retitled "Ravendarque Noncommercial Licence", notice → `Copyright Ravendarque (https://github.com/ravendarque)`, URLs → `{{repo_url}}/blob/main/LICENSE.md` etc. Schedule copied as-is.

- [ ] **Step 1: Failing tests**: render core alone with `tests/fixtures/answers-core.json`, then assert: rendered `CLAUDE.md` ≤60 lines; every relative Markdown link in every rendered `.md` resolves to a rendered file; `LICENSE.md` first line is `# Ravendarque Noncommercial Licence 1.0.0`; `.claude/settings.json` parses and contains a `PreToolUse` hook matching `Write|Edit`; no file contains `{{`; `docs/coding-standards.md` contains "## Part 1: Review framework".
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Write the templates and manifest.**
- [ ] **Step 4: Run** `node --test tests/` and the identifier guard, expect both pass.
- [ ] **Step 5: Commit** `core module: project docs, standards, Claude config and licence`.

### Task 5: core module: GitHub configuration and release machinery

**Files:**
- Create under `modules/core/templates/`: `.github/workflows/{require-release-label,release,zizmor,scorecard,dependency-review,project-status-sync}.yml`, `.github/dependabot.yml`, `.github/zizmor.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/{bug,feature}.yml`, `.github/release-paths.json`, `.github/scripts/check-release-paths.mjs`, `.github/scripts/next-version.mjs`; plus `modules/core/github/ruleset.json`, `modules/core/github/repo-settings.json`, `modules/core/github/labels.json`
- Modify: `modules/core/MODULE.md` (GitHub configuration + manual steps sections)
- Test: `tests/release-scripts.test.mjs`, `tests/core-github.test.mjs`

**Interfaces:**
- Produces:
  - `.github/release-paths.json` = `{{release_paths_json}}` (renderer derived key: merged `releasePaths` of selected modules; add with test)
  - `checkReleasePaths(changed: string[], cfg) => { ok, offending: string[] }`: a file is allowed under `none` iff it matches some `noneAllowed` glob and no `noneForbidden` glob; renames' old paths included
  - `nextVersion(tags: string[], bump: 'major'|'minor'|'patch') => string`: ignores non-`vX.Y.Z` tags; `v0.0.0` base when none
  - `ruleset.json` with `{{required_checks_json}}`, rules: deletion, non_fast_forward, pull_request (0 approvals, squash only), required_status_checks, required_signatures
- `release.yml`: on PR closed+merged with a non-none label; mints a release-App token (`RELEASE_APP_CLIENT_ID` var, `RELEASE_APP_PRIVATE_KEY` secret); tags the PR's merge commit; `gh release create --generate-notes`; uploads each artefact path from `{{artefact_paths}}` (derived key; empty → step skipped). Concurrency group `release`.
- `project-status-sync.yml`: In Progress on branch create (branch name contains the issue number after the prefix, e.g. `feature/12-…`), In Review on PR open; uses secret `PROJECT_STATUS_PAT`; project number from repo variable `PROJECT_NUMBER`.

- [ ] **Step 1: Failing tests**: `nextVersion` (`[] + minor → v0.1.0`, `['v1.2.3','v1.10.0','junk'] + patch → v1.10.1`); `checkReleasePaths` (`docs/x.md` ok; `infra/main.tf` with forbidden `infra/` → offending; mixed → only infra listed); rendered `ruleset.json` for core+js contains checks `check-label, lint, typecheck, test, e2e`; every rendered workflow has top-level `permissions:` and every `uses:` is `@<40-hex> # v…`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** scripts and templates; port YAML from the source repo's workflows, generalised.
- [ ] **Step 4: MODULE.md GitHub configuration section**: exact `gh api` calls in order: repo settings PATCH (squash only, delete branch on merge, auto-merge off), security_and_analysis enable, labels create, ruleset POST, environments create, `gh project create` + Status field options + link repo, `gh variable set PROJECT_NUMBER`. Manual steps (format per Task 3): (1) create the release GitHub App, Contents: write, only this repo, install it, then `gh variable set RELEASE_APP_CLIENT_ID` / `gh secret set RELEASE_APP_PRIVATE_KEY < key.pem`. Verify `gh variable list`, `gh secret list`. (2) Classic PAT with only `project` scope → `gh secret set PROJECT_STATUS_PAT`. Verify listing. (3) Turn on the board's built-in "Item closed" and "Pull request merged" → Done workflows (no API). Verify by Raven's confirmation. Private repo: before the plan is confirmed, `gh api user --jq .plan.name`; on `free` list rulesets/secret scanning/push protection/dependency review as unavailable and ask.
- [ ] **Step 5: Run** `node --test tests/`; run `actionlint` and `zizmor` over a core render (install both first: `pipx install zizmor`, actionlint release binary — ask Raven before installing). Expected: clean. **Commit** `core module: GitHub configuration, release label guard and tag releases`.

### Task 6: js-toolchain module

**Files:**
- Create `modules/js-toolchain/{MODULE.md,manifest.json,templates/standards-fragment.md}` and templates: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `biome.json`, `tsconfig.json`, `vite.config.js`, `vitest.config.js`, `playwright.config.js`, `src/index.js`, `src/greeting.js`, `test/greeting.test.js`, `e2e/home.spec.js`, `e2e/accessibility.spec.js`, `index.html`, `.github/actions/setup-node-pnpm/action.yml`, `.github/workflows/{test,e2e}.yml`, `.claude/launch.json`
- Test: `tests/js-toolchain.test.mjs` (render-only assertions) + the integration step below

**Interfaces:**
- Consumes: Tasks 1, 4, 5 derived keys.
- Produces: manifest `dependsOn: []`, `requiredChecks: ["lint","typecheck","test","e2e"]`, `releasePaths.noneAllowed: ["e2e/", "test/"]`, `artefact: "dist.zip"` (built by a `release` step that runs `pnpm build` and zips `dist/`), `screening` rows for every default dependency.
- Exact values: `minimumReleaseAge: 4320`; `allowBuilds` lists only `esbuild: true` (plus anything the chosen deps genuinely need, each with a one-line why); Biome recommended preset, warnings fail; `tsc` with `allowJs`, `checkJs`, `noEmit`, `strictNullChecks`; Playwright axe test tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` at 375px in light and dark; `packageManager` pinned to the current pnpm at build time.

- [ ] **Step 1: Failing render tests**: rendered `package.json` has scripts `dev, build, lint, format, typecheck, test, test:e2e`; `pnpm-workspace.yaml` has `minimumReleaseAge: 4320`.
- [ ] **Step 2: Run**, FAIL. **Step 3: Write templates.**
- [ ] **Step 4: Integration check**: render core+js-toolchain into a temp dir, then `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm exec playwright install chromium && pnpm test:e2e`. Expected: all exit 0. Run `actionlint`/`zizmor` on the render.
- [ ] **Step 5: BDS screening** of each default dependency (Biome, Vite, Vitest, Playwright, axe-core, pnpm, TypeScript under the free-tool exception, GitHub likewise): check each maintainer against both BDS lists, fill `screening` in the manifest with sources noted in the commit message. **Commit** `js-toolchain module`.

### Task 7: cloudflare-terraform module

**Files:**
- Create `modules/cloudflare-terraform/{MODULE.md,manifest.json,templates/standards-fragment.md}` and templates: `wrangler.jsonc`, `src/worker.js` (replaces js-toolchain's `src/index.js` when this module is selected; manifest `overrides` entry, add renderer support with a test), `infra/{main,variables,outputs,dns,security,cache}.tf`, `infra/terraform.tfvars.example`, `infra/README.md`, `scripts/bootstrap-state.mjs`, `scripts/require-cloudflare-env.mjs`, `.github/workflows/{infra,preview,deploy,bootstrap-state}.yml`, `.github/workflows/promote.yml` (`when: beta`), `.dev.vars.example`
- Test: `tests/cloudflare.test.mjs` + integration step

**Interfaces:**
- Consumes: answers `zone_name`, `beta` (boolean), `slug`.
- Produces: manifest `dependsOn: ["js-toolchain"]`, `releasePaths.noneForbidden: ["infra/", "migrations/", "wrangler.jsonc"]`, `requiredChecks: []` (infra plan is informational), `screening` row for Cloudflare.
- Exact behaviour: `workers_dev: false` top level; envs `production`, `preview` (workers_dev true), `e2e`, and `beta` iff beta; deploy on `v*` tag goes to `beta` when beta, else `production`; `promote.yml` dispatch input `tag`; preview uploads `wrangler versions upload --preview-alias pr-<n>` and comments the URL; Terraform state in R2 bucket `{{slug}}-tfstate` via S3 backend; DNS proxied placeholder `192.0.2.1` for apex (+ `beta.`) with `prevent_destroy`; min TLS 1.2, HSTS, DNSSEC, CAA restricted to the provider's CAs, `Cache-Control` rules; `infra/README.md` contains setup, disaster recovery and the deliberate teardown procedure.
- Manual steps (MODULE.md, format per Task 3): tokens preview / deploy / infra-plan / infra-apply with exact permission rows (port from source `docs/infra-architecture.md` "Cloudflare token permissions", minus source-only grants: Access, Turnstile, Email Routing, Zero Trust), one-year expiry, never edit a per-Worker granular policy in place; verify with `curl …/user/tokens/verify` and `GET /accounts/{id}/tokens/{id}`. R2 S3 credentials → `TF_STATE_ACCESS_KEY_ID`/`TF_STATE_SECRET_ACCESS_KEY`. `CLOUDFLARE_ACCOUNT_ID` variable. Secrets into environments `production` (deploy token) and `infra` (apply token). `wrangler secret put <name> --env <env>` per environment for app secrets (none for hello app; the step explains the pattern). Enable Worker preview URLs if off.

- [ ] **Step 1: Failing render tests**: beta=true render has `promote.yml` and a `beta` env in `wrangler.jsonc`; beta=false has neither and `deploy.yml` targets `production`; every env in `wrangler.jsonc` repeats each binding; the `src/index.js` override applies.
- [ ] **Step 2: Run**, FAIL. **Step 3: Write templates.**
- [ ] **Step 4: Integration check** for both beta values: render core+js+cloudflare into temp dirs; `terraform -chdir=infra init -backend=false && terraform -chdir=infra validate && terraform fmt -check -recursive infra`; `pnpm install && pnpm exec wrangler deploy --dry-run --env production`; `pnpm lint && pnpm typecheck && pnpm test`; `actionlint`/`zizmor`. Expected: all clean.
- [ ] **Step 5: Commit** `cloudflare-terraform module`.

### Task 8: Plugin docs and repo-local extras

**Files:**
- Create: `README.md` (what it is, install via `/plugin marketplace add ravendarque/claude-project-bootstrap`, `/plugin install`, usage, module list, how to add a module), `docs/adding-a-module.md`, `repo-local/test.yml` (runs `node --test tests/` and the identifier guard with secret `IDENTIFIER_DENYLIST`), `repo-local/release-artefact.md` (how the plugin zip is added to this repo's generated `release.yml`)
- Test: link check from Task 4 applied to the repo's own docs

- [ ] **Step 1:** Write the docs. **Step 2:** Run link check and identifier guard; expect clean. **Step 3: Commit** `Plugin README and module authoring guide`.

### Task 9: End-to-end render review

- [ ] **Step 1:** Render all four combinations (core; core+js; core+js+cf beta; core+js+cf no-beta) into temp dirs; run `node --test tests/`, the identifier guard on each render, `actionlint`, `zizmor`. Expected: all clean.
- [ ] **Step 2:** `/code-review high` over the staging repo against the spec. Fix every blocking and should-fix finding. Commit fixes.

### Task 10: Install the plugin locally

- [ ] **Step 1:** `/plugin marketplace add ~/git/ravendarque/claude-project-bootstrap-staging`, `/plugin install claude-project-bootstrap`. Verify the `bootstrap` skill is listed and `engineering-standards` is **not** exposed as a plugin skill.

### Task 11: Dogfood: bootstrap the plugin's own repo (acceptance 2)

Raven drives this in a fresh session; the main session stays available for fixes in staging.

- [ ] **Step 1:** Fresh session in empty `~/git/ravendarque/claude-project-bootstrap`; invoke the skill; modules: core only; visibility public. Every phase through `github-configured` completes; manual steps (release App, PAT, board workflows) done and verified.
- [ ] **Step 2:** First issue "Add the bootstrap plugin" → branch `feature/1-bootstrap-plugin` → copy the staging tree in (excluding `.git`), move `repo-local/test.yml` to `.github/workflows/test.yml`, add `test` to the ruleset's required checks, wire the plugin zip into `release.yml` per `repo-local/release-artefact.md`, move spec and plan into `docs/superpowers/`. Set Actions secret `IDENTIFIER_DENYLIST` from the local denylist (Raven runs `gh secret set IDENTIFIER_DENYLIST < ~/.config/claude-project-bootstrap/denylist`).
- [ ] **Step 3:** Draft PR with `release: minor` → ready → CI green → merge. Expected: tag `v0.1.0`, GitHub Release with the plugin zip attached.
- [ ] **Step 4:** Reinstall from GitHub: `/plugin marketplace add ravendarque/claude-project-bootstrap`. Verify the skill loads. Any defect found here gets an issue and a fix PR in the new repo.

### Task 12: Dry runs, resume and teardown (acceptances 3 and 4)

Needs a throwaway Cloudflare zone; Raven confirms which before starting (costs and DNS are Raven's call).

- [ ] **Step 1:** Fresh session, empty dir, all modules, beta = yes, private repo. Kill the session after `github-configured`; start a new one; confirm it resumes at the first manual step with nothing duplicated (labels, ruleset, board unchanged).
- [ ] **Step 2:** Complete to `v0.1.0` deployed on beta; run `promote.yml`; verify the production hostname serves the hello Worker (`curl -sI https://<zone>/` → 200).
- [ ] **Step 3:** Tear down with `infra/README.md`'s procedure; delete the repo (Raven confirms). Verify nothing remains in the Cloudflare account.
- [ ] **Step 4:** Repeat Steps 1–3 with beta = no (no resume test needed). Raise issues for every defect found; fix through the plugin repo's own process.
