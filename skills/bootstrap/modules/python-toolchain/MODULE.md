# Module: python-toolchain

Python for any kind of project (library, CLI or service): mise pins the tools,
uv manages CPython and the lockfile, ruff lints and formats, pytest tests. One
stack per repository, so it can't be combined with `js-toolchain` or anything
that depends on it.

## 1. Depends on

Nothing beyond core. It conflicts with `js-toolchain` (`conflictsWith`), which
means `web-app` and `cloudflare-opentofu` are out as well.

## 2. Interview questions

None.

**Plan warning:** say that the uv/ruff vendor, Astral, has announced it is
joining OpenAI. Neither is on a BDS list, and the screening row records it.

## 3. Files

- Tooling (initial commit): `mise.toml` (the tools plus the `setup`,
  `check:python` and `check` tasks), `mise.lock`, `.python-version`,
  `pyproject.toml` (src layout, `uv_build`, entry point, pytest and ruff
  config, the `dev` group), `uv.lock`, `scripts/install-mise.sh`,
  `.github/workflows/ci.yml` (one `check` job running `mise run setup` and
  `mise run check`), `.github/dependabot.yml` (replaces core's, adding uv and a
  4-day cooldown), `tests/test_toolchain.py` (keeps CI and development from
  drifting apart), and `src/<python_package>/__init__.py`.
- Application (first PR, `stage: app`): `src/<python_package>/cli.py` and
  `tests/test_cli.py`.

`<python_package>` is the derived key `python_package`: the slug with `-`
replaced by `_`. Dependabot release labels are not set.

The templates hold no tool or package versions. They carry five `@@…@@`
tokens, which the scaffold fills in so nothing is stale on the day of the
bootstrap: `@@MISE_VERSION@@` (`ci.yml`, `install-mise.sh`),
`@@MISE_SHA256_X64@@` and `@@MISE_SHA256_ARM64@@` (`install-mise.sh`),
`@@PYTHON_MINOR@@` (`.python-version`, `pyproject.toml`) and
`@@UV_BUILD_REQUIRES@@` (`pyproject.toml`). The toolchain test fails if one
survives.

**Scaffold:** after rendering the initial stage, and with `<dir>` as the
working directory. "Old enough" means published more than 72 hours ago, and a
release that is a draft, a pre-release or too new is never used.

1. **Resolve the versions.** For each of `jdx/mise`, `astral-sh/uv` and
   `koalaman/shellcheck`, take the newest release that is old enough:

   ```bash
   gh api "repos/<repo>/releases?per_page=30" --jq '[.[] | select(.prerelease == false and .draft == false and (.published_at | fromdateiso8601) < (now - 259200))][0].tag_name'
   ```

   Strip a leading `v`. `jdx/mise-action` and `actions/checkout` stay at the SHAs in the template.
   Check that each is still the newest release that is old enough (`gh api
   repos/<repo>/releases`) and raise it for the plugin's own PR process if not.
2. **mise.** Set `MISE_VERSION` to the mise version and compute its checksums
   from the release's signed list. Verify the GPG signature before reading
   any value from it, in a throwaway keyring, against the release key's
   fingerprint `24853EC9F655CE80B48E6C3A8B81C9D17413A06D` (published on
   <https://mise.jdx.dev/installing-mise.html>):

   ```bash
   export GNUPGHOME="$(mktemp -d)"
   curl -fsSLO "https://github.com/jdx/mise/releases/download/v$MISE/SHASUMS256.asc"
   gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys 24853EC9F655CE80B48E6C3A8B81C9D17413A06D
   gpg --batch --status-fd 1 --verify SHASUMS256.asc | grep VALIDSIG
   grep -E "mise-v$MISE-linux-(x64|arm64)\.tar\.gz$" SHASUMS256.asc
   ```

   Continue only if `VALIDSIG` shows that fingerprint. Replace the three
   tokens with `sed`: `@@MISE_VERSION@@` and the two checksums.
3. **Pin the tools through mise.** `mise.toml` sets `locked = true`, which makes
   `mise use` refuse a tool that isn't in the lock yet, so override it for
   these two commands only:

   ```bash
   MISE_LOCKED=0 mise use "aqua:koalaman/shellcheck@<shellcheck>" "aqua:astral-sh/uv@<uv>"
   MISE_LOCKED=0 mise lock --platform linux-x64,linux-arm64
   ```

   Then fill in `@@UV_BUILD_REQUIRES@@` as `uv_build>=<uv>,<0.<next minor>.0`
   and resolve Python: take the newest stable CPython release on python.org
   that is old enough and keep its minor (`3.15`). Check that this uv offers
   it (`mise exec -- uv python list --only-downloads`), then replace
   `@@PYTHON_MINOR@@`.

4. **Pin the packages through uv.** `pyproject.toml` sets
   `[tool.uv] exclude-newer = "72 hours"`, and uv's documentation says it
   accepts friendly durations such as `24 hours` or `30 days`, "always resolved
   to a fixed number of seconds assuming that a day is 24 hours". So uv
   itself leaves out anything newer than 72 hours:

   ```bash
   mise exec -- uv add --dev pytest pytest-asyncio pyyaml ruff
   ```

   This writes the `dev` group with `>=` bounds and `uv.lock`. Confirm the
   resolved versions (`uv tree --depth 1 --group dev`) are each over 72 hours
   old on PyPI.
5. `git add -A`, then `mise exec -- uv run ruff format .` so generated files
   match ruff's style. Do the same after rendering the app stage. (The
   toolchain test reads `git ls-files`, so stage before running it.)

## 4. GitHub configuration

Nothing beyond core: the ruleset already includes this module's required
check (`check`).

## 5. Manual steps

None. Development machines run `scripts/install-mise.sh` to get the same
mise as CI, then `mise run setup`. To upgrade mise, change `MISE_VERSION`, the
checksums and the version in `ci.yml` together; a test checks they agree.

## 6. Standards

`templates/standards-fragment.md`, rendered as "Python toolchain".

## 7. Smoke check

On the full render, scaffolded as above and with `git add -A` done:
`mise run setup && mise run check`. Both exit 0. Run it with the tools mise
installs, not the machine's own Python or uv.
