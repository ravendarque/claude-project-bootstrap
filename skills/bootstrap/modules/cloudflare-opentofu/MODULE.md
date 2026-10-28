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

## 4. GitHub configuration

After core's configuration. Steps `github:cloudflare-opentofu:<n>`.
Environments need a paid plan on a free private repo: skip them there, as
the plan said, and set the secrets at repository level instead.

1. Environments, each limited to the refs that may deploy from it:
   - `infra`: the `main` branch only;
   - `production`: `main` (promote runs from it) and tags `v*`, or tags
     `v*` only without a beta;
   - `beta` (beta only): tags `v*`.

   For each: `gh api -X PUT repos/$R/environments/<env> --input -` with
   `{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}`,
   then for each allowed ref
   `gh api -X POST repos/$R/environments/<env>/deployment-branch-policies -f name=<ref> -f type=<branch|tag>`.
2. `gh variable set CLOUDFLARE_ACCOUNT_ID --repo $R --body <account id>`
   (ask the user for it; it isn't confidential).

## 5. Manual steps

Do these in order. `infra/README.md` (rendered into the project) has the
same steps for later rebuilds.

### cloudflare-opentofu:1 Create the Cloudflare API tokens

**Why:** CI needs separate least-privilege credentials for previews,
deploys, and the infrastructure plan and apply.

**Do:** In the Cloudflare dashboard → My Profile → API Tokens (or Manage
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

**Verify (Claude runs):** ask the user to run, for each token,
`curl -s -H "Authorization: Bearer <token>" https://api.cloudflare.com/client/v4/user/tokens/verify | jq .result.status`
themselves (so the token never enters the conversation), then run
`gh secret list --repo $R` and `gh secret list --repo $R --env production`
(and `infra`, `beta`).
**Expected:** each verify prints `"active"`; every secret is listed in the
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

**Do:** Cloudflare dashboard → R2 → Manage R2 API Tokens. Create two
tokens, both applied to the `<slug>-tfstate` bucket only:
1. Object Read & Write. Then
   `gh secret set TF_STATE_ACCESS_KEY_ID --repo $R --env infra` and
   `gh secret set TF_STATE_SECRET_ACCESS_KEY --repo $R --env infra`.
2. Object Read only. Then
   `gh secret set TF_STATE_READ_ACCESS_KEY_ID --repo $R` and
   `gh secret set TF_STATE_READ_SECRET_ACCESS_KEY --repo $R`.

**Verify (Claude runs):** `gh secret list --repo $R` and
`gh secret list --repo $R --env infra`.
**Expected:** the read-only pair at repository level, the read-write pair in
`infra`.

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
