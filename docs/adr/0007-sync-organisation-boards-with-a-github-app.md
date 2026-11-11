# 7. Sync organisation boards with a GitHub App

## Status

Accepted.

## Context

The board sync workflow (`project-status-sync.yml`) moves an issue to In
progress when its branch is created, and to In review when its PR opens.
`GITHUB_TOKEN` can't reach Projects v2, and a GitHub App can't reach a
board owned by a personal account. So the sync has used a classic personal
access token, `PROJECT_STATUS_PAT`, scoped to `project` and rotated every
year.

New projects now belong to the `oneloneraven` organisation (#74). A GitHub
App can reach an organisation's boards through the organisation Projects
permission. A live check on 2026-11-11 confirmed this: an installation
token ran `updateProjectV2ItemFieldValue` against an organisation board.

The organisation is on GitHub Free. There, organisation secrets are
readable by public repositories, but not by private ones.

## Decision

- **One App per organisation.** Each organisation gets one App,
  `<org>-board-sync`, with:
  - organisation Projects: read and write;
  - repository Issues: read;
  - no webhook;
  - an installation on all of the organisation's repositories.
- **Credentials at organisation level.** The App's key is the organisation
  secret `BOARD_SYNC_APP_PRIVATE_KEY`, and its client id is the
  organisation variable `BOARD_SYNC_APP_CLIENT_ID`. Both are visible to
  every repository.
- **Made once, by script.** `secrets.mjs board-app` creates the App through
  the manifest flow, stores it in Pass, sets the secret and variable, and
  checks the installation. For a private repository on Free,
  `secrets.mjs board-app-repo` copies the key and client id onto the
  repository itself.
- **The workflow mints its own token.** For an organisation owner,
  `project-status-sync.yml` mints a token with
  `actions/create-github-app-token`. Personal-account owners keep the PAT
  version.
- **The release App stays separate.** It's per repository and can push
  tags and change workflows. Giving it board access across the
  organisation would widen what a leaked key can do.

## Consequences

- **Less to do for a new public repository.** It needs no board-sync
  credential at all, and there's no yearly token rotation for organisation
  boards.
- **A leaked key reaches every board.** It could change any board in the
  organisation, and read issues in every repository. Installation tokens
  last an hour, and the key lives only in the organisation secret and in
  Pass.
- **Bootstrapping into an organisation needs more gh scope.** The gh token
  needs `admin:org` to set and list organisation secrets and variables.
- **There are two workflow variants to maintain.** The tests render and
  check both.
