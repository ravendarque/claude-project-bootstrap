# Automate the board and the secrets: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** new boards are copied from a template board, and a
user-run script makes each project's credentials, stores them in Proton
Pass and sets the GitHub secrets.

**Architecture:**
- Core's GitHub configuration copies a private `Project template`
  project with `copyProjectV2` instead of creating an empty one.
- `skills/bootstrap/scripts/secrets.mjs` is a no-dependency Node CLI with
  one subcommand per credential step.
- Every external effect goes through an injected `deps` object, so the
  tests can stub it and check that no secret is ever passed as an
  argument.

**Tech Stack:** Node 22 ESM (the repository CI version), `node:test`, `node:crypto`, `node:http`,
`gh`, `pass-cli` 2.7.0, `keytool`, and the GitHub and Cloudflare REST and
GraphQL APIs.

**Spec:** `docs/superpowers/specs/2026-11-08-automate-board-and-secrets-design.md`

## Global Constraints

- No dependencies: `pnpm test` runs with no install.
- **No secret as a process argument, in an inherited environment
  variable, in a log, or in the conversation.** Secrets go to `gh` and
  `pass-cli` on stdin.
  - The one exception is `keytool`'s `-storepass:env` and `-keypass:env`,
    with variables set only in that child's own `env`.
- Never call `pass-cli item update`: it takes values as arguments.
  Rotation creates a new item, then moves the old one to the bin.
- Store a credential in Pass first, then set it in GitHub.
- The vault defaults to `Dev`, overridable with `--vault`. Each project
  gets a folder named `<slug>`, and items are titled by purpose.
- Two or more active items with the same title in the folder is an error.
  So is having no item on `--rotate`, or two or more `<slug>` folders.
- Step ids stay the same. Only each step's **Do** text changes, and the
  old instructions move to a "By hand" fallback.
- Claude never runs `secrets.mjs` and never marks steps done on the
  script's behalf.
- Nothing may name or link the reference board's source project, and
  nothing may include personal details. Run the identifier guard before
  pushing.
- British English, no comments by default, professional register.
- Pace GitHub API mutations at least a second apart.
- The status option names are exactly Backlog, Ready, In progress,
  In review, Done.

## Review Focus

1. **`gh` or `pass-cli` missing, or not signed in.** The preflight stops
   with one line naming the missing tool and the fix, before anything is
   created (Task 3: `preflight reports the missing tool`).
2. **A step re-run after it already succeeded.** Without `--rotate` it
   creates nothing and says the secrets already exist (Task 3:
   `an existing secret short-circuits without --rotate`).
3. **A failure after Pass but before GitHub.** The error names the Pass
   item it created and the secrets still unset (Task 3:
   `a GitHub failure reports what was created`).
4. **The callback hit twice, or with a wrong `state`.** Wrong `state` gets
   a 400 and the server keeps waiting. A second valid hit is ignored
   (Task 4: `callback rejects a wrong state`).
5. **An environment recorded as skipped.** Its secrets go to repository
   level (Task 3: `resolveEnv falls back to repository level for skipped
   environments`).

---

### Task 1: Cut the template board and write its runbook

This task has live actions on the user's account. Ask before each one.

**Files:**
- Create: `docs/runbooks/board-template.md`

- [ ] **Step 1: Copy the reference board.** The user names the source
  board in chat. Run `copyProjectV2` with `includeDraftIssues: false` and
  the title `Project template`. Confirm the copy is private and has
  0 items.
- [ ] **Step 2: Turn on Auto-archive.** The user does this in the UI:
  project → Workflows → Auto-archive items, filter
  `is:closed updated:<@today-2w`. Then confirm the enabled workflows:
  Auto-add sub-issues to project, Auto-archive items, Auto-close issue,
  Item added to project, Item closed, Pull request linked to issue,
  Pull request merged.
- [ ] **Step 3: Check that copies keep Auto-archive.** Copy the template
  to `zz-template-copy-check`, list its enabled workflows, check its title
  and that it has 0 items, then delete it. Record in the runbook whether
  Auto-archive survived. This decides Task 2, Step 4.
- [ ] **Step 4: Write `docs/runbooks/board-template.md`.** Cover:
  - what the template holds (the spec's fields, views and workflows);
  - how to change it on purpose;
  - how to check a copy.

  Don't name the source project.
- [ ] **Step 5: Commit** the runbook ("Add the board template runbook").

### Task 2: Copy the board from the template

**Files:**
- Modify: `skills/bootstrap/modules/core/MODULE.md` (§4 step 5, §5 `core:3`)
- Modify: `skills/bootstrap/SKILL.md` (the plan warnings, and the first-PR step's "In Progress")
- Modify: `skills/bootstrap/modules/core/templates/docs/workflow.md`
- Test: `tests/core-docs.test.mjs`

- [ ] **Step 1: Write the failing tests** in `tests/core-docs.test.mjs`:
  - `the workflow doc uses the board's status names`: matches
    `**In progress**` and `**In review**`, and doesn't match
    `/In Progress|In Review/`.
  - `the workflow doc explains the board views and title prefixes`:
    matches each of `[EPIC]`, `[BUG]`, `[CHORE]`, `Priority`, `Size`,
    `Estimate` and `No parent epic`.
- [ ] **Step 2: Run** `node --test tests/core-docs.test.mjs`. Expected:
  the two new tests FAIL.
- [ ] **Step 3: Update `workflow.md`.**
  - Use the new status spelling.
  - Add a "The board" subsection under "Issues and the board", covering:
    the four views; the Priority, Size and Estimate fields; epics as
    parent issues titled `[EPIC] …` with sub-issues; and the `[BUG] …`
    and `[CHORE] …` prefixes.
- [ ] **Step 4: Rewrite MODULE.md §4 step 5** as the spec's numbered list
  (find the existing project; look up the template by exact title on the
  owner's account, where several is an error; copy it; make it private;
  link it; read the Status ids by option name; fail if the options aren't
  exactly the five), and drop the `updateProjectV2Field` rewrite.
  - Rewrite `core:3`'s **Do** as turning on Auto-add (this repository,
    `is:issue`). If Task 1 found that copies lose Auto-archive, add
    turning it on with its filter.
  - Its **Verify** expects exactly the eight workflow names enabled, and
    asks the user to confirm both filters by eye.
- [ ] **Step 5: Update SKILL.md.**
  - Add the plan warning: when no `Project template` exists, the user
    chooses between stopping to create one (link the runbook path in this
    repository) and today's path (an empty board with the Status options
    set, and every workflow and view done by hand).
  - Change "In Progress" in the first-PR step to "In progress".
- [ ] **Step 6: Run** `pnpm test`. Expected: all PASS.
- [ ] **Step 7: Commit** ("Copy new boards from the template board").

### Task 3: Secrets CLI skeleton, context, vault and GitHub writers

**Files:**
- Create: `skills/bootstrap/scripts/secrets.mjs` (argument parsing, preflight, dispatch)
- Create: `skills/bootstrap/scripts/secrets/context.mjs`
- Create: `skills/bootstrap/scripts/secrets/vault.mjs`
- Create: `skills/bootstrap/scripts/secrets/github.mjs`
- Create: `skills/bootstrap/scripts/secrets/deps.mjs` (the real `deps`)
- Modify: `skills/bootstrap/modules/cloudflare-opentofu/MODULE.md` (github:1 fallback records `skipped_envs`)
- Test: `tests/secrets-core.test.mjs`, `tests/helpers-secrets.mjs` (a stub `deps` that records every call)

**Interfaces (produced):**
- **`deps`:**
  - `exec(cmd, args, { input?, env? }) → Promise<{ status, stdout, stderr }>`;
  - `prompt(question, { hidden }) → Promise<string>`;
  - `openUrl(url)`;
  - `fetch` (the global signature);
  - `now() → Date`;
  - `log(line)`.
- **Context:** `loadContext(dir) → { owner, slug, name, repo: "<owner>/<slug>", zoneName?, skippedEnvs: string[], answers }`.
  It reads `.bootstrap/state.json` through `loadState`. `skippedEnvs`
  comes from `ids.skipped_envs`, a comma list.
- **Environments:** `resolveEnv(ctx, env) → string | null`, which returns
  null when `env` is in `skippedEnvs`.
- **`Vault`:** `new Vault(deps, { vault, folder })`.
  - `async folderId()` finds or creates the folder, and errors on 2+.
  - `async find(title)` returns the active item id or null, and errors
    on 2+.
  - `async create(title, fields: { name, value, hidden }[], note)`
    returns the item id. It pipes custom-item JSON to
    `item create custom --from-template - --vault-name <v> --folder-id <id>`.
  - `async trash(itemId)`.
- **GitHub:**
  - `secretExists(deps, repo, name, env?) → Promise<boolean>`
  - `setSecret(deps, repo, name, value, env?)`, through
    `gh secret set <name> --repo <repo> [--env <env>]` with the value on
    stdin
  - `setVariable(deps, repo, name, value)`
- **Steps:** each is a module exporting
  `{ name, secrets: (ctx) => { name, env? }[], run(ctx, deps, { vault, rotate }) }`.
  `secrets.mjs` dispatches on `name`, and does the short-circuit
  (everything in `secrets(ctx)` already exists and `--rotate` is absent)
  before `run`.
- **Order:** `storeThenSet(deps, vault, ctx, { title, fields, note, secrets: { name, env?, value }[], variables?: { name, value }[], rotate })`
  does: create the item, set every secret, trash the previous item when
  rotating. On a GitHub failure it throws
  `Error("Stored <title> in Pass; not set: <names>")`.

- [ ] **Step 1: Write the failing tests.**
  - `loadContext reads answers and skipped_envs`.
  - `resolveEnv falls back to repository level for skipped environments`.
  - `Vault errors on two active items with one title`.
  - `Vault creates the folder once`.
  - `setSecret passes the value on stdin, never in args`.
  - `an existing secret short-circuits without --rotate`: a stub step
    whose `run` is never called.
  - `a GitHub failure reports what was created`.
  - `preflight reports the missing tool`: a stub `exec` returning
    `status 127` for `pass-cli`, with output that names `pass-cli`.
  - `rotation trashes the old item only after the secrets are set`: check
    the order of calls.
- [ ] **Step 2: Run** `node --test tests/secrets-core.test.mjs`.
  Expected: FAIL (the modules don't exist yet).
- [ ] **Step 3: Implement** the files above.
  - **CLI:** `secrets.mjs <step> <dir> [--vault <name>] [--rotate]`.
    With no or unknown arguments it prints usage and exits 2.
  - **Preflight:** `gh auth status`, then `pass-cli info`, then the step's
    `tools` (an optional array on the step module).
  - **Real `deps`:** `exec` uses `spawn` with `stdio` piped and no shell.
    `prompt` with `hidden` turns off the terminal echo through
    `readline` and `process.stdin.setRawMode`.
- [ ] **Step 4: Update the cloudflare-opentofu github:1 fallback.** It
  gains
  `node scripts/state.mjs record <dir> skipped_envs <comma list of skipped environments>`.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** ("Add the secrets script's core").

### Task 4: `release-app`

**Files:**
- Create: `skills/bootstrap/scripts/secrets/release-app.mjs`
- Modify: `skills/bootstrap/modules/core/MODULE.md` (`core:1`)
- Test: `tests/secrets-release-app.test.mjs`

**Interfaces:**
- Consumes: Task 3's `deps`, `storeThenSet` and the step shape.
- Produces:
  - `buildManifest(ctx, redirectUrl) → object`;
  - `appJwt(clientId, pem, now) → string` (RS256; `iat` is now−60 s,
    `exp` is now+540 s, `iss` is the client id);
  - `waitForCallback(deps, state) → Promise<{ code, url }>`, which listens
    on `127.0.0.1` on port 0.

- [ ] **Step 1: Write the failing tests.**
  - `buildManifest asks for contents and workflows write only`:
    `default_permissions` deep-equals
    `{ contents: "write", workflows: "write" }`, `public` is false,
    `hook_attributes.active` is false, and `name` is `<slug>-release`.
  - `appJwt verifies with the public key`: generate a key pair in the
    test.
  - `callback rejects a wrong state`: the server answers 400, then
    resolves on the right state.
  - `release-app stores the PEM before setting the secret, and never
    passes it as an argument`: run the full step on a stubbed `deps`. The
    stubbed conversion returns `{ id, client_id, pem, html_url }`. Assert
    that no `exec` argument includes the PEM.
  - `release-app has no --rotate`: it exits with the "By hand" pointer.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the step.**
  1. The local page auto-posts a form to
     `https://github.com/settings/apps/new?state=<random>`, with a
     `manifest` field.
  2. Exchange the code with
     `deps.fetch("https://api.github.com/app-manifests/<code>/conversions", { method: "POST" })`.
  3. Store the Pass item `release App` with the fields App id, client id
     and private key (hidden).
  4. Set `RELEASE_APP_PRIVATE_KEY` and the variable
     `RELEASE_APP_CLIENT_ID`.
  5. Open `<html_url>/installations/new`.
  6. Poll `GET /app/installations` with the JWT, every 5 s for up to
     10 minutes. Then fetch an installation token and check that
     `GET /installation/repositories` is exactly `[repo]`. If it isn't,
     tell the user to set "Only select repositories" to this one, and
     exit non-zero.
- [ ] **Step 4: Rewrite `core:1`.** **Do:** run
  `node <skill dir>/scripts/secrets.mjs release-app <project dir>`, click
  "Create GitHub App", then install it on this repository only. Move the
  old steps under "By hand". **Verify** stays as it is.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** ("Automate the release App with the manifest flow").

### Task 5: `board-token`

**Files:**
- Create: `skills/bootstrap/scripts/secrets/board-token.mjs`
- Modify: `skills/bootstrap/modules/core/MODULE.md` (`core:2`)
- Test: `tests/secrets-board-token.test.mjs`

- [ ] **Step 1: Write the failing tests.**
  - `tokenUrl prefills the scope and note`: equals
    `https://github.com/settings/tokens/new?scopes=project&description=sample-project%20board%20sync`.
  - `checkToken accepts exactly the project scope`: `X-OAuth-Scopes:
    project` passes, and `project, repo` throws "must have only the
    project scope".
  - `checkToken returns the expiry header`.
  - `board-token never passes the token as an argument`: a full stubbed
    run.
  - On `--rotate`, the step logs "Delete the old token at
    https://github.com/settings/tokens".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `tokenUrl(ctx)`,
  `checkToken(deps, token) → { expires }` (`GET https://api.github.com/user`
  with `Authorization: token <t>`) and the step. The Pass item is
  `board sync token`, with an expiry field. Set `PROJECT_STATUS_PAT`.
- [ ] **Step 4: Rewrite `core:2`** the same way as Task 4, Step 4.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** ("Automate the board sync token").

### Task 6: `android-keystore`

**Files:**
- Create: `skills/bootstrap/scripts/secrets/android-keystore.mjs`
- Modify: `skills/bootstrap/modules/android-toolchain/MODULE.md` (`android-toolchain:1`)
- Test: `tests/secrets-android-keystore.test.mjs`

- [ ] **Step 1: Check the field size limit.** First ask the user's OK to
  create, then delete, the item `zz-field-size-check` in `Dev`. Store a
  6 KB random base64 string in a hidden field. Then check it round-trips
  with `pass-cli item view --output json`; the user runs this if agent
  sessions can't see secrets. Record the result in the task notes. If it
  doesn't round-trip, use the spec's fallback: write the keystore to a
  path the user picks, and tell them to attach it in the app.
- [ ] **Step 2: Write the failing tests.**
  - `keytool gets the password only through its own env`: args include
    `-storepass:env` and `-keypass:env`; the password isn't in args;
    `env` holds it; the DN is exactly `CN=<name>`; and the args include
    `-keyalg RSA -keysize 4096 -validity 10000 -alias upload`.
  - `the keystore directory is removed even when keytool fails`.
  - `four release secrets, or repository level when release is skipped`.
  - `the step reminds the user about the offline backup`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement it.**
  - The password is `randomBytes(32).toString("base64url")`.
  - `mkdtemp` under `os.tmpdir()`, with mode 0700 on the directory and
    0600 on the keystore.
  - The Pass item is `upload keystore`, holding the password, the alias
    and the keystore (base64).
  - Set the secrets `ANDROID_KEYSTORE_BASE64`,
    `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`) and
    `ANDROID_KEY_PASSWORD` (the same password).
  - The step's `tools` is `["keytool"]`.
- [ ] **Step 5: Rewrite `android-toolchain:1`.** **Do:** run the step,
  then make the offline backup from the Pass item. Move steps 1 and 3
  under "By hand".
- [ ] **Step 6: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 7: Commit** ("Automate the Android upload keystore").

### Task 7: Check the Cloudflare bootstrap token (stop here if it fails)

**Files:** a throwaway script in the session scratchpad. It isn't
committed.

- [ ] **Step 1: Write the check script.** It reads a token from a hidden
  prompt and the account id from an argument, then:
  1. `GET /accounts/<id>/tokens/verify` to get its own id;
  2. `GET /accounts/<id>/tokens/permission_groups`;
  3. `POST /accounts/<id>/tokens`, creating a token with `Zone: DNS Read`
     that expires in an hour;
  4. delete that token;
  5. delete itself.

  It prints only pass or fail per check, and the names of the permission
  groups the spec needs. Those are the eleven in Task 8's
  `tokens.json`, plus `Workers R2 Storage Bucket Item Write` and
  `Workers R2 Storage Bucket Item Read`.
- [ ] **Step 2: The user runs it.** They first make, in the dashboard, an
  account-owned token with only Account API Tokens Write, expiring today.
  They run the check in their own terminal.
- [ ] **Step 3: Read the result.** If any check fails, or a permission
  group name differs, **stop and report it to the user.** Don't start
  Task 8. Confirm the bootstrap token was revoked.

### Task 8: `cloudflare-tokens`

**Files:**
- Create: `skills/bootstrap/modules/cloudflare-opentofu/templates/bootstrap/cloudflare-tokens.json`, rendered to `.bootstrap/cloudflare/tokens.json` (a manifest `files` entry)
- Create: `skills/bootstrap/scripts/secrets/cloudflare.mjs` (the shared API client and bootstrap-token handling)
- Create: `skills/bootstrap/scripts/secrets/cloudflare-tokens.mjs`
- Modify: `skills/bootstrap/modules/cloudflare-opentofu/manifest.json`, `MODULE.md` (`cloudflare-opentofu:1`), `templates/infra/README.md` (Setup step 2 and the plan token row)
- Test: `tests/secrets-cloudflare.test.mjs`, `tests/cloudflare.test.mjs`

**Interfaces (produced):**
- `cfClient(deps, token) → { get(path), post(path, body), del(path) }`
  calls `https://api.cloudflare.com/client/v4`. It throws on
  `success: false`, with the API's error messages but never the token.
- `withBootstrapToken(deps, fn)` prompts for the token, runs `fn(client)`,
  and in `finally` deletes the token itself (verify, then delete).
- `buildPolicies(entry, { accountId, zoneId }, groupIdsByName) → policy[]`.
  - The account resource is
    `com.cloudflare.api.account.<accountId>`.
  - The zone resource is
    `com.cloudflare.api.account.zone.<zoneId>`.

**`tokens.json` shape:**
`[{ "token": "Preview", "secret": "CLOUDFLARE_PREVIEW_TOKEN", "env": null, "account": [...], "zone": [...] }, ...]`.
The deploy token's `env` is `["production"]`, plus `"beta"` when
`{{beta}}`. Render that through the existing `when` mechanism with two
template files if a single file can't express it.

| Token | Account | Zone |
|---|---|---|
| Preview | Workers Scripts Write, Account Settings Read | (none) |
| Deploy | Workers Scripts Write, Account Settings Read | Workers Routes Write |
| Infra plan | Workers R2 Storage Read | DNS Read, Zone Settings Read, Zone WAF Read, Transform Rules Read, Cache Settings Read |
| Infra apply | Workers R2 Storage Write | DNS Write, Zone Settings Write, Zone WAF Write, Transform Rules Write, Cache Settings Write |

These names are the API's ("Write" where the dashboard says "Edit").
Correct them to whatever Task 7 printed.

- [ ] **Step 1: Write the failing tests.**
  - `buildPolicies scopes zone permissions to the zone only`.
  - `every rendered token entry matches the README table`: parse
    `infra/README.md`'s table and compare each token's secret and
    environments with `tokens.json`, rendering both with and without
    beta.
  - `the README lists the infra plan token's permissions explicitly`.
  - `cloudflare-tokens creates four tokens, reads each back, stores, then
    sets`: a stubbed run where the read-back equals the requested
    policies.
  - `a read-back mismatch stops before Pass`.
  - `the bootstrap token is deleted even when a create fails`.
  - `no token value appears in exec args`.
  - `rotation revokes the old token ids recorded in the previous item
    after the secrets are set`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Look up the zone and account with
    `GET /zones?name=<zoneName>`, which gives `result[0].id` and
    `result[0].account.id`.
  - Every token expires one year out (`expires_on`, ISO, from
    `deps.now()`).
  - Each Pass item is `Cloudflare <token> token` and holds the token
    value (hidden) and the token id. The id is what rotation needs.
  - Environment secrets go through `resolveEnv`.
  - Also set `CLOUDFLARE_ACCOUNT_ID` as a variable.
- [ ] **Step 4: Update the docs.**
  - Rewrite `cloudflare-opentofu:1`. **Do:** make the bootstrap token
    (only Account API Tokens Write, expiring today), then run the step.
    Drop the curl verification. Move the dashboard steps under
    "By hand".
  - Change the README's Setup step 2 to name the script, and spell out
    the plan token row.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** ("Automate the Cloudflare API tokens").

### Task 9: `cloudflare-r2`

**Files:**
- Create: `skills/bootstrap/scripts/secrets/cloudflare-r2.mjs`
- Modify: `skills/bootstrap/modules/cloudflare-opentofu/MODULE.md` (`cloudflare-opentofu:3`), `templates/infra/README.md` (R2 section)
- Test: `tests/secrets-cloudflare.test.mjs`

- [ ] **Step 1: Write the failing tests.**
  - `s3Credentials derives the key id and the SHA-256 secret`:
    `s3Credentials({ id: "abc", value: "secret" })` deep-equals
    `{ accessKeyId: "abc", secretAccessKey: "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b" }`.
  - `bucketResource names the default jurisdiction`: equals
    `com.cloudflare.edge.r2.bucket.<account>_default_sample-project-tfstate`.
  - `read-write goes to infra and read-only to repository level`, and
    both go to repository level when `infra` is skipped.
  - `no secret appears in exec args`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `s3Credentials`, `bucketResource` and the
  step.
  - It uses `withBootstrapToken` from Task 8.
  - The Pass items are `R2 state read-write` and `R2 state read-only`.
  - The secrets are `TF_STATE_ACCESS_KEY_ID`,
    `TF_STATE_SECRET_ACCESS_KEY`, `TF_STATE_READ_ACCESS_KEY_ID` and
    `TF_STATE_READ_SECRET_ACCESS_KEY`.
- [ ] **Step 4: Update the docs.** Rewrite `cloudflare-opentofu:3`
  (Do, then By hand), and point the README's R2 section at the script.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** ("Automate the R2 state credentials").

### Task 10: Threat model, contract docs and the PR

**Files:**
- Modify: `docs/threat-model.md`
- Modify: `skills/bootstrap/reference/manual-step-format.md` (document the "By hand" fallback subsection)

- [ ] **Step 1: Update the threat model.** Add a row for each new trust
  boundary in its existing format:
  - the localhost callback (spoofing: mitigated by `state`, `127.0.0.1`
    only and a single use);
  - the password manager CLI (stdin only, never argv);
  - the Cloudflare bootstrap token (it can mint any token: same-day
    expiry, and it deletes itself).
- [ ] **Step 2: Update the step format.** Add the "By hand" subsection
  to `manual-step-format.md`.
- [ ] **Step 3: Run the checks.** Run `pnpm test`, then
  `IDENTIFIER_DENYLIST_FILE=<user's list> node skills/bootstrap/scripts/check-identifiers.mjs .`.
  Ask the user for the list's path. Expected: both pass.
- [ ] **Step 4: Open the PR.** Push, then open a draft PR with
  `--label "release: minor"` that closes #69. Work through
  `docs/definition-of-done.md`, mark it ready, and merge once green
  (standing approval).
