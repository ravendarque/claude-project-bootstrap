import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks, renderReal } from "./helpers.mjs";

const extra = { zone_name: "example.test" };
const withBeta = renderReal(["cloudflare-opentofu"], { ...extra, beta: true });
const noBeta = renderReal(["cloudflare-opentofu"], { ...extra, beta: false });
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

test("cloudflare-opentofu pulls in web-app and js-toolchain and adds wrangler", () => {
  const pkg = JSON.parse(read(withBeta, "package.json"));
  assert.ok(pkg.devDependencies.webdriverio);
  assert.ok(pkg.devDependencies.wrangler);
  assert.match(pkg.scripts["e2e:server"], /wrangler dev --env e2e/);
  assert.match(read(withBeta, "pnpm-workspace.yaml"), /\n  "workerd": true/);
});

test("beta adds a beta environment, its DNS record and the promote workflow", () => {
  assert.ok(jsonc(read(withBeta, "wrangler.jsonc")).env.beta);
  assert.ok(existsSync(join(withBeta, "infra/dns-beta.tf")));
  assert.ok(existsSync(join(withBeta, ".github/workflows/promote.yml")));
  assert.match(read(withBeta, ".github/workflows/deploy.yml"), /--env beta/);
});

test("without beta there is no beta environment and tags deploy to production", () => {
  assert.equal(jsonc(read(noBeta, "wrangler.jsonc")).env.beta, undefined);
  assert.ok(!existsSync(join(noBeta, "infra/dns-beta.tf")));
  assert.ok(!existsSync(join(noBeta, ".github/workflows/promote.yml")));
  assert.match(read(noBeta, ".github/workflows/deploy.yml"), /--env production/);
  assert.doesNotMatch(read(noBeta, ".github/workflows/deploy.yml"), /--env beta/);
});

test("every environment repeats the assets binding and only preview has workers.dev", () => {
  const config = jsonc(read(withBeta, "wrangler.jsonc"));
  assert.equal(config.workers_dev, false);
  for (const [name, env] of Object.entries(config.env)) {
    assert.equal(env.assets?.binding, "ASSETS", name);
    assert.equal(env.workers_dev === true, name === "preview", name);
  }
});

test("infra and wrangler config can never ride a release: none", () => {
  const cfg = JSON.parse(read(withBeta, ".github/release-paths.json"));
  for (const path of ["infra/", "wrangler.jsonc"]) assert.ok(cfg.noneForbidden.includes(path), path);
});

test("state lives in the project's own R2 bucket", () => {
  assert.match(read(withBeta, "infra/main.tf"), /bucket\s*=\s*"sample-project-tfstate"/);
});

test("data-bearing records are protected from destroy", () => {
  assert.match(read(withBeta, "infra/dns.tf"), /prevent_destroy = true/);
});

test("the infra README covers setup, disaster recovery and teardown", () => {
  const readme = read(withBeta, "infra/README.md");
  for (const heading of ["## Setup", "## Disaster recovery", "## Teardown"]) assert.ok(readme.includes(heading), heading);
});

test("links resolve with both stack modules", () => {
  assert.deepEqual(brokenLinks(withBeta), []);
});

test("infrastructure runs on OpenTofu", () => {
  const infra = read(withBeta, ".github/workflows/infra.yml");
  assert.match(infra, /opentofu\/setup-opentofu@[0-9a-f]{40} # v2/);
  assert.match(infra, /run: tofu plan/);
  assert.doesNotMatch(infra, /terraform (init|plan|apply)/);
  assert.match(read(withBeta, "infra/README.md"), /OpenTofu/);
});

test("OpenTofu is pinned through a scaffold token and no other version is carried", () => {
  const infra = read(withBeta, ".github/workflows/infra.yml");
  assert.match(infra, /tofu_version: "@@TOFU_VERSION@@"/);
  const tokens = new Set();
  for (const dir of [withBeta, noBeta]) {
    for (const file of readdirSync(join(dir, ".github/workflows"))) {
      for (const [token] of read(dir, `.github/workflows/${file}`).matchAll(/@@[A-Z0-9_]+@@/g)) tokens.add(token);
    }
  }
  assert.deepEqual([...tokens], ["@@TOFU_VERSION@@"]);
});

test("every cloudflare-opentofu workflow pins its runner image", () => {
  const manifest = JSON.parse(readFileSync(new URL("../skills/bootstrap/modules/cloudflare-opentofu/manifest.json", import.meta.url), "utf8"));
  const workflows = manifest.files.map(file => file.to).filter(to => to.startsWith(".github/workflows/"));
  assert.ok(workflows.length > 0);
  for (const dir of [withBeta, noBeta]) {
    for (const to of workflows) {
      if (!existsSync(join(dir, to))) continue;
      const runners = [...read(dir, to).matchAll(/runs-on: (\S+)/g)].map(match => match[1]);
      assert.ok(runners.length > 0, to);
      for (const runner of runners) assert.equal(runner, "ubuntu-24.04", to);
    }
  }
});
