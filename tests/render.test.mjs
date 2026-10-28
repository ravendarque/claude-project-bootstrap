import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxSlugLength, resolveModules, validateAnswers, render } from "../skills/bootstrap/scripts/render.mjs";

const modulesDir = fileURLToPath(new URL("./fixtures/modules", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "render-"));

test("resolveModules orders core first and pulls dependencies", () => {
  const names = resolveModules(["b"], modulesDir).map(m => m.name);
  assert.deepEqual(names, ["core", "a", "b"]);
});

test("resolveModules throws on missing dependency", () => {
  assert.throws(() => resolveModules(["c"], modulesDir), { message: "Missing dependency: c requires nope" });
});

test("resolveModules throws on an unknown module", () => {
  assert.throws(() => resolveModules(["zzz"], modulesDir), { message: "Unknown module: zzz" });
});

test("validateAnswers slugs a display name", () => {
  const { slug, answers } = validateAnswers({ name: "My Cool App!" });
  assert.equal(slug, "my-cool-app");
  assert.equal(answers.slug, "my-cool-app");
});

test("validateAnswers rejects a name not starting with a letter", () => {
  assert.throws(() => validateAnswers({ name: "123" }), { message: "Project name must start with a letter" });
});

test("validateAnswers rejects an empty name", () => {
  assert.throws(() => validateAnswers({ name: "  " }), { message: "Project name is required" });
});

test("validateAnswers truncates slugs to 63 characters without a trailing hyphen", () => {
  const { slug } = validateAnswers({ name: `${"a".repeat(62)} b` });
  assert.ok(slug.length <= 63);
  assert.ok(!slug.endsWith("-"));
});

test("render substitutes placeholders and derived keys", () => {
  const dest = tmp();
  const modules = resolveModules([], modulesDir);
  const { answers } = validateAnswers({ name: "Demo App", beta: true });
  const written = render({ modules, answers, modulesDir, destDir: dest });
  assert.deepEqual(written.sort(), ["CLAUDE.md", "docs/beta.md"]);
  const claude = readFileSync(join(dest, "CLAUDE.md"), "utf8");
  assert.match(claude, /^# Demo App/);
  assert.match(claude, /Slug: demo-app/);
  assert.match(claude, /- Core line/);
  assert.match(claude, /Checks: \[\{"context":"check-label"\}\]/);
});

test("render honours !when", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo", beta: false });
  const written = render({ modules: resolveModules([], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(written.sort(), ["CLAUDE.md", "docs/no-beta.md"]);
});

test("render unions required checks across modules without duplicates", () => {
  const modules = resolveModules(["a"], modulesDir);
  modules[1] = { ...modules[1], files: [] };
  const { answers } = validateAnswers({ name: "Demo" });
  const dest = tmp();
  render({ modules, answers, modulesDir, destDir: dest });
  assert.match(readFileSync(join(dest, "CLAUDE.md"), "utf8"), /Checks: \[\{"context":"check-label"\},\{"context":"lint"\}\]/);
});

test("render throws on unresolved placeholder and writes nothing", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(
    () => render({ modules: resolveModules(["a"], modulesDir), answers, modulesDir, destDir: dest }),
    { message: "Unresolved placeholder {{missing_key}} in a.txt" },
  );
  assert.deepEqual(readdirSync(dest), []);
});

test("render rejects a destination that escapes the target", () => {
  const dest = tmp();
  const modules = resolveModules(["b"], modulesDir).map(m => (m.name === "a" ? { ...m, files: [] } : m));
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: dest }), {
    message: "Path escapes destination: ../escape.txt",
  });
  assert.ok(!existsSync(join(dest, "..", "escape.txt")));
});

test("render dryRun writes nothing but reports paths", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules([], modulesDir), answers, modulesDir, destDir: dest, dryRun: true });
  assert.ok(written.includes("CLAUDE.md"));
  assert.deepEqual(readdirSync(dest), []);
});

test("render leaves GitHub Actions expressions untouched", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["d"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(
    readFileSync(join(dest, ".github/workflows/wf.yml"), "utf8"),
    "name: Demo\nref: ${{ github.sha }}\nctx: ${{ steps }}\n",
  );
});

test("render splits files by stage, defaulting to initial", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const modules = resolveModules(["e"], modulesDir);
  const initial = render({ modules, answers, modulesDir, destDir: tmp(), dryRun: true, stage: "initial" });
  const app = render({ modules, answers, modulesDir, destDir: tmp(), dryRun: true, stage: "app" });
  assert.ok(initial.includes("infra.txt") && !initial.includes("src/app.txt"));
  assert.deepEqual(app, ["src/app.txt"]);
});

test("render without a stage renders everything", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const all = render({ modules: resolveModules(["e"], modulesDir), answers, modulesDir, destDir: tmp(), dryRun: true });
  assert.ok(all.includes("infra.txt") && all.includes("src/app.txt"));
});

test("render derives standards fragments, screening table and repo URL", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo", owner: "someone" });
  render({ modules: resolveModules(["f"], modulesDir), answers, modulesDir, destDir: dest });
  const out = readFileSync(join(dest, "out.md"), "utf8");
  assert.match(out, /### F standards\n\n- Rule F/);
  assert.match(out, /\| Dependency \| Maintainer \| On a list \| Note \|\n\|---\|---\|---\|---\|\n\| toolf \| Org F \| N \|  \|/);
  assert.match(out, /Repo: https:\/\/github\.com\/someone\/demo/);
});

test("render merges release paths across modules", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["g"], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "paths.json"), "utf8")), {
    noneAllowed: ["docs/", "e2e/"],
    noneForbidden: ["infra/"],
  });
});

test("a module's overrides replace another module's file", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules(["h"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(written.filter(p => p === "CLAUDE.md").length, 1);
  assert.equal(readFileSync(join(dest, "CLAUDE.md"), "utf8"), "overridden Demo\n");
});

test("two modules writing the same path without an override is an error", () => {
  const modules = resolveModules(["h"], modulesDir).map(m => (m.name === "h" ? { ...m, overrides: [] } : m));
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: tmp() }), {
    message: "CLAUDE.md is written by both core and h; declare it in h's overrides",
  });
});

test("resolveModules fails on a dependency cycle", () => {
  assert.throws(() => resolveModules(["cyc1"], modulesDir), { message: "Dependency cycle: cyc1 -> cyc2 -> cyc1" });
});

test("render rejects a file and a directory at the same path", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules: resolveModules(["clash"], modulesDir), answers, modulesDir, destDir: dest }), {
    message: "a is both a file and a directory",
  });
  assert.deepEqual(readdirSync(dest), []);
});

test("render rejects an empty destination path", () => {
  const modules = [{ name: "core", files: [{ from: "templates/CLAUDE.md", to: "." }] }];
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: tmp() }), { message: "Path escapes destination: ." });
});

test("render accepts a file whose name starts with two dots", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules(["dots"], modulesDir), answers, modulesDir, destDir: tmp(), dryRun: true });
  assert.ok(written.includes("..foo"));
});

test("validateAnswers enforces the tightest module slug limit", () => {
  assert.throws(() => validateAnswers({ name: "a-very-long-project-name" }, { maxSlugLength: 10 }), {
    message: "Project name gives the slug a-very-long-project-name (24 characters); the selected modules allow at most 10",
  });
});

test("maxSlugLength takes the minimum over modules", () => {
  assert.equal(maxSlugLength(resolveModules(["slim"], modulesDir)), 10);
  assert.equal(maxSlugLength(resolveModules([], modulesDir)), 63);
});

test("validateAnswers derives private, licensor and escaped name keys", () => {
  const { answers } = validateAnswers({ name: `Sam's "App" <1>`, visibility: "private" });
  assert.equal(answers.private, true);
  assert.equal(answers.licensor, "Ravendarque (https://github.com/ravendarque)");
  assert.equal(answers.name_js, JSON.stringify(`Sam's "App" <1>`));
  assert.equal(answers.greeting_js, JSON.stringify(`Hello from Sam's "App" <1>`));
  assert.equal(answers.name_html, "Sam&#39;s &quot;App&quot; &lt;1&gt;");
});

test("validateAnswers keeps a supplied licensor", () => {
  assert.equal(validateAnswers({ name: "Demo", licensor: "Someone Else" }).answers.licensor, "Someone Else");
});


test("a merge file deep-merges JSON into the earlier module's file", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["pkgext"], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "package.json"), "utf8")), {
    name: "demo",
    scripts: { test: "vitest run", build: "vite build" },
    devDependencies: { vitest: "^5.0.0", vite: "^8.0.0" },
  });
});

test("a merge file with nothing to merge into is an error", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules: resolveModules(["orphan"], modulesDir), answers, modulesDir, destDir: tmp() }), {
    message: "orphan merges into package.json, but no earlier module writes it",
  });
});

test("allow_builds_yaml lists every module's build decisions with reasons", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["ws"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(
    readFileSync(join(dest, "ws.yaml"), "utf8"),
    "allowBuilds:\n  # Bundler binary.\n  \"esbuild\": true\n  # Downloaded at runtime instead.\n  \"geckodriver\": false\n",
  );
});

test("required checks can depend on an answer", () => {
  const modules = resolveModules(["condcheck"], modulesDir);
  const contexts = visibility => {
    const dest = tmp();
    const { answers } = validateAnswers({ name: "Demo", visibility });
    render({ modules, answers, modulesDir, destDir: dest });
    return readFileSync(join(dest, "CLAUDE.md"), "utf8").match(/Checks: (.*)/)[1];
  };
  assert.equal(contexts("public"), '[{"context":"check-label"},{"context":"always"},{"context":"public-only"}]');
  assert.equal(contexts("private"), '[{"context":"check-label"},{"context":"always"}]');
});

test("an override can't silently drop an earlier merge", () => {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("core/manifest.json", JSON.stringify({ name: "core", files: [{ from: "t/p.json", to: "p.json" }] }));
  write("core/t/p.json", '{"a":[1]}');
  write("m/manifest.json", JSON.stringify({ name: "m", files: [{ from: "t/p.json", to: "p.json", merge: true }] }));
  write("m/t/p.json", '{"a":{"b":1},"c":2}');
  write("o/manifest.json", JSON.stringify({ name: "o", dependsOn: ["m"], overrides: ["p.json"], files: [{ from: "t/p.json", to: "p.json" }] }));
  write("o/t/p.json", "{}");
  const { answers } = validateAnswers({ name: "Demo" });
  const dest = tmp();
  render({ modules: resolveModules(["m"], dir), answers, modulesDir: dir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "p.json"), "utf8")), { a: { b: 1 }, c: 2 });
  assert.throws(() => render({ modules: resolveModules(["o"], dir), answers, modulesDir: dir, destDir: tmp() }), {
    message: "o overrides p.json, which m merges into; merge instead",
  });
});

test("allow_builds_yaml quotes package names and keeps reasons on one line", () => {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  mkdirSync(join(dir, "core", "t"), { recursive: true });
  writeFileSync(join(dir, "core", "t", "w.yaml"), "{{allow_builds_yaml}}\n");
  writeFileSync(
    join(dir, "core", "manifest.json"),
    JSON.stringify({ name: "core", files: [{ from: "t/w.yaml", to: "w.yaml" }], allowBuilds: { "@scope/pkg": { allow: true, reason: "Two\nlines." } } }),
  );
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules([], dir), answers, modulesDir: dir, destDir: dest });
  assert.equal(readFileSync(join(dest, "w.yaml"), "utf8"), '  # Two lines.\n  "@scope/pkg": true\n');
});
