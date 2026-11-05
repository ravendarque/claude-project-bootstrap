import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, files, renderReal } from "./helpers.mjs";

const dest = renderReal(["web-app"]);
const jsDest = renderReal(["js-toolchain"]);
const read = path => readFileSync(join(dest, path), "utf8");

function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  return Object.fromEntries(
    body
      .split(/^(?=  [a-z0-9-]+:$)/m)
      .filter(block => block.trim())
      .map(block => [block.match(/^  ([a-z0-9-]+):$/m)[1], block.trimEnd()]),
  );
}

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
  assert.doesNotMatch(read(".github/workflows/test.yml"), /playwright/);
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
  const safari = jobs(read(".github/workflows/test.yml"))["e2e-safari-run"];
  assert.match(safari, /runs-on: macos-latest/);
  assert.match(safari, /sudo safaridriver --enable/);
  assert.match(safari, /E2E_BROWSERS: safari/);
  const checks = JSON.parse(read(".bootstrap/github/ruleset.json")).rules.find(r => r.type === "required_status_checks")
    .parameters.required_status_checks;
  assert.ok(checks.some(c => c.context === "e2e-safari"));
});

test("private repos don't run Safari", () => {
  const privateTest = readFileSync(join(privateDest, ".github/workflows/test.yml"), "utf8");
  assert.deepEqual(Object.keys(jobs(privateTest)), ["lint", "typecheck", "test", "e2e-run", "e2e"]);
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

test("web-app's test.yml keeps js-toolchain's lint, typecheck and test jobs identical", () => {
  const shared = jobs(readFileSync(join(jsDest, ".github/workflows/test.yml"), "utf8"));
  assert.deepEqual(Object.keys(shared), ["lint", "typecheck", "test"]);
  for (const text of [read(".github/workflows/test.yml"), readFileSync(join(privateDest, ".github/workflows/test.yml"), "utf8")]) {
    const combined = jobs(text);
    for (const [id, job] of Object.entries(shared)) assert.equal(combined[id], job, id);
  }
});

test("the e2e jobs wait for lint and typecheck, and the required checks fail with a reason when gated", () => {
  const combined = jobs(read(".github/workflows/test.yml"));
  for (const run of ["e2e-run", "e2e-safari-run"]) assert.match(combined[run], /needs: \[lint, typecheck\]/, run);
  assert.doesNotMatch(combined["e2e-run"], /needs:.*\btest\b/);
  for (const [check, run] of [["e2e", "e2e-run"], ["e2e-safari", "e2e-safari-run"]]) {
    assert.match(combined[check], /if: \$\{\{ !cancelled\(\) \}\}/, check);
    assert.match(combined[check], new RegExp(`needs: \\[lint, typecheck, ${run}\\]`), check);
    assert.match(combined[check], /::error::.*did not run because a quick check failed/, check);
    assert.match(combined[check], /exit 1/, check);
  }
});

test("every required check still has a job of that name and no separate e2e workflow remains", () => {
  const checks = JSON.parse(read(".bootstrap/github/ruleset.json")).rules.find(r => r.type === "required_status_checks")
    .parameters.required_status_checks.map(c => c.context);
  const combined = Object.keys(jobs(read(".github/workflows/test.yml")));
  for (const check of checks.filter(c => c !== "check-label")) assert.ok(combined.includes(check), check);
  const workflows = [...files(dest)].filter(f => f.startsWith(".github/workflows/"));
  assert.ok(!workflows.includes(".github/workflows/e2e.yml"));
  assert.ok(!workflows.includes(".github/workflows/e2e-safari.yml"));
});
