# Module: web-app

A browser app built with Vite, tested end to end with WebdriverIO in
Chromium and Firefox, plus real Safari on a macOS runner for public
repositories, with axe-core checking WCAG 2.2 AA.

## 1. Depends on

`js-toolchain`.

## 2. Interview questions

None.

## 3. Files

- Tooling (initial commit): merges into `package.json` (Vite, WebdriverIO
  and axe-core; scripts `dev`, `build`, `preview`, `test:e2e` and
  `e2e:server`, which serves the built app for the e2e run) and
  `tsconfig.json` (adds the DOM library); `vite.config.js`, `wdio.conf.js`,
  `e2e/accessibility.spec.js`, `.github/workflows/e2e.yml`,
  `.github/workflows/e2e-safari.yml` (public repos only: macOS minutes are
  billed at ten times the Linux rate on private ones),
  `.github/scripts/build-artefacts.sh` (zips `dist/` for the release),
  `.claude/launch.json`.
- Application (first PR, `stage: app`): `index.html`, `src/main.js`,
  `e2e/home.spec.js`.

**Scaffold:** as js-toolchain's (install, then format).

## 4. GitHub configuration

Nothing beyond core: the ruleset already includes `e2e`, and `e2e-safari`
on public repos.

## 5. Manual steps

None.

## 6. Standards

`templates/standards-fragment.md`, rendered as "Web app".

## 7. Smoke check

After js-toolchain's: `pnpm test:e2e && bash .github/scripts/build-artefacts.sh`.
Both exit 0, the e2e run passes in Chromium and Firefox, and
`artefacts/<slug>-dist.zip` exists. Safari runs only in CI: confirm the
`e2e-safari` check passes on the first PR (public repos).
