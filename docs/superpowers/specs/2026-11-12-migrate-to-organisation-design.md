# Migrate a repository and its board to the organisation: design

This covers issue #75. Four repositories move from the personal account to
`oneloneraven`:
- `deaftly`
- `beta-interpreter`
- `climbing-logbook`
- `ravendarque-beyond-borders`

Their boards move with them. GitHub can't transfer a personal board to an
organisation, so the script rebuilds each board there.

## Decisions

- **Which repositories move:** only those four (D24). The private
  repositories and `claude-project-bootstrap` stay on the personal account
  (D25).
- **How each board is rebuilt:** `copyProjectV2` copies that repository's
  own personal board into the organisation. It keeps the board's own
  fields, views, workflows and draft issues (D27).
- **The `beta-interpreter` package:** it's republished as
  `@oneloneraven/beta-interpreter` on GitHub Packages, and
  `climbing-logbook` switches its dependency, `.npmrc` and imports in one PR
  (D28).
- **Order:** `deaftly` goes first, then `beta-interpreter` and
  `climbing-logbook` together, then `ravendarque-beyond-borders` (D29).

## Findings

These come from a live transfer test on 2026-11-12:
- **Carried over by a transfer:** Actions variables and secrets,
  environments with their branch policies and secrets, rulesets, labels,
  issues and pull requests.
- **Lost:** the repository's link to its personal board.
- **The old board keeps its items.** The issue stayed as an item on the
  personal board, with its content URL updated, so the old board can still
  be read after the transfer.
- **Board sync already covers moved repositories.** The organisation's
  board-sync App is installed on all repositories.
- **The release App doesn't carry over.** A personal-account release App
  can't be installed on an organisation repository. `deaftly` and
  `climbing-logbook` each have one, with `RELEASE_APP_*` secrets.
- **Boards in scope:**

  | Board | Items | Custom fields | Views |
  |---|---|---|---|
  | Deaftly (7) | 137 | Status | 2 |
  | Climbing Logbook (3) | 831 | Status, Priority, Size, Estimate | 4 |
  | Beyond Borders (2) | 26 | Status, Priority, Size, Estimate, Start date, End date | 6 |

- **Packages:** `beta-interpreter` publishes `@ravendarque/beta-interpreter`
  to GitHub Packages, with 20 versions. npm packages there are tied to the
  owner's scope.
- **Pages:** `ravendarque-beyond-borders` serves GitHub Pages on
  `wearebeyondborders.com`, with a legacy build. Its DNS is on Cloudflare,
  proxied. GitHub doesn't redirect Pages after a transfer.

## The script

The script is `skills/bootstrap/scripts/migrate.mjs <repo> [--dry-run]`.

- **Running it:** Claude runs it, with the user's go-ahead for each
  repository, because the transfer can't be undone. It handles no secret
  values.
- **Resuming:** its state lives in `~/.local/state/claude-project-bootstrap/migrate/<repo>.json`.
  It records each finished phase and the old-item-to-new-item mapping, so
  a second run carries on from where the first stopped.

Phases, in order:

1. **`inventory`** (and all of `--dry-run`):
   - **Old board:** find it from the repository's linked projects. Record
     its fields with their options, its item count by type, and how many
     are archived.
   - **Repository:** record its secrets and variables, Pages, packages and
     release App.
   - **Plan:** print the plan.
   - **Stop conditions:** the repository has more than one linked board,
     or the organisation already has a repository with that name.
2. **`transfer`:** `POST /repos/<personal>/<repo>/transfer` with
   `new_owner: oneloneraven`. Then wait until
   `gh repo view oneloneraven/<repo>` answers.
3. **`copy-board`:**
   - Copy the old board into the organisation with the same title,
     `includeDraftIssues: true`, which brings drafts and their field
     values. Then make the copy private.
   - Record the new board's number, id and fields. The fields match by
     name, and their options match by name.
4. **`items`:** for every issue and PR item on the old board:
   - add it to the new board with `addProjectV2ItemById`, using its content
     id;
   - copy every single-select, number, text and date value with
     `updateProjectV2ItemFieldValue`. An iteration field's values are
     reported, not copied.
   - **Archiving:** archive the new item if the old one is archived.
   - **Pacing:** at most one mutation a second. Back off on a secondary
     rate limit, and never retry into one.
   - **Resuming:** record each item in the mapping as it finishes.
5. **`verify`:**
   - Re-read both boards and compare them by content URL. Every issue and
     PR must be on the new board, with the same field values and the same
     archived state.
   - Built-in workflows such as "Item added to project" can overwrite a
     value just after it's set. Re-apply any mismatch and re-check, up to
     three passes, then report anything left.
   - The draft count must match.
6. **`link`:**
   - Link the repository to the new board.
   - Set `PROJECT_ID`, `PROJECT_STATUS_FIELD_ID`,
     `PROJECT_IN_PROGRESS_OPTION` and `PROJECT_IN_REVIEW_OPTION` from the
     new board. "In progress" and "In review" are matched case-insensitively.
   - Tell the user to turn on Auto-add (this repository, `is:issue`) and
     confirm, then check that it's enabled.
7. **`board-sync`:**
   - If the repository has `.github/workflows/project-status-sync.yml`,
     tell the user that the repository needs the App variant from
     `skills/bootstrap/modules/core/templates/github/workflows/project-status-sync-app.yml`.
     It goes in through that repository's own PR process, which the script
     doesn't do.
   - Once the user confirms it's merged, delete `PROJECT_STATUS_PAT` from
     the repository.
8. **`release-app`:** this only applies when the repository has
   `RELEASE_APP_PRIVATE_KEY`.
   - Move the old `release App` Pass item to the bin, so that the next
     `release-app` run doesn't resume with the personal App's key.
   - Delete `RELEASE_APP_PRIVATE_KEY` and `RELEASE_APP_CLIENT_ID`.
   - Tell the user to run `secrets.mjs release-app` for the moved project,
     then delete the old personal App in their account's settings.
   - The script verifies that the new secret and variable exist.
9. **`delete-old-board`:**
   - Only if `verify` passed.
   - The user must type the old board's title, and there's no flag to skip
     that.
   - Then delete the personal board.

The script reports anything it doesn't handle, so the user knows what's
left: Pages (the custom domain must be re-checked on the new repository),
and packages (they need a new scope and a republish, which happen in that
repository).

## Done outside the script, per repository

These go through each repository's own PR process:
- **`deaftly` and `climbing-logbook`:** the board-sync workflow switches to
  the App variant.
- **`beta-interpreter`:** `package.json` gets the name
  `@oneloneraven/beta-interpreter`, and a release republishes it.
- **`climbing-logbook`:** the dependency, the `.npmrc` scope and the imports
  change.
- **`ravendarque-beyond-borders`:** after the transfer, confirm the Pages
  custom domain and the site, and check that Cloudflare's records point at
  GitHub's Pages IPs or `oneloneraven.github.io`.

## Docs

- A runbook, `docs/runbooks/migrate-to-organisation.md`, covering the
  phases, how to resume, and the per-repository extras.
- Once all four repositories have moved, the personal `Project template`
  is deleted (D22).

## Out of scope

- Moving private repositories or `claude-project-bootstrap`.
- Standardising the boards' fields.
