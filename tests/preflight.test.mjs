import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkTarget, toolsFor } from "../skills/bootstrap/scripts/preflight.mjs";
import { realModulesDir } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "pre-"));

test("preflight accepts an empty directory", () => {
  assert.deepEqual(checkTarget(tmp()), { ok: true });
});

test("preflight refuses non-empty dir", () => {
  const dir = tmp();
  writeFileSync(join(dir, "README.md"), "x");
  assert.deepEqual(checkTarget(dir), { ok: false, reason: "Directory is not empty: README.md" });
});

test("preflight refuses an existing git repository", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  assert.deepEqual(checkTarget(dir), { ok: false, reason: "Directory is not empty: .git" });
});

test("preflight allows .bootstrap alone so a run can resume", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".bootstrap"));
  assert.deepEqual(checkTarget(dir), { ok: true });
});

test("preflight refuses a missing directory", () => {
  assert.deepEqual(checkTarget(join(tmp(), "nope")), { ok: false, reason: "Directory does not exist" });
});

test("preflight resumes when state exists, whatever else is in the directory", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".bootstrap"));
  writeFileSync(join(dir, ".bootstrap", "state.json"), "{}");
  writeFileSync(join(dir, "README.md"), "x");
  assert.deepEqual(checkTarget(dir), { ok: true, resume: true });
});

test("preflight refuses a file", () => {
  const dir = tmp();
  writeFileSync(join(dir, "f"), "x");
  assert.deepEqual(checkTarget(join(dir, "f")), { ok: false, reason: "Not a directory" });
});

test("preflight refuses an empty directory inside a git work tree", () => {
  const dir = tmp();
  spawnSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "child"));
  assert.deepEqual(checkTarget(join(dir, "child")), { ok: false, reason: "Directory is inside an existing git work tree" });
});

test("tool checks cover core and dependencies of the selected modules", () => {
  const names = toolsFor(["cloudflare-opentofu"], realModulesDir);
  for (const tool of ["git", "gh with project scope", "commit signing", "jq", "node >= 22", "pnpm", "firefox", "tofu", "wrangler"]) {
    assert.ok(names.includes(tool), tool);
  }
});

test("the cloudflare module checks for OpenTofu", () => {
  assert.ok(toolsFor(["cloudflare-opentofu"], realModulesDir).includes("tofu"));
});
