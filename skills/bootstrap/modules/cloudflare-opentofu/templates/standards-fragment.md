### Cloudflare and OpenTofu

Platform persona for this stack: routing correctness (including static
assets taking precedence over the Worker), Workers runtime limits (no Node
APIs unless `nodejs_compat` is on, CPU time, cold starts), caching headers
and edge cache behaviour, binding and secret handling per environment, and
whether the design is idiomatic for the platform rather than fighting it.

- **Everything provisionable is in OpenTofu** (`infra/`, HCL): declarative,
  repeatable, idempotent. Only data, runtime secrets, the state bucket and
  CI credentials live outside it.
- **State is in R2, never in git.** A `sensitive` value is still written to
  state in plain text.
- **Data-bearing resources have `prevent_destroy`.** The infra workflow
  refuses any plan that deletes.
- **Least-privilege tokens**, one per job (preview, deploy, infra plan,
  infra apply), each scoped to the narrowest account or zone that offers the
  permission.
- **Every wrangler environment repeats every binding.** An environment that
  leaves one out doesn't inherit it, or worse, a misconfigured one inherits
  production's.
- **API responses for changing data send `Cache-Control: no-store`.**
- **Verify platform behaviour empirically** (a real request, `wrangler dev`,
  `--dry-run`) rather than trusting documentation alone.
- **Merging `infra/` is a production change.** It never takes
  `release: none`.
