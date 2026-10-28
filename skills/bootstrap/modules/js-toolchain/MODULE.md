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
  `.npmrc`, `biome.json`, `tsconfig.json`, `vitest.config.js`,
  `.github/actions/setup-node-pnpm`, `.github/workflows/test.yml`,
  `.github/dependabot.yml` (replaces core's, adding npm).
- Application (first PR, `stage: app`): `src/greeting.js`,
  `test/greeting.test.js`.

**Scaffold:** after rendering the initial stage, run `pnpm install` in the
project so `pnpm-lock.yaml` goes into the initial commit (CI installs with
`--frozen-lockfile`), then `pnpm format` so generated JSON matches Biome's
style. Do the same after rendering the app stage. Before committing, check
the latest stable versions (`pnpm outdated`); if the template's ranges are
behind, raise it for the plugin's own PR process.

## 4. GitHub configuration

Nothing beyond core: the ruleset already includes this module's required
checks (`lint`, `typecheck`, `test`).

## 5. Manual steps

None.

## 6. Standards

`templates/standards-fragment.md`, rendered as "JavaScript toolchain".

## 7. Smoke check

On the full render:
`pnpm install && pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
All exit 0.
