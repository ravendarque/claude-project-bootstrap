import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, files, renderReal } from "./helpers.mjs";

const dest = renderReal(["web-app"]);
const read = path => readFileSync(join(dest, path), "utf8");

test("web-app merges browser tooling into js-toolchain's package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.test, "vitest run");
  assert.equal(pkg.scripts["test:e2e"], "wdio run wdio.conf.js");
  for (const dep of ["vite", "webdriverio", "axe-core", "vitest"]) assert.ok(pkg.devDependencies[dep], dep);
  assert.ok(!Object.keys(pkg.devDependencies).some(d => d.includes("playwright")));
});

test("the e2e suite runs in Chromium and Firefox", () => {
  const config = read("wdio.conf.js");
  assert.match(config, /browserName: "chrome"/);
  assert.match(config, /browserName: "firefox"/);
  assert.doesNotMatch(read(".github/workflows/e2e.yml"), /playwright/);
});

test("the accessibility spec checks WCAG 2.2 AA at phone width in both themes", () => {
  const spec = read("e2e/accessibility.spec.js");
  assert.match(spec, /wcag22aa/);
  assert.match(spec, /width: 375/);
  assert.match(spec, /colorScheme/);
});

test("tsconfig gains the DOM library", () => {
  assert.deepEqual(JSON.parse(read("tsconfig.json")).compilerOptions.lib, ["ES2024", "DOM"]);
});

test("the ruleset requires e2e as well as the js checks", () => {
  const ruleset = JSON.parse(read(".bootstrap/github/ruleset.json"));
  const checks = ruleset.rules.find(r => r.type === "required_status_checks").parameters.required_status_checks;
  assert.deepEqual(checks.map(c => c.context), ["check-label", "lint", "typecheck", "test", "e2e", "e2e-safari"]);
});

test("unneeded driver install scripts are declined with a reason", () => {
  const ws = read("pnpm-workspace.yaml");
  assert.match(ws, /\n  "edgedriver": false/);
  assert.match(ws, /\n  "geckodriver": false/);
});

test("the release artefact build script and web standards exist", () => {
  assert.ok([...files(dest)].includes(".github/workflows/release-artefacts.yml"));
  assert.match(read("docs/coding-standards.md"), /### Web app/);
});

test("links resolve", () => {
  assert.deepEqual(brokenLinks(dest), []);
});

const privateDest = renderReal(["web-app"], { visibility: "private" });

test("public repos run Safari on macOS as a required check", () => {
  const safari = read(".github/workflows/e2e-safari.yml");
  assert.match(safari, /runs-on: macos-latest/);
  assert.match(safari, /sudo safaridriver --enable/);
  assert.match(safari, /E2E_BROWSERS: safari/);
  const checks = JSON.parse(read(".bootstrap/github/ruleset.json")).rules.find(r => r.type === "required_status_checks")
    .parameters.required_status_checks;
  assert.ok(checks.some(c => c.context === "e2e-safari"));
});

test("private repos don't run Safari", () => {
  assert.ok(![...files(privateDest)].includes(".github/workflows/e2e-safari.yml"));
  const checks = JSON.parse(readFileSync(join(privateDest, ".bootstrap/github/ruleset.json"), "utf8")).rules.find(
    r => r.type === "required_status_checks",
  ).parameters.required_status_checks;
  assert.ok(!checks.some(c => c.context === "e2e-safari"));
});

test("the e2e config picks browsers from E2E_BROWSERS, defaulting to Chromium and Firefox", () => {
  const config = read("wdio.conf.js");
  assert.match(config, /process\.env\.E2E_BROWSERS \?\? "chrome,firefox"/);
  assert.match(config, /safari: \{ browserName: "safari" \}/);
});
