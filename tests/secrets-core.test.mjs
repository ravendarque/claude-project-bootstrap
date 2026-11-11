import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext, resolveEnv } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import { secretExists, setSecret } from "../skills/bootstrap/scripts/secrets/github.mjs";
import { preflight, runCli, storeThenSet } from "../skills/bootstrap/scripts/secrets.mjs";
import { projectDir, stubDeps } from "./helpers-secrets.mjs";

const folder = (id, name, parent = null) => ({ id, share_id: "s", parent_folder_id: parent, content: { name } });
const item = (id, title, folder_id = "f1") => ({ id, title, folder_id, state: "active" });
const isCall = (c, ...words) => c.cmd === "pass-cli" && words.every((w, i) => c.args[i] === w);
const label = c => `${c.cmd} ${c.args.slice(0, 2).join(" ")}`;

function vaultResponder({ folders = [folder("f1", "sample-project")], items = [] } = {}) {
  const live = [...items];
  const known = [...folders];
  return (cmd, args, options) => {
    if (cmd !== "pass-cli") return {};
    const key = args.slice(0, 2).join(" ");
    if (key === "folder list") return { stdout: JSON.stringify(known) };
    if (key === "folder create") {
      known.push(folder("f1", args[args.indexOf("--name") + 1]));
      return {};
    }
    if (key === "item list") return { stdout: JSON.stringify({ items: live, folders: [] }) };
    if (key === "item create") {
      live.push(item(`new${live.length}`, JSON.parse(options.input).title));
      return {};
    }
    return {};
  };
}

const newVault = deps => new Vault(deps, { vault: "Dev", folder: "sample-project" });

test("loadContext reads answers and skipped_envs", () => {
  const ctx = loadContext(projectDir({ zone_name: "example.com", skippedEnvs: "infra,beta" }));
  assert.equal(ctx.owner, "sample-owner");
  assert.equal(ctx.slug, "sample-project");
  assert.equal(ctx.name, "Sample Project");
  assert.equal(ctx.repo, "sample-owner/sample-project");
  assert.equal(ctx.zoneName, "example.com");
  assert.deepEqual(ctx.skippedEnvs, ["infra", "beta"]);
  assert.equal(ctx.answers.slug, "sample-project");
});

test("loadContext refuses a directory with no bootstrap answers", () => {
  assert.throws(() => loadContext(projectDir({ owner: "" })), /owner/);
});

test("loadContext exposes the project directory", () => {
  const dir = projectDir();
  assert.equal(loadContext(dir).dir, dir);
});

test("Vault reads one field of an item by id", async () => {
  const deps = stubDeps(() => ({ stdout: "tok123\n" }));
  assert.equal(await newVault(deps).field("item1", "token id"), "tok123");
  assert.deepEqual(deps.calls[0].args, ["item", "view", "--vault-name", "Dev", "--item-id", "item1", "--field", "token id"]);
});

test("resolveEnv falls back to repository level for skipped environments", () => {
  const ctx = loadContext(projectDir({ skippedEnvs: "infra" }));
  assert.equal(resolveEnv(ctx, "infra"), null);
  assert.equal(resolveEnv(ctx, "production"), "production");
  assert.equal(resolveEnv(ctx, undefined), null);
});

test("Vault errors on two active items with one title", async () => {
  const deps = stubDeps(vaultResponder({ items: [item("a", "release App"), item("b", "release App")] }));
  await assert.rejects(newVault(deps).find("release App"), /2 active items/);
});

test("Vault ignores items in other folders and at the root", async () => {
  const deps = stubDeps(vaultResponder({ items: [item("a", "release App", "other"), { id: "b", title: "release App" }] }));
  assert.equal(await newVault(deps).find("release App"), null);
});

test("Vault errors on two folders with one name", async () => {
  const deps = stubDeps(vaultResponder({ folders: [folder("f1", "sample-project"), folder("f2", "sample-project")] }));
  await assert.rejects(newVault(deps).folderId(), /2 folders/);
});

test("Vault ignores a nested folder of the same name", async () => {
  const deps = stubDeps(vaultResponder({ folders: [folder("f9", "sample-project", "f0")] }));
  assert.equal(await newVault(deps).folderId(), "f1");
  assert.equal(deps.calls.filter(c => isCall(c, "folder", "create")).length, 1);
});

test("Vault creates the folder once", async () => {
  const deps = stubDeps(vaultResponder({ folders: [] }));
  const vault = newVault(deps);
  assert.equal(await vault.folderId(), "f1");
  await vault.folderId();
  const created = deps.calls.filter(c => isCall(c, "folder", "create"));
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].args, ["folder", "create", "--vault-name", "Dev", "--name", "sample-project"]);
});

test("Vault creates a custom item from JSON on stdin and returns its id", async () => {
  const deps = stubDeps(vaultResponder());
  const id = await newVault(deps).create("release App", [{ name: "key", value: "s3cret", hidden: true }, { name: "id", value: "42", hidden: false }], "note");
  assert.equal(id, "new0");
  const create = deps.calls.find(c => isCall(c, "item", "create"));
  assert.deepEqual(create.args, ["item", "create", "custom", "--from-template", "-", "--vault-name", "Dev", "--folder-id", "f1"]);
  const body = JSON.parse(create.input);
  assert.equal(body.title, "release App");
  assert.equal(body.note, "note");
  assert.deepEqual(body.sections[0].fields, [
    { field_name: "key", field_type: "hidden", value: "s3cret" },
    { field_name: "id", field_type: "text", value: "42" },
  ]);
  assert.deepEqual(body.extra_fields, []);
  assert.ok(deps.calls.every(c => !c.args.some(a => a.includes("s3cret"))));
  assert.ok(deps.calls.every(c => !isCall(c, "item", "update")));
});

test("Vault trashes an item by id in its vault", async () => {
  const deps = stubDeps();
  await newVault(deps).trash("a");
  assert.deepEqual(deps.calls[0].args, ["item", "trash", "--vault-name", "Dev", "--item-id", "a"]);
});

test("setSecret passes the value on stdin, never in args", async () => {
  const deps = stubDeps();
  await setSecret(deps, "o/r", "TOKEN", "s3cret", "infra");
  const [call] = deps.calls;
  assert.equal(call.cmd, "gh");
  assert.deepEqual(call.args, ["secret", "set", "TOKEN", "--repo", "o/r", "--env", "infra"]);
  assert.equal(call.input, "s3cret");
  assert.equal(call.env, undefined);
});

test("secretExists reads the names gh lists", async () => {
  const deps = stubDeps(() => ({ stdout: JSON.stringify([{ name: "A" }]) }));
  assert.equal(await secretExists(deps, "o/r", "A"), true);
  assert.equal(await secretExists(deps, "o/r", "B"), false);
});

test("an existing secret short-circuits without --rotate", async () => {
  const dir = projectDir();
  let ran = false;
  const step = { name: "demo", secrets: () => [{ name: "A" }], run: async () => { ran = true; } };
  const deps = stubDeps(cmd => (cmd === "gh" ? { stdout: JSON.stringify([{ name: "A" }]) } : {}));
  assert.equal(await runCli(["demo", dir], deps, { steps: { demo: step } }), 0);
  assert.equal(ran, false);
  assert.match(deps.logs.join("\n"), /already exist/);
  assert.ok(deps.calls.every(c => !c.args.includes("set")));
});

test("--rotate runs the step even when the secrets exist", async () => {
  const dir = projectDir();
  const seen = [];
  const step = { name: "demo", secrets: () => [{ name: "A" }], run: async (ctx, deps, options) => { seen.push(options); } };
  const deps = stubDeps(cmd => (cmd === "gh" ? { stdout: JSON.stringify([{ name: "A" }]) } : {}));
  assert.equal(await runCli(["demo", dir, "--rotate", "--vault", "Work"], deps, { steps: { demo: step } }), 0);
  assert.equal(seen[0].rotate, true);
  assert.equal(seen[0].vault.vault, "Work");
});

test("no or unknown arguments print usage and exit 2", async () => {
  const deps = stubDeps();
  assert.equal(await runCli([], deps, { steps: {} }), 2);
  assert.equal(await runCli(["nope", "dir"], deps, { steps: {} }), 2);
  assert.match(deps.logs.join("\n"), /Usage/);
});

test("preflight reports the missing tool", async () => {
  const deps = stubDeps(cmd => (cmd === "pass-cli" ? { status: 127, stderr: "pass-cli: not found" } : {}));
  await assert.rejects(preflight(deps, {}), /pass-cli.*not installed/);
  assert.deepEqual(deps.calls[0].args, ["auth", "status"]);
});

test("preflight reports a tool that is not signed in", async () => {
  await assert.rejects(preflight(stubDeps(cmd => (cmd === "gh" ? { status: 1 } : {})), {}), /gh.*gh auth login/);
  await assert.rejects(preflight(stubDeps(cmd => (cmd === "pass-cli" ? { status: 1 } : {})), {}), /pass-cli.*pass-cli login/);
});

test("preflight checks the step's own tools last", async () => {
  const deps = stubDeps(cmd => (cmd === "keytool" ? { status: 127 } : {}));
  await assert.rejects(preflight(deps, { tools: ["keytool"] }), /keytool.*not installed/);
  assert.deepEqual(deps.calls.map(c => c.cmd), ["gh", "pass-cli", "keytool"]);
});

const options = (extra = {}) => ({
  title: "release App",
  fields: [{ name: "key", value: "s3cret", hidden: true }],
  note: "n",
  secrets: [{ name: "A", value: "1" }, { name: "B", value: "2", env: "infra" }],
  ...extra,
});

test("a GitHub failure reports what was created", async () => {
  const ctx = loadContext(projectDir());
  const respond = vaultResponder();
  const deps = stubDeps((cmd, args, o) => (cmd === "gh" && args[2] === "B" ? { status: 1, stderr: "boom" } : respond(cmd, args, o)));
  await assert.rejects(storeThenSet(deps, newVault(deps), ctx, options()), { message: "Stored release App in Pass; not set: B" });
});

test("storeThenSet stores in Pass before it sets in GitHub", async () => {
  const ctx = loadContext(projectDir({ skippedEnvs: "infra" }));
  const deps = stubDeps(vaultResponder());
  await storeThenSet(deps, newVault(deps), ctx, options());
  const order = deps.calls.map(label);
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
  const b = deps.calls.filter(c => c.cmd === "gh").find(c => c.args[2] === "B");
  assert.ok(!b.args.includes("--env"), "a skipped environment's secret goes to repository level");
});

test("rotation trashes the old item only after the secrets are set", async () => {
  const ctx = loadContext(projectDir());
  const deps = stubDeps(vaultResponder({ items: [item("old", "release App")] }));
  await storeThenSet(deps, newVault(deps), ctx, options({ rotate: true }));
  const order = deps.calls.map(label);
  const trash = order.indexOf("pass-cli item trash");
  assert.ok(trash > order.lastIndexOf("gh secret set"));
  assert.ok(trash > order.indexOf("pass-cli item create"));
  assert.ok(deps.calls[trash].args.includes("old"));
});

test("rotation with no earlier item creates one and trashes nothing", async () => {
  const ctx = loadContext(projectDir());
  const deps = stubDeps(vaultResponder());
  await storeThenSet(deps, newVault(deps), ctx, options({ rotate: true }));
  assert.ok(deps.calls.some(c => isCall(c, "item", "create")));
  assert.ok(deps.calls.every(c => !isCall(c, "item", "trash")));
  assert.match(deps.logs.join("\n"), /No earlier release App in Pass: creating one/);
});

test("an item left by a failed run stops a plain re-run before anything is created", async () => {
  const ctx = loadContext(projectDir());
  const deps = stubDeps(vaultResponder({ items: [item("old", "release App")] }));
  await assert.rejects(
    storeThenSet(deps, newVault(deps), ctx, options()),
    { message: "An earlier run left release App in Pass but didn't finish setting the secrets: re-run with --rotate to replace it" },
  );
  assert.ok(deps.calls.every(c => !isCall(c, "item", "create") && c.cmd !== "gh"));
});

test("only a GitHub failure marks the error as stored", async () => {
  const ctx = loadContext(projectDir());
  const respond = vaultResponder();
  const github = stubDeps((cmd, args, o) => (cmd === "gh" ? { status: 1 } : respond(cmd, args, o)));
  await assert.rejects(storeThenSet(github, newVault(github), ctx, options()), error => error.stored === true);
  const respondPass = vaultResponder();
  const pass = stubDeps((cmd, args, o) => (cmd === "pass-cli" && args[1] === "create" ? { status: 1 } : respondPass(cmd, args, o)));
  await assert.rejects(storeThenSet(pass, newVault(pass), ctx, options()), error => error.stored === undefined);
});

test("the script runs when launched through a symlinked directory", () => {
  const link = join(mkdtempSync(join(tmpdir(), "link-")), "scripts");
  symlinkSync(fileURLToPath(new URL("../skills/bootstrap/scripts", import.meta.url)), link);
  const result = spawnSync(process.execPath, [join(link, "secrets.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Usage: secrets\.mjs/);
});
