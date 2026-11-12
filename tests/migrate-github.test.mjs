import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithub } from "../skills/bootstrap/scripts/migrate/github.mjs";
import { defaultStateDir, isRepoName, openState } from "../skills/bootstrap/scripts/migrate/state.mjs";
import { runCli } from "../skills/bootstrap/scripts/migrate.mjs";
import { createFake, migrationDeps, scriptedAnswers, seedWorld, stateDir } from "./helpers-migrate.mjs";

function world() {
  const fake = createFake();
  seedWorld(fake);
  const deps = migrationDeps(fake);
  return { fake, deps, gh: createGithub(deps) };
}

test("a rate-limited response waits retry-after on the injected sleep, then succeeds", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 1, retryAfter: 7 });
  assert.ok(await gh.repository("alice", "widgets"));
  assert.deepEqual(fake.sleeps, [7000]);
});

test("a rate limit with no retry-after waits 60 seconds", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 1 });
  await gh.repository("alice", "widgets");
  assert.deepEqual(fake.sleeps, [60_000]);
});

test("a 429 and a GraphQL RATE_LIMITED error are both backed off", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 1, status: 429, retryAfter: 2 });
  fake.limits.push({ match: /^OrganisationId$/, remaining: 1 });
  await gh.repository("alice", "widgets");
  assert.equal(await gh.organisationId("acme"), "ORG_1");
  assert.deepEqual(fake.sleeps, [2000, 60_000]);
});

test("three rate limits in a row is an error, with no wait after the last", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 5, retryAfter: 1 });
  await assert.rejects(gh.repository("alice", "widgets"), /rate-limited .* 3 times in a row/);
  assert.deepEqual(fake.sleeps, [1000, 1000]);
});

test("the count of rate limits starts again for the next call", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 2, retryAfter: 1 });
  await gh.repository("alice", "widgets");
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 2, retryAfter: 1 });
  await gh.repository("alice", "widgets");
  assert.deepEqual(fake.sleeps, [1000, 1000, 1000, 1000]);
});

test("a 403 that isn't a rate limit fails straight away", async () => {
  const sleeps = [];
  const gh = createGithub({
    exec: async () => ({ status: 1, stdout: 'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"Resource not accessible by personal access token"}', stderr: "gh: x (HTTP 403)" }),
    sleep: async ms => sleeps.push(ms),
    log: () => {},
  });
  await assert.rejects(gh.repository("alice", "widgets"), error => error.status === 403 && /not accessible/.test(error.message));
  assert.deepEqual(sleeps, []);
});

test("mutations are spaced a second apart and reads are not", async () => {
  const { fake, gh } = world();
  await gh.repository("alice", "widgets");
  await gh.setVariable("alice/widgets", "A", "1");
  await gh.repository("alice", "widgets");
  await gh.setVariable("alice/widgets", "B", "2");
  await gh.deleteVariable("alice/widgets", "B");
  assert.deepEqual(fake.sleeps, [1000, 1000]);
});

test("a migration waits out a GraphQL rate limit part-way through and carries on", async () => {
  const fake = createFake();
  seedWorld(fake);
  fake.limits.push({ match: /^AddItem$/, remaining: 2, retryAfter: 3 });
  const code = await runCli(["widgets", "--org", "acme"], migrationDeps(fake, scriptedAnswers(fake)), { stateDir: stateDir() });
  assert.equal(code, 0, fake.logs.join("\n"));
  assert.equal(fake.sleeps.filter(ms => ms === 3000).length, 0);
  assert.equal(fake.sleeps.filter(ms => ms === 60_000).length, 2);
});

test("state names are validated and live under the XDG state directory", () => {
  assert.equal(isRepoName("beta-interpreter"), true);
  assert.equal(isRepoName("a.b_c"), true);
  for (const bad of ["", ".", "..", "a/b", "../x", "a b"]) assert.equal(isRepoName(bad), false, bad);
  assert.equal(defaultStateDir({ XDG_STATE_HOME: "/x" }, "/home/u"), "/x/claude-project-bootstrap/migrate");
  assert.equal(defaultStateDir({}, "/home/u"), "/home/u/.local/state/claude-project-bootstrap/migrate");
  assert.throws(() => openState(stateDir(), "../x"), /valid repository name/);
});

test("state persists phases, notes and the mapping", () => {
  const dir = stateDir();
  const first = openState(dir, "widgets");
  first.markDone("inventory");
  first.data.mapping.a = { newId: "b", done: true };
  first.note("one");
  first.note("one");
  const second = openState(dir, "widgets");
  assert.equal(second.isDone("inventory"), true);
  assert.equal(second.isDone("transfer"), false);
  assert.deepEqual(second.data.mapping.a, { newId: "b", done: true });
  assert.deepEqual(second.data.notes, ["one"]);
});

const DIAL = "dial tcp 140.82.121.6:443: i/o timeout";

test("a connection failure on a read is retried with 5, 15 and 45 second backoffs, then recovers", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 3, network: DIAL });
  assert.ok(await gh.repository("alice", "widgets"));
  assert.deepEqual(fake.sleeps, [5000, 15_000, 45_000]);
});

test("a connection failure before a response on a mutation is retried", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^POST repos\/alice\/widgets\/transfer$/, remaining: 1, network: DIAL });
  await gh.transfer("alice", "widgets", "acme");
  assert.deepEqual(fake.sleeps, [5000]);
  assert.equal(fake.mutations.filter(label => label === "transfer").length, 1);
});

test("failures that may have reached GitHub aren't retried for a mutation", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^POST repos\/alice\/widgets\/transfer$/, remaining: 1, network: "read tcp 1.2.3.4:5->6.7.8.9:443: connection reset by peer" });
  await assert.rejects(gh.transfer("alice", "widgets", "acme"), /failed/);
  assert.deepEqual(fake.sleeps, []);
  assert.deepEqual(fake.mutations, []);
});

test("four connection failures in a row is an error that says to re-run", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 9, network: DIAL });
  await assert.rejects(gh.repository("alice", "widgets"), /after 3 retries: check your connection, then re-run to resume/);
  assert.deepEqual(fake.sleeps, [5000, 15_000, 45_000]);
});

test("a 503 on a read is retried", async () => {
  const sleeps = [];
  let calls = 0;
  const gh = createGithub({
    exec: async () => (++calls < 2 ? { status: 1, stdout: 'HTTP/2.0 503 Service Unavailable\r\n\r\n{"message":"unavailable"}', stderr: "gh: x (HTTP 503)" } : { status: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"node_id":"R"}', stderr: "" }),
    sleep: async ms => sleeps.push(ms),
    log: () => {},
  });
  assert.equal((await gh.repository("alice", "widgets")).node_id, "R");
  assert.deepEqual(sleeps, [5000]);
});

test("connection retries and rate-limit retries are counted separately", async () => {
  const { fake, gh } = world();
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 3, network: DIAL });
  fake.limits.push({ match: /^GET repos\/alice\/widgets$/, remaining: 2, retryAfter: 1 });
  assert.ok(await gh.repository("alice", "widgets"));
  assert.equal(fake.sleeps.length, 5);
});

test("a validation failure includes GitHub's error details", async () => {
  const gh = createGithub({
    exec: async () => ({ status: 1, stdout: 'HTTP/2.0 422 Unprocessable Entity\r\n\r\n{"message":"Validation Failed","errors":["This organization does not have GitHub Pages enabled.",{"message":"Second reason"}]}', stderr: "gh: Validation Failed (HTTP 422)" }),
    sleep: async () => {},
    log: () => {},
  });
  await assert.rejects(gh.transfer("alice", "widgets", "acme"), error => error.message === "gh api POST repos/alice/widgets/transfer failed (HTTP 422): Validation Failed: This organization does not have GitHub Pages enabled.; Second reason");
});
