import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import { orgVariableExists, setOrgSecret, setOrgVariable } from "../skills/bootstrap/scripts/secrets/github.mjs";
import boardApp from "../skills/bootstrap/scripts/secrets/steps/board-app.mjs";
import boardAppRepo from "../skills/bootstrap/scripts/secrets/steps/board-app-repo.mjs";
import { runCli } from "../skills/bootstrap/scripts/secrets.mjs";
import { folder, projectDir, stubDeps, vaultResponder } from "./helpers-secrets.mjs";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const ctx = options => loadContext(projectDir({ owner: "one-org", owner_type: "Organization", ...options }));
const json = body => ({ ok: true, status: 200, json: async () => body });
const OPTIONS = { pollIntervalMs: 1, pollLimitMs: 50 };

function harness({ ownerKind = "Organization", installed = true, selection = "all", variableExists = false, listFails = false, installations = "one-org-board-sync\tall\n", items = [], folders = [], appUrl = "https://github.com/apps/one-org-board-sync" } = {}) {
  const fetched = [];
  const pages = [];
  const opened = [];
  const vaultFake = vaultResponder({ items, folders });
  const deps = stubDeps((cmd, args, options) => {
    if (cmd === "gh" && args[0] === "api") return { stdout: installations };
    if (cmd === "gh" && args[0] === "variable" && args[1] === "list") {
      if (listFails) return { status: 1, stderr: 'HTTP 403: This API operation needs the "admin:org" scope. To request it, run: gh auth refresh -h github.com -s admin:org' };
      return { stdout: JSON.stringify(variableExists ? [{ name: "BOARD_SYNC_APP_CLIENT_ID" }] : []) };
    }
    if (cmd === "pass-cli" && args[0] === "item" && args[1] === "view") {
      const field = args[args.indexOf("--field") + 1];
      if (field === "App URL" && !appUrl) return { status: 1, stderr: "no such field" };
      return { stdout: { "client id": "Iv1.board", "private key": privateKey, "App URL": appUrl }[field] };
    }
    return vaultFake(cmd, args, options);
  });
  let driver;
  deps.fetch = async (url, init = {}) => {
    fetched.push({ url, init });
    if (url.endsWith("/users/one-org")) return json({ type: ownerKind });
    if (url.endsWith("/conversions")) return json({ id: 8, client_id: "Iv1.board", pem: privateKey, html_url: "https://github.com/apps/one-org-board-sync", slug: "one-org-board-sync" });
    if (url.endsWith("/app/installations")) return json(installed ? [{ id: 5, account: { login: "one-org" }, repository_selection: selection }] : []);
    throw new Error(`unexpected fetch ${url}`);
  };
  deps.openUrl = url => {
    opened.push(url);
    if (!url.startsWith("http://127.0.0.1")) return;
    driver = (async () => {
      const page = await (await fetch(url)).text();
      pages.push(page);
      const state = page.match(/state=([0-9a-f]+)"/)[1];
      await fetch(`${url}callback?code=the-code&state=${state}`);
    })();
  };
  return { deps, fetched, pages, opened, done: () => driver };
}

const runBoardApp = (c, deps, extra = {}) => boardApp.run(c, deps, { vault: new Vault(deps, { vault: "Dev", folder: boardApp.folder(c) }), rotate: false, ...OPTIONS, ...extra });
const callsOf = deps => deps.calls.map(call => `${call.cmd} ${call.args.slice(0, 2).join(" ")}`);

test("the org-level github helpers pass --org and --visibility all, values on stdin", async () => {
  const deps = stubDeps();
  await setOrgSecret(deps, "one-org", "S", "secret-value");
  await setOrgVariable(deps, "one-org", "V", "variable-value");
  assert.deepEqual(deps.calls.map(call => [call.args, call.input]), [
    [["secret", "set", "S", "--org", "one-org", "--visibility", "all"], "secret-value"],
    [["variable", "set", "V", "--org", "one-org", "--visibility", "all"], "variable-value"],
  ]);
});

test("orgVariableExists lists the organisation's variables", async () => {
  const deps = stubDeps(() => ({ stdout: JSON.stringify([{ name: "OTHER" }, { name: "BOARD_SYNC_APP_CLIENT_ID" }]) }));
  assert.equal(await orgVariableExists(deps, "one-org", "BOARD_SYNC_APP_CLIENT_ID"), true);
  assert.equal(await orgVariableExists(deps, "one-org", "MISSING"), false);
  assert.deepEqual(deps.calls[0].args, ["variable", "list", "--org", "one-org", "--json", "name"]);
});

test("board-app asks for organisation Projects write and Issues read, and posts to the organisation", async () => {
  const c = ctx();
  const { deps, pages, done } = harness();
  await runBoardApp(c, deps);
  await done();
  const page = pages[0];
  assert.match(page, /action="https:\/\/github\.com\/organizations\/one-org\/settings\/apps\/new\?state=[0-9a-f]+"/);
  const manifest = JSON.parse(page.match(/name="manifest" value="([^"]*)"/)[1].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)));
  assert.deepEqual(manifest.default_permissions, { organization_projects: "write", issues: "read" });
  assert.equal(manifest.name, "one-org-board-sync");
  assert.equal(manifest.url, "https://github.com/one-org");
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
});

test("board-app stores the key in the organisation's Pass folder, then sets the org secret and variable on stdin", async () => {
  const c = ctx();
  const { deps, fetched, done } = harness();
  await runBoardApp(c, deps);
  await done();
  const order = callsOf(deps);
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
  const folderCreate = deps.calls.find(call => call.args[0] === "folder" && call.args[1] === "create");
  assert.equal(folderCreate.args[folderCreate.args.indexOf("--name") + 1], "one-org");
  const create = deps.calls.find(call => call.args[0] === "item" && call.args[1] === "create");
  const item = JSON.parse(create.input);
  assert.equal(item.title, "board-sync App");
  assert.deepEqual(item.sections[0].fields.map(f => [f.field_name, f.field_type]), [["App id", "text"], ["client id", "text"], ["private key", "hidden"], ["App URL", "text"]]);
  const secret = deps.calls.find(call => call.args[0] === "secret");
  assert.deepEqual(secret.args, ["secret", "set", "BOARD_SYNC_APP_PRIVATE_KEY", "--org", "one-org", "--visibility", "all"]);
  assert.equal(secret.input, privateKey);
  const variable = deps.calls.find(call => call.args[0] === "variable" && call.args[1] === "set");
  assert.deepEqual(variable.args, ["variable", "set", "BOARD_SYNC_APP_CLIENT_ID", "--org", "one-org", "--visibility", "all"]);
  assert.equal(variable.input, "Iv1.board");
  assert.ok(!deps.calls.some(call => call.args.includes("--repo")), "nothing is set at repository level");
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes("PRIVATE KEY")), "no argument carries the PEM");
  assert.ok(!deps.logs.join("\n").includes("PRIVATE KEY"));
  assert.ok(!fetched.some(f => String(f.init.body ?? "").includes("PRIVATE KEY")));
});

test("board-app refuses a user owner before any browser or Pass work", async () => {
  const c = ctx();
  const { deps, opened } = harness({ ownerKind: "User" });
  await assert.rejects(runBoardApp(c, deps), /board-sync App is only for organisation owners.*one-org is a User/s);
  assert.deepEqual(deps.calls, []);
  assert.deepEqual(opened, []);
});

test("board-app does nothing when the organisation variable already exists", async () => {
  const c = ctx();
  const { deps, opened } = harness({ variableExists: true });
  await runBoardApp(c, deps);
  assert.deepEqual(deps.calls.map(call => call.cmd + " " + call.args.slice(0, 2).join(" ")), ["gh variable list", "gh api orgs/one-org/installations"]);
  assert.deepEqual(opened, []);
  assert.match(deps.logs.join("\n"), /already exists for one-org and covers all repositories/);
});

test("board-app's existing-App path fails when the App isn't installed", async () => {
  const { deps, opened } = harness({ variableExists: true, installations: "other-app\tall\n" });
  await assert.rejects(runBoardApp(ctx(), deps), /isn't installed on one-org: install it with "All repositories"/);
  assert.deepEqual(opened, []);
});

test("board-app's existing-App path fails when the installation is on selected repositories", async () => {
  const { deps } = harness({ variableExists: true, installations: "one-org-board-sync\tselected\n" });
  await assert.rejects(runBoardApp(ctx(), deps), /must cover all repositories/);
  assert.match(deps.logs.join("\n"), /Choose All repositories/);
});

test("board-app through the CLI isn't short-circuited by the empty secrets list", async () => {
  const dir = projectDir({ owner: "one-org" });
  const { deps, opened, done } = harness();
  assert.equal(await runCli(["board-app", dir], deps), 0);
  await done();
  assert.ok(opened.some(url => url.endsWith("/installations/new")));
  assert.ok(!deps.logs.join("\n").includes("already exist"));
});

test("board-app asks for All repositories and fails on a narrower installation", async () => {
  const c = ctx();
  const { deps, done } = harness({ selection: "selected" });
  await assert.rejects(runBoardApp(c, deps), /must cover all repositories/);
  await done();
  assert.match(deps.logs.join("\n"), /Choose All repositories/);
});

test("board-app opens the installation page and passes when installed on all repositories", async () => {
  const c = ctx();
  const { deps, opened, done } = harness();
  await runBoardApp(c, deps);
  await done();
  assert.ok(opened.includes("https://github.com/apps/one-org-board-sync/installations/new"));
  assert.match(deps.logs.join("\n"), /All repositories/);
});

test("board-app fails when the App is never installed", async () => {
  const c = ctx();
  const { deps, done } = harness({ installed: false });
  await assert.rejects(runBoardApp(c, deps, { pollLimitMs: 5 }), /wasn't installed/);
  await done();
});

test("board-app has no --rotate", async () => {
  const dir = projectDir({ owner: "one-org" });
  const deps = stubDeps();
  assert.equal(await runCli(["board-app", dir, "--rotate"], deps), 0);
  assert.deepEqual(deps.calls.map(call => call.cmd), ["gh", "pass-cli"]);
  assert.match(deps.logs.join("\n"), /board-app can't rotate.*core:2 "By hand"/);
});

test("board-app's Pass folder is the organisation, not the slug", () => {
  assert.equal(boardApp.folder(ctx()), "one-org");
  assert.deepEqual(boardApp.secrets(ctx()), []);
});

function repoHarness({ items = [{ id: "i1", title: "board-sync App", folder_id: "f9" }] } = {}) {
  const base = vaultResponder({ folders: [folder("f9", "one-org")], items });
  const deps = stubDeps((cmd, args, options) => {
    if (cmd === "pass-cli" && args[0] === "item" && args[1] === "view") {
      const field = args[args.indexOf("--field") + 1];
      return { stdout: field === "private key" ? `${privateKey}\n` : "Iv1.board\n" };
    }
    return base(cmd, args, options);
  });
  return deps;
}

const runRepo = (c, deps) => boardAppRepo.run(c, deps, { vault: new Vault(deps, { vault: "Dev", folder: boardAppRepo.folder(c) }), rotate: false });

test("board-app-repo copies the client id and key from the organisation's Pass item to the repository, on stdin", async () => {
  const c = ctx({ visibility: "private" });
  const deps = repoHarness();
  await runRepo(c, deps);
  const views = deps.calls.filter(call => call.args[0] === "item" && call.args[1] === "view");
  assert.deepEqual(views.map(call => call.args[call.args.indexOf("--field") + 1]).sort(), ["client id", "private key"]);
  const secret = deps.calls.find(call => call.args[0] === "secret");
  assert.deepEqual(secret.args, ["secret", "set", "BOARD_SYNC_APP_PRIVATE_KEY", "--repo", "one-org/sample-project"]);
  assert.equal(secret.input, privateKey.trim());
  const variable = deps.calls.find(call => call.args[0] === "variable");
  assert.deepEqual(variable.args, ["variable", "set", "BOARD_SYNC_APP_CLIENT_ID", "--repo", "one-org/sample-project"]);
  assert.equal(variable.input, "Iv1.board");
  assert.ok(!deps.calls.some(call => call.args[0] === "item" && call.args[1] === "create"), "no Pass item is created");
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes("PRIVATE KEY")), "no argument carries the PEM");
  assert.ok(!deps.logs.join("\n").includes("PRIVATE KEY"));
});

test("board-app-repo refuses a personal owner", async () => {
  const deps = repoHarness();
  await assert.rejects(runRepo(ctx({ visibility: "private", owner_type: "User" }), deps), /board-app-repo is for organisation owners; a personal owner uses board-token/);
  assert.deepEqual(deps.calls, []);
});

test("board-app-repo refuses a public repository", async () => {
  const deps = repoHarness();
  await assert.rejects(runRepo(ctx({ visibility: "public" }), deps), /public repositories read the organisation secret/);
  assert.deepEqual(deps.calls, []);
});

test("board-app-repo tells you to run board-app first when the Pass item is missing", async () => {
  const deps = repoHarness({ items: [] });
  await assert.rejects(runRepo(ctx({ visibility: "private" }), deps), /run board-app first/);
});

test("board-app-repo reads from the organisation folder when run through the CLI", async () => {
  const dir = projectDir({ owner: "one-org", visibility: "private", owner_type: "Organization" });
  const deps = repoHarness();
  assert.equal(await runCli(["board-app-repo", dir], deps), 0);
  assert.ok(deps.calls.some(call => call.args[0] === "secret" && call.args[1] === "set"));
  assert.ok(!deps.calls.some(call => call.args[0] === "folder" && call.args[1] === "create"));
});

test("board-app-repo declares the repository secret", () => {
  assert.deepEqual(boardAppRepo.secrets(ctx()), [{ name: "BOARD_SYNC_APP_PRIVATE_KEY" }]);
});

test("board-app stops before any browser or Pass work when gh lacks the admin:org scope", async () => {
  const c = ctx();
  const { deps, opened } = harness({ listFails: true });
  await assert.rejects(runBoardApp(c, deps), /board-app needs the admin:org scope: run gh auth refresh -h github\.com -s admin:org, then re-run/);
  assert.deepEqual(deps.calls.map(call => call.cmd), ["gh"]);
  assert.deepEqual(opened, []);
});

const earlierItem = { items: [{ id: "i1", title: "board-sync App", folder_id: "f1" }], folders: [folder("f1", "one-org")] };

test("board-app resumes from the Pass item: no second App, both org writes on stdin, then the install check", async () => {
  const c = ctx();
  const { deps, opened, fetched } = harness(earlierItem);
  await runBoardApp(c, deps);
  assert.match(deps.logs.join("\n"), /Resuming: the board-sync App already exists in Pass/);
  assert.ok(!deps.calls.some(call => call.args[0] === "item" && call.args[1] === "create"));
  assert.ok(!opened.some(url => url.startsWith("http://127.0.0.1")), "no manifest callback");
  assert.ok(!fetched.some(f => f.url.endsWith("/conversions")));
  const secret = deps.calls.find(call => call.args[0] === "secret");
  assert.deepEqual(secret.args, ["secret", "set", "BOARD_SYNC_APP_PRIVATE_KEY", "--org", "one-org", "--visibility", "all"]);
  assert.equal(secret.input, privateKey.trim());
  const variable = deps.calls.find(call => call.args[0] === "variable" && call.args[1] === "set");
  assert.equal(variable.input, "Iv1.board");
  assert.deepEqual(variable.args, ["variable", "set", "BOARD_SYNC_APP_CLIENT_ID", "--org", "one-org", "--visibility", "all"]);
  assert.ok(opened.includes("https://github.com/apps/one-org-board-sync/installations/new"));
  assert.match(deps.logs.join("\n"), /installed on all/);
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes("PRIVATE KEY")));
});

test("board-app resume without an App URL sets the values and tells you to install by hand", async () => {
  const c = ctx();
  const { deps, opened, fetched } = harness({ ...earlierItem, appUrl: "" });
  await runBoardApp(c, deps);
  assert.ok(deps.calls.some(call => call.args[0] === "secret" && call.args[1] === "set"));
  assert.deepEqual(opened, []);
  assert.ok(!fetched.some(f => f.url.endsWith("/app/installations")));
  assert.match(deps.logs.join("\n"), /no App URL: open the App's settings/);
});

test("board-app tells you how to recover when Pass fails after the App was created", async () => {
  const c = ctx();
  const { deps, done } = harness();
  const base = deps.exec;
  deps.exec = async (cmd, args, options) => (cmd === "pass-cli" && args[0] === "item" && args[1] === "create" ? { status: 1, stderr: "pass is down" } : base(cmd, args, options));
  await assert.rejects(runBoardApp(c, deps), error => {
    assert.match(error.message, /The App one-org-board-sync exists on GitHub but its key wasn't stored \(.*pass is down.*\)\. Delete it at https:\/\/github\.com\/organizations\/one-org\/settings\/apps\/one-org-board-sync\/advanced, then re-run this step\./);
    assert.ok(error.cause);
    assert.ok(!error.message.includes("PRIVATE KEY"));
    return true;
  });
  await done();
  assert.ok(!deps.calls.some(call => call.args[0] === "secret"));
  for (const call of deps.calls) assert.ok(!call.args.some(arg => arg.includes("PRIVATE KEY")), "no argument carries the PEM");
  assert.ok(!deps.logs.join("\n").includes("PRIVATE KEY"));
});

const SCOPE_ERROR = 'HTTP 403: This API operation needs the "admin:org" scope. To request it, run: gh auth refresh -h github.com -s admin:org';

test("org writes tell you to refresh the gh token when it lacks admin:org, keeping the cause", async () => {
  const deps = stubDeps(() => ({ status: 1, stderr: SCOPE_ERROR }));
  for (const write of [() => setOrgSecret(deps, "one-org", "S", "v"), () => setOrgVariable(deps, "one-org", "V", "v")]) {
    await assert.rejects(write(), error => {
      assert.match(error.message, /needs the admin:org scope: run gh auth refresh -h github\.com -s admin:org, then re-run/);
      assert.match(error.cause.message, /HTTP 403/);
      return true;
    });
  }
});

test("org writes keep gh's own error for other failures", async () => {
  const deps = stubDeps(() => ({ status: 1, stderr: "boom" }));
  await assert.rejects(setOrgSecret(deps, "one-org", "S", "v"), /gh secret set failed \(exit 1\): boom/);
});

test("a failed org write after the Pass item exists is still marked stored, with the scope hint", async () => {
  const c = ctx();
  const { deps, done } = harness();
  const base = deps.exec;
  deps.exec = async (cmd, args, options) => (cmd === "gh" && args[0] === "secret" && args[1] === "set" ? { status: 1, stderr: SCOPE_ERROR } : base(cmd, args, options));
  await assert.rejects(runBoardApp(c, deps), error => {
    assert.equal(error.stored, true);
    assert.match(error.cause.message, /needs the admin:org scope/);
    return true;
  });
  await done();
});
