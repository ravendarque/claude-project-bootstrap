import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brokenLinks, files, renderReal } from "./helpers.mjs";

const dest = renderReal([]);
const read = path => readFileSync(join(dest, path), "utf8");

test("CLAUDE.md is a short index", () => {
  assert.ok(read("CLAUDE.md").split("\n").length <= 60);
});

test("the workflow table and the CLAUDE.md index list the same branch prefixes", () => {
  const table = [...read("docs/workflow.md").matchAll(/^\| `([a-z]+\/)` \|/gm)].map(m => m[1]);
  const index = [...read("CLAUDE.md").match(/^- Branches are named.*$/m)[0].matchAll(/`([a-z]+\/)`/g)].map(m => m[1]);
  assert.ok(table.includes("chore/"));
  assert.deepEqual(index, table);
});

test("each merge policy renders its own rule in the workflow and the CLAUDE.md index", () => {
  const rules = {
    claude: [/^- Claude merges a PR once it meets the definition of done and every required\s+check passes, including PRs that cut a release\. This is standing approval/m, /^- Merge a PR yourself .*release PRs included.*standing approval/m],
    "claude-except-release": [/^- Claude merges a PR once [^\n]*\n[^\n]*It asks the maintainer before merging a PR that cuts a release/m, /^- Merge a PR yourself .*ask the maintainer before merging one that cuts a release/m],
    maintainer: [/^- The maintainer merges every PR\. Claude marks a PR ready once it meets the\s+definition of done, and stops there\./m, /^- Never merge a PR: mark it ready and leave the merge to the maintainer/m],
  };
  for (const [merge_policy, [workflow, index]] of Object.entries(rules)) {
    const dir = renderReal([], { merge_policy });
    const text = path => readFileSync(join(dir, path), "utf8");
    assert.match(text("docs/workflow.md"), workflow, merge_policy);
    assert.match(text("CLAUDE.md"), index, merge_policy);
    assert.equal(/standing approval/.test(text("CLAUDE.md")), merge_policy !== "maintainer", merge_policy);
  }
});

test("every relative Markdown link resolves", () => {
  assert.deepEqual(brokenLinks(dest), []);
});

test("licence carries the standard title and handle notice", () => {
  const licence = read("LICENSE.md");
  assert.equal(licence.split("\n")[0], "# Ravendarque Noncommercial Licence 1.0.0");
  assert.match(licence, /^Required Notice: Copyright Ravendarque \(https:\/\/github\.com\/ravendarque\)$/m);
  assert.match(licence, /https:\/\/github\.com\/sample-owner\/sample-project\/blob\/main\/LICENSE\.md/);
});

test("Claude settings block edits on main", () => {
  const settings = JSON.parse(read(".claude/settings.json"));
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Write|Edit");
});

test("no placeholder survives", () => {
  for (const file of files(dest)) assert.doesNotMatch(read(file), /(?<!\$)\{\{/, file);
});

test("coding standards carry the review framework", () => {
  assert.match(read("docs/coding-standards.md"), /## Part 1: Review framework/);
});

test("model routing names tiers, not model IDs", () => {
  const claude = read("CLAUDE.md");
  assert.match(claude, /Opus-class/);
  assert.match(claude, /Sonnet-class/);
  assert.doesNotMatch(claude, /claude-(opus|sonnet)-\d/);
});

test("screening ADR has a record table", () => {
  assert.match(read("docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md"), /\| Dependency \| Maintainer \|/);
});

test("gitignore covers local state and secrets", () => {
  const ignore = read(".gitignore");
  for (const entry of [".bootstrap/", ".dev.vars", ".env*"]) assert.ok(ignore.includes(entry), entry);
});

test("gitignore keeps secrets and tool state out and config in", () => {
  const dir = mkdtempSync(join(tmpdir(), "ignore-"));
  copyFileSync(join(dest, ".gitignore"), join(dir, ".gitignore"));
  execFileSync("git", ["init", "-q", dir]);
  const ignored = path => spawnSync("git", ["-c", "core.excludesFile=/dev/null", "-C", dir, "check-ignore", "-q", "--no-index", path]).status === 0;
  for (const path of [
    ".claude/settings.local.json",
    ".claude/worktrees/x",
    ".wrangler/state",
    "infra/.terraform/providers",
    "infra/terraform.tfstate",
    "infra/terraform.tfstate.backup",
    "infra/terraform.tfvars",
    "test-results/x",
    ".venv/x",
    "src/app/__pycache__/x.pyc",
    ".pytest_cache/x",
    ".ruff_cache/x",
    ".gradle/x",
    ".kotlin/x",
    "app/build/x",
    "local.properties",
    "upload.jks",
    "release.keystore",
  ]) {
    assert.ok(ignored(path), `${path} should be ignored`);
  }
  for (const path of ["infra/terraform.tfvars.example", "infra/.terraform.lock.hcl", ".claude/settings.json", ".env.example", "gradle/wrapper/gradle-wrapper.jar", "app/src/test/screenshots/x.png"]) {
    assert.ok(!ignored(path), `${path} should stay tracked`);
  }
});

test("a core-only CLAUDE.md has no empty Stack section", () => {
  assert.doesNotMatch(read("CLAUDE.md"), /## Stack/);
});

test("the licence notice uses the licensor answer", () => {
  assert.match(read("LICENSE.md"), /^Required Notice: Copyright Ravendarque \(https:\/\/github\.com\/ravendarque\)$/m);
});
