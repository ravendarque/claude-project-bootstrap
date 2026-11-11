# Bootstrap into the organisation: implementation plan

> **Execution:** this follows `docs/working-with-claude.md`.
> - One Sonnet-class subagent, in its own worktree, implements Tasks 2 and
>   4, and gets every fix as a follow-up.
> - The main session reviews each task before the next one starts.
> - The main session does Tasks 1, 3 and 5 itself.

**Spec:** `docs/superpowers/specs/2026-11-11-bootstrap-into-organisation-design.md`

## Global constraints

The constraints from the
[previous plan](2026-11-08-automate-board-and-secrets-plan.md) still apply:
- secrets go on stdin only;
- the Pass item is created first, then the GitHub secret is set;
- Claude never runs `secrets.mjs`;
- British English, and no comments by default;
- run the identifier guard before pushing.

Every `uses:` entry is pinned to a full SHA with a `# vX` comment.

### Task 1: The organisation's template (main session, live)

1. Copy the personal `Project template` into `oneloneraven` with
   `copyProjectV2`, using `includeDraftIssues: false` and the title
   `Project template`.
2. Check the copy, as the runbook describes:
   - it's private and has 0 items;
   - its fields, views and seven enabled workflows match the template.
3. Update the runbook with the organisation's copy.

### Task 2: The `board-app` and `board-app-repo` steps (subagent)

- **Generalise the manifest flow.** `buildManifest` in
  `secrets/github-app.mjs` takes `{ name, url, permissions }`. Both callers
  use it, and release-app's tests stay green.
- **Add `steps/board-app.mjs`.**
  - It refuses a `User` owner.
  - The manifest asks for `default_permissions: { organization_projects: "write", issues: "read" }`.
  - The Pass item is `board-sync App`, in a folder named after the
    organisation.
  - It sets the organisation secret and variable on stdin, with
    `--visibility all`.
  - The install check requires `repository_selection === "all"`.
  - If the organisation variable already exists, it does nothing.
  - It has no `--rotate`.
- **Add `steps/board-app-repo.mjs`.**
  - It copies the key and client id from the organisation folder's Pass
    item into repository-level secrets.
  - It refuses to run unless the repository is private.
- **`secretExists` gains an `--org` variant.**
- **Tests:**
  - the manifest's permissions;
  - the organisation-level `gh` arguments;
  - nothing secret in any argument or log line;
  - the existing-App short-circuit;
  - `User` owners refused;
  - `board-app-repo` reading the key from Pass.

### Task 3: Live check (user, then main session)

1. The user runs `secrets.mjs board-app` against `oneloneraven`.
2. Then the user runs a check script from the scratchpad. It mints an
   installation token from the Pass key, sends
   `updateProjectV2ItemFieldValue` against a throwaway draft item on the
   organisation template, and deletes the draft.
3. **If the mutation fails, stop and report it.**

### Task 4: Owner type, workflow variants and core docs (subagent)

- **Answers:** `owner_type` is required and must be `User` or
  `Organization`. The derived key `owner_org` follows from it, and the
  answer fixtures and CI's render answers gain it.
- **Workflow:** add an organisation variant of `project-status-sync.yml`
  with the pinned `actions/create-github-app-token` step. The two variants
  go in the core manifest as `when: owner_org` and `when: !owner_org`.
- **core MODULE.md:**
  - Step 5's template lookup works on the owner.
  - `core:2` splits by owner type.
  - `core:3`'s Verify uses `organization(login:)` for an organisation.
- **SKILL.md:**
  - the owner question defaults to `oneloneraven`;
  - it records `owner_type`;
  - it reads the organisation's plan;
  - the "v1" wording goes.
- **Tests:**
  - an organisation render has the App workflow and no `PROJECT_STATUS_PAT`;
  - a user render has the PAT workflow;
  - the pinning test covers the new `uses:`;
  - an invalid `owner_type` is rejected.

### Task 5: Docs, review and PR (main session)

1. Write ADR-0007 and update the threat model.
2. Run `/code-review` and fix what it finds.
3. Run `pnpm test` and the identifier guard.
4. Open a draft PR with `release: minor` that closes #74, mark it ready,
   and merge it once it's green.
