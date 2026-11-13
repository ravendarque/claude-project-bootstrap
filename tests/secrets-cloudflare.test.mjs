import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { saveRun } from "../skills/bootstrap/scripts/state.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import { createHash } from "node:crypto";
import { buildPolicies, bucketResource, cfClient, resolvePermissions, s3Credentials, withBootstrapToken } from "../skills/bootstrap/scripts/secrets/cloudflare.mjs";
import cloudflareR2 from "../skills/bootstrap/scripts/secrets/steps/cloudflare-r2.mjs";
import cloudflareTokens from "../skills/bootstrap/scripts/secrets/steps/cloudflare-tokens.mjs";
import { renderReal } from "./helpers.mjs";
import { stubDeps, vaultResponder } from "./helpers-secrets.mjs";

const ACCOUNT = "a".repeat(32);
const ZONE = "b".repeat(32);
const BOOTSTRAP = "boot-secret-token";
const ACCOUNT_SCOPE = "com.cloudflare.api.account";
const ZONE_SCOPE = "com.cloudflare.api.account.zone";
const R2_SCOPE = "com.cloudflare.edge.r2.bucket";

const NAMES = {
  [ACCOUNT_SCOPE]: ["Workers Scripts Write", "Account Settings Read", "Workers R2 Storage Read", "Workers R2 Storage Write", "Transform Rules Read", "Transform Rules Write"],
  [ZONE_SCOPE]: ["Workers Routes Write", "DNS Read", "DNS Write", "Zone Settings Read", "Zone Settings Write", "Zone WAF Read", "Zone WAF Write", "Cache Settings Read", "Cache Settings Write"],
};
const GROUPS = [
  ...Object.entries(NAMES).flatMap(([scope, names]) => names.map(name => ({ id: `pg-${name.replaceAll(" ", "-")}`, name, scopes: [scope] }))),
  { id: "pg-r2-write", name: "Workers R2 Storage Bucket Item Write", scopes: [R2_SCOPE] },
  { id: "pg-r2-read", name: "Workers R2 Storage Bucket Item Read", scopes: [R2_SCOPE] },
  { id: "decoy", name: "DNS Read", scopes: ["com.cloudflare.api.user"] },
];

const ok = result => ({ ok: true, status: 200, json: async () => ({ success: true, errors: [], result }) });
const failed = (status, message) => ({ ok: false, status, json: async () => ({ success: false, errors: [{ message }] }) });

function rendered(beta = false) {
  const dir = renderReal(["cloudflare-opentofu"], { zone_name: "example.test", beta });
  saveRun(dir, { answers: { owner: "sample-owner", name: "Sample Project", slug: "sample-project", zone_name: "example.test", beta }, modules: ["core"] });
  return dir;
}

function fakeCloudflare({ tamper, failCreateAt, groups = GROUPS } = {}) {
  const log = [];
  const stored = new Map();
  let count = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = url.replace("https://api.cloudflare.com/client/v4", "");
    log.push({ method, path, auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body) });
    if (path === `/accounts/${ACCOUNT}/tokens/verify`) return ok({ id: "self", status: "active" });
    if (path === `/accounts/${ACCOUNT}/tokens/permission_groups`) return ok(groups);
    if (method === "POST" && path === `/accounts/${ACCOUNT}/tokens`) {
      count += 1;
      if (count === failCreateAt) return failed(400, "create refused");
      const body = JSON.parse(init.body);
      const id = `tok${count}`;
      const byId = Object.fromEntries(groups.map(g => [g.id, g]));
      const policies = body.policies.map(p => ({ ...p, permission_groups: p.permission_groups.map(g => ({ id: g.id, name: byId[g.id].name })) }));
      stored.set(id, { id, name: body.name, policies, expires_on: body.expires_on });
      return ok({ id, value: `cfut_value${count}`, name: body.name, policies });
    }
    const match = path.match(new RegExp(`^/accounts/${ACCOUNT}/tokens/([^/]+)$`));
    if (match && method === "GET") {
      const token = structuredClone(stored.get(match[1]));
      if (tamper) tamper(token);
      return ok(token);
    }
    if (match && method === "DELETE") return ok({ id: match[1] });
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { fetch, log, stored };
}

function harness({ beta = false, cf = fakeCloudflare(), items, skippedEnvs, passAnswers, fail, step = cloudflareTokens } = {}) {
  const dir = rendered(beta);
  if (skippedEnvs) {
    saveRun(dir, { answers: { owner: "sample-owner", name: "Sample Project", slug: "sample-project", zone_name: "example.test", beta }, modules: ["core"] });
  }
  const ctx = loadContext(dir);
  if (skippedEnvs) ctx.skippedEnvs = skippedEnvs;
  const pass = vaultResponder({ items });
  const deps = stubDeps((cmd, args, options) => {
    if (fail?.(cmd, args, options)) return { status: 1, stderr: "refused" };
    if (cmd === "pass-cli" && args[0] === "item" && args[1] === "view") return { stdout: `${passAnswers?.[args.find(arg => arg.startsWith("--item-id=")).slice("--item-id=".length)] ?? "oldtok"}\n` };
    return pass(cmd, args, options);
  });
  deps.fetch = cf.fetch;
  deps.prompt = async question => {
    if (/account id/i.test(question)) return ACCOUNT;
    if (/zone id/i.test(question)) return ZONE;
    if (/bootstrap token/i.test(question)) return BOOTSTRAP;
    throw new Error(`unexpected prompt ${question}`);
  };
  const vault = new Vault(deps, { vault: "Dev", folder: ctx.slug });
  return { ctx, deps, cf, run: (extra = {}) => step.run(ctx, deps, { vault, rotate: false, ...extra }) };
}

const label = call => `${call.cmd} ${call.args.slice(0, 2).join(" ")}`;

test("buildPolicies scopes zone permissions to the zone only", () => {
  const policies = buildPolicies(
    [{ id: "w", scope: ACCOUNT_SCOPE }, { id: "r", scope: ACCOUNT_SCOPE }, { id: "d", scope: ZONE_SCOPE }],
    { accountId: ACCOUNT, zoneId: ZONE },
  );
  assert.deepEqual(policies, [
    { effect: "allow", resources: { [`${ACCOUNT_SCOPE}.${ACCOUNT}`]: "*" }, permission_groups: [{ id: "w" }, { id: "r" }] },
    { effect: "allow", resources: { [`${ZONE_SCOPE}.${ZONE}`]: "*" }, permission_groups: [{ id: "d" }] },
  ]);
  assert.equal(buildPolicies([{ id: "w", scope: ACCOUNT_SCOPE }], { accountId: ACCOUNT, zoneId: ZONE }).length, 1);
});

test("permissions resolve by name and scope, and an ambiguous or missing name is an error", async () => {
  const client = { get: async () => GROUPS };
  const resolved = await resolvePermissions(client, ACCOUNT, ["DNS Read", "Transform Rules Write"]);
  assert.deepEqual(resolved, [{ id: "pg-DNS-Read", scope: ZONE_SCOPE }, { id: "pg-Transform-Rules-Write", scope: ACCOUNT_SCOPE }]);
  await assert.rejects(resolvePermissions(client, ACCOUNT, ["Nope"]), /"Nope".*0/);
  const twice = { get: async () => [...GROUPS, { id: "dup", name: "DNS Read", scopes: [ZONE_SCOPE] }] };
  await assert.rejects(resolvePermissions(twice, ACCOUNT, ["DNS Read"]), /"DNS Read".*2/);
});

test("cfClient throws the API's messages and never the token", async () => {
  const deps = stubDeps();
  deps.fetch = async () => failed(403, "Authentication error");
  await assert.rejects(cfClient(deps, "secret-token").get("/x"), error => /Authentication error/.test(error.message) && !error.message.includes("secret-token"));
});

test("withBootstrapToken deletes the token itself, even when the work fails", async () => {
  const cf = fakeCloudflare();
  const deps = stubDeps();
  deps.fetch = cf.fetch;
  deps.prompt = async () => BOOTSTRAP;
  await assert.rejects(withBootstrapToken(deps, ACCOUNT, async () => { throw new Error("work failed"); }), /work failed/);
  assert.deepEqual(cf.log.map(c => `${c.method} ${c.path}`), [`GET /accounts/${ACCOUNT}/tokens/verify`, `DELETE /accounts/${ACCOUNT}/tokens/self`]);
  assert.ok(cf.log.every(c => c.auth === `Bearer ${BOOTSTRAP}`));
  assert.match(deps.logs.join("\n"), /bootstrap token.*deleted/i);
});

test("withBootstrapToken tells the user to revoke it by hand when the deletion fails", async () => {
  const deps = stubDeps();
  deps.fetch = async (url, init = {}) => (init.method === "DELETE" ? failed(500, "nope") : ok({ id: "self", status: "active" }));
  deps.prompt = async () => BOOTSTRAP;
  await withBootstrapToken(deps, ACCOUNT, async () => {});
  assert.match(deps.logs.join("\n"), /revoke it in the dashboard/);
});

test("cloudflare-tokens creates four tokens, reads each back, stores, then sets", async () => {
  const { ctx, deps, cf, run } = harness();
  await run();
  const posts = cf.log.filter(c => c.method === "POST");
  assert.equal(posts.length, 4);
  assert.deepEqual(posts.map(p => p.body.name), ["sample-project Preview", "sample-project Deploy", "sample-project Infra plan", "sample-project Infra apply"]);
  for (const post of posts) {
    assert.match(post.body.expires_on, /^2027-11-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(post.body.expires_on, "2027-11-08T12:00:00Z");
  }
  const infraPlan = posts[2].body.policies;
  assert.deepEqual(infraPlan.map(p => Object.keys(p.resources)[0]), [`${ACCOUNT_SCOPE}.${ACCOUNT}`, `${ZONE_SCOPE}.${ZONE}`]);
  const reads = cf.log.filter(c => c.method === "GET" && /tokens\/tok\d$/.test(c.path));
  assert.equal(reads.length, 4);
  const order = deps.calls.map(label);
  assert.ok(order.indexOf("pass-cli item create") > -1);
  const lastRead = cf.log.findLastIndex(c => /tokens\/tok\d$/.test(c.path));
  assert.ok(lastRead < cf.log.length, "reads happen against the API");
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
  const secrets = deps.calls.filter(c => c.cmd === "gh" && c.args[0] === "secret").map(c => [c.args[2], c.args.includes("--env") ? c.args[c.args.indexOf("--env") + 1] : null]);
  assert.deepEqual(secrets, [
    ["CLOUDFLARE_PREVIEW_TOKEN", null],
    ["CLOUDFLARE_DEPLOY_TOKEN", "production"],
    ["CLOUDFLARE_INFRA_PLAN_TOKEN", null],
    ["CLOUDFLARE_INFRA_APPLY_TOKEN", "infra"],
  ]);
  const variables = deps.calls.filter(c => c.args[0] === "variable");
  assert.equal(variables.length, 1);
  assert.deepEqual(variables[0].args, ["variable", "set", "CLOUDFLARE_ACCOUNT_ID", "--repo", ctx.repo]);
  assert.equal(variables[0].input, ACCOUNT);
  const create = deps.calls.filter(c => c.args[0] === "item" && c.args[1] === "create").map(c => JSON.parse(c.input));
  assert.deepEqual(create.map(i => i.title), ["Cloudflare Preview token", "Cloudflare Deploy token", "Cloudflare Infra plan token", "Cloudflare Infra apply token"]);
  assert.deepEqual(create[0].sections[0].fields, [
    { field_name: "token", field_type: "hidden", value: "cfut_value1" },
    { field_name: "token id", field_type: "text", value: "tok1" },
    { field_name: "expires", field_type: "text", value: "2027-11-08T12:00:00Z" },
  ]);
  assert.equal(cf.log.at(-1).method, "DELETE");
});

test("with a beta environment one deploy token is set in both environments", async () => {
  const { deps, cf, run } = harness({ beta: true });
  await run();
  assert.equal(cf.log.filter(c => c.method === "POST").length, 4);
  const deploy = deps.calls.filter(c => c.args[2] === "CLOUDFLARE_DEPLOY_TOKEN");
  assert.deepEqual(deploy.map(c => c.args[c.args.indexOf("--env") + 1]), ["production", "beta"]);
  assert.equal(new Set(deploy.map(c => c.input)).size, 1);
  assert.deepEqual(cloudflareTokens.secrets(loadContext(rendered(true))).filter(s => s.name === "CLOUDFLARE_DEPLOY_TOKEN").map(s => s.env), ["production", "beta"]);
});

test("a skipped environment's secret goes to repository level", async () => {
  const { deps, run } = harness({ skippedEnvs: ["infra"] });
  await run();
  const apply = deps.calls.find(c => c.args[2] === "CLOUDFLARE_INFRA_APPLY_TOKEN");
  assert.ok(!apply.args.includes("--env"));
});

test("a read-back mismatch stops before Pass and deletes what was created", async () => {
  const cf = fakeCloudflare({ tamper: token => token.policies.at(-1).permission_groups.pop() });
  const { deps, run } = harness({ cf });
  await assert.rejects(run(), /did not match/);
  assert.ok(deps.calls.every(c => c.cmd !== "pass-cli" || c.args[1] !== "create" || c.args[0] !== "item"), "nothing reached Pass");
  assert.ok(deps.calls.every(c => c.cmd !== "gh"));
  assert.ok(cf.log.some(c => c.method === "DELETE" && c.path.endsWith("/tokens/tok1")));
  assert.ok(cf.log.some(c => c.method === "DELETE" && c.path.endsWith("/tokens/self")));
});

test("the bootstrap token is deleted even when a create fails", async () => {
  const cf = fakeCloudflare({ failCreateAt: 3 });
  const { deps, run } = harness({ cf });
  await assert.rejects(run(), /create refused/);
  const deleted = cf.log.filter(c => c.method === "DELETE").map(c => c.path.split("/").at(-1));
  assert.deepEqual(deleted.sort(), ["self", "tok1", "tok2"]);
  assert.ok(deps.calls.every(c => c.cmd !== "gh"));
});

test("no token value appears in exec args, logs or errors", async () => {
  const { deps, run } = harness();
  await run();
  const secrets = ["cfut_value1", "cfut_value2", "cfut_value3", "cfut_value4", BOOTSTRAP];
  for (const call of deps.calls) for (const secret of secrets) assert.ok(!call.args.some(arg => arg.includes(secret)), `${call.cmd} args`);
  for (const secret of secrets) assert.ok(!deps.logs.join("\n").includes(secret));
});

test("an account id that isn't 32 hex characters is refused before anything happens", async () => {
  const { deps, cf, run } = harness();
  deps.prompt = async question => (/account id/i.test(question) ? "not-an-id" : ZONE);
  await assert.rejects(run(), /account id/i);
  assert.equal(cf.log.length, 0);
});

test("an item left by an earlier run stops a plain re-run before any token is made", async () => {
  const { deps, cf, run } = harness({ items: [{ id: "old1", title: "Cloudflare Preview token", folder_id: "f1" }] });
  await assert.rejects(run(), /earlier run left Cloudflare Preview token.*--rotate/);
  assert.equal(cf.log.length, 0);
  assert.ok(deps.calls.every(c => c.cmd !== "gh"));
});

test("rotation revokes the old token ids recorded in the previous items after the secrets are set", async () => {
  const items = ["Preview", "Deploy", "Infra plan", "Infra apply"].map((name, i) => ({ id: `old${i}`, title: `Cloudflare ${name} token`, folder_id: "f1" }));
  const passAnswers = { old0: "oldtok0", old1: "oldtok1", old2: "oldtok2", old3: "oldtok3" };
  const { deps, cf, run } = harness({ items, passAnswers });
  await run({ rotate: true });
  const views = deps.calls.filter(c => c.args[0] === "item" && c.args[1] === "view");
  assert.deepEqual(views.map(c => c.args.at(-1)), ["token id", "token id", "token id", "token id"]);
  const deletes = cf.log.map((c, index) => ({ ...c, index })).filter(c => c.method === "DELETE" && /oldtok\d/.test(c.path));
  assert.deepEqual(deletes.map(c => c.path.split("/").at(-1)), ["oldtok0", "oldtok1", "oldtok2", "oldtok3"]);
  assert.ok(cf.log.findIndex(c => c.method === "DELETE" && c.path.endsWith("tokens/self")) > deletes.at(-1).index);
  const lastSecret = deps.calls.map(label).lastIndexOf("gh secret set");
  const trash = deps.calls.map(label).lastIndexOf("pass-cli item trash");
  assert.ok(trash > lastSecret);
});

const deletedTokens = cf => cf.log.filter(c => c.method === "DELETE").map(c => c.path.split("/").at(-1));
const createsItem = title => (cmd, args, options) => cmd === "pass-cli" && args[0] === "item" && args[1] === "create" && JSON.parse(options.input).title === title;

test("a Pass failure at the second token revokes it and the two after, and keeps the first", async () => {
  const cf = fakeCloudflare();
  const { run } = harness({ cf, fail: createsItem("Cloudflare Deploy token") });
  await assert.rejects(run(), /pass-cli item create failed/);
  assert.deepEqual(deletedTokens(cf).sort(), ["self", "tok2", "tok3", "tok4"]);
});

test("a GitHub failure at the second token keeps it and revokes the two after", async () => {
  const cf = fakeCloudflare();
  const { run } = harness({ cf, fail: (cmd, args) => cmd === "gh" && args[2] === "CLOUDFLARE_DEPLOY_TOKEN" });
  await assert.rejects(run(), /Stored Cloudflare Deploy token in Pass; not set: CLOUDFLARE_DEPLOY_TOKEN/);
  assert.deepEqual(deletedTokens(cf).sort(), ["self", "tok3", "tok4"]);
});

test("a failed store during rotation revokes only the old tokens already replaced", async () => {
  const items = ["Preview", "Deploy", "Infra plan", "Infra apply"].map((name, i) => ({ id: `old${i}`, title: `Cloudflare ${name} token`, folder_id: "f1" }));
  const cf = fakeCloudflare();
  const { run } = harness({ cf, items, passAnswers: { old0: "oldtok0", old1: "oldtok1" }, fail: createsItem("Cloudflare Deploy token") });
  await assert.rejects(run({ rotate: true }), /pass-cli item create failed/);
  assert.deepEqual(deletedTokens(cf).filter(id => id.startsWith("oldtok")), ["oldtok0"]);
});

test("a revoke that fails is reported for the dashboard", async () => {
  const cf = fakeCloudflare();
  const inner = cf.fetch;
  cf.fetch = async (url, init = {}) => (init.method === "DELETE" && url.endsWith("/tok3") ? failed(500, "nope") : inner(url, init));
  const { deps, run } = harness({ cf, fail: createsItem("Cloudflare Deploy token") });
  await assert.rejects(run(), /pass-cli item create failed/);
  assert.match(deps.logs.join("\n"), /tok3.*revoke it in the dashboard/);
});

test("s3Credentials derives the key id and the SHA-256 secret", () => {
  assert.deepEqual(s3Credentials({ id: "abc", value: "secret" }), {
    accessKeyId: "abc",
    secretAccessKey: "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
  });
});

test("bucketResource names the default jurisdiction", () => {
  assert.equal(bucketResource(ACCOUNT, "sample-project-tfstate"), `com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_sample-project-tfstate`);
});

test("resolvePermissions can be limited to the R2 bucket scope", async () => {
  const client = { get: async () => GROUPS };
  assert.deepEqual(await resolvePermissions(client, ACCOUNT, ["Workers R2 Storage Bucket Item Read"], [R2_SCOPE]), [{ id: "pg-r2-read", scope: R2_SCOPE }]);
  await assert.rejects(resolvePermissions(client, ACCOUNT, ["Workers R2 Storage Bucket Item Read"]), /matched 0/);
});

const r2 = options => harness({ step: cloudflareR2, ...options });

test("cloudflare-r2 makes two tokens scoped to the state bucket and reads them back", async () => {
  const { cf, run } = r2();
  await run();
  const posts = cf.log.filter(c => c.method === "POST");
  assert.deepEqual(posts.map(p => p.body.name), ["sample-project R2 state read-write", "sample-project R2 state read-only"]);
  const resource = `${R2_SCOPE}.${ACCOUNT}_default_sample-project-tfstate`;
  assert.deepEqual(posts[0].body.policies, [{ effect: "allow", resources: { [resource]: "*" }, permission_groups: [{ id: "pg-r2-write" }] }]);
  assert.deepEqual(posts[1].body.policies, [{ effect: "allow", resources: { [resource]: "*" }, permission_groups: [{ id: "pg-r2-read" }] }]);
  assert.equal(posts[0].body.expires_on, "2027-11-08T12:00:00Z");
  assert.equal(cf.log.filter(c => c.method === "GET" && /tokens\/tok\d$/.test(c.path)).length, 2);
  assert.ok(cf.log.some(c => c.path.endsWith("/tokens/self") && c.method === "DELETE"));
  assert.ok(cf.log.every(c => !/zones/.test(c.path)));
});

test("read-write goes to infra and read-only to repository level", async () => {
  const { deps, run } = r2();
  await run();
  const secrets = deps.calls.filter(c => c.cmd === "gh").map(c => [c.args[2], c.args.includes("--env") ? c.args[c.args.indexOf("--env") + 1] : null]);
  assert.deepEqual(secrets, [
    ["TF_STATE_ACCESS_KEY_ID", "infra"],
    ["TF_STATE_SECRET_ACCESS_KEY", "infra"],
    ["TF_STATE_READ_ACCESS_KEY_ID", null],
    ["TF_STATE_READ_SECRET_ACCESS_KEY", null],
  ]);
  const inputs = Object.fromEntries(deps.calls.filter(c => c.cmd === "gh").map(c => [c.args[2], c.input]));
  assert.equal(inputs.TF_STATE_ACCESS_KEY_ID, "tok1");
  assert.equal(inputs.TF_STATE_SECRET_ACCESS_KEY, createHash("sha256").update("cfut_value1").digest("hex"));
  assert.equal(inputs.TF_STATE_READ_ACCESS_KEY_ID, "tok2");
  assert.equal(inputs.TF_STATE_READ_SECRET_ACCESS_KEY, createHash("sha256").update("cfut_value2").digest("hex"));
});

test("both R2 pairs go to repository level when infra is skipped", async () => {
  const { deps, run } = r2({ skippedEnvs: ["infra"] });
  await run();
  assert.ok(deps.calls.filter(c => c.cmd === "gh").every(c => !c.args.includes("--env")));
});

test("the R2 step lists its four secrets", () => {
  assert.deepEqual(cloudflareR2.secrets(loadContext(rendered())), [
    { name: "TF_STATE_ACCESS_KEY_ID", env: "infra" },
    { name: "TF_STATE_SECRET_ACCESS_KEY", env: "infra" },
    { name: "TF_STATE_READ_ACCESS_KEY_ID" },
    { name: "TF_STATE_READ_SECRET_ACCESS_KEY" },
  ]);
  assert.equal(cloudflareR2.name, "cloudflare-r2");
});

test("the R2 Pass items hold the S3 pair, not the raw token", async () => {
  const { deps, run } = r2();
  await run();
  const items = deps.calls.filter(c => c.args[0] === "item" && c.args[1] === "create").map(c => JSON.parse(c.input));
  assert.deepEqual(items.map(i => i.title), ["R2 state read-write", "R2 state read-only"]);
  assert.deepEqual(items[0].sections[0].fields, [
    { field_name: "access key id", field_type: "text", value: "tok1" },
    { field_name: "secret access key", field_type: "hidden", value: createHash("sha256").update("cfut_value1").digest("hex") },
    { field_name: "token id", field_type: "text", value: "tok1" },
    { field_name: "expires", field_type: "text", value: "2027-11-08T12:00:00Z" },
  ]);
  assert.ok(!JSON.stringify(items).includes("cfut_value"));
});

test("no R2 secret appears in exec args, logs or errors", async () => {
  const { deps, run } = r2();
  await run();
  const secrets = ["cfut_value1", "cfut_value2", BOOTSTRAP, ...[1, 2].map(n => createHash("sha256").update(`cfut_value${n}`).digest("hex"))];
  for (const call of deps.calls) for (const secret of secrets) assert.ok(!call.args.some(arg => arg.includes(secret)), `${call.cmd} args`);
  for (const secret of secrets) assert.ok(!deps.logs.join("\n").includes(secret));
});

test("an R2 Pass failure at the second token revokes it and keeps the first", async () => {
  const cf = fakeCloudflare();
  const { run } = r2({ cf, fail: createsItem("R2 state read-only") });
  await assert.rejects(run(), /pass-cli item create failed/);
  assert.deepEqual(deletedTokens(cf).sort(), ["self", "tok2"]);
});

test("an item left by an earlier run stops a plain R2 re-run before any token is made", async () => {
  const { cf, run } = r2({ items: [{ id: "old1", title: "R2 state read-only", folder_id: "f1" }] });
  await assert.rejects(run(), /earlier run left R2 state read-only.*--rotate/);
  assert.equal(cf.log.length, 0);
});

test("R2 rotation revokes the old tokens after the secrets are set", async () => {
  const items = ["R2 state read-write", "R2 state read-only"].map((title, i) => ({ id: `old${i}`, title, folder_id: "f1" }));
  const { deps, cf, run } = r2({ items, passAnswers: { old0: "oldtok0", old1: "oldtok1" } });
  await run({ rotate: true });
  const deletes = cf.log.map((c, index) => ({ ...c, index })).filter(c => c.method === "DELETE" && /oldtok\d/.test(c.path));
  assert.deepEqual(deletes.map(c => c.path.split("/").at(-1)), ["oldtok0", "oldtok1"]);
  assert.ok(deps.calls.map(label).lastIndexOf("gh secret set") > -1);
  assert.ok(cf.log.findIndex(c => c.path.endsWith("tokens/self") && c.method === "DELETE") > deletes.at(-1).index);
});

const oldItems = titles => titles.map((title, i) => ({ id: `old${i}`, title, folder_id: "f1" }));
const oldTokens = { old0: "oldtok0", old1: "oldtok1", old2: "oldtok2", old3: "oldtok3" };

test("a failed rotation at the third token revokes the first two old tokens and keeps the rest", async () => {
  const cf = fakeCloudflare();
  const items = oldItems(["Preview", "Deploy", "Infra plan", "Infra apply"].map(name => `Cloudflare ${name} token`));
  const { run } = harness({ cf, items, passAnswers: oldTokens, fail: createsItem("Cloudflare Infra plan token") });
  await assert.rejects(run({ rotate: true }), /pass-cli item create failed/);
  assert.deepEqual(deletedTokens(cf).sort(), ["oldtok0", "oldtok1", "self", "tok3", "tok4"]);
});

test("a failed R2 rotation at the second pair keeps the second old token", async () => {
  const cf = fakeCloudflare();
  const items = oldItems(["R2 state read-write", "R2 state read-only"]);
  const { run } = r2({ cf, items, passAnswers: oldTokens, fail: createsItem("R2 state read-only") });
  await assert.rejects(run({ rotate: true }), /pass-cli item create failed/);
  assert.deepEqual(deletedTokens(cf).sort(), ["oldtok0", "self", "tok2"]);
});

test("a GitHub failure at a rotated token keeps its old token, which GitHub still holds", async () => {
  const cf = fakeCloudflare();
  const items = oldItems(["Preview", "Deploy", "Infra plan", "Infra apply"].map(name => `Cloudflare ${name} token`));
  const { run } = harness({ cf, items, passAnswers: oldTokens, fail: (cmd, args) => cmd === "gh" && args[2] === "CLOUDFLARE_DEPLOY_TOKEN" });
  await assert.rejects(run({ rotate: true }), /not set: CLOUDFLARE_DEPLOY_TOKEN/);
  assert.deepEqual(deletedTokens(cf).sort(), ["oldtok0", "self", "tok3", "tok4"]);
});

test("a second project on the same account asks only for its zone id, and the first run's ids are stored", async () => {
  const config = mkdtempSync(join(tmpdir(), "config-"));
  const asking = harness();
  const asked = [];
  const inner = asking.deps.prompt;
  asking.deps.prompt = async question => {
    asked.push(question);
    return inner(question);
  };
  await asking.run({ configDir: config });
  assert.equal(asked.filter(question => /account id/i.test(question)).length, 1);
  assert.equal(asked.filter(question => /zone id/i.test(question)).length, 1);
  assert.equal(JSON.parse(readFileSync(join(config, "cloudflare.json"), "utf8")).account_id, ACCOUNT);

  const next = harness();
  const nextAsked = [];
  const nextInner = next.deps.prompt;
  next.deps.prompt = async question => {
    nextAsked.push(question);
    return nextInner(question);
  };
  await next.run({ configDir: config });
  assert.equal(nextAsked.some(question => /account id/i.test(question)), false);
  assert.equal(nextAsked.some(question => /zone id/i.test(question)), true);

  const r2 = harness({ step: cloudflareR2 });
  const r2Asked = [];
  const r2Inner = r2.deps.prompt;
  r2.deps.prompt = async question => {
    r2Asked.push(question);
    return r2Inner(question);
  };
  await r2.run({ configDir: config });
  assert.equal(r2Asked.some(question => /account id/i.test(question)), false);
});
