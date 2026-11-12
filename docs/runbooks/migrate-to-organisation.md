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

## Phases

| Phase | What it does | What you do |
|---|---|---|
| `inventory` | Records the board and the repository's settings, and prints the plan. | Read the plan. |
| `transfer` | Transfers the repository and waits up to 2 minutes for it to appear. | |
| `copy-board` | Copies the old board into the organisation with its draft issues, makes the copy private, and checks every field and option arrived. | |
| `items` | Adds each issue and pull request, sets its single-select, number, text and date values, and archives it if the old item is archived. | |
| `verify` | Compares both boards item by item, re-applies any difference up to three times, and checks the draft count. | |
| `link` | Links the repository to the new board and sets the four `PROJECT_*` variables. | Turn on Auto-add for the repository with `is:issue`, then type `done`. |
| `board-sync` | Deletes `PROJECT_STATUS_PAT` once the App variant of board sync is merged. | Open a PR in the repository that switches to `project-status-sync-app.yml`, merge it, then type `done`. |
| `release-app` | Moves the old `release App` Pass item to the bin, and deletes `RELEASE_APP_PRIVATE_KEY` and `RELEASE_APP_CLIENT_ID`. | Run `secrets.mjs release-app` for the moved project, delete the old personal App, then type `done`. |
| `delete-old-board` | Deletes the personal board, only if `verify` passed. | Type the old board's exact title. |

Phases that don't apply, such as `board-sync` for a repository without the
workflow, log why and finish at once.

The script makes at most one change a second, and waits when GitHub
rate-limits it. A board of 800 items takes about an hour.

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

- **Iteration fields:** values aren't copied, so set them by hand.
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
