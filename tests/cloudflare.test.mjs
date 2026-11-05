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

const moduleDoc = readFileSync(new URL("../skills/bootstrap/modules/cloudflare-opentofu/MODULE.md", import.meta.url), "utf8");
const skillDoc = readFileSync(new URL("../skills/bootstrap/SKILL.md", import.meta.url), "utf8");
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, heading);
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next < 0 ? undefined : next);
};

test("environments are created on every plan and each is verified after creation", () => {
  const config = section(moduleDoc, "## 4. GitHub configuration");
  assert.match(config, /on every plan/);
  assert.match(config, /gh api repos\/\$R\/environments\/<env> --jq '\.deployment_branch_policy'/);
  assert.match(config, /"custom_branch_policies":true/);
  assert.match(config, /repos\/\$R\/environments\/<env>\/deployment-branch-policies --jq/);
  for (const expected of ['["branch:main"]', '["branch:main","tag:v*"]', '["tag:v*"]']) assert.ok(config.includes(expected), expected);
});

test("the repository-level fallback is conditional on the check failing", () => {
  const config = section(moduleDoc, "## 4. GitHub configuration");
  assert.match(config, /Fallback, only if a create or a verification above fails/);
  assert.match(config, /state\.mjs skip <dir> github:cloudflare-opentofu:1/);
  assert.match(config, /docs\/threat-model\.md/);
  assert.match(config, /offer the plan upgrade/);
  assert.doesNotMatch(section(moduleDoc, "## 3. Files"), /threat-model/);
  assert.doesNotMatch(moduleDoc, /Free private repository only/);
  assert.doesNotMatch(moduleDoc, /environments aren't available, so/);
});

test("secret commands use --env normally and repository level only on the fallback", () => {
  const manual = section(moduleDoc, "## 5. Manual steps");
  assert.match(manual, /CLOUDFLARE_DEPLOY_TOKEN --repo \$R --env production/);
  assert.match(manual, /CLOUDFLARE_INFRA_APPLY_TOKEN --repo \$R --env infra/);
  assert.match(manual, /TF_STATE_ACCESS_KEY_ID --repo \$R --env infra/);
  assert.match(manual, /recorded an environment as skipped/);
  assert.doesNotMatch(manual, /On a free private repo/);
});

test("the bootstrap skill checks environments on a free private repo rather than assuming", () => {
  const plan = skillDoc.slice(skillDoc.indexOf("**`plan-confirmed`**"), skillDoc.indexOf("**`scaffold`**"));
  assert.doesNotMatch(plan, /environment secrets aren't available/);
  assert.match(plan, /checks\s+rather than assumes/);
  assert.match(plan, /only if that check fails/);
});

const coreDoc = readFileSync(new URL("../skills/bootstrap/modules/core/MODULE.md", import.meta.url), "utf8");

test("no doc reads the plan from the API outside the interview", () => {
  for (const doc of [skillDoc, moduleDoc, coreDoc]) {
    assert.doesNotMatch(doc, /gh api user --jq \.plan\.name/);
  }
  assert.equal(skillDoc.match(/gh api user --jq/g).length, 3);
});

test("the interview asks for the plan only when the token can't read it, for private repos", () => {
  const interview = skillDoc.slice(skillDoc.indexOf("**`interview`**"), skillDoc.indexOf("**`tools`**"));
  assert.match(interview, /gh api user --jq '\.plan\.name \/\/ empty'/);
  assert.match(interview, /`github_plan`/);
  assert.match(interview, /can't read the plan/);
  assert.match(interview, /Public repos get\s+these features on every plan/);
});

test("plan-dependent steps use the recorded github_plan", () => {
  const plan = skillDoc.slice(skillDoc.indexOf("**`plan-confirmed`**"), skillDoc.indexOf("**`scaffold`**"));
  assert.match(plan, /recorded `github_plan`/);
  assert.match(plan, /resumed run uses the saved value/);
  assert.match(coreDoc, /recorded `github_plan` is `free`/);
  assert.match(moduleDoc, /recorded `github_plan` is `free`/);
});
