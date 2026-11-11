# Module: cloudflare-opentofu

A Cloudflare Worker serving the app's static assets and a `/api/health`
endpoint, deployed by wrangler from release tags, with the zone's DNS,
TLS, headers and cache rules in OpenTofu (the open-source Terraform fork)
and state in R2.

## 1. Depends on

`web-app` (and through it, `js-toolchain`).

## 2. Interview questions

- **`zone_name`**: the domain the app is served from. It must already be an
  active zone in the user's Cloudflare account. Ask them to confirm.
- **`beta`** (yes or no): with a beta, each release tag deploys to
  `beta.<zone>` and a person promotes a chosen tag to production with
  "Promote to production". Without one, each tag deploys straight to
  production.

The slug is limited to 40 characters here: Worker names, the state bucket
and preview hostnames are built from it.

### Plan warnings

- **The app takes over the zone's apex.** OpenTofu adds a proxied
  placeholder A record for `<zone>` (and `beta.<zone>`), and the production
  Worker route is `<zone>/*`. Ask the user to check the zone's DNS records in
  the dashboard. If the apex or `beta.` already has a record, or the domain
  already serves something, stop and agree what happens to it before going
  on: apply fails on an existing CNAME and splits traffic with an existing
  A record.
- Without a beta, the first merged release deploys straight to the apex.
- **Free private repository** (the recorded `github_plan` is `free`):
  GitHub's documentation says environments need a paid plan for private
  repositories, but the bootstrap checks rather than assumes. It creates the
  environments and verifies their branch and tag policies took effect. Say
  that the module falls back only if the check fails: then the infra apply
  and state read-write credentials become repository secrets, which any
  workflow on any branch can read, so a pull request that edits a workflow
  could reach the live zone and the state. In that case the alternative is
  upgrading the plan (GitHub Pro or Team); offer both and let the user
  choose.

## 3. Files

- `wrangler.jsonc`: environments `production`, `beta` (beta only),
  `preview` (the only one with workers.dev) and `e2e`, each repeating every
  binding.
- `infra/`: provider and R2 backend, DNS placeholder records (and `beta.`),
  CAA, TLS 1.2 minimum, HSTS, always HTTPS, DNSSEC, security headers, cache
  rules, and a README with setup, disaster recovery and teardown.
- `scripts/bootstrap-state.mjs` and the workflows `infra.yml`,
  `bootstrap-state.yml`, `preview.yml`, `deploy.yml`, and `promote.yml`
  (beta only).
- Merges into `package.json`: adds wrangler, and its `e2e:server` script
  runs `wrangler dev`, so e2e tests the real Worker. Allows `workerd`'s
  install script in `pnpm-workspace.yaml`.
- Application (first PR): `src/worker.js`, `test/worker.test.js`.

Every `runs-on` in this module's workflows is `ubuntu-26.04`, so a runner
image migration is a deliberate change: when GitHub moves `ubuntu-latest` to
a new image, move the pin to that image by hand.

The templates hold no OpenTofu version. `infra.yml` carries the token
`@@TOFU_VERSION@@` as `setup-opentofu`'s `tofu_version`, which the scaffold
fills in so nothing is stale on the day of the bootstrap. The render test
checks that the template carries the token; step 3 of the scaffold checks
that none is left after it.

**Scaffold:** after rendering the initial stage, and with `<dir>` as the
working directory. "Old enough" means published more than 72 hours ago, and a
release that is a draft or a pre-release is never used.

1. Resolve the OpenTofu version:

   ```bash
   gh api "repos/opentofu/opentofu/releases?per_page=30" --jq '[.[] | select(.prerelease == false and .draft == false and (.published_at | fromdateiso8601) < (now - 259200))][0].tag_name'
   ```

   Strip the leading `v`.
2. Replace the token: `sed -i 's/@@TOFU_VERSION@@/<version>/' .github/workflows/infra.yml`.
3. Check that none survives: `! grep -rn '@@[A-Z0-9_]*@@' .github/workflows`.

`tofu_version` is exact, so Dependabot never bumps it. To upgrade, resolve
the newest release more than 72 hours old as above, change `tofu_version` in
`infra.yml`, and keep the local `tofu` on the same version.

## 4. GitHub configuration

After core's configuration. Steps `github:cloudflare-opentofu:<n>`.

1. Environments, on every plan, each limited to the refs that may deploy
   from it:
   - `infra`: the `main` branch only;
   - `production`: `main` (promote runs from it) and tags `v*`, or tags
     `v*` only without a beta;
   - `beta` (beta only): tags `v*`.

   For each: `gh api -X PUT repos/$R/environments/<env> --input -` with
   `{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}`,
   then for each allowed ref
   `gh api -X POST repos/$R/environments/<env>/deployment-branch-policies -f name=<ref> -f type=<branch|tag>`.

   **Verify each one straight after creating it.** Both must pass:
   - `gh api repos/$R/environments/<env> --jq '.deployment_branch_policy'`
     prints `{"custom_branch_policies":true,"protected_branches":false}`,
     not `null`;
   - `gh api repos/$R/environments/<env>/deployment-branch-policies --jq '[.branch_policies[] | "\(.type):\(.name)"] | sort'`
     lists exactly the expected refs: `["branch:main"]` for `infra`,
     `["branch:main","tag:v*"]` for `production` with a beta, `["tag:v*"]`
     for `production` without one and for `beta`.

   If every environment passes, record the step done.

   **Fallback, only if a create or a verification above fails** (typically
   a free private repository, where GitHub's documentation says
   environments aren't available), and for no other reason:
   - record each environment that failed as skipped:
     `node scripts/state.mjs skip <dir> github:cloudflare-opentofu:1 "environment branch policy not available: <what failed>"`;
   - record the skipped environments for the secrets script:
     `node scripts/state.mjs record <dir> skipped_envs <comma list of skipped environments>`;
   - set the secrets of a skipped environment at repository level (the
     manual steps say how);
   - add a row to `docs/threat-model.md`'s STRIDE table, after the existing
     rows, on the first PR's branch: threat "Any workflow on any branch can
     read the repository-level infra apply and state read-write
     credentials", category Elevation of privilege, mitigation "Environment
     branch policies weren't available on this repository when it was
     bootstrapped; upgrade the plan and move these secrets into the `infra`
     environment", status Accepted;
   - offer the plan upgrade (GitHub Pro or Team) and let the user choose.
2. `gh variable set CLOUDFLARE_ACCOUNT_ID --repo $R --body <account id>`
   (ask the user for it; it isn't confidential).

## 5. Manual steps

Do these in order. `infra/README.md` (rendered into the project) has the
same steps for later rebuilds.

### cloudflare-opentofu:1 Create the Cloudflare API tokens

**Why:** CI needs separate least-privilege credentials for previews,
deploys, and the infrastructure plan and apply.

**Do:** make the bootstrap token: Cloudflare dashboard → Manage Account →
Account API Tokens → Create Token → Custom token. Its only permission is
Account: Account API Tokens: Edit, and it expires today. Then run
`node <skill dir>/scripts/secrets.mjs cloudflare-tokens <project dir>`.
Paste the bootstrap token at the hidden prompt, and give the account id and
zone id from the zone's Overview page when asked. The script creates the
four tokens, reads each back to check its policies, stores them in Proton
Pass, sets the secrets and the `CLOUDFLARE_ACCOUNT_ID` variable, and deletes
the bootstrap token.

**By hand:** In the Cloudflare dashboard → My Profile → API Tokens (or Manage
Account → Account API Tokens for account-owned tokens) → Create Token →
Custom token. Create four tokens, each with a one-year expiry, scoped to
this account and, for zone permissions, to `<zone_name>` only. The exact
permissions are in the "Cloudflare API tokens" table in `infra/README.md`.
Then set each secret:
- `gh secret set CLOUDFLARE_PREVIEW_TOKEN --repo $R`
- `gh secret set CLOUDFLARE_INFRA_PLAN_TOKEN --repo $R`
- `gh secret set CLOUDFLARE_DEPLOY_TOKEN --repo $R --env production`, and
  `--env beta` too, with a beta
- `gh secret set CLOUDFLARE_INFRA_APPLY_TOKEN --repo $R --env infra`

Never add a per-Worker granular policy by editing an existing token.

If github:cloudflare-opentofu:1 recorded an environment as skipped (its
fallback), drop `--env <name>` for that environment's secrets and set them
at repository level.

**Verify (Claude runs):** `gh secret list --repo $R` and
`gh secret list --repo $R --env production` (and `infra`, `beta`).
**Expected:** every secret is listed in the
right place.

### cloudflare-opentofu:2 Create the state bucket

**Why:** the state bucket must exist before OpenTofu can run.

**Do:** nothing by hand. Claude runs
`gh workflow run bootstrap-state.yml --repo $R` once core:1 and step 1 are done.

**Verify (Claude runs):** `gh run watch --repo $R --exit-status` on that run.
**Expected:** success, with "Created bucket" or "already exists" in the log.

### cloudflare-opentofu:3 Create the R2 state credentials

**Why:** the state backend reads and writes state through R2's S3 API.
PR plans get a read-only pair, so PR code can't rewrite state.

**Do:** make a fresh bootstrap token as in step 1 (only Account: Account API
Tokens: Edit, expiring today), then run
`node <skill dir>/scripts/secrets.mjs cloudflare-r2 <project dir>` and paste
it at the hidden prompt, with the account id when asked. The script creates
the two bucket-scoped tokens, derives the S3 key pairs, stores them in
Proton Pass, sets the four secrets, and deletes the bootstrap token.

**By hand:** Cloudflare dashboard → R2 → Manage R2 API Tokens. Create two
tokens, both applied to the `<slug>-tfstate` bucket only:
1. Object Read & Write. Then
   `gh secret set TF_STATE_ACCESS_KEY_ID --repo $R --env infra` and
   `gh secret set TF_STATE_SECRET_ACCESS_KEY --repo $R --env infra`.
2. Object Read only. Then
   `gh secret set TF_STATE_READ_ACCESS_KEY_ID --repo $R` and
   `gh secret set TF_STATE_READ_SECRET_ACCESS_KEY --repo $R`.

If `infra` was skipped, set the read-write pair at repository level too.

**Verify (Claude runs):** `gh secret list --repo $R` and
`gh secret list --repo $R --env infra`.
**Expected:** the read-only pair at repository level, the read-write pair in
`infra` (or both at repository level if `infra` was skipped).

### cloudflare-opentofu:4 Apply the infrastructure

**Why:** the Worker routes need the DNS records to exist before the first
deploy.

**Do:** nothing by hand. Claude runs `gh workflow run infra.yml --repo $R`.
(The initial push skipped this workflow on purpose: no credentials existed
yet.)

**Verify (Claude runs):** `gh run watch --repo $R --exit-status`.
**Expected:** success. On an authorisation error, the log names the missing
permission: the user adds exactly that one to the infra token and Claude
re-runs it.

### cloudflare-opentofu:5 Add the DNSSEC DS record

**Why:** DNSSEC isn't active until the registrar publishes the DS record.

**Do:** copy the `app_dnssec_ds_record` output from the Infra run's log (or
the dashboard's DNS → Settings → DNSSEC) into the registrar's DNSSEC
settings.

**Verify (Claude runs):** `dig +short DS <zone_name>` after a few minutes.
**Expected:** a DS record. Propagation can take hours; if it hasn't appeared,
note it in the hand-over rather than blocking.

### cloudflare-opentofu:6 Check Worker preview URLs (after the first PR)

**Why:** Cloudflare made preview URLs opt-in, and PR previews need them.

**Do:** after the first preview run, Workers & Pages → `<slug>-preview` →
Settings → Domains & Routes: Preview URLs enabled.

**Verify:** the PR's preview comment URL answers
`curl -s <url>/api/health` with `"ok":true`.

## 6. Standards

`templates/standards-fragment.md`, rendered as "Cloudflare and OpenTofu".

## 7. Smoke check

Local, on the full render: `tofu -chdir=infra init -backend=false`,
`tofu -chdir=infra validate`, `tofu fmt -check -recursive infra`,
then `pnpm build && pnpm exec wrangler deploy --dry-run --env <env>` for
each environment, then js-toolchain's and web-app's smoke checks (e2e runs against
`wrangler dev`).

After the first release: `curl -s https://<host>/api/health` reports the
release tag (on `beta.<zone>` with a beta, after promoting on `<zone>`).
