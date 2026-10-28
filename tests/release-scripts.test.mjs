import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bumpOf,
  nextVersion,
  planFromRepo,
  planReleases,
} from "../skills/bootstrap/modules/core/templates/github/scripts/plan-releases.mjs";
import { checkReleasePaths } from "../skills/bootstrap/modules/core/templates/github/scripts/check-release-paths.mjs";

const PRS = {
  a: { number: 1, labels: ["release: patch"] },
  b: { number: 2, labels: ["release: minor", "enhancement"] },
  c: { number: 3, labels: ["release: none"] },
  d: { number: 4, labels: [] },
};
const plan = (commits, { tagged = [], latestVersion = "v2.9.5" } = {}) =>
  planReleases({ commits, latestVersion, isTagged: sha => tagged.includes(sha), prFor: sha => PRS[sha] ?? null });

test("planReleases tags every released PR since the latest tag, oldest first", () => {
  assert.deepEqual(plan(["a", "b"]), [
    { sha: "a", version: "v2.9.6", pr: 1 },
    { sha: "b", version: "v2.10.0", pr: 2 },
  ]);
});

test("planReleases skips none, unlabelled, PR-less and already-tagged commits", () => {
  assert.deepEqual(
    plan(["a", "c", "d", "x", "b"], { tagged: ["a"] }).map(r => [r.sha, r.version]),
    [["b", "v2.10.0"]],
  );
});

test("planReleases starts from v0.0.0 when there is no tag yet", () => {
  assert.deepEqual(plan(["b"], { latestVersion: null }), [{ sha: "b", version: "v0.1.0", pr: 2 }]);
});

test("bumpOf takes the largest release label", () => {
  assert.equal(bumpOf(["release: patch", "release: major"]), "major");
  assert.equal(bumpOf(["release: none"]), null);
});

test("nextVersion bumps each part", () => {
  assert.equal(nextVersion("v2.9.5", "major"), "v3.0.0");
  assert.equal(nextVersion("v2.9.5", "minor"), "v2.10.0");
  assert.equal(nextVersion("v1.10.0", "patch"), "v1.10.1");
});

function fakeGit({ tags = "v2.9.5\nv2.9.4", ancestor = true, revList = "a\nb" } = {}) {
  const calls = [];
  const git = args => {
    calls.push(args.join(" "));
    if (args[0] === "tag" && args[1] === "-l") return tags;
    if (args[0] === "merge-base") {
      if (!ancestor) throw new Error("not an ancestor");
      return "";
    }
    if (args[0] === "rev-list") return revList;
    if (args[0] === "tag" && args[1] === "--points-at") return "";
    if (args[0] === "rev-parse") return "head";
    return "";
  };
  return { git, calls };
}

test("planFromRepo plans from the latest tag to the merge commit", () => {
  const { git, calls } = fakeGit();
  const result = planFromRepo({ git, prFor: sha => PRS[sha] ?? null, mergeSha: "b" });
  assert.deepEqual(result.map(r => r.version), ["v2.9.6", "v2.10.0"]);
  assert.ok(calls.includes("rev-list --reverse --first-parent v2.9.5..b"));
});

test("planFromRepo with no tags walks the merge commit's whole first-parent history", () => {
  const { git, calls } = fakeGit({ tags: "", revList: "b" });
  const result = planFromRepo({ git, prFor: sha => PRS[sha] ?? null, mergeSha: "b" });
  assert.deepEqual(result.map(r => r.version), ["v0.1.0"]);
  assert.ok(calls.includes("rev-list --reverse --first-parent b"));
});

test("planFromRepo refuses when the latest tag isn't in the merge commit's history", () => {
  const { git } = fakeGit({ ancestor: false });
  assert.throws(() => planFromRepo({ git, prFor: () => null, mergeSha: "b" }), /isn't in b's history/);
});

test("planFromRepo honours a manual bump", () => {
  const { git } = fakeGit();
  assert.deepEqual(planFromRepo({ git, prFor: () => null, mergeSha: "", bumpInput: "minor" }), [
    { sha: "head", version: "v2.10.0", pr: null },
  ]);
});

const cfg = { noneAllowed: ["docs/", ".github/", "*.md"], noneForbidden: ["infra/"] };

test("checkReleasePaths allows docs and root Markdown", () => {
  assert.deepEqual(checkReleasePaths(["docs/x.md", "README.md"], cfg), { ok: true, offending: [] });
});

test("checkReleasePaths rejects nested Markdown outside an allowed folder", () => {
  assert.deepEqual(checkReleasePaths(["src/help/page.md"], cfg), { ok: false, offending: ["src/help/page.md"] });
});

test("checkReleasePaths rejects forbidden paths even under an allowed glob", () => {
  const result = checkReleasePaths(["docs/a.md", "infra/main.tf", "infra/README.md"], cfg);
  assert.deepEqual(result, { ok: false, offending: ["infra/main.tf", "infra/README.md"] });
});

test("checkReleasePaths matches exact file entries", () => {
  assert.equal(checkReleasePaths([".gitignore"], { noneAllowed: [".gitignore"], noneForbidden: [] }).ok, true);
});

test("planFromRepo refuses a manual bump when HEAD is already tagged", () => {
  const { git } = fakeGit();
  const tagged = args => (args[0] === "tag" && args[1] === "--points-at" ? "v2.9.5" : git(args));
  assert.throws(() => planFromRepo({ git: tagged, prFor: () => null, mergeSha: "", bumpInput: "patch" }), {
    message: "HEAD is already released as v2.9.5",
  });
});
