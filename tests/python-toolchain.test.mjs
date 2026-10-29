import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render, resolveModules, validateAnswers } from "../skills/bootstrap/scripts/render.mjs";
import { toolsFor } from "../skills/bootstrap/scripts/preflight.mjs";
import { brokenLinks, files, realModulesDir, renderReal } from "./helpers.mjs";

const dest = renderReal(["python-toolchain"], { description: 'A "quoted" description.' });
const read = path => readFileSync(join(dest, path), "utf8");

test("python-toolchain can't be combined with js-toolchain or anything built on it", () => {
  for (const other of ["js-toolchain", "web-app", "cloudflare-opentofu"]) {
    assert.throws(() => resolveModules(["python-toolchain", other], realModulesDir), /^Error: Conflicting modules: /, other);
    assert.throws(() => resolveModules([other, "python-toolchain"], realModulesDir), /^Error: Conflicting modules: /, other);
  }
});

test("the initial stage ships the tooling and the package, and the app stage the CLI", () => {
  const all = [...files(dest)];
  for (const path of ["mise.toml", ".python-version", "pyproject.toml", "scripts/install-mise.sh", "tests/test_toolchain.py", "src/sample_project/__init__.py"]) {
    assert.ok(all.includes(path), path);
  }
  const initial = mkdtempSync(join(tmpdir(), "py-initial-"));
  const modules = resolveModules(["python-toolchain"], realModulesDir);
  const { answers } = validateAnswers({ name: "Sample Project", description: "x", owner: "o", visibility: "public" });
  const written = render({ modules, answers, modulesDir: realModulesDir, destDir: initial, stage: "initial" });
  assert.ok(written.includes("src/sample_project/__init__.py"));
  assert.ok(!written.includes("src/sample_project/cli.py"));
  assert.ok(!written.includes("tests/test_cli.py"));
});

test("pyproject derives the package, entry point and escaped description from the slug", () => {
  const pyproject = read("pyproject.toml");
  assert.match(pyproject, /^name = "sample-project"$/m);
  assert.match(pyproject, /^sample-project = "sample_project\.cli:main"$/m);
  assert.match(pyproject, /^module-name = "sample_project"$/m);
  assert.match(pyproject, /^description = "A \\"quoted\\" description\."$/m);
  assert.match(pyproject, /^exclude-newer = "72 hours"$/m);
});

test("a slug that is a Python keyword still gives an importable package", () => {
  const { answers } = validateAnswers({ name: "Import", description: "x", owner: "o", visibility: "public" });
  assert.equal(answers.python_package, "import_");
  assert.equal(validateAnswers({ name: "my-app", description: "x" }).answers.python_package, "my_app");
});

test("the templates hold no versions, only the tokens the scaffold fills in", () => {
  const tokens = new Set();
  for (const path of files(dest)) {
    const text = readFileSync(join(dest, path), "utf8");
    for (const [token] of text.matchAll(/@@[A-Z0-9_]+@@/g)) tokens.add(token);
  }
  assert.deepEqual(
    [...tokens].sort(),
    ["@@MISE_SHA256_ARM64@@", "@@MISE_SHA256_X64@@", "@@MISE_VERSION@@", "@@PYTHON_MINOR@@", "@@UV_BUILD_REQUIRES@@"],
  );
  assert.match(read("mise.toml"), /^\[tools\]\n\n/);
});

test("CI pins its runner and its actions, and runs the same tasks as development", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /runs-on: ubuntu-24\.04$/m);
  assert.match(ci, /persist-credentials: false/);
  for (const [, ref] of ci.matchAll(/uses: (\S+)/g)) assert.match(ref, /@[0-9a-f]{40}$/);
  assert.match(ci, /run: mise run setup/);
  assert.match(ci, /run: mise run check/);
  assert.match(ci, /cache: false/);
});

test("mise runs the lint, shell and test checks and git hooks are not configured", () => {
  const mise = read("mise.toml");
  assert.match(mise, /^locked = true$/m);
  for (const command of ["uv run ruff check .", "uv run ruff format --check .", "shellcheck scripts/*.sh", "uv run pytest -q"]) {
    assert.ok(mise.includes(command), command);
  }
  assert.doesNotMatch(mise, /hooksPath/);
});

test("the ruleset requires the python check", () => {
  const ruleset = JSON.parse(read(".bootstrap/github/ruleset.json"));
  const checks = ruleset.rules.find(r => r.type === "required_status_checks").parameters.required_status_checks;
  assert.deepEqual(checks.map(c => c.context), ["check-label", "check"]);
});

test("dependabot covers uv and actions with a four-day cooldown", () => {
  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem: "uv"/);
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
  assert.equal(dependabot.match(/default-days: 4/g).length, 2);
  assert.doesNotMatch(dependabot, /npm/);
});

test("the coding standards gain the Python section without domain-specific rules", () => {
  const standards = read("docs/coding-standards.md");
  assert.match(standards, /### Python toolchain/);
  assert.doesNotMatch(standards, /SQLite|device/i);
});

test("the screening table lists every new dependency and vendor", () => {
  const table = read("docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md");
  for (const name of ["mise", "aqua registry", "jdx/mise-action", "uv and ruff", "CPython", "pytest", "pytest-asyncio", "PyYAML", "shellcheck"]) {
    assert.ok(table.includes(`| ${name}`), name);
  }
});

test("no node tooling is rendered", () => {
  assert.ok(!existsSync(join(dest, "package.json")));
});

test("preflight checks mise and gpg", () => {
  assert.deepEqual(toolsFor(["python-toolchain"], realModulesDir).slice(-3), ["mise", "gpg", "curl"]);
});

test("links resolve", () => {
  assert.deepEqual(brokenLinks(dest), []);
});
