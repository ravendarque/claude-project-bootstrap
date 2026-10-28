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

test("links still resolve with the module added", () => {
  assert.deepEqual(brokenLinks(dest), []);
});
