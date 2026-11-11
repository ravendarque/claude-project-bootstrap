import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import boardToken, { checkToken, tokenUrl } from "../skills/bootstrap/scripts/secrets/steps/board-token.mjs";
import { projectDir, stubDeps, vaultResponder } from "./helpers-secrets.mjs";

const TOKEN = "ghp_supersecrettoken123";
const ctx = () => loadContext(projectDir());
const reply = (headers, status = 200) => ({ ok: status < 400, status, headers: new Headers(headers) });

function withUser(deps, response) {
  const fetched = [];
  deps.fetch = async (url, init) => {
    fetched.push({ url, init });
    return response;
  };
  return fetched;
}

test("tokenUrl prefills the scope and note", () => {
  assert.equal(tokenUrl(ctx()), "https://github.com/settings/tokens/new?scopes=project&description=sample-project%20board%20sync");
});

test("checkToken accepts exactly the project scope", async () => {
  const deps = stubDeps();
  const fetched = withUser(deps, reply({ "X-OAuth-Scopes": "project" }));
  await checkToken(deps, TOKEN);
  assert.equal(fetched[0].url, "https://api.github.com/user");
  assert.deepEqual(fetched[0].init.headers, { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  withUser(deps, reply({ "X-OAuth-Scopes": "project, repo" }));
  await assert.rejects(checkToken(deps, TOKEN), error => /must have only the project scope; it has: project, repo/.test(error.message) && !error.message.includes(TOKEN));
});

test("checkToken rejects a token GitHub refuses, without echoing it", async () => {
  const deps = stubDeps();
  withUser(deps, reply({}, 401));
  await assert.rejects(checkToken(deps, TOKEN), error => error.message === "GitHub rejected the token (HTTP 401)");
});

test("checkToken returns the expiry header", async () => {
  const deps = stubDeps();
  withUser(deps, reply({ "X-OAuth-Scopes": "project", "GitHub-Authentication-Token-Expiration": "2027-11-08 12:00:00 UTC" }));
  assert.deepEqual(await checkToken(deps, TOKEN), { expires: "2027-11-08 12:00:00 UTC" });
});

test("checkToken warns about a token with no expiry", async () => {
  const deps = stubDeps();
  withUser(deps, reply({ "X-OAuth-Scopes": "project" }));
  assert.deepEqual(await checkToken(deps, TOKEN), { expires: null });
  assert.match(deps.logs.join("\n"), /no expiry.*one-year/i);
});

function run(extra = {}) {
  const c = ctx();
  const deps = stubDeps(vaultResponder());
  const opened = [];
  const prompts = [];
  deps.openUrl = url => opened.push(url);
  deps.prompt = async (question, options) => {
    prompts.push({ question, options });
    return `  ${TOKEN}\n`;
  };
  withUser(deps, reply({ "X-OAuth-Scopes": "project", "GitHub-Authentication-Token-Expiration": "2027-11-08 12:00:00 UTC" }));
  const vault = new Vault(deps, { vault: "Dev", folder: c.slug });
  return { deps, opened, prompts, go: () => boardToken.run(c, deps, { vault, rotate: false, ...extra }) };
}

test("board-token never passes the token as an argument, error or log line", async () => {
  const { deps, opened, prompts, go } = run();
  await go();
  assert.deepEqual(opened, ["https://github.com/settings/tokens/new?scopes=project&description=sample-project%20board%20sync"]);
  assert.deepEqual(prompts[0], { question: "Paste the token: ", options: { hidden: true } });
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes(TOKEN)), "no argument carries the token");
  assert.ok(!deps.logs.join("\n").includes(TOKEN));
  const secret = deps.calls.find(call => call.args[0] === "secret");
  assert.deepEqual(secret.args, ["secret", "set", "PROJECT_STATUS_PAT", "--repo", "sample-owner/sample-project"]);
  assert.equal(secret.input, TOKEN);
  const create = deps.calls.find(call => call.args[0] === "item" && call.args[1] === "create");
  const body = JSON.parse(create.input);
  assert.equal(body.title, "board sync token");
  assert.deepEqual(body.sections[0].fields, [
    { field_name: "token", field_type: "hidden", value: TOKEN },
    { field_name: "expires", field_type: "text", value: "2027-11-08 12:00:00 UTC" },
  ]);
  assert.match(body.note, /PROJECT_STATUS_PAT/);
  const order = deps.calls.map(call => `${call.cmd} ${call.args.slice(0, 2).join(" ")}`);
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
});

test("board-token refuses an empty paste before storing anything", async () => {
  const { deps, go } = run();
  deps.prompt = async () => "  \n";
  await assert.rejects(go(), /No token pasted/);
  assert.equal(deps.calls.length, 0);
});

test("board-token refuses a wrong-scope token before storing anything", async () => {
  const { deps, go } = run();
  withUser(deps, reply({ "X-OAuth-Scopes": "repo" }));
  await assert.rejects(go(), error => /only the project scope/.test(error.message) && !error.message.includes(TOKEN));
  assert.equal(deps.calls.length, 0);
});

test("on --rotate the step says to delete the old token, after the secret is set", async () => {
  const { deps, go } = run({ rotate: true });
  await go().catch(() => {});
  assert.match(deps.logs.at(-1), /Delete the old token at https:\/\/github\.com\/settings\/tokens/);
});
