### Python toolchain

Platform persona for this stack: event-loop correctness, failure isolation
between components, and the exposure of every dependency and secret.

- **Tools come from mise, packages from uv.** `mise.toml` pins the tools
  (uv, shellcheck) and `mise.lock` checksums them for every platform CI and
  deployment use; `uv.lock` pins the packages and `uv sync --frozen` installs
  from it. CPython is installed by uv, never taken from the OS. `uv`'s
  `exclude-newer` keeps new releases out for 72 hours. CI runs
  `mise run setup` then `mise run check`, and nothing else is installed
  around mise.
- **Lint and format with ruff** (rules E, F, I, UP, B, ASYNC); warnings
  fail CI. Test with pytest, using `--import-mode=importlib`, so test
  directories need no `__init__.py`.
- **asyncio correctness.** No blocking calls on the loop: run blocking I/O
  in a thread, or keep a one-shot CLI synchronous. Handle cancellation and
  don't swallow `CancelledError`. Reconnect long-lived clients with backoff.
- **Failure isolation.** One failing dependency or component never takes
  another down, and a service never crash-loops. Report "absent" (for
  example a `null` reading) and recover on the next good read.
- **Config** is typed, frozen dataclasses with defaults. Validate on load
  and raise one config-error type that names the key, never the value of a
  secret. Unknown sections are ignored, so older code reads newer config.
- **Crash-safe writes.** Write a temp file in the same directory, fsync,
  `os.replace`, then fsync the directory.
- **Exit codes for one-shot commands.** 0 for success, 1 for a transient
  failure (retry later), 2 for not configured.
- **Secrets** are never logged, put in argv or put in a URL. Log the
  exception type, not the message, when a message can contain a URL.
- **HTTP.** Set a timeout on every request, inject the client so tests can
  use `httpx.MockTransport` or an equivalent fake, follow redirects
  deliberately, and check the final scheme.
- **Shell.** `set -euo pipefail`. Beware `cmd | grep -q` and
  `| awk '{…; exit}'`, which fail through SIGPIPE under `pipefail`.
  shellcheck runs in `check`.
- **Tests.** Write the test first. Test real behaviour against fakes at the
  boundary (mock transports, temporary git repos, real files in `tmp_path`).
  Skip a test cleanly when an optional system tool is missing, but never in
  CI, which installs it.
