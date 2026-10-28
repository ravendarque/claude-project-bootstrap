# Working with Claude

How Claude sessions are run on this project, to get good results without
spending tokens on work that doesn't need the most capable model.

## Model routing

- **The main session runs an Opus-class model.** It owns design, scoping
  issues, architecture decisions, review judgement, anything security- or
  privacy-sensitive, and the final verification before anything is called
  done.
- **At most one nested Sonnet-class session at a time** takes the work that
  doesn't need Opus: dependency bumps, running test suites and reporting
  their output, board and label housekeeping, executing an agreed plan step
  by step, bulk renames, doc updates from a settled decision, and digging
  through CI logs.
- **Follow-ups go to the existing nested session**, not a new one.
- **The nested session gets its own worktree whenever it writes code**, and
  the two sessions never write the same files.
- **Briefs are self-contained**: the files involved, what done looks like,
  and the instruction to run slow commands (test suites, e2e) in the
  foreground, never in the background.
- **The main session checks the nested session's results** (the diff, the
  real test output) before reporting them as done.

Where nested sessions aren't available (the CLI, the web), use at most one
subagent with `model: sonnet` at a time, with the same split and the same
rules.

## Memory

- One fact per file, with frontmatter: name, one-line description, type
  (user, feedback, project, reference).
- `MEMORY.md` is the index: one line per memory, nothing else.
- Update an existing memory rather than adding a duplicate; delete one that
  turns out to be wrong.
- Don't save what the repo already records (code, docs, git history).

## Keeping context small

- `CLAUDE.md` is an index of one-line rules linking here and to the other
  docs. Add a rule as a line and its detail to a doc, never a paragraph to
  `CLAUDE.md`.
- Docs are short and split by topic. A doc that grows past a few screens
  gets split.
- Redirect long command output to a file and read its tail.

## Operational lessons

- There's no such thing as a flaky test, only a bad test or a real bug.
  Capture the full output and find the cause.
- Wait on PR checks with `gh pr checks --watch --fail-fast` and act on the
  first failure at once.
- Run the type checker locally before pushing; CI runs it as its own job.
- Run the e2e suite once per verification pass, not twice by default.
- Before blaming a file watcher for stale output, check for a duplicate dev
  server (`ps aux`).
- Never `pgrep -f` inside a `bash -c` wait loop: it matches itself.
- Test setup never reaches real external services. Local secrets files hold
  real keys.
- Check what the platform already provides before building ops tooling, and
  prefer the platform's newest feature unless there's a stated reason not to.
- Treat Claude-written docs as unverified until a person confirms them,
  especially anything phrased as "by design".
- When a needed tool or library is missing, say so and discuss options
  before improvising a workaround.
- Check an item's full stated scope before calling it done.
