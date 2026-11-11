# Automate the board and the secrets: design

## Intent

Bootstrapping a project leaves the user a long run of manual steps:
creating the release GitHub App, a board token, Android signing keys and
Cloudflare tokens, and setting up the board's views and workflows by hand.
Most of that can be automated. This design automates two things:

1. **The board.** New projects get a board laid out like the reference
   board's (its views, fields and workflows), made by copying a template
   board instead of creating an empty one.
2. **Secrets.** One script, run by the user in their own terminal, creates
   or collects each credential, stores it in the user's password manager
   (the Dev vault) and sets the GitHub secret or variable. No secret ever
   passes through the conversation.

## Goals

- A new board arrives with the reference board's views, fields and workflows.
  The only board step left by hand is turning on Auto-add, which GitHub
  never copies.
- Each secret-bearing manual step becomes "run this command". Clicks stay
  only where GitHub or Cloudflare offer no API.
- Every credential the script handles is in the Dev vault when it finishes,
  so a rebuild or a yearly rotation never depends on a downloaded file.

## Non-goals

- The DNSSEC DS record (`cloudflare-opentofu:5`): it's registrar-specific.
- Preview URLs (`cloudflare-opentofu:6`) and the signed APK check
  (`android-toolchain:2`): neither handles a secret.
- Any password manager other than the user's.
- Orchestrating the steps: the script runs one step per invocation, and
  the skill still walks the steps in order.

## Anti-goals

- A secret on a command line, in an environment variable visible to other
  processes, in the conversation, in a log or in a file left on disk. Only
  the keystore may exist on disk, briefly, because `keytool` needs a file.
- Claude running the script. The user runs it; Claude runs the
  verification afterwards.
- Personal details in anything the script creates (the keystore's DN, Pass
  item titles, App names).
- A board that silently differs from the template.

## Background findings

Verified on 2026-11-08:

- GraphQL's `createProjectV2View` only takes name, layout, filter and
  visible fields. It can't set group-by or sort.
- `copyProjectV2` works on a personal account. A copy of the reference
  board (made and then deleted on 2026-11-08) kept:
  - every field and option;
  - every view, with its filters, columns, group-by and sorts;
  - every workflow except Auto-add.

  Two things didn't match: the view order differed, and the user found
  Auto-add switched off on the copy (it needs a repository anyway).
- The API reports whether each workflow is enabled, not how it's
  configured. The user checked the copy's settings by eye, and they
  matched.
- GitHub's App manifest flow returns the App's id, client id and private
  key from `POST /app-manifests/{code}/conversions`. The user still clicks
  "Create" and then installs the App.
- There's no API to create a classic personal access token.
- Cloudflare account-owned tokens can be created through the API. R2's S3
  credentials come from a token's `id` (the access key ID) and the SHA-256
  of its `value` (the secret access key), and can be scoped to one bucket.
- `pass-cli` 2.7.0 can create items from JSON on stdin
  (`--from-template -`) and generate passwords. It can download attachments
  but not upload them.

## Part 1: the board

### The template board

- **What it is:** a private project on the owner's account titled
  `Project template`, with no items. It's cut once from the reference board's
  board with `copyProjectV2` and then changed only on purpose. The
  bootstrap never copies the reference board's live board.
- **Fields:**
  - Status: Backlog, Ready, In progress, In review, Done
  - Priority: P0, P1, P2
  - Size: XS, S, M, L, XL
  - Estimate: a number
- **Views:**
  1. **Board**: board layout, columns by Status, sorted by Priority
     ascending. It shows Title, Assignees, Status, Linked pull requests,
     Sub-issues progress, Priority, Size and Estimate.
  2. **No parent epic**: a table filtered on
     `no:parent-issue AND -title:[EPIC]* AND is:open`.
  3. **Epics**: a table filtered on `title:[EPIC]* AND is:open`, sorted by
     Status ascending.
  4. **Bugs & Chores**: a table filtered on
     `(title:[BUG]* OR title:[CHORE]*) AND is:open`.

  All three tables show Title, Assignees, Status, Linked pull requests and
  Sub-issues progress.
- **Workflows, all enabled:**
  - Auto-add sub-issues to project
  - Auto-close issue
  - Item added to project
  - Item closed
  - Pull request linked to issue
  - Pull request merged
  - **Auto-archive items**, filter `is:closed updated:<@today-2w`. This
    one is new: the reference board doesn't have it, and the user wants it
    kept. Nobody has checked yet whether a copy keeps it, so the first
    copy from the template must check.
  - Auto-add is set on each copy, not on the template.
- **Runbook:** a new `docs/runbooks/board-template.md` in this repository
  covers how to cut the template, how to change it, and how to check a
  copy. It must not name or link the source project; "a reference board"
  is enough.

### Bootstrap changes (core)

- **GitHub configuration step 5** becomes:
  1. Look for an existing project titled `<name>`, as now. If one exists,
     don't copy.
  2. Look up the template by its exact title (`gh project list --owner
     <owner>`).
  3. `copyProjectV2` with `includeDraftIssues: false`, then
     `updateProjectV2` to make it private. Record `project_number` and
     `project_id`.
  4. `gh project link`, as now.
  5. Read the Status field. Record `status_field_id`, and the option ids
     for "In progress" and "In review".
  6. Drop the `updateProjectV2Field` options rewrite. Instead, fail
     loudly if the options aren't exactly Backlog, Ready, In progress,
     In review, Done.
- **No template found:** the plan phase says so as a plan warning. The
  user then chooses between stopping to create one and today's path: an
  empty board with the Status options set, and every workflow and view
  left as manual steps.
- **Manual step `core:3`** shrinks to turning on Auto-add (this
  repository, filter `is:issue`). Its verification checks that the enabled
  workflows are exactly the eight above, Auto-add included. It still asks
  the user to confirm the Auto-add filter and the auto-archive filter by
  eye, because the API can't read them.
- **Status spelling:** "In Progress" and "In Review" become the reference board's "In
  progress" and "In review" everywhere: `docs/workflow.md`, the SKILL.md
  first-PR step and core's MODULE.md. The board sync workflow uses option
  ids, so it doesn't change.
- **Generated docs:** `docs/workflow.md` explains the board:
  - the four views;
  - the Priority, Size and Estimate fields;
  - the `[EPIC]`, `[BUG]` and `[CHORE]` title prefixes the views rely on;
  - that epics are parent issues with sub-issues.

  Without this, the epic and bug views stay empty.

## Part 2: the secrets script

### Shape

- **File:** `skills/bootstrap/scripts/secrets.mjs`. It's Node with no
  dependencies, like the plugin's other scripts. The script stays in the
  plugin and isn't rendered into generated repositories. The generated
  repository's disaster-recovery docs say how to run it from the plugin.
- **Invocation:** `node <plugin>/skills/bootstrap/scripts/secrets.mjs
  <step> <project dir> [--vault Dev] [--rotate]`.
  - The steps are `release-app`, `board-token`, `android-keystore`,
    `cloudflare-tokens` and `cloudflare-r2`.
  - It reads owner, slug, name, zone and skipped environments from the
    bootstrap state in `<project dir>/.bootstrap/`, and refuses to run
    without them.
- **Preflight:** before any step, it checks `gh auth status` and
  `pass-cli info`, and the step's own tools (`keytool` for Android).
- **Idempotence:**
  - Without `--rotate`, a step whose GitHub secrets already exist reports
    that and does nothing.
  - With `--rotate`, it makes a new credential, creates a new Pass item,
    and overwrites the secrets. Only then does it move the old item to the
    bin (`pass-cli item trash`), where it can still be recovered.
    Rotation is the same code path, so the yearly token expiry is one
    command.
- **Writing secrets:**
  - GitHub: `gh secret set` and `gh variable set` read the value from
    stdin (`--env` where the module says so, or at repository level where
    state records the environment as skipped).
  - Pass: `pass-cli item create custom --from-template -`, with JSON on
    stdin and secrets in hidden fields. Never use `pass-cli item update`:
    it only takes values as `--field name=value` arguments.
  - No secret is ever an argument or an inherited environment variable.
- **Pass items:**
  - Each project gets a folder named `<slug>` in the vault. The script
    finds or creates it with `pass-cli folder list` and
    `pass-cli folder create`.
  - There's one item per credential in that folder, titled by purpose
    (for example `release App`) and created with `--folder-id`.
  - Each item records:
    - which GitHub secrets hold the value;
    - when it was created;
    - when it expires, where it does.
- **Failure:** a step that fails partway reports exactly what it created
  and where, so nothing is orphaned without the user knowing. A credential
  is stored in Pass before it's set in GitHub, so a failure never leaves a
  secret that exists only in GitHub.

### Steps

#### `release-app` (replaces `core:1`)

1. Start an HTTP server on `127.0.0.1` on a random port. Open the
   browser at a local page that posts the manifest to
   `https://github.com/settings/apps/new`, with a random `state` value.
   - Name: `<slug>-release`. URL: the repository URL.
   - Webhook inactive. `public: false`.
   - Permissions: contents write and workflows write, nothing else.
   - Redirect: back to the local server.
2. The user clicks "Create GitHub App".
3. Check the callback's `state`, then exchange the code (within the hour)
   for the App's id, client id and PEM.
4. Store them in Pass.
5. Set `RELEASE_APP_CLIENT_ID` (variable) and `RELEASE_APP_PRIVATE_KEY`
   (secret).
6. Open the App's install page and tell the user to install it on this
   repository only.
7. Confirm the installation covers exactly this repository, using a JWT
   signed with the PEM (Node `crypto`, RS256): first
   `GET /app/installations`, then the installation's repositories.

The server listens only on `127.0.0.1`, accepts exactly one callback with
the matching state, then shuts down.

#### `board-token` (replaces `core:2`)

1. Open `https://github.com/settings/tokens/new` with the `project` scope
   and the note `<slug> board sync` prefilled. The user sets a one-year
   expiry and generates the token.
2. Read the token from a hidden prompt.
3. Check it with `GET /user`: the `X-OAuth-Scopes` header must be exactly
   `project`. Read its expiry from the
   `GitHub-Authentication-Token-Expiration` header.
4. Store it in Pass, then set `PROJECT_STATUS_PAT`.

#### `android-keystore` (replaces `android-toolchain:1`, steps 1 and 3)

1. Generate a random password with Node `crypto`.
2. Run `keytool -genkeypair` with `-storepass:env` and `-keypass:env`, so
   the password never appears as an argument. Settings: alias `upload`,
   RSA 4096, validity 10000 days, DN `CN=<name>` only. The keystore goes in
   a fresh `mkdtemp` directory with mode 0600.
3. Store the password, the alias and the keystore (base64, in a hidden
   field) in Pass.
4. Set the four `release` environment secrets.
5. Delete the temporary directory.
6. Remind the user that the offline backup is still theirs to make, and
   that the Pass item is enough to make it.

Unverified: whether a Pass hidden field takes a base64 keystore (about
4 to 5 KB). The builder checks this first. If it doesn't, the script
writes the keystore to a path the user picks, and tells them to attach it
to the Pass item in the app.

#### `cloudflare-tokens` (replaces `cloudflare-opentofu:1`)

1. **Bootstrap token:** the user makes one in the dashboard. It's an
   account-owned token whose only permission is Account API Tokens Write,
   expiring within a day. The script reads it from a hidden prompt.
2. **Ids:** look up the account id and zone id (by `zone_name`), and the
   permission group ids by name (`GET
   /accounts/<id>/tokens/permission_groups`).
3. **The four tokens:** create Preview, Deploy, Infra plan and Infra apply
   as account-owned tokens, each with a one-year expiry, scoped to the
   account and to the zone for zone permissions.
   - Their permissions come from one data file rendered into
     `.bootstrap/cloudflare/tokens.json`.
   - A test keeps `infra/README.md`'s table and that file in agreement.
   - "The read-only version of each infra apply permission" becomes an
     explicit list in the data file.
4. **Check them:** read each new token back with `GET
   /accounts/<id>/tokens/<token id>`, and confirm the policies are the
   ones requested. This is the README's own rule: trust the API, not the
   dashboard.
5. **Store and set:** put each token in Pass, then set its secret in the
   right environment.
6. **Revoke the bootstrap token:** use the bootstrap token to delete
   itself, and tell the user it's gone.

#### `cloudflare-r2` (replaces `cloudflare-opentofu:3`)

- Run after `bootstrap-state.yml` has created the bucket, as today's order
  requires. It needs a fresh bootstrap token, prompted and revoked the same
  way.
- Create two account-owned tokens scoped to
  `com.cloudflare.edge.r2.bucket.<account>_default_<slug>-tfstate`: one
  with Workers R2 Storage Bucket Item Write, one with Item Read.
- Derive the S3 pairs (the token id, and the SHA-256 of the value).
- Store each pair in Pass, then set the read-write pair in `infra` and the
  read-only pair at repository level, as the module says today.

### Docs changes

- Each replaced manual step's **Do** in MODULE.md becomes the command to
  run, followed by the clicks it still needs. Its **Verify** stays as
  Claude's `gh secret list` checks. The step-by-step dashboard instructions
  move to a "By hand" fallback under the same step. The generated
  repository's setup and disaster-recovery docs carry the fallback too.
- The Cloudflare step drops "ask the user to curl each token", because
  the script checks the tokens itself.
- This repository's `docs/threat-model.md` gains the script's trust
  boundaries:
  - the localhost callback;
  - the password manager CLI;
  - the Cloudflare bootstrap token and its revocation.

### Tests

- Unit tests (with `node:test` and no network) for the pure parts:
  - building the App manifest;
  - building the Cloudflare policy from `tokens.json`;
  - deriving the S3 credentials;
  - reading state and resolving environments, including skipped ones;
  - building Pass item JSON;
  - a guard that no `spawn` or `execFile` call in the script passes a
    secret as an argument.

  The external commands are injected, so the tests can stub them.
- Rendering tests:
  - `tokens.json` agrees with the README table;
  - `docs/workflow.md` uses "In progress" and "In review";
  - `docs/workflow.md` documents the title prefixes.

## Constraints

- No dependencies (`pnpm test` runs without an install).
- British English, and the repository's coding standards: no comments by
  default.
- Pace the GitHub API calls as `docs/workflow.md` says.
- Any dependency or vendor screening needed follows ADR-0002. The script
  adds no new vendor beyond the user's password manager, but see the open
  question below.

## Settled after review (designer's calls)

### State, steps and the vault

- **Inputs:**
  - Owner, slug, name and zone come from the state's `answers`.
  - Skipped environments get a structured record: `github:cloudflare-opentofu:1`
    also runs `state.mjs record <dir> skipped_envs <comma list>`. The
    script reads that and never parses free-text skip reasons.
  - The script never marks steps done. Claude runs each step's
    verification and marks it, as now.
- **Step ids:** they stay the same, so `core:1`, `core:2`,
  `android-toolchain:1`, `cloudflare-opentofu:1` and `cloudflare-opentofu:3`
  keep their ids and order. Only their **Do** text changes.
- **Vault:**
  - `Dev` is the default, and `--vault` overrides it.
  - Items are found by exact title within the project's folder. Two or
    more active items, or two or more folders named `<slug>`, is an
    error.
  - On `--rotate` with no earlier item (for example, secrets that were set
    by hand), the script creates one and has nothing to trash.
  - Without `--rotate`, an item left by a failed earlier run stops the
    step before anything is created, and the error says to re-run with
    `--rotate`.
  - The preflight checks that `pass-cli` exists and is logged in, and
    stops if it isn't.

### Rotation

A new credential is created and verified, then written to a new Pass
item, then set in GitHub. Only after that is the old item moved to the
bin. Duplicate checks count active items only. Old credentials are handled
per step:

- **Cloudflare:** the old token ids are recorded in the Pass item. The old
  tokens are revoked only after the new secrets are set.
- **Board token:** there's no API to revoke a classic PAT. The script
  tells the user to delete the old one.
- **Release App:** `--rotate` isn't supported. App keys don't expire, and
  GitHub has no API to generate a key. The "By hand" fallback covers it.

### Cloudflare bootstrap token

- **Check first:** the builder's first task is a manual check against a
  real account. It confirms that a token holding only Account API Tokens
  Write can list permission groups, create tokens with permissions it
  doesn't hold itself, and delete itself.
- **If any of that fails, stop and come back.** Don't redesign around it.
- **Zone resource:** `com.cloudflare.api.account.zone.<zone id>`.

### Template board

- **Lookup:** the template is looked up on the repository owner's account.
  Several projects with that title is an error.
- **Auto-archive:** if a copy doesn't keep Auto-archive, `core:3` gains
  "turn on Auto-archive with the filter" alongside Auto-add. Either way,
  the verification expects the eight workflows enabled.

### Release App

The user can edit the App name on GitHub's page, for example on a name
collision. The script uses whatever name and ids the conversion returns.

### Already answered

`.bootstrap/` is gitignored (core's `.gitignore`, tested), and
`tokens.json` holds policies only, never secrets.

## Decided by the user

- **The password manager is Proton Pass (`pass-cli`).** It may be named in
  public code and docs.
- **Folders:** each project's credentials go in a folder of their own in
  the vault.

## Left to the builder

- The local page's markup, the prompts' wording, and the exact layout of
  each Pass item.
- How the script finds the plugin path for the docs.
- How stubs get injected in the tests.
