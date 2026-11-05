import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReal } from "./helpers.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
let command;
let main;
let worktree;
let outside;

before(() => {
  const settings = JSON.parse(readFileSync(join(renderReal([]), ".claude/settings.json"), "utf8"));
  command = settings.hooks.PreToolUse[0].hooks[0].command;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hook-")));
  main = join(root, "main-checkout");
  worktree = join(main, ".claude/worktrees/feature");
  outside = join(root, "not-a-repo");
  mkdirSync(main);
  mkdirSync(outside);
  git(main, "init", "-q", "-b", "main");
  git(main, "-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", "-b", "feature/x", worktree);
});

const run = (cwd, file) => {
  const input = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: file } });
  const { stdout } = spawnSync("sh", ["-c", command], { cwd, input, encoding: "utf8" });
  return stdout.trim() ? JSON.parse(stdout).hookSpecificOutput.permissionDecision : "allow";
};

test("an edit in a worktree on a feature branch is allowed while the main checkout is on main", () => {
  writeFileSync(join(worktree, "a.txt"), "x");
  assert.equal(run(main, join(worktree, "a.txt")), "allow");
});

test("an edit in the main checkout on main is denied", () => {
  writeFileSync(join(main, "b.txt"), "x");
  assert.equal(run(main, join(main, "b.txt")), "deny");
});

test("a new file in a directory that does not exist yet is judged by its checkout", () => {
  assert.equal(run(main, join(worktree, "new/deep/c.txt")), "allow");
  assert.equal(run(main, join(main, "new/deep/c.txt")), "deny");
});

test("a file outside any repository is allowed", () => {
  assert.equal(run(main, join(outside, "d.txt")), "allow");
  assert.equal(run(main, join(outside, "missing/d.txt")), "allow");
});
