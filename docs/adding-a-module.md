# Adding a module

A module is a folder under `skills/bootstrap/modules/<name>/`. The contract
is in [module-contract.md](../skills/bootstrap/reference/module-contract.md);
manual steps follow [manual-step-format.md](../skills/bootstrap/reference/manual-step-format.md).

1. **Open an issue** describing the stack and what the module sets up.
2. **Screen its default dependencies and vendors** against the BDS lists and
   record them in the manifest's `screening`.
3. **Write `manifest.json`**: `dependsOn`, `questions`, `files` (mark
   application files `"stage": "app"` so they ship in the first PR),
   `merge: true` to extend another module's JSON (such as `package.json`),
   `overrides` only to replace a file wholesale, `allowBuilds` for any
   package's install script, `requiredChecks`,
   `releasePaths`, `claudeIndexLines`.
4. **Write the templates.** Use `{{key}}` for answers and derived keys.
   GitHub Actions expressions (`${{ … }}`) pass through untouched. Pin every
   action by commit SHA with a version comment, and give every workflow
   least-privilege `permissions:`.
5. **Write `templates/standards-fragment.md`**: a `###` section with the
   stack's platform persona and its rules. It's added to the project's
   coding standards.
6. **Write `MODULE.md`** with the seven sections.
7. **Test it.** Add `tests/<module>.test.mjs` with render assertions, then
   render it with its dependencies into a temporary directory and run the
   module's smoke check for real.
8. Run `npm test` and the identifier guard, then open the PR with
   `release: minor`.
