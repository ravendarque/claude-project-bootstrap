import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { Vault } from "../skills/bootstrap/scripts/secrets/vault.mjs";
import androidKeystore, { dnValue } from "../skills/bootstrap/scripts/secrets/steps/android-keystore.mjs";
import { projectDir, stubDeps, vaultResponder } from "./helpers-secrets.mjs";

const KEYSTORE = Buffer.from("fake-keystore-bytes-\u0000\u0001\u0002");
const NAMES = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];

function harness({ name, skippedEnvs, keytoolStatus = 0, answer = "rotate" } = {}) {
  const ctx = loadContext(projectDir({ ...(name && { name }), ...(skippedEnvs && { skippedEnvs }) }));
  const seen = {};
  const pass = vaultResponder();
  const deps = stubDeps((cmd, args, options) => {
    if (cmd !== "keytool") return pass(cmd, args, options);
    seen.args = args;
    seen.env = options.env;
    seen.file = args[args.indexOf("-keystore") + 1];
    seen.dir = dirname(seen.file);
    seen.dirMode = statSync(seen.dir).mode & 0o777;
    if (keytoolStatus) return { status: keytoolStatus, stderr: "keytool error: boom" };
    writeFileSync(seen.file, KEYSTORE, { mode: 0o644 });
    return {};
  });
  deps.prompt = async question => {
    seen.question = question;
    return answer;
  };
  const vault = new Vault(deps, { vault: "Dev", folder: ctx.slug });
  return { ctx, deps, seen, go: (extra = {}) => androidKeystore.run(ctx, deps, { vault, rotate: false, ...extra }) };
}

test("keytool gets the password only through its own env", async () => {
  const { deps, seen, go } = harness();
  await go();
  const { args, env } = seen;
  assert.deepEqual(args.slice(0, 1), ["-genkeypair"]);
  const at = flag => args[args.indexOf(flag) + 1];
  assert.equal(at("-alias"), "upload");
  assert.equal(at("-keyalg"), "RSA");
  assert.equal(at("-keysize"), "4096");
  assert.equal(at("-validity"), "10000");
  assert.equal(at("-dname"), "CN=Sample Project");
  assert.equal(at("-storetype"), "PKCS12");
  assert.equal(at("-storepass:env"), "KS_PASS");
  assert.equal(at("-keypass:env"), "KEY_PASS");
  assert.match(seen.file, /keystore-[^/]+\/sample-project-upload\.jks$/);
  assert.ok(args.includes("-v"));
  assert.ok(env.KS_PASS.length >= 43 && env.KS_PASS === env.KEY_PASS);
  assert.deepEqual(Object.keys(env).sort(), ["KEY_PASS", "KS_PASS"]);
  const base64 = KEYSTORE.toString("base64");
  for (const call of deps.calls) {
    assert.ok(!call.args.some(arg => arg.includes(env.KS_PASS) || arg.includes(base64)), `${call.cmd} args carry no secret`);
  }
  assert.ok(!deps.logs.join("\n").includes(env.KS_PASS));
});

test("the distinguished name is escaped for a free-text project name", async () => {
  const { seen, go } = harness({ name: "Acme, Inc" });
  await go();
  assert.equal(seen.args[seen.args.indexOf("-dname") + 1], "CN=Acme\\, Inc");
  assert.equal(dnValue("#a+b;c=d\"e\\f<g>h "), "\\#a\\+b\\;c\\=d\\\"e\\\\f\\<g\\>h\\ ");
  assert.equal(dnValue(" lead"), "\\ lead");
});

test("the keystore lives in a private directory that is removed afterwards", async () => {
  const { seen, go } = harness();
  await go();
  assert.equal(seen.dirMode, 0o700);
  assert.equal(existsSync(seen.dir), false);
});

test("the keystore directory is removed even when keytool fails", async () => {
  const { deps, seen, go } = harness({ keytoolStatus: 1 });
  await assert.rejects(go(), error => /boom/.test(error.message) && !error.message.includes(seen.env.KS_PASS));
  assert.equal(existsSync(seen.dir), false);
  assert.ok(deps.calls.every(call => call.cmd === "keytool"), "nothing reached Pass or GitHub");
});

test("the item and four release secrets are stored in Pass first", async () => {
  const { deps, seen, go } = harness();
  await go();
  const create = deps.calls.find(call => call.args[0] === "item" && call.args[1] === "create");
  const body = JSON.parse(create.input);
  assert.equal(body.title, "upload keystore");
  assert.deepEqual(body.sections[0].fields, [
    { field_name: "keystore password", field_type: "hidden", value: seen.env.KS_PASS },
    { field_name: "key alias", field_type: "text", value: "upload" },
    { field_name: "keystore (base64)", field_type: "hidden", value: KEYSTORE.toString("base64") },
  ]);
  assert.match(body.note, /offline backup/);
  assert.match(body.note, /key password/);
  const sets = deps.calls.filter(call => call.cmd === "gh");
  assert.deepEqual(sets.map(call => call.args[2]), NAMES);
  for (const call of sets) assert.deepEqual(call.args.slice(3), ["--repo", "sample-owner/sample-project", "--env", "release"]);
  const values = Object.fromEntries(sets.map(call => [call.args[2], call.input]));
  assert.equal(values.ANDROID_KEYSTORE_BASE64, KEYSTORE.toString("base64"));
  assert.equal(values.ANDROID_KEYSTORE_PASSWORD, seen.env.KS_PASS);
  assert.equal(values.ANDROID_KEY_ALIAS, "upload");
  assert.equal(values.ANDROID_KEY_PASSWORD, seen.env.KS_PASS);
  const order = deps.calls.map(call => `${call.cmd} ${call.args.slice(0, 2).join(" ")}`);
  assert.ok(order.indexOf("pass-cli item create") < order.indexOf("gh secret set"));
});

test("four release secrets, or repository level when release is skipped", async () => {
  assert.deepEqual(androidKeystore.secrets(loadContext(projectDir())), NAMES.map(name => ({ name, env: "release" })));
  const { deps, go } = harness({ skippedEnvs: "release" });
  await go();
  for (const call of deps.calls.filter(c => c.cmd === "gh")) assert.ok(!call.args.includes("--env"));
});

test("the step reminds the user about the offline backup", async () => {
  const { deps, go } = harness();
  await go();
  assert.match(deps.logs.at(-1), /offline backup/);
});

test("the step needs keytool", () => {
  assert.deepEqual(androidKeystore.tools, ["keytool"]);
  assert.equal(androidKeystore.name, "android-keystore");
});

test("--rotate warns loudly and needs the word rotate", async () => {
  const refused = harness({ answer: "no" });
  await assert.rejects(refused.go({ rotate: true }), /Not confirmed/);
  assert.equal(refused.deps.calls.length, 0);
  assert.equal(refused.seen.question, "Type rotate to replace the upload key: ");
  assert.match(refused.deps.logs.join("\n"), /WARNING.*existing installs can't update/s);
  const accepted = harness();
  await accepted.go({ rotate: true });
  assert.ok(accepted.deps.calls.some(call => call.cmd === "keytool"));
});
