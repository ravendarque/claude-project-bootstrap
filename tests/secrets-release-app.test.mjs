import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import releaseApp, { appJwt, buildManifest, waitForCallback } from "../skills/bootstrap/scripts/secrets/steps/release-app.mjs";
import { runCli } from "../skills/bootstrap/scripts/secrets.mjs";
import { projectDir, stubDeps, vaultResponder } from "./helpers-secrets.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const ctx = () => loadContext(projectDir());
const json = body => ({ ok: true, status: 200, json: async () => body });

test("buildManifest asks for contents and workflows write only", () => {
  const manifest = buildManifest(ctx(), "http://127.0.0.1:1/callback");
  assert.deepEqual(manifest.default_permissions, { contents: "write", workflows: "write" });
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
  assert.equal(manifest.hook_attributes.url, "https://github.com/sample-owner/sample-project");
  assert.equal(manifest.name, "sample-project-release");
  assert.equal(manifest.redirect_url, "http://127.0.0.1:1/callback");
});

test("appJwt verifies with the public key", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const [header, payload, signature] = appJwt("Iv1.abc", privateKey, now).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  const seconds = now.getTime() / 1000;
  assert.deepEqual(claims, { iat: seconds - 60, exp: seconds + 540, iss: "Iv1.abc" });
  assert.ok(createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(createPublicKey(publicKey), Buffer.from(signature, "base64url")));
});

test("callback rejects a wrong state, then resolves on the right one", async () => {
  let origin;
  const waiting = waitForCallback(stubDeps(), "right", {
    manifestFor: redirectUrl => ({ redirect_url: redirectUrl }),
    onListening: ({ url }) => (origin = url),
  });
  while (!origin) await new Promise(resolve => setImmediate(resolve));
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal((await fetch(`${origin}callback?code=c&state=wrong`)).status, 400);
  assert.equal((await fetch(`${origin}callback?code=c`)).status, 400);
  const page = await (await fetch(origin)).text();
  assert.match(page, /name="manifest" value="\{&#34;redirect_url&#34;:&#34;http:\/\/127\.0\.0\.1:\d+\/callback&#34;\}"/);
  assert.match(page, /action="https:\/\/github\.com\/settings\/apps\/new\?state=right"/);
  const ok = await fetch(`${origin}callback?code=abc&state=right`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /You can close this tab/);
  assert.deepEqual(await waiting, { code: "abc", url: `${origin}callback` });
});

test("callback times out with a clear error", async () => {
  await assert.rejects(waitForCallback(stubDeps(), "s", { manifestFor: () => ({}), timeoutMs: 20 }), /Timed out/);
});

function stepHarness({ repos = ["sample-owner/sample-project"], installed = true } = {}) {
  const pem = privateKey;
  const respond = vaultResponder();
  const fetched = [];
  const deps = stubDeps(respond);
  let driver;
  deps.fetch = async (url, init = {}) => {
    fetched.push({ url, init });
    if (url.endsWith("/conversions")) return json({ id: 7, client_id: "Iv1.abc", pem, html_url: "https://github.com/apps/sample-project-release", slug: "sample-project-release", client_secret: "cs", webhook_secret: "ws" });
    if (url.endsWith("/app/installations")) return json(installed ? [{ id: 99, account: { login: "sample-owner" } }] : []);
    if (url.endsWith("/access_tokens")) return json({ token: "inst-token" });
    if (url.endsWith("/installation/repositories")) return json({ repositories: repos.map(full_name => ({ full_name })) });
    throw new Error(`unexpected fetch ${url}`);
  };
  deps.openUrl = url => {
    if (!url.startsWith("http://127.0.0.1")) return;
    driver = (async () => {
      const page = await (await fetch(url)).text();
      const state = page.match(/state=([0-9a-f]+)"/)[1];
      await fetch(`${url}callback?code=the-code&state=${state}`);
    })();
  };
  return { deps, pem, fetched, done: () => driver };
}

test("release-app stores the PEM before setting the secret, and never passes it as an argument", async () => {
  const c = ctx();
  const { deps, pem, fetched, done } = stepHarness();
  const vault = new Vault(deps, { vault: "Dev", folder: c.slug });
  await releaseApp.run(c, deps, { vault, rotate: false, pollIntervalMs: 1, pollLimitMs: 50 });
  await done();
  const order = deps.calls.map(call => `${call.cmd} ${call.args.slice(0, 2).join(" ")}`);
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
  assert.ok(order.includes("gh variable set"));
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes("PRIVATE KEY")), "no argument carries the PEM");
  const create = deps.calls.find(call => call.args[1] === "create" && call.args[0] === "item");
  const fields = JSON.parse(create.input).sections[0].fields;
  assert.deepEqual(fields.map(f => [f.field_name, f.field_type]), [["App id", "text"], ["client id", "text"], ["private key", "hidden"]]);
  assert.equal(deps.calls.find(call => call.args[0] === "secret").input, pem);
  assert.equal(deps.calls.find(call => call.args[0] === "variable").input, "Iv1.abc");
  const conversion = fetched.find(f => f.url.endsWith("/conversions"));
  assert.equal(conversion.url, "https://api.github.com/app-manifests/the-code/conversions");
  assert.equal(conversion.init.method, "POST");
  assert.equal(conversion.init.headers.Authorization, undefined);
  assert.ok(!deps.logs.join("\n").includes("PRIVATE KEY") && !deps.logs.join("\n").includes("inst-token"));
});

test("release-app fails when the installation covers other repositories", async () => {
  const c = ctx();
  const { deps, done } = stepHarness({ repos: ["sample-owner/sample-project", "sample-owner/other"] });
  const vault = new Vault(deps, { vault: "Dev", folder: c.slug });
  await assert.rejects(releaseApp.run(c, deps, { vault, rotate: false, pollIntervalMs: 1, pollLimitMs: 50 }), /exactly sample-owner\/sample-project/);
  await done();
  assert.match(deps.logs.join("\n"), /Only select repositories/);
});

test("release-app fails when the App is never installed", async () => {
  const c = ctx();
  const { deps, done } = stepHarness({ installed: false });
  const vault = new Vault(deps, { vault: "Dev", folder: c.slug });
  await assert.rejects(releaseApp.run(c, deps, { vault, rotate: false, pollIntervalMs: 1, pollLimitMs: 5 }), /wasn't installed/);
  await done();
});

test("release-app has no --rotate", async () => {
  const dir = projectDir();
  const deps = stubDeps();
  assert.equal(await runCli(["release-app", dir, "--rotate"], deps), 0);
  assert.deepEqual(deps.calls.map(call => call.cmd), ["gh", "pass-cli"]);
  assert.match(deps.logs.join("\n"), /release-app can't rotate.*core:1 "By hand"/);
});

test("release-app short-circuits when the secret exists", async () => {
  const dir = projectDir();
  const deps = stubDeps(cmd => (cmd === "gh" ? { stdout: JSON.stringify([{ name: "RELEASE_APP_PRIVATE_KEY" }]) } : {}));
  assert.equal(await runCli(["release-app", dir], deps), 0);
  assert.match(deps.logs.join("\n"), /already exist/);
});
