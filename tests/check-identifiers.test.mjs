import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findIdentifiers } from "../skills/bootstrap/scripts/check-identifiers.mjs";

const cli = fileURLToPath(new URL("../skills/bootstrap/scripts/check-identifiers.mjs", import.meta.url));

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "ids-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test("reports each hit with file and line", () => {
  const root = tree({ "docs/a.md": "fine\nJane Example wrote this\n" });
  assert.deepEqual(findIdentifiers(root, [/jane example/i], []), [
    { file: "docs/a.md", line: 2, match: "Jane Example" },
  ]);
});

test("allow list exempts only the matching path and pattern", () => {
  const root = tree({ "LICENSE.md": "Required Notice: Copyright Handle\n", "README.md": "by Handle\n" });
  const hits = findIdentifiers(root, [/Handle/], [{ path: "LICENSE.md", pattern: /^Required Notice:/ }]);
  assert.deepEqual(hits, [{ file: "README.md", line: 1, match: "Handle" }]);
});

test("skips node_modules, .git and .superpowers", () => {
  const root = tree({
    "node_modules/x/index.js": "secret",
    ".git/config": "secret",
    ".superpowers/sdd/ledger.md": "secret",
  });
  assert.deepEqual(findIdentifiers(root, [/secret/], []), []);
});

test("CLI exits 2 with no patterns", () => {
  const root = tree({ "a.md": "x" });
  const run = spawnSync(process.execPath, [cli, root], { env: { PATH: process.env.PATH } });
  assert.equal(run.status, 2);
});

test("CLI exits 1 on a hit from IDENTIFIER_DENYLIST", () => {
  const root = tree({ "a.md": "contains forbidden-term\n" });
  const run = spawnSync(process.execPath, [cli, root], {
    env: { PATH: process.env.PATH, IDENTIFIER_DENYLIST: "forbidden-term\n" },
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout.toString(), /a\.md:1/);
});

test("CLI exits 0 when clean, reading patterns from IDENTIFIER_DENYLIST_FILE", () => {
  const root = tree({ "a.md": "clean\n" });
  const list = join(tree({ list: "forbidden-term\n\n" }), "list");
  const run = spawnSync(process.execPath, [cli, root], {
    env: { PATH: process.env.PATH, IDENTIFIER_DENYLIST_FILE: list },
  });
  assert.equal(run.status, 0);
});

const gitAvailable = spawnSync("git", ["--version"]).status === 0;
const needsGit = gitAvailable ? {} : { skip: "git is not installed" };

function repo(files, ignore) {
  const root = tree({ ...files, ".gitignore": ignore });
  const run = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  run("init", "-q");
  run("add", ".gitignore", ...Object.keys(files).filter(name => name.startsWith("tracked")));
  return root;
}

test("inside a git work tree, reports a tracked file", needsGit, () => {
  const root = repo({ "tracked.md": "has forbidden-term\n" }, "ignored.md\n");
  assert.deepEqual(findIdentifiers(root, [/forbidden-term/], []), [
    { file: "tracked.md", line: 1, match: "forbidden-term" },
  ]);
});

test("inside a git work tree, ignores gitignored and untracked files", needsGit, () => {
  const root = repo(
    { "tracked.md": "clean\n", "ignored.md": "forbidden-term\n", "untracked.md": "forbidden-term\n" },
    "ignored.md\n",
  );
  assert.deepEqual(findIdentifiers(root, [/forbidden-term/], []), []);
});

test("inside a git work tree, scans only the given subdirectory", needsGit, () => {
  const root = repo({ "tracked/a.md": "forbidden-term\n", "tracked-b/b.md": "forbidden-term\n" }, "");
  const hits = findIdentifiers(join(root, "tracked"), [/forbidden-term/], []);
  assert.deepEqual(hits, [{ file: "a.md", line: 1, match: "forbidden-term" }]);
});

test("a directory that git ignores is walked rather than silently skipped", needsGit, () => {
  const root = repo({ "tracked.md": "clean\n", "out/a.md": "forbidden-term\n" }, "out/\n");
  const hits = findIdentifiers(join(root, "out"), [/forbidden-term/], []);
  assert.deepEqual(hits, [{ file: "a.md", line: 1, match: "forbidden-term" }]);
});

test("outside a git work tree, the directory walk still reports a match", () => {
  const root = tree({ "a.md": "has forbidden-term\n" });
  assert.deepEqual(findIdentifiers(root, [/forbidden-term/], []), [
    { file: "a.md", line: 1, match: "forbidden-term" },
  ]);
});
