# 6. Automate project credentials and the board from a template

## Status

Accepted.

## Context

Bootstrapping used to end with a long run of manual steps. The user made
the release GitHub App, a board token, the Android upload keystore, and four
Cloudflare tokens plus two R2 credentials by hand, set each GitHub secret,
and then set up the board's workflows and views. Issue #69 asked for these
steps to be automated.

Facts that shaped the design:
- **Views:** GraphQL's `createProjectV2View` can't set a view's sort or
  group-by.
- **Copying a board:** `copyProjectV2` copies views, fields and every
  workflow except Auto-add, and works on a personal account.
- **The release App:** GitHub's App manifest flow returns the App's key in
  exchange for one click.
- **Classic tokens:** there's no API to create one.
- **Cloudflare:** a token holding only Account API Tokens Write can create
  scoped tokens and then delete itself. This was checked against a real
  account.

## Decision

**The board is copied from a template.** It's a private, empty project
titled `Project template` on the owner's account. Core's GitHub
configuration copies it with `copyProjectV2` instead of creating an empty
board, and the only step left by hand is turning on Auto-add.
[The runbook](../runbooks/board-template.md) covers what the template holds,
and how to change and check it.

**Credentials are made by a script the user runs.** That's
`skills/bootstrap/scripts/secrets.mjs`, with one subcommand per credential
step.
- **Storage:** each credential goes into the user's password manager first
  (Proton Pass through `pass-cli`, the `Dev` vault, one folder per
  project), and only then into GitHub.
- **No secret on a command line:** secrets travel on stdin, and to
  `keytool` through its own environment, never as arguments. The script
  never calls `pass-cli item update`, because that takes values as
  arguments.
- **Claude doesn't run it.** The user runs the script in their own terminal
  and Claude runs each step's verification, so no secret enters the
  conversation.
- **Rotation:** it's the same code path. The script creates a new
  credential, stores and sets it, then moves the old Pass item to the bin
  and revokes the old Cloudflare tokens.

Every replaced manual step keeps its old instructions under "By hand", as
a fallback.

**Screening (ADR-0002), checked on 2026-11-11:**

| Dependency | Maintainer | On a list | Note |
|---|---|---|---|
| Proton Pass CLI (`pass-cli`) | Proton AG | N | Not named in either list. It runs on the user's machine and isn't a dependency of generated repositories. |

GitHub is already recorded. Cloudflare is recorded in the
cloudflare-opentofu module's screening rows.

## Consequences

- The secrets steps are one command each, plus the clicks GitHub still
  needs: creating and installing the App, and generating the classic
  token.
- The board's shape lives in a project on the owner's account. Changing it
  is a UI change plus an update to the runbook. Projects already copied
  keep their old shape.
- The template's Status options are spelled "In progress" and "In review",
  so new projects' docs use that spelling.
- Signed-in `pass-cli` returns hidden values to any process running as the
  user, other Claude sessions included. The threat model accepts this, and
  recommends signing out of `pass-cli` when not bootstrapping.
- Transform Rules is an account-scoped Cloudflare permission, so the infra
  tokens can change Transform Rules on every zone in the account.
- Release Apps for organisation-owned repositories are created under the
  organisation (#72).
