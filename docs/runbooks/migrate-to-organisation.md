# Migrate a repository to the organisation

`skills/bootstrap/scripts/migrate.mjs` moves a repository from the personal
account to the organisation, and rebuilds its board there. GitHub can't
transfer a personal board, so the script copies it and then re-adds every
issue and pull request with its field values. The design is in
`docs/superpowers/specs/2026-11-12-migrate-to-organisation-design.md`.

The transfer can't be undone. Run a dry run first, every time.

## Before you start

- `gh` is signed in as the repository's owner, with the `project` and
  `read:packages` scopes: `gh auth refresh -s project,read:packages`.
  Without `read:packages`, the plan says packages couldn't be listed.
- The organisation's board-sync App exists and is installed on all
  repositories (`secrets.mjs board-app`).
- The repository is linked to exactly one board. The script refuses
  anything else.
- The organisation has no repository with the same name.

## Running it

```bash
node skills/bootstrap/scripts/migrate.mjs <repo> --dry-run
```

The dry run only reads. It prints the old board's fields and item counts,
the repository's secret and variable names, Pages, packages, and whether
there's a release App or a board-sync workflow to switch. Read it, then run
the migration:

```bash
node skills/bootstrap/scripts/migrate.mjs <repo>
```

`--org` picks another organisation (the default is `oneloneraven`), and
`--vault` picks the Pass vault (the default is `Dev`).

`--project-dir <dir>` is the moved project's local checkout. The
`bootstrap-answers` phase then sets `owner` to the organisation and
`owner_type` to `Organization` in `<dir>/.bootstrap/state.json`, and in
`<dir>/.bootstrap/answers.json` if it exists. `secrets.mjs release-app`
reads the owner from there, so without the change it would create a
personal App again. The script refuses a directory whose project isn't the
repository being moved, before anything is transferred, and writes nothing
when the values already match. Without the flag, the final report reminds
you to change the owner by hand before `release-app`.

## Phases

| Phase | What it does | What you do |
|---|---|---|
| `inventory` | Records the board and the repository's settings, and prints the plan. | Read the plan. |
| `transfer` | Transfers the repository and waits up to 2 minutes for it to appear. | |
| `bootstrap-answers` | With `--project-dir`, points the project's bootstrap answers at the organisation. Otherwise it records a reminder. | |
| `copy-board` | Copies the old board into the organisation with its draft issues, makes the copy private, and checks every field and option arrived. | |
| `items` | Adds each issue and pull request, sets its single-select, number, text and date values, and archives it if the old item is archived. | |
| `verify` | Compares both boards item by item, re-applies any difference up to three times, and checks the draft count. | |
| `link` | Links the repository to the new board and sets the four `PROJECT_*` variables. Does the same for every other organisation repository with items on the board. | Turn on Auto-add for the repository with `is:issue`, then type `done`. |
| `board-sync` | Deletes `PROJECT_STATUS_PAT` once the App variant of board sync is merged. | Open a PR in the repository that switches to `project-status-sync-app.yml`, merge it, then type `done`. |
| `release-app` | Moves the old `release App` Pass item to the bin, and deletes `RELEASE_APP_PRIVATE_KEY` and `RELEASE_APP_CLIENT_ID`. If the Pass folder or item isn't there, it says so and creates nothing. | Delete the old personal App in your account's settings first, because App names are global and the new App can't take its name. Then run `secrets.mjs release-app` for the moved project, and type `done`. |
| `delete-old-board` | Deletes the personal board, only if `verify` passed and no other repository still has the old board as its `PROJECT_ID`. | Type the old board's exact title. |

Phases that don't apply, such as `board-sync` for a repository without the
workflow, log why and finish at once.

The script makes at most one change a second, and waits when GitHub
rate-limits it. A board of 800 items takes about an hour.

## Boards shared by more than one repository

A board can hold issues from several repositories. The `inventory` phase
lists every other repository with issue or pull request items on the old
board, and the plan prints them.

- **Already in the organisation:** `link` links each one to the new board
  and sets its four `PROJECT_*` variables. The final report says what each
  still needs, and you do these through that repository's own PR process:
  - switch to the App variant of board sync;
  - add the `add-issue` job below;
  - delete its `PROJECT_STATUS_PAT` secret.
- **Still on the personal account:** the report says so. Migrate it, or
  point its `PROJECT_*` variables at the new board by hand.
- **`delete-old-board`:** it refuses while any of those repositories still
  has the old board's id as `PROJECT_ID`. A repository that has gone, or
  can't be read, is reported and doesn't block the deletion.

GitHub Free allows one Auto-add workflow per board, and the main
repository uses it. A second repository therefore can't have its own, so
its sync workflow adds new issues itself, with an `issues: opened` trigger
and an `add-issue` job that uses the board-sync App's token. This is the
job as merged in the first shared-board repository (add `issues: opened`
to the workflow's `on:` block, and keep the existing `sync` job's `if:`
excluding that event):

```yaml
  add-issue:
    # The organisation's plan allows one Auto-add workflow per board, and this board's is used by the main repository.
    if: github.event_name == 'issues' && github.actor != 'dependabot[bot]'
    runs-on: ubuntu-26.04
    env:
      PROJECT_ID: ${{ vars.PROJECT_ID }}
      ISSUE_NODE_ID: ${{ github.event.issue.node_id }}
    steps:
      - uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        id: token
        with:
          client-id: ${{ vars.BOARD_SYNC_APP_CLIENT_ID }}
          private-key: ${{ secrets.BOARD_SYNC_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ github.event.repository.name }}
          permission-issues: read
          permission-organization-projects: write

      - name: Add the issue to the board
        env:
          GH_TOKEN: ${{ steps.token.outputs.token }}
        run: |
          # shellcheck disable=SC2016 # $project and $content are GraphQL variables
          gh api graphql -f query='
            mutation($project:ID!, $content:ID!) {
              addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
            }' -f project="$PROJECT_ID" -f content="$ISSUE_NODE_ID"
          echo "Added the issue to the board."
```

## Resuming

State lives in
`${XDG_STATE_HOME:-~/.local/state}/claude-project-bootstrap/migrate/<repo>.json`.
It records each finished phase and which new item each old item became, so
re-running the same command carries on where it stopped. Don't edit or
delete the file mid-migration: without it, the script would try the
transfer again and refuse.

If `copy-board` was interrupted after GitHub made the copy, the re-run
adopts the one organisation board with the same title. If there are two,
delete the extra one and re-run.

If `verify` still finds differences after three passes, it stops and lists
the first 20, and the old board is kept. Fix them by hand or re-run.

## What it doesn't do

The script ends by listing what's left. Typically:

- **Iteration fields:** values aren't copied, so set them by hand. Only
  single-select, number, text and date values are copied, decided by each
  field's type; built-in fields such as Title, Created, Updated and Closed
  are left to GitHub.
- **The project's bootstrap owner**, when `--project-dir` wasn't given.
- **Pages:** check the custom domain on the moved repository and that the
  site still answers. GitHub doesn't redirect Pages after a transfer, so a
  DNS record pointing at the personal account's `github.io` host must move
  to the organisation's.
- **npm packages on GitHub Packages:** the scope belongs to the owner, so
  the package needs a new name under the organisation's scope and a
  republish, and every consumer needs its dependency, `.npmrc` scope and
  imports changing. Do both through each repository's own PR process.

## After the last repository

Delete the personal account's `Project template` (see the
[board template runbook](board-template.md)).
