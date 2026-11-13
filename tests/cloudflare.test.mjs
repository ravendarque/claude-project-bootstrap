import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const PREVIEW_BINDINGS = ["vars", "kv_namespaces", "d1_databases", "r2_buckets", "durable_objects", "ratelimits", "send_email", "version_metadata", "services", "queues"];

test("a Preview repeats every binding of env.preview, because it inherits nothing", () => {
  for (const dir of [withBeta, noBeta]) {
    const { preview } = jsonc(read(dir, "wrangler.jsonc")).env;
    assert.ok(preview.previews, "env.preview.previews");
    assert.deepEqual(preview.previews.vars, { APP_ENV: "preview" });
    for (const key of PREVIEW_BINDINGS.filter(name => name in preview)) assert.deepEqual(preview.previews[key], preview[key], key);
  }
});

test("the Preview upload posts the URL, and prints wrangler's stderr and stdout when it fails", () => {
  const workflow = read(withBeta, ".github/workflows/preview.yml");
  const start = workflow.indexOf("set -euo pipefail\n          ERR=");
  const script = workflow
    .slice(start, workflow.indexOf("      - name: Comment the Preview URL"))
    .split("\n")
    .map(line => line.replace(/^ {10}/, ""))
    .join("\n");
  const scratch = mkdtempSync(join(tmpdir(), "preview-"));
  mkdirSync(join(scratch, "bin"));
  writeFileSync(join(scratch, "bin", "pnpm"), 'printf "%s" "$FAKE_STDOUT"\nprintf "%s" "$FAKE_STDERR" >&2\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 });
  const run = ({ stdout = "", stderr = "", exit = 0 }) => {
    const output = join(scratch, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${join(scratch, "bin")}:${process.env.PATH}`, RUNNER_TEMP: scratch, PR_NUMBER: "1", GITHUB_OUTPUT: output, FAKE_STDOUT: stdout, FAKE_STDERR: stderr, FAKE_EXIT: String(exit) },
      encoding: "utf8",
    });
    return { ...result, written: readFileSync(output, "utf8") };
  };
  const json = '{\n  "preview": {\n    "urls": [\n      "https://pr-1.example.test"\n    ]\n  }\n}\n';

  const ok = run({ stdout: json, stderr: "a warning\n" });
  assert.equal(ok.status, 0);
  assert.equal(ok.written, "url=https://pr-1.example.test\n");

  const failed = run({ stdout: "partial\n", stderr: "Authentication error [code: 10000]\n", exit: 1 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Authentication error/);
  assert.match(failed.stderr, /partial/);
  assert.equal(failed.written, "");

  const none = run({ stdout: "no json here\n", stderr: "something odd\n" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /something odd/);
  assert.match(none.stderr, /no json here/);
  assert.match(none.stdout, /::error::wrangler didn't report a Preview URL/);
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

const tokensIn = dir => JSON.parse(read(dir, ".bootstrap/cloudflare/tokens.json"));
const normalise = names => names.map(name => name.replace(/\bEdit$/, "Write")).sort();

function readmeTokens(dir, beta) {
  const section = read(dir, "infra/README.md").split("### Cloudflare API tokens")[1].split("###")[0];
  return section.split("\n").filter(line => /^\| (Preview|Deploy|Infra plan|Infra apply) \|/.test(line)).map(line => {
    const [, token, secret, permissions] = line.split("|").map(cell => cell.trim());
    const [name, scope] = secret.match(/^`([A-Z_]+)` \((.*)\)$/).slice(1);
    const env = scope === "repository" ? null : [...scope.matchAll(/`([a-z]+)`/g)].map(m => m[1]).filter(e => beta || e !== "beta");
    const names = permissions.replace(/(Account|Zone): /g, "").split(/[,.]\s*/).map(s => s.trim()).filter(Boolean);
    return { token, secret: name, env, permissions: normalise(names) };
  });
}

for (const [label, dir, beta] of [["with beta", withBeta, true], ["without beta", noBeta, false]]) {
  test(`every rendered token entry matches the README table ${label}`, () => {
    const rendered = tokensIn(dir).map(({ token, secret, env, permissions }) => ({ token, secret, env, permissions: normalise(permissions) }));
    assert.deepEqual(rendered, readmeTokens(dir, beta));
  });
}

test("the deploy token's environments follow the beta answer", () => {
  assert.deepEqual(tokensIn(withBeta).find(t => t.token === "Deploy").env, ["production", "beta"]);
  assert.deepEqual(tokensIn(noBeta).find(t => t.token === "Deploy").env, ["production"]);
});

test("the README lists the infra plan token's permissions explicitly", () => {
  const plan = readmeTokens(withBeta, true).find(t => t.token === "Infra plan");
  assert.deepEqual(plan.permissions, normalise(["Workers R2 Storage Read", "Transform Rules Read", "DNS Read", "Zone Settings Read", "Zone WAF Read", "Cache Settings Read"]));
  assert.doesNotMatch(read(withBeta, "infra/README.md"), /read-only version of each/);
});

test("the README says Transform Rules covers every zone in the account", () => {
  assert.match(read(withBeta, "infra/README.md"), /Transform Rules.*account-scoped.*every zone in the account/s);
});

test("every DNS record comment fits Cloudflare's 100-character Free plan limit", () => {
  const dir = "skills/bootstrap/modules/cloudflare-opentofu/templates/infra";
  const comments = readdirSync(dir)
    .filter(file => file.endsWith(".tf"))
    .flatMap(file => [...readFileSync(join(dir, file), "utf8").matchAll(/comment\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map(match => ({ file, text: match[1] })));
  assert.ok(comments.length > 0);
  for (const { file, text } of comments) assert.ok(text.length <= 100, `${file}: ${text.length} characters: ${text}`);
});
