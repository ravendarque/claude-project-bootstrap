# Module contract

A module is a folder `modules/<name>/` with `manifest.json`, `MODULE.md`
and `templates/`.

## manifest.json

| Field | Meaning |
|---|---|
| `name` | Folder name |
| `dependsOn` | Modules that must also be selected; the renderer pulls them in first |
| `maxSlugLength` | The longest slug the module's derived names allow (default 63) |
| `questions` | Interview questions: `{ key, type, prompt }` |
| `files` | `{ from, to, when?, stage? }`; `when` is an answer key (truthy) or `!key` (falsy); `stage` is `initial` (default, pushed with the initial commit) or `app` (shipped in the first PR); `merge: true` deep-merges a JSON file into the one an earlier module writes |
| `overrides` | Destination paths of other modules' files that this module replaces wholesale; prefer `merge` |
| `allowBuilds` | pnpm install-script decisions: `{ "<package>": { "allow": true or false, "reason": "…" } }`, rendered into `pnpm-workspace.yaml` |
| `requiredChecks` | Status check names added to the default branch ruleset |
| `releasePaths` | `{ noneAllowed, noneForbidden }` globs for the `release: none` guard |
| `claudeIndexLines` | Lines added to the generated `CLAUDE.md` index |
| `screening` | Dependency and vendor screening rows: `{ dependency, maintainer, listed, note }` |

Templates use `{{key}}` for answers and derived keys. `${{ … }}` (GitHub
Actions expressions) is never substituted. An unresolved placeholder fails
the render, and nothing is written.

Derived keys: `slug`, `required_checks_json`, `claude_index`,
`coding_standards_modules`, `screening_table`, `release_paths_json`,
`repo_url`, `claude_stack_section`, `allow_builds_yaml`. Answers also gain `private`,
`licensor` (defaulted), and escaped forms of the name for code and markup:
`name_js`, `greeting_js`, `name_html`. Never put `{{name}}` inside a JS
string or HTML.

A module that has a release artefact renders `.github/scripts/build-artefacts.sh`,
which builds it into `artefacts/`. The release attaches whatever is there.

## MODULE.md sections

1. **Depends on**
2. **Interview questions**: what to ask and why, matching `questions`,
   plus any "Plan warnings" the plan-and-confirm phase must show
3. **Files**: what the templates produce and any conditionals
4. **GitHub configuration**: exact `gh` commands, in order
5. **Manual steps**: in `manual-step-format.md` form. A step that can only
   be verified once the first PR exists says "(after the first PR)" in
   its heading
6. **Standards**: the module's `templates/standards-fragment.md`, rendered into
   `docs/coding-standards.md`
7. **Smoke check**: the commands that prove the module works after setup
