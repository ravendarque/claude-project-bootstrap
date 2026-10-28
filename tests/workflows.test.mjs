import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { files, renderReal } from "./helpers.mjs";

const cf = { zone_name: "example.test" };
const renders = {
  core: renderReal([]),
  corePrivate: renderReal([], { visibility: "private" }),
  js: renderReal(["js-toolchain"]),
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

test("dependabot PRs carry a release label", () => {
  const core = read(renders.core, ".github/dependabot.yml");
  assert.match(core, /labels:\n\s+- "release: none"/);
  const js = read(renders.js, ".github/dependabot.yml");
  assert.match(js, /package-ecosystem: "npm"[\s\S]*?labels:\n\s+- "release: patch"/);
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
