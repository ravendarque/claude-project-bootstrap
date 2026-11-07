# Module: js-toolchain

JavaScript for any kind of project (library, CLI, service or app): pnpm with
supply-chain controls, Biome, `tsc` over JSDoc and Vitest. Browser apps add
`web-app` on top.

## 1. Depends on

Nothing beyond core.

## 2. Interview questions

None.

## 3. Files

- Tooling (initial commit): `package.json`, `pnpm-workspace.yaml` (its
  `allowBuilds` list is built from every selected module's decisions),
  `.npmrc`, `.nvmrc`, `biome.json`, `tsconfig.json`, `vitest.config.js`,
  `.github/actions/setup-node-pnpm`, `.github/workflows/test.yml`,
  `.github/dependabot.yml` (replaces core's, adding npm).
- Application (first PR, `stage: app`): `src/greeting.js`,
  `test/greeting.test.js`.

`.nvmrc` holds no version. It carries the `@@NODE_VERSION@@` token, which the
scaffold fills in so the project doesn't start on a stale Node.

**Scaffold:** after rendering the initial stage, with `<dir>` as the working
directory:

1. **Resolve Node.** Take the newest LTS release published more than 72
   hours ago (the date in the index is a day, so count from its end), which
   is the newest release on the newest Active LTS line:

   ```bash
   curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.lts != false and ((.date + "T23:59:59Z") | fromdateiso8601) < (now - 259200))] | max_by(.version | ltrimstr("v") | split(".") | map(tonumber)) | .version | ltrimstr("v")'
   ```

   Replace `@@NODE_VERSION@@` in `.nvmrc` with it.
2. **Use that Node.** Make it the active Node (`nvm use`, `fnm use`, or
   prefix each command with `mise exec node@<version> --`) and check that
   `node --version` prints `v<version>`. If no version manager can provide
   it, tell the user and stop: the lockfile and checks must come from the
   Node CI runs.
3. Run `pnpm install` so `pnpm-lock.yaml` goes into the initial commit (CI
   installs with `--frozen-lockfile`), then `pnpm format` so generated JSON
   matches Biome's style. Do the same after rendering the app stage.
4. Before committing, check the latest stable versions (`pnpm outdated`); if
   the template's ranges are behind, raise it for the plugin's own PR
   process.

## 4. GitHub configuration

Nothing beyond core: the ruleset already includes this module's required
checks (`lint`, `typecheck`, `test`).

## 5. Manual steps

None.

## 6. Standards

`templates/standards-fragment.md`, rendered as "JavaScript toolchain".

## 7. Smoke check

On the full render, scaffolded as above:
`pnpm install && pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
All exit 0. Run it with the Node in `.nvmrc`, not the machine's own.
