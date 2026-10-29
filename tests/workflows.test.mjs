import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkReleasePaths } from "../skills/bootstrap/modules/core/templates/github/scripts/check-release-paths.mjs";
import { files, renderReal } from "./helpers.mjs";

const cf = { zone_name: "example.test" };
const renders = {
  core: renderReal([]),
  corePrivate: renderReal([], { visibility: "private" }),
  js: renderReal(["js-toolchain"]),
  web: renderReal(["web-app"]),
  cfBeta: renderReal(["cloudflare-opentofu"], { ...cf, beta: true }),
  cfNoBeta: renderReal(["cloudflare-opentofu"], { ...cf, beta: false }),
};
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const workflows = dir => [...files(dir)].filter(f => f.startsWith(".github/workflows/"));

test("every workflow that checks out code can read contents", () => {
  for (const [name, dir] of Object.entries(renders)) {
    for (const wf of workflows(dir)) {
      const text = read(dir, wf);
      if (text.includes("actions/checkout@")) assert.match(text, /contents: (read|write)/, `${name} ${wf}`);
    }
  }
});

test("releases only come from PRs merged into main", () => {
  assert.match(read(renders.core, ".github/workflows/release.yml"), /types: \[closed\]\n\s+branches: \[main\]/);
});

const releaseLabelsByEcosystem = { "github-actions": "release: none", npm: "release: patch", uv: "release: patch" };

function dependabotUpdates(text) {
  return text
    .split(/^ {2}- (?=package-ecosystem:)/m)
    .slice(1)
    .map(block => ({
      ecosystem: block.match(/^package-ecosystem: "([^"]+)"/)[1],
      labels: [...(block.match(/^ {4}labels:\n((?: {6}- .*\n)+)/m)?.[1] ?? "").matchAll(/- "([^"]+)"/g)].map(m => m[1]),
    }));
}

test("every dependabot update carries exactly the release label for its ecosystem", () => {
  const combinations = { core: renders.core, js: renders.js, web: renders.web, cf: renders.cfBeta, python: renderReal(["python-toolchain"]) };
  for (const [name, dir] of Object.entries(combinations)) {
    const updates = dependabotUpdates(read(dir, ".github/dependabot.yml"));
    assert.ok(updates.length > 0, name);
    for (const { ecosystem, labels } of updates) {
      const expected = releaseLabelsByEcosystem[ecosystem];
      assert.ok(expected, `${name}: no expected label for ${ecosystem}`);
      assert.deepEqual(labels.filter(label => label.startsWith("release:")), [expected], `${name} ${ecosystem}`);
    }
  }
});

test("the labels dependabot applies are ones core creates", () => {
  const created = JSON.parse(read(renders.core, ".bootstrap/github/labels.json")).map(label => label.name);
  for (const label of Object.values(releaseLabelsByEcosystem)) assert.ok(created.includes(label), label);
});

test("a release: none actions bump passes the path guard in every combination", () => {
  const bumped = [".github/workflows/test.yml", ".github/workflows/release.yml", ".github/actions/setup-node-pnpm/action.yml"];
  const combinations = { core: renders.core, js: renders.js, web: renders.web, cf: renders.cfBeta, python: renderReal(["python-toolchain"]) };
  for (const [name, dir] of Object.entries(combinations)) {
    const { ok, offending } = checkReleasePaths(bumped, JSON.parse(read(dir, ".github/release-paths.json")));
    assert.ok(ok, `${name}: ${offending}`);
  }
});

test("deploys only run from release tags", () => {
  for (const dir of [renders.cfBeta, renders.cfNoBeta]) {
    assert.match(read(dir, ".github/workflows/deploy.yml"), /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  }
});

test("a private repo gets no security settings it can't use, no scorecard and no SARIF upload", () => {
  const settings = JSON.parse(read(renders.corePrivate, ".bootstrap/github/repo-settings.json"));
  assert.equal(settings.security_and_analysis, undefined);
  assert.ok(!existsSync(join(renders.corePrivate, ".github/workflows/scorecard.yml")));
  assert.match(read(renders.corePrivate, ".github/workflows/zizmor.yml"), /advanced-security: false/);
  assert.ok(JSON.parse(read(renders.core, ".bootstrap/github/repo-settings.json")).security_and_analysis);
  assert.ok(existsSync(join(renders.core, ".github/workflows/scorecard.yml")));
});

test("infra skips the repository's very first push", () => {
  assert.match(read(renders.cfBeta, ".github/workflows/infra.yml"), /github\.event\.before != '0000000000000000000000000000000000000000'/);
});

test("the infra plan reads state with read-only credentials", () => {
  const infra = read(renders.cfBeta, ".github/workflows/infra.yml");
  assert.match(infra, /TF_STATE_READ_ACCESS_KEY_ID/);
  assert.match(infra, /deletes or replaces/);
});

test("the board sync ignores Dependabot", () => {
  assert.match(read(renders.core, ".github/workflows/project-status-sync.yml"), /github\.actor != 'dependabot\[bot\]'/);
});

test("in-repo actions use the self-repository syntax", () => {
  for (const [name, dir] of Object.entries(renders)) {
    for (const wf of workflows(dir)) assert.doesNotMatch(read(dir, wf), /uses: \.\//, `${name} ${wf}`);
  }
});

test("private repos don't get dependency review", () => {
  assert.ok(!existsSync(join(renders.corePrivate, ".github/workflows/dependency-review.yml")));
  assert.ok(existsSync(join(renders.core, ".github/workflows/dependency-review.yml")));
});

test("infra PR plans and main applies never share a concurrency group", () => {
  assert.match(
    read(renders.cfBeta, ".github/workflows/infra.yml"),
    /group: infra-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| 'apply' \}\}/,
  );
});

test("the release workflow doesn't depend on any module's local action", () => {
  const release = read(renders.core, ".github/workflows/release.yml");
  assert.doesNotMatch(release, /setup-node-pnpm/);
  assert.doesNotMatch(release, /uses: \$\//);
  assert.doesNotMatch(release, /artefact/);
  assert.match(release, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
});

test("web-app attaches its artefact when a release is published", () => {
  const wf = read(renders.web, ".github/workflows/release-artefacts.yml");
  assert.match(wf, /release:\n\s+types: \[published\]/);
  assert.match(wf, /uses: \$\/\.github\/actions\/setup-node-pnpm/);
  assert.match(wf, /gh release upload "\$TAG"/);
  assert.match(wf, /contents: write/);
});

test("dependabot also updates the composite action's pinned actions", () => {
  assert.match(read(renders.js, ".github/dependabot.yml"), /directories:\n\s+- "\/"\n\s+- "\/\.github\/actions\/\*"/);
});

test("cloudflare dev serves on the port the launch config expects", () => {
  assert.match(JSON.parse(read(renders.cfBeta, "package.json")).scripts.dev, /--port 5173/);
});
