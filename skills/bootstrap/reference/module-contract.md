# Module contract

A module is a folder `modules/<name>/` with `manifest.json`, `MODULE.md`
and `templates/`.

## manifest.json

| Field | Meaning |
|---|---|
| `name` | Folder name |
| `dependsOn` | Modules that must also be selected; the renderer pulls them in first |
| `conflictsWith` | Modules that cannot be selected together with this one, whether chosen directly or pulled in through `dependsOn`; resolution fails naming both |
| `maxSlugLength` | The longest slug the module's derived names allow (default 63) |
| `questions` | Interview questions: `{ key, type, prompt }`, where `type` is `boolean`, `string`, `hostname` or `application_id` (a lower-case reverse domain with no Java or Kotlin keyword as a segment); answers are checked against it |
| `mergePolicies` | Core only: `{ "<policy>": { rule, index } }`, the allowed `merge_policy` answers, each with its `docs/workflow.md` rule (an array of lines) and CLAUDE.md index line |
| `files` | `{ from, to, when?, stage? }`; `when` is an answer key (truthy) or `!key` (falsy); `stage` is `initial` (default, pushed with the initial commit) or `app` (shipped in the first PR); `merge: true` deep-merges a JSON file into the one an earlier module writes |
| `overrides` | Destination paths of other modules' files that this module replaces wholesale; prefer `merge` |
| `allowBuilds` | pnpm install-script decisions: `{ "<package>": { "allow": true or false, "reason": "…" } }`, rendered into `pnpm-workspace.yaml` |
| `requiredChecks` | Status check names added to the default branch ruleset: a name, or `{ "context": name, "when": key }` to depend on an answer |
| `releasePaths` | `{ noneAllowed, noneForbidden }` globs for the `release: none` guard |
| `claudeIndexLines` | Lines added to the generated `CLAUDE.md` index |
| `screening` | Dependency and vendor screening rows: `{ dependency, maintainer, listed, note }` |

Templates use `{{key}}` for answers and derived keys, and so does a file's
`to` path. `${{ … }}` (GitHub
Actions expressions) is never substituted. An unresolved placeholder fails
the render, and nothing is written.

Derived keys: `slug`, `required_checks_json`, `claude_index`,
`coding_standards_modules`, `screening_table`, `release_paths_json`,
`repo_url`, `claude_stack_section`, `allow_builds_yaml`. Answers also gain `private`,
`licensor` (defaulted), and escaped forms of the name for code and markup:
`name_js`, `greeting_js`, `name_html`, `description_toml`; and
`python_package`, the slug as a Python identifier (`-` becomes `_`, and a
trailing `_` is added when that is a Python keyword); `name_kotlin` and
`greeting_kotlin`, Kotlin string literals; `name_android`, the name escaped
for an Android string resource; and, when there's an `application_id`
answer, `application_id_path`, the id as a directory path. Core also
derives `merge_rule` and `merge_index` from the `merge_policy` answer and
its manifest's `mergePolicies` (each policy's rule for `docs/workflow.md`
and its CLAUDE.md index line). Never put
`{{name}}` inside a JS, Python or Kotlin string, HTML or an Android
resource, or `{{description}}` inside a TOML string.

Binary templates (images, archives, `.jar`) are copied as they are, and a
template that is executable in the plugin is rendered executable.

A module with a release artefact renders its own workflow that runs on
`release: published`, builds the artefact with the module's toolchain, and
attaches it with `gh release upload`. Core's release workflow creates the
release with the release App's token, which is what lets that event fire.

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
