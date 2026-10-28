# Module: core

Always selected. Stack-agnostic: the workflow, release machinery, standards,
privacy and security docs, licence and Claude configuration every project
gets.

## 1. Depends on

Nothing.

## 2. Interview questions

Core's questions are the project basics asked by the orchestrator: name,
description, GitHub owner and visibility.

## 3. Files

- `CLAUDE.md`: the index of one-line rules; stack modules add lines under
  "Stack".
- `docs/`: workflow, versioning, coding standards (stack modules add their
  sections), definition of done, privacy, record of processing, threat
  model, working with Claude, ADRs 0001 and 0002, incident runbooks.
- `SECURITY.md`, `README.md`, `LICENSE.md`, `LICENSE-SCHEDULE.md`,
  `.gitignore`.
- `.claude/settings.json` (blocks edits while on `main`) and the
  `engineering-standards` skill.
- `.github/`: see section 4.

## 4. GitHub configuration

Run in order, one command at a time, at least a second apart. Each numbered
item is step `github:core:<n>`. The JSON payloads are rendered into
`.bootstrap/github/` (the private variant of `repo-settings.json` leaves out
the security features a private repo can't use).

1. Repo settings: `gh api -X PATCH repos/$R --input .bootstrap/github/repo-settings.json`.
2. Private vulnerability reporting (public repos only):
   `gh api -X PUT repos/$R/private-vulnerability-reporting`.
3. Labels: for each entry in `.bootstrap/github/labels.json`,
   `gh label create "<name>" --repo $R --color <color> --description "<description>"`.
4. Ruleset (on a free private repo, skip it as the plan said and record it with `state.mjs skip`):
   `gh api -X POST repos/$R/rulesets --input .bootstrap/github/ruleset.json`.
5. Board. Look for an existing project titled `<name>` first
   (`gh project list --owner <owner> --format json`); create it only if
   there's none:
   - `gh project create --owner <owner> --title "<name>" --format json`;
     record `project_number` and `project_id`;
   - `gh project link <number> --owner <owner> --repo $R`;
   - read the Status field (`gh project field-list <number> --owner <owner> --format json`)
     and record `status_field_id`;
   - set its options to Backlog, Ready, In Progress, In Review, Done with the
     `updateProjectV2Field` GraphQL mutation (only if they differ: the
     mutation regenerates option ids);
   - re-read the field list and record `in_progress_option` and
     `in_review_option`.
6. Repository variables for the board sync workflow, from the recorded ids:
   `gh variable set PROJECT_ID`, `PROJECT_STATUS_FIELD_ID`,
   `PROJECT_IN_PROGRESS_OPTION` and `PROJECT_IN_REVIEW_OPTION`, each with
   `--repo $R --body <value>`.

Verify: `gh api repos/$R/rulesets` lists `default-branch-protection` as
`active` (unless skipped); `gh label list --repo $R` shows the four release
labels; `gh variable list --repo $R` shows the four project variables.

## 5. Manual steps

### core:1 Create the release GitHub App

**Why:** a tag pushed with the default workflow token doesn't trigger other
workflows, so releases (and deploys) would never fire.

**Do:**
1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Name: `<slug>-release`. Homepage URL: the repository URL. Untick
   Webhook → Active.
3. Repository permissions: Contents → Read and write. Nothing else.
4. "Where can this GitHub App be installed?": Only on this account.
5. Create it, note the Client ID, then Generate a private key (a `.pem`
   downloads).
6. Install App → choose Only select repositories → this repository.
7. Run:
   `gh variable set RELEASE_APP_CLIENT_ID --repo <owner>/<slug> --body <client id>`
   `gh secret set RELEASE_APP_PRIVATE_KEY --repo <owner>/<slug> < <path to .pem>`
8. Delete the downloaded `.pem`.

**Verify (Claude runs):** `gh variable list --repo $R` and
`gh secret list --repo $R`
**Expected:** `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY` listed.

### core:2 Create the board sync token

**Why:** the workflow token can't reach Projects v2, and a GitHub App can't
reach a board owned by a personal account.

**Do:**
1. GitHub → Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token.
2. Note: `<slug> board sync`. Expiration: 1 year. Scope: `project` only.
3. Run: `gh secret set PROJECT_STATUS_PAT --repo <owner>/<slug>` and paste
   the token when prompted.

**Verify (Claude runs):** `gh secret list --repo $R`
**Expected:** `PROJECT_STATUS_PAT` listed.

### core:3 Turn on the board's built-in workflows

**Why:** Done and archiving are handled by GitHub's own project workflows,
which the API can read but not create or configure.

**Do:** open the project → ⋯ → Workflows, and enable:
1. **Item added to project**: set Status to Backlog.
2. **Item closed**: set Status to Done.
3. **Pull request merged**: set Status to Done.
4. **Auto-add to project**: this repository, filter `is:issue`.
5. **Auto-archive items**: filter `is:closed updated:<@today-2w`, so closed
   items leave the board two weeks after they close.

**Verify (Claude runs):**
`gh api graphql -f query='query($n:Int!){ user(login:"<owner>"){ projectV2(number:$n){ workflows(first:20){ nodes{ name enabled } } } } }' -F n=<project_number> --jq '.data.user.projectV2.workflows.nodes[] | select(.enabled) | .name'`
**Expected:** the five names above are listed. The API doesn't expose each
workflow's settings, so check the Status values and filters with the user.
