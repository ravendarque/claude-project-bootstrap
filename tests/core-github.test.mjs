import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const dest = renderReal([]);
const read = path => readFileSync(join(dest, path), "utf8");
const workflows = [...files(dest)].filter(f => f.startsWith(".github/workflows/"));

test("core renders its workflows", () => {
  for (const name of ["require-release-label", "release", "zizmor", "scorecard", "dependency-review", "project-status-sync"]) {
    assert.ok(workflows.includes(`.github/workflows/${name}.yml`), name);
  }
});

test("every workflow declares top-level permissions", () => {
  for (const wf of workflows) assert.match(read(wf), /^permissions:/m, wf);
});

test("every action is pinned to a full commit SHA with a version comment", () => {
  for (const wf of workflows) {
    for (const [, ref] of read(wf).matchAll(/uses:\s*(\S+@\S+.*)$/gm)) {
      assert.match(ref, /@[0-9a-f]{40} # v\d/, `${wf}: ${ref}`);
    }
  }
});

test("the ruleset requires the core check, signatures and squash-only PRs", () => {
  const ruleset = JSON.parse(read(".bootstrap/github/ruleset.json"));
  const rule = type => ruleset.rules.find(r => r.type === type);
  assert.deepEqual(rule("required_status_checks").parameters.required_status_checks, [{ context: "check-label" }]);
  assert.ok(rule("required_signatures"));
  assert.ok(rule("non_fast_forward"));
  assert.ok(rule("deletion"));
  assert.deepEqual(rule("pull_request").parameters.allowed_merge_methods, ["squash"]);
});

test("release paths config is rendered from the modules", () => {
  const cfg = JSON.parse(read(".github/release-paths.json"));
  assert.ok(cfg.noneAllowed.includes("docs/"));
});

test("PR template carries the definition of done", () => {
  assert.match(read(".github/pull_request_template.md"), /Screened/);
});

test("repo settings pair the squash title with the only message GitHub accepts alongside it", () => {
  for (const visibility of ["public", "private"]) {
    const settings = JSON.parse(readFileSync(join(renderReal([], { visibility }), ".bootstrap/github/repo-settings.json"), "utf8"));
    assert.equal(settings.squash_merge_commit_title, "COMMIT_OR_PR_TITLE");
    assert.equal(settings.squash_merge_commit_message, "COMMIT_MESSAGES", visibility);
  }
});
