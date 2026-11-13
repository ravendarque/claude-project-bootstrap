import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../skills/bootstrap/scripts/secrets.mjs";
import { loadContext } from "../skills/bootstrap/scripts/secrets/context.mjs";
import { checkFlagId, defaultConfigDir, resolveAccountId, resolveZoneId } from "../skills/bootstrap/scripts/secrets/ids.mjs";
import { getId, recordId } from "../skills/bootstrap/scripts/state.mjs";
import { projectDir, stubDeps } from "./helpers-secrets.mjs";

const ACCOUNT = "a".repeat(32);
const OTHER_ACCOUNT = "b".repeat(32);
const ZONE = "c".repeat(32);
const OTHER_ZONE = "d".repeat(32);

const configDir = () => mkdtempSync(join(tmpdir(), "config-"));
const configFile = dir => join(dir, "cloudflare.json");

function session(answers = {}) {
  const deps = stubDeps();
  const asked = [];
  deps.prompt = async question => {
    asked.push(question);
    return /account id/i.test(question) ? (answers.account ?? ACCOUNT) : (answers.zone ?? ZONE);
  };
  return { deps, asked };
}

test("a second run prompts for neither id", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  const first = session();
  assert.equal(await resolveAccountId(ctx, first.deps, { configDir: dir }), ACCOUNT);
  assert.equal(await resolveZoneId(ctx, first.deps), ZONE);
  assert.equal(first.asked.length, 2);

  const second = session();
  assert.equal(await resolveAccountId(ctx, second.deps, { configDir: dir }), ACCOUNT);
  assert.equal(await resolveZoneId(ctx, second.deps), ZONE);
  assert.deepEqual(second.asked, []);
  assert.match(second.deps.logs.join("\n"), new RegExp(`Using Cloudflare account id ${ACCOUNT} \\(from stored\\)`));
  assert.match(second.deps.logs.join("\n"), new RegExp(`Using Cloudflare zone id ${ZONE} \\(from stored\\)`));
  assert.match(first.deps.logs.join("\n"), /\(from prompt\)/);
});

test("a second project on the same account prompts only for its zone", async () => {
  const dir = configDir();
  const first = session();
  await resolveAccountId(loadContext(projectDir()), first.deps, { configDir: dir });

  const ctx = loadContext(projectDir({ slug: "second-project" }));
  const second = session({ zone: OTHER_ZONE });
  assert.equal(await resolveAccountId(ctx, second.deps, { configDir: dir }), ACCOUNT);
  assert.equal(await resolveZoneId(ctx, second.deps), OTHER_ZONE);
  assert.equal(second.asked.length, 1);
  assert.match(second.asked[0], /zone id/i);
  assert.equal(getId(ctx.dir, "cloudflare_zone_id"), OTHER_ZONE);
});

test("a flag overrides the stored value and replaces it", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  const { deps, asked } = session();
  await resolveAccountId(ctx, deps, { configDir: dir });
  await resolveZoneId(ctx, deps);

  assert.equal(await resolveAccountId(ctx, deps, { configDir: dir, accountId: OTHER_ACCOUNT }), OTHER_ACCOUNT);
  assert.equal(await resolveZoneId(ctx, deps, { zoneId: OTHER_ZONE }), OTHER_ZONE);
  assert.equal(asked.length, 2);
  assert.equal(JSON.parse(readFileSync(configFile(dir), "utf8")).account_id, OTHER_ACCOUNT);
  assert.equal(getId(ctx.dir, "cloudflare_zone_id"), OTHER_ZONE);
  assert.match(deps.logs.join("\n"), new RegExp(`account id ${OTHER_ACCOUNT} \\(from flag\\)`));
  assert.match(deps.logs.join("\n"), new RegExp(`zone id ${OTHER_ZONE} \\(from flag\\)`));
});

test("a malformed stored value is ignored with a warning, then prompted for and replaced", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  writeFileSync(configFile(dir), JSON.stringify({ account_id: "nope", other: "kept" }));
  recordId(ctx.dir, "cloudflare_zone_id", "also-nope");
  const { deps, asked } = session();
  assert.equal(await resolveAccountId(ctx, deps, { configDir: dir }), ACCOUNT);
  assert.equal(await resolveZoneId(ctx, deps), ZONE);
  assert.equal(asked.length, 2);
  assert.match(deps.logs.join("\n"), /Ignoring the stored Cloudflare account id/);
  assert.match(deps.logs.join("\n"), /Ignoring the stored Cloudflare zone id/);
  assert.deepEqual(JSON.parse(readFileSync(configFile(dir), "utf8")), { account_id: ACCOUNT, other: "kept" });
  assert.equal(getId(ctx.dir, "cloudflare_zone_id"), ZONE);
});

test("an unreadable config file is treated as empty", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  writeFileSync(configFile(dir), "{not json");
  const { deps, asked } = session();
  assert.equal(await resolveAccountId(ctx, deps, { configDir: dir }), ACCOUNT);
  assert.equal(asked.length, 1);
});

test("the config file is written atomically with mode 600, and nothing is stored without a config directory", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  await resolveAccountId(ctx, session().deps, { configDir: dir });
  assert.equal(statSync(configFile(dir)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(configFile(dir), "utf8")), { account_id: ACCOUNT });
  assert.equal(existsSync(`${configFile(dir)}.tmp`), false);
  const { deps, asked } = session();
  await resolveAccountId(ctx, deps);
  await resolveAccountId(ctx, deps);
  assert.equal(asked.length, 2);
});

test("a prompted value that isn't 32 hex characters is refused and not stored", async () => {
  const ctx = loadContext(projectDir());
  const dir = configDir();
  await assert.rejects(resolveAccountId(ctx, session({ account: "short" }).deps, { configDir: dir }), /account id must be 32 hexadecimal/);
  assert.equal(await resolveZoneId(ctx, session().deps), ZONE);
  assert.throws(() => readFileSync(configFile(dir)), /ENOENT/);
});

test("flags are validated as 32 hex characters", () => {
  assert.equal(checkFlagId("--account-id", ` ${ACCOUNT} `), ACCOUNT);
  assert.equal(checkFlagId("--zone-id", undefined), undefined);
  assert.throws(() => checkFlagId("--zone-id", "xyz"), /--zone-id must be 32 hexadecimal characters/);
});

test("the config directory follows XDG_CONFIG_HOME", () => {
  assert.equal(defaultConfigDir({ XDG_CONFIG_HOME: "/x" }, "/home/u"), "/x/claude-project-bootstrap");
  assert.equal(defaultConfigDir({}, "/home/u"), "/home/u/.config/claude-project-bootstrap");
});

test("secrets.mjs passes the flags and the config directory to the step, and refuses a malformed flag", async () => {
  const dir = projectDir();
  const received = [];
  const steps = { "cloudflare-tokens": { secrets: () => [], run: async (ctx, deps, options) => received.push(options) } };
  const deps = stubDeps();
  const config = configDir();
  assert.equal(await runCli(["cloudflare-tokens", dir, "--account-id", ACCOUNT, "--zone-id", ZONE], deps, { steps, configDir: config }), 0, deps.logs.join("\n"));
  assert.equal(received[0].accountId, ACCOUNT);
  assert.equal(received[0].zoneId, ZONE);
  assert.equal(received[0].configDir, config);
  assert.equal(await runCli(["cloudflare-tokens", dir, "--account-id", "bad"], deps, { steps, configDir: config }), 2);
  assert.match(deps.logs.join("\n"), /--account-id must be 32 hexadecimal characters/);
  assert.equal(received.length, 1);
});
