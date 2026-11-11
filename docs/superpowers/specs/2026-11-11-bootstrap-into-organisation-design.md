# Bootstrap into the organisation: design

Issue #74. New projects belong in the `oneloneraven` organisation, not on
a personal account. The design builds on
[the board and secrets design](2026-11-08-automate-board-and-secrets-design.md).

## Decisions

These are the user's decisions (D18, D20, D21, D22):

- The owner question defaults to `oneloneraven`, and any owner can still be
  entered.
- Personal-account owners stay supported. They keep today's PAT path for
  board sync. Organisation owners use a GitHub App.
- When a repository is private and the organisation is on GitHub Free, the
  bootstrap also sets the board-sync App's key and client id on the
  repository. On Free, private repositories can't read organisation
  secrets.
- The personal `Project template` stays until #75 has migrated everything.
  After that it's deleted.

## Findings

- `oneloneraven` is on GitHub Free and currently has only public
  repositories.
- **Organisation secrets on Free:** "Organization-level secrets and
  variables are not accessible by private repositories for GitHub Free"
  (GitHub's "Using secrets" docs).
- **Projects permission:** GitHub Apps have an organisation-level
  "Projects" permission. GitHub's permissions page lists only the REST
  ProjectsV2 endpoints under it. Before anything is built on it, a live
  check must confirm that the sync's GraphQL mutation
  (`updateProjectV2ItemFieldValue`) works with an installation token.
- **The release App stays as it is.** It's per repository and can push
  tags and change workflows. Giving every release App write access to
  every organisation board would widen what a leaked key can do.

## Design

### Owner type

- The interview records `owner_type` (`User` or `Organization`) from
  `gh api users/<owner> --jq .type`, and validation accepts only those two
  values.
- The renderer derives the boolean `owner_org`, which file `when`
  conditions can use.
- For an organisation owner on a private repository, the plan is read with
  `gh api orgs/<owner> --jq .plan.name`. If that comes back empty, the
  interview asks for it, as it does now.
- SKILL.md's "a personal account in v1" wording goes.

### The board-sync App (organisation owners)

- **One App per organisation**, named `<org>-board-sync`.
  - **Permissions:** organisation Projects (read and write) and repository
    Issues (read).
  - **Webhooks:** none.
  - **Installation:** on every repository in the organisation.
- **Where its credentials live:** the key goes in the organisation secret
  `BOARD_SYNC_APP_PRIVATE_KEY`, and the client id in the organisation
  variable `BOARD_SYNC_APP_CLIENT_ID`. Both are visible to all
  repositories.
- **Made once:** a new step, `secrets.mjs board-app <dir>`, reuses the
  release App's manifest flow with the organisation URL. It stores the App
  id, client id and key in Pass, in a folder named after the organisation,
  then sets the organisation secret and variable with
  `gh secret set --org <org> --visibility all` and
  `gh variable set --org <org> --visibility all`.
- **Install check:** the App must be installed with "All repositories"
  (`repository_selection: all`).
- **When the App already exists** (the organisation variable is set), the
  step says so and does nothing. `--rotate` isn't supported, for the same
  reason as `release-app`.
- **Private repository on Free:** a step,
  `secrets.mjs board-app-repo <dir>`, copies the key and client id from
  Pass into repository-level secrets.
- **What replaces `core:2`:**
  - for an organisation owner: "the board-sync App exists", and on a
    private repository on Free, the `board-app-repo` step;
  - for a personal owner: the `board-token` step, as now.

### Board sync workflow

`project-status-sync.yml` is rendered in two variants, picked by
`owner_org`:

- **Organisation:** an `actions/create-github-app-token` step, pinned to a
  full SHA, with `client-id: ${{ vars.BOARD_SYNC_APP_CLIENT_ID }}`,
  `private-key: ${{ secrets.BOARD_SYNC_APP_PRIVATE_KEY }}` and
  `owner: ${{ github.repository_owner }}`. Its token is the `GH_TOKEN`.
- **User:** today's PAT version, unchanged.

### Template board

- `Project template` is copied into `oneloneraven` with `copyProjectV2`.
  This is done once, live, and the copy is checked as the runbook
  describes.
- The board steps look the template up on the owner. For an organisation
  owner, that's the organisation.
- `core:3`'s Verify query uses `organization(login:)` for an organisation
  owner and `user(login:)` for a user.
- The runbook says which accounts hold a template.

### Docs

- ADR-0007 records the board-sync credential decision. ADR-0006 stays as
  it is.
- The threat model gains the board-sync App as an asset and a trust
  boundary.

## Out of scope

Moving existing repositories (#75).
