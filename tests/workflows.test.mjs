import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleasePaths } from "../skills/bootstrap/modules/core/templates/github/scripts/check-release-paths.mjs";
import { files, renderReal } from "./helpers.mjs";

const cf = { zone_name: "example.test" };
const renders = {
  core: renderReal([]),
  coreOrg: renderReal([], { owner_type: "Organization" }),
  corePrivate: renderReal([], { visibility: "private" }),
  js: renderReal(["js-toolchain"]),
  web: renderReal(["web-app"]),
  webPrivate: renderReal(["web-app"], { visibility: "private" }),
  python: renderReal(["python-toolchain"]),
  android: renderReal(["android-toolchain"], { application_id: "org.example.sample" }),
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

const runnerImages = ["ubuntu-26.04", "macos-26"];

function assertPinnedRunners(dir, wfs, name) {
  assert.ok(wfs.length > 0, name);
  for (const wf of wfs) {
    const runners = [...read(dir, wf).matchAll(/^\s*runs-on:\s*(.*?)\s*$/gm)].map(match => match[1]);
    assert.ok(runners.length > 0, `${name} ${wf}`);
    for (const runner of runners) assert.ok(runnerImages.includes(runner), `${name} ${wf}: ${runner}`);
  }
}

test("every job runs on an exactly pinned runner image", () => {
  for (const [name, dir] of Object.entries(renders)) assertPinnedRunners(dir, workflows(dir), name);
});

test("this repository's own workflows run on exactly pinned runner images", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const own = readdirSync(join(root, ".github/workflows")).map(file => `.github/workflows/${file}`);
  assertPinnedRunners(root, own, "repo");
});

test("releases only come from PRs merged into main", () => {
  assert.match(read(renders.core, ".github/workflows/release.yml"), /types: \[closed\]\n\s+branches: \[main\]/);
});

const releaseLabelsByEcosystem = { "github-actions": "release: none", npm: "release: patch", uv: "release: patch", gradle: "release: patch" };

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
  const combinations = { core: renders.core, js: renders.js, web: renders.web, cf: renders.cfBeta, python: renders.python, android: renders.android };
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
  const combinations = { core: renders.core, js: renders.js, web: renders.web, cf: renders.cfBeta, python: renders.python, android: renders.android };
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

const SYNC = ".github/workflows/project-status-sync.yml";

test("the board sync uses the App's token for an organisation and the PAT for a user", () => {
  const org = read(renders.coreOrg, SYNC);
  assert.match(org, /uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d/);
  assert.match(org, /client-id: \$\{\{ vars\.BOARD_SYNC_APP_CLIENT_ID \}\}/);
  assert.match(org, /private-key: \$\{\{ secrets\.BOARD_SYNC_APP_PRIVATE_KEY \}\}/);
  assert.match(org, /owner: \$\{\{ github\.repository_owner \}\}/);
  assert.match(org, /GH_TOKEN: \$\{\{ steps\.token\.outputs\.token \}\}/);
  assert.doesNotMatch(org, /PROJECT_STATUS_PAT/);
  const user = read(renders.core, SYNC);
  assert.match(user, /GH_TOKEN: \$\{\{ secrets\.PROJECT_STATUS_PAT \}\}/);
  assert.doesNotMatch(user, /BOARD_SYNC_APP|create-github-app-token/);
});

test("both board sync variants keep read-only contents and ignore Dependabot", () => {
  for (const dir of [renders.core, renders.coreOrg]) {
    const text = read(dir, SYNC);
    assert.match(text, /permissions:\n  contents: read/);
    assert.match(text, /github\.actor != 'dependabot\[bot\]'/);
  }
});

const SELF_REPOSITORY = /^\$\/[^@\s]+$/;
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d/;

test("every uses: is a self-repository path or pinned to a full commit SHA with a version comment", () => {
  for (const [name, dir] of Object.entries(renders)) {
    const actionFiles = [...files(dir)].filter(f => f.startsWith(".github/workflows/") || /^\.github\/actions\/.+\/action\.ya?ml$/.test(f));
    assert.ok(actionFiles.length > 0, name);
    for (const file of actionFiles) {
      for (const [, ref] of read(dir, file).matchAll(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/gm)) {
        assert.ok(SELF_REPOSITORY.test(ref) || PINNED.test(ref), `${name} ${file}: ${ref}`);
      }
    }
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

const triggers = text => text.match(/^on:\n((?:  .*\n|\n)+)/m)[1];

test("every workflow that runs PR checks cancels superseded runs, and never cancels pushes or releases", () => {
  const exempt = new Set(["project-status-sync.yml", "release.yml"]);
  let checked = 0;
  for (const [name, dir] of Object.entries(renders)) {
    for (const wf of workflows(dir)) {
      const text = read(dir, wf);
      const where = `${name} ${wf}`;
      const cancel = text.match(/^concurrency:\n  group: .+\n  cancel-in-progress: (.+)$/m)?.[1];
      const onPullRequest = /^  pull_request:/m.test(triggers(text));
      if (!onPullRequest) {
        if (cancel !== undefined) assert.equal(cancel, "false", where);
        continue;
      }
      if (exempt.has(wf.split("/").pop())) continue;
      checked++;
      const otherTriggers = triggers(text).match(/^  [a-z_]+:/gm).filter(t => t !== "  pull_request:");
      assert.ok(cancel, where);
      if (otherTriggers.length === 0) assert.equal(cancel, "true", where);
      else assert.equal(cancel, "${{ github.event_name == 'pull_request' }}", where);
    }
  }
  assert.ok(checked >= 8, String(checked));
  assert.match(read(renders.core, ".github/workflows/release.yml"), /cancel-in-progress: false/);
});
