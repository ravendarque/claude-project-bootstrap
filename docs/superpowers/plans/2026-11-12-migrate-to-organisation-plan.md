# Migrate to the organisation: implementation plan

> **Execution:** this follows `docs/working-with-claude.md`.
> - One Sonnet-class subagent, in its own worktree, builds Task 1, and gets
>   every fix as a follow-up.
> - The main session reviews the work, runs the migrations (Tasks 3 to 5)
>   with the user's go-ahead for each repository, and makes the PRs in each
>   repository.

**Spec:** `docs/superpowers/specs/2026-11-12-migrate-to-organisation-design.md`

## Global constraints

- No dependencies.
- External effects go through an injected `deps`, with the same shape as
  `secrets/deps.mjs`: `exec`, `fetch`, `prompt`, `log`, `now`, plus a
  `sleep(ms)` you can inject.
- No narrative comments, and British English.
- No secret values, ever: the script only lists and deletes secrets by
  name.
- GitHub API pacing: at most one mutation a second. On a secondary rate
  limit (HTTP 403 or 429, or a GraphQL `RATE_LIMITED` error), wait for
  `retry-after`, or 60 s without one, and only then retry. Never more than
  three times in a row.

## Facts the builder needs

- **Archived items:** `ProjectV2.items(archivedStates: [ARCHIVED, NOT_ARCHIVED])`
  returns both kinds. Without the argument, only non-archived items come
  back (checked on 2026-11-12). Each item has `isArchived`, `type`
  (`ISSUE`, `PULL_REQUEST`, `DRAFT_ISSUE` or `REDACTED`) and `content`
  (with the content node `id` and `url`).
- **Field values:** `fieldValues` has the subtypes
  `ProjectV2ItemFieldSingleSelectValue` (`name`, `field{name}`),
  `…NumberValue` (`number`), `…TextValue` (`text`), `…DateValue` (`date`)
  and `…IterationValue`. Ignore the built-in ones: Title, Assignees,
  Labels, Linked pull requests, Milestone, Repository, Reviewers, Parent
  issue and Sub-issues progress.
- **Mutations:**
  - `copyProjectV2(projectId, ownerId, title, includeDraftIssues: true)`
  - `updateProjectV2(projectId, public: false)`
  - `addProjectV2ItemById(projectId, contentId)`
  - `updateProjectV2ItemFieldValue(projectId, itemId, fieldId, value: { singleSelectOptionId | number | text | date })`
  - `archiveProjectV2Item(projectId, itemId)`
  - `linkProjectV2ToRepository(projectId, repositoryId)`
  - `deleteProjectV2(projectId)`
- **Transfer:** `gh api -X POST repos/<owner>/<repo>/transfer -f new_owner=oneloneraven`.
  It's asynchronous, so poll `gh api repos/oneloneraven/<repo>` with
  `deps.sleep`, for at most 2 minutes.
- **Organisation id:** `gh api graphql -f query='{organization(login:"oneloneraven"){id}}'`.
- **The personal account:** `ravendarque` is never hard-coded. The script
  takes it from `gh api user --jq .login`.

### Task 1: `migrate.mjs` (subagent)

**Files:**
- `skills/bootstrap/scripts/migrate.mjs`: the CLI, `migrate.mjs <repo> [--dry-run] [--org oneloneraven]`.
- `skills/bootstrap/scripts/migrate/` modules:
  - `state.mjs`: resumable state at
    `${XDG_STATE_HOME:-~/.local/state}/claude-project-bootstrap/migrate/<repo>.json`.
  - `github.mjs`: GraphQL and REST through `gh`, with the pacing and
    backoff rules.
  - `board.mjs`: reads a board, copies it, and adds and verifies items.
  - `phases.mjs`: the nine phases in the spec's order.
- **Tests:** `tests/migrate-*.test.mjs`. They use a fake GitHub that's
  stateful in memory, so a whole migration can run against it.

**Behaviour:** as the spec describes, one phase at a time.
- Each phase is recorded done in state, and a re-run skips the finished
  phases.
- The `items` phase resumes from the mapping.
- `--dry-run` runs `inventory` only, and prints the plan.
- **Prompts:** Auto-add, the board-sync merge and the release App each wait
  for the user to type `done`. `delete-old-board` waits for the old
  board's exact title.

**Tests must cover:**
- **The full run:** a migration against the fake, with 3 issue items, 1 PR
  item, 1 draft and 1 archived item. Afterwards, every value is copied,
  and archived items stay archived.
- **Resuming:** kill the run after the second item, re-run it, and check
  there are no duplicates.
- **Verify re-applies:** the fake can overwrite Status after an add, to
  mimic a workflow, and the second pass corrects it.
- **Verify stops:** a mismatch still there after three passes stops the
  migration before `delete-old-board`.
- **Rate limits:** a rate-limited response waits `retry-after`, using the
  injected sleep, and then succeeds. Three in a row is an error.
- **Inventory refuses** when the repository has two linked boards, or the
  organisation already has a repository with that name.
- **Dry run:** `--dry-run` makes no mutation.
- **Deleting the old board** only happens with the exact title.
- **The release-app phase** moves the old Pass item to the bin and deletes
  the two names. It never reads a secret value.
- **The board-sync phase** deletes `PROJECT_STATUS_PAT` only after
  confirmation.

Commit with the body "Refs #75".

### Task 2: Review, runbook and PR (main session)

1. Write `docs/runbooks/migrate-to-organisation.md`.
2. Run `/code-review`, and fix what it finds.
3. Run `pnpm test` and the identifier guard.
4. Open a PR labelled `release: minor` that refers to #75 (it doesn't close
   it), and merge it once it's green.

### Task 3: Migrate `deaftly` (main session, live)

1. Dry run, then the user's go-ahead, then the full run.
2. In `deaftly`, a PR switches board sync to the App variant.
3. The user runs `release-app` for the moved project.
4. Delete the old board.

### Task 4: Migrate `beta-interpreter`, then `climbing-logbook` (main session, live)

1. Transfer `beta-interpreter`. It has no board, so most phases are skipped.
2. In `beta-interpreter`, a PR renames the package scope and releases it.
3. Migrate `climbing-logbook`.
4. In `climbing-logbook`, a PR switches the dependency, the `.npmrc` scope
   and the imports, plus the board-sync workflow.
5. Release App and old board as in Task 3.

### Task 5: Migrate `ravendarque-beyond-borders` (main session, live)

1. Run the migration.
2. Check the Pages custom domain, and that `https://wearebeyondborders.com`
   still answers.
3. Fix the DNS if it pointed at `ravendarque.github.io`.
4. When it's done, delete the personal `Project template` and close #75.
