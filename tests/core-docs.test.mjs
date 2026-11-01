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
  ]) {
    assert.ok(ignored(path), `${path} should be ignored`);
  }
  for (const path of ["infra/terraform.tfvars.example", "infra/.terraform.lock.hcl", ".claude/settings.json", ".env.example"]) {
    assert.ok(!ignored(path), `${path} should stay tracked`);
  }
});

test("a core-only CLAUDE.md has no empty Stack section", () => {
  assert.doesNotMatch(read("CLAUDE.md"), /## Stack/);
});

test("the licence notice uses the licensor answer", () => {
  assert.match(read("LICENSE.md"), /^Required Notice: Copyright Ravendarque \(https:\/\/github\.com\/ravendarque\)$/m);
});
