import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, files, renderReal } from "./helpers.mjs";

const dest = renderReal(["js-toolchain"]);
const read = path => readFileSync(join(dest, path), "utf8");

test("package.json has the standard scripts and no browser tooling", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const s of ["lint", "format", "typecheck", "test"]) assert.ok(pkg.scripts[s], s);
  assert.equal(pkg.scripts["test:e2e"], undefined);
  assert.equal(pkg.devDependencies.vite, undefined);
  assert.equal(pkg.name, "sample-project");
  assert.match(pkg.packageManager, /^pnpm@\d+\.\d+\.\d+/);
});

test("pnpm holds new releases for three days and lists build decisions with reasons", () => {
  const ws = read("pnpm-workspace.yaml");
  assert.match(ws, /^minimumReleaseAge: 4320$/m);
  assert.match(ws, /^allowBuilds:\n  # .+\n  "esbuild": true$/m);
});

test("the ruleset requires the js checks", () => {
  const ruleset = JSON.parse(read(".bootstrap/github/ruleset.json"));
  const checks = ruleset.rules.find(r => r.type === "required_status_checks").parameters.required_status_checks;
  assert.deepEqual(checks.map(c => c.context), ["check-label", "lint", "typecheck", "test"]);
});

test("dependabot covers npm and actions", () => {
  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem: "npm"/);
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
});

test("the coding standards gain the JavaScript section", () => {
  assert.match(read("docs/coding-standards.md"), /### JavaScript toolchain/);
});

test("Node is pinned to an exact release in .nvmrc, which CI reads", () => {
  const [, major] = read(".nvmrc").match(/^(\d+)\.\d+\.\d+\n$/);
  assert.equal(Number(major) % 2, 0, "an LTS line has an even major");
  const action = read(".github/actions/setup-node-pnpm/action.yml");
  assert.match(action, /node-version-file: \.nvmrc/);
  assert.doesNotMatch(action, /node-version:/);
  assert.match(read("docs/coding-standards.md"), /`\.nvmrc`/);
});

test("links still resolve with the module added", () => {
  assert.deepEqual(brokenLinks(dest), []);
});
