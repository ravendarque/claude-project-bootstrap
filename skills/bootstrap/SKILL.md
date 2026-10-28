---
name: bootstrap
description: Set up a new project from an empty directory - GitHub repo, branch protection, project board, CI, tag-based releases, coding standards, privacy and security docs, and Claude configuration - from selectable modules (core, js-toolchain, web-app, cloudflare-opentofu). Use when the user asks to bootstrap, scaffold or set up a new project or repository.
---

# Bootstrap a project

You turn an empty directory into a fully configured project, then ship its
first change through its own process. Work the phases in order. The scripts
are in `scripts/` next to this file; run them with `node`. `<dir>` is the
target directory, `$R` is `<owner>/<slug>`.

## Routing

The main session (this one) keeps the work that needs judgement or the
user: `preflight`, `interview`, `tools`, `plan-confirmed`, the go-ahead for
each public or irreversible step, `repo-created` and `initial-push`, the
manual steps with the user, verification and `handover`.

One `bootstrap-executor` agent does the mechanical phases: `scaffold` and
its smoke check, the GitHub configuration, the first-PR mechanics and CI
log digging. Brief it with the phase, the step ids, `<dir>` and `$R`, the
approvals already given, and the instruction to run slow commands in the
foreground and to report real command output. Send follow-ups to the same
executor; the plugin's routing mod runs it on Sonnet and refuses a second
one while it's active.

Check its report against real output (`state.mjs show`, `gh`, `git log`)
before marking a step done or telling the user it worked.

## Rules for the whole run

- **Load a module's `modules/<name>/MODULE.md` only once that module is
  selected.** The contract is in `reference/module-contract.md`.
- **Nothing public, paid or irreversible happens without an explicit yes.**
  The plan-and-confirm phase is that yes for everything it lists; anything
  not listed needs its own.
- **You never create tokens, enter secrets or click through consoles for
  the user.** Those are manual steps (`reference/manual-step-format.md`).
  Never ask the user to paste a secret into the conversation.
- **Pace GitHub mutations**: one at a time, at least a second apart. On a
  rate-limit error, stop, record state and report. Never retry into it.
- **Retry transient GitHub errors, boundedly.** A 5xx response, or a GraphQL
  "Something went wrong" error, is transient; a rate limit is not. First
  check whether the mutation took effect (look the resource up, as under
  Resuming) so a create that succeeded server-side isn't duplicated. If it
  didn't, retry at most 3 times, pausing about 5, 15 and 30 seconds, on top
  of the normal pacing. If it still fails, stop, record state and report
  the request id (`gh api -i`, or the `X-GitHub-Request-Id` header).
- **Record every step** as soon as it succeeds:
  `node scripts/state.mjs done <dir> <step-id>`. Record every id a create
  returns (`state.mjs record <dir> <key> <value>`) before the next command.
- **Record a deliberately skipped step** with
  `node scripts/state.mjs skip <dir> <step-id> <reason>`: a step the plan
  says to skip on a free private repo, or one the user declines. Never mark
  a skipped step done.
- Write generated text in British English and a professional register.
  Never put a real name, email address or personal detail in any file.

## Resuming

`node scripts/preflight.mjs <dir>` answers `"resume": true` when
`.bootstrap/state.json` exists. Then read state (`state.mjs show <dir>`),
load the selected modules' MODULE.md files and continue from
`state.mjs next <dir> <ids>`, with the step ids below in order. Skipped
steps count as settled. Before re-running a create:

- if the resource has a recorded id (`state.mjs get`), it exists: don't
  re-create it, and mark the step done;
- a create that fails with "already exists" (labels, ruleset name,
  environments) counts as done;
- `repo-created`: if `gh repo view $R` succeeds, add `origin` if
  `git remote` lacks it, and mark the step done;
- the board and the first issue have no uniqueness error, so look for them
  (`gh project list --owner <owner>`, `gh issue list --repo $R --search "<title> in:title"`)
  before creating either.

## Phases and step ids

1. **`preflight`**: `node scripts/preflight.mjs <dir>`. It must be an empty
   directory, not inside another git work tree. Report the reason and stop
   otherwise.
2. **`interview`**: ask in plain chat for:
   - project name, one-line description, GitHub owner (a personal account
     in v1), visibility (public or private);
   - the licence's copyright holder, defaulting to
     `Ravendarque (https://github.com/ravendarque)`; never a real name
     unless the user insists;
   - modules: `core` is always on; offer `js-toolchain` (any JavaScript
     project), `web-app` (a browser app; needs `js-toolchain`) and
     `cloudflare-opentofu` (needs `web-app`);
   - each selected module's questions from its MODULE.md.

   Write the answers to a temporary JSON file and run
   `node scripts/state.mjs save-answers <dir> <file> <modules>`. It
   validates them, applies the modules' slug limit and prints the slug:
   show it back for confirmation.
3. **`tools`**: `node scripts/preflight.mjs --tools <modules>`. It checks
   core, the selected modules and their dependencies. Report every failing
   tool with its fix at once, and don't work around a missing tool.
4. **`plan-confirmed`**: show the plan and get a yes:
   - the files (`node scripts/render.mjs --modules <list> --answers <dir>/.bootstrap/answers.json --dest <dir> --dry-run`);
   - the GitHub repository and its visibility, the board, ruleset,
     environments and the security features;
   - for a private repo, run `gh api user --jq .plan.name`; on `free`, say
     the ruleset, secret scanning, push protection, dependency review,
     code scanning uploads and environment secrets aren't available, and
     that those steps will be skipped;
   - every manual step ahead, and its cost (usually nothing). Say plainly
     that there's nothing to do for them yet: you'll walk the user through
     each one, one at a time, after the GitHub configuration;
   - every screening row marked listed (`Y`) in the modules' manifests, with
     its note, so the user decides with the facts;
   - each module's plan warnings from its MODULE.md;
   - the "as at" date in `modules/core/templates/LICENSE-SCHEDULE.md`; warn
     if it's more than six months old;
   - that the initial commit is pushed straight to `main` once, before
     protections exist, and never again.
   - for a public repo, that Claude Code's permission checks may block
     creating it even after this yes, and that the user will be asked to
     confirm that step again at `repo-created`.
5. **`scaffold`**: `git init -b main`, then set the project's commit
   identity to the user's GitHub login and noreply address, so no personal
   name or address reaches a public history:
   `git config user.name "$(gh api user --jq .login)"` and
   `git config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"`.
   Prove signing still works with that identity before any real commit:
   `git commit-tree -S -m check "$(git write-tree)"` must succeed (it makes
   no commit on any branch). If it fails, GPG users need `user.signingkey`
   set, and GitHub only shows a GPG signature as verified when the key's
   user ids include the noreply address: tell the user and stop.
   Then render with `--stage initial`
   (no `--dry-run`). Run each module's scaffold instructions. Also render
   the full set (no `--stage`) into a temporary directory and run each
   module's smoke check there, so the first PR will be green. Fix template
   defects in the plugin, not by hand in the project.
6. **`repo-created`**: `gh repo create $R --<visibility> --source <dir> --remote origin --description "<description>"`.
   Creating a public repo may be blocked by the harness's permission
   checks even though `plan-confirmed` was a yes. That block is expected,
   not a failure. Ask the user to confirm this step in the running session,
   and run it only after they do. Never work around the block: no other
   command, no nested session, no other way of making the repo public.
7. **`initial-push`**: if `git log` shows no commit yet, commit (signed);
   then `git push -u origin main`.
8. **GitHub configuration**: each selected module's section 4, in module
   order, one step id per numbered item (`github:<module>:<n>`).
9. **Manual steps** (`manual:<module>:<n>`): each one in turn. Give the
   instruction, wait for "done", run its verification, and only then mark it
   done. A step marked "after the first PR" waits for phase 10: in the step
   list you pass to `state.mjs next`, put its id after `first-pr-merged`.
10. **`first-pr-merged`**: the first user-facing change ships through the
    project's own process and proves the pipeline.
    - If any selected module has `stage: "app"` files: find or create the
      issue "Initial application" (record `first_issue`), add it to the
      board if it isn't there
      (`gh project item-add <project_number> --owner <owner> --url <issue-url> --format json --jq .id`)
      and confirm it's listed
      (`gh project item-list <project_number> --owner <owner> --format json`).
      If the issue is already on the board (the built-in auto-add workflow may
      have added it), take the item id from the `item-list` entry whose
      content URL matches the issue. Record it
      (`state.mjs record <dir> first_issue_item <id>`) so a resume can reuse
      it, then set it to In Progress with the recorded ids
      (`gh project item-edit --id <item-id> --project-id <project_id> --field-id <status_field_id> --single-select-option-id <in_progress_option>`).
      Only then create the branch
      `feature/<n>-initial-app`, render with
      `--stage app`, run the scaffold formatting, commit, and open a draft
      PR with `release: minor` set at creation (`gh pr create --draft --label`).
      Mark it ready, wait with `gh pr checks --watch --fail-fast`, and merge
      once green. Then run the manual steps marked "after the first PR".
      Confirm the `v0.1.0` tag, the GitHub Release with any artefact, and
      the deploy where a module deploys.
    - If none do (core only), there's nothing user-facing to release yet.
      Say the pipeline is unproven until the first real change, and mark the
      step done.
11. **`handover`**: summarise what exists, what was verified and how, what
    was skipped (list the skipped steps and their reasons from
    `state.mjs show`), and every listed screening row. Leave
    `.bootstrap/` in place (it's gitignored).

## When something fails

Stop at the failing step. Say what failed, with the real output, and what
you think the cause is. Don't skip ahead and don't mark the step done. If
the defect is in a template, fix the template in this plugin, re-render that
file and carry on.
