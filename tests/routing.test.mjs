import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSpawn, isExecutor, DENY_MESSAGE } from "../hooks/routing.js";

const EXEC = "project-bootstrap:bootstrap-executor";
const DENY = { action: "deny", message: DENY_MESSAGE };

test("an allowed non-executor passes through", () => {
  for (const type of ["general-purpose", "Explore", "fork", "other:agent"]) {
    assert.deepEqual(decideSpawn(type, []), { action: "pass" });
  }
});

test("matches the executor by suffix, whatever the plugin prefix", () => {
  assert.equal(isExecutor("project-bootstrap@x:bootstrap-executor"), true);
  assert.equal(isExecutor("bootstrap-executor-extra"), false);
  assert.equal(isExecutor(undefined), false);
});

test("forces sonnet on the executor when no subagent is active", () => {
  assert.deepEqual(decideSpawn(EXEC, []), { action: "force", model: "sonnet" });
});

test("denies any spawn while a subagent is pending, running, waiting or idle", () => {
  for (const status of ["pending", "running", "waiting", "idle"]) {
    assert.deepEqual(decideSpawn(EXEC, [{ type: EXEC, status }]), DENY);
    assert.deepEqual(decideSpawn("Explore", [{ type: EXEC, status }]), DENY);
    assert.deepEqual(decideSpawn(EXEC, [{ type: "Explore", status }]), DENY);
    assert.deepEqual(decideSpawn("general-purpose", [{ type: "Explore", status }]), DENY);
  }
});

test("completed, failed and killed subagents free the slot", () => {
  for (const status of ["completed", "failed", "killed"]) {
    assert.equal(decideSpawn(EXEC, [{ type: "Explore", status }]).action, "force");
    assert.equal(decideSpawn("Explore", [{ type: EXEC, status }]).action, "pass");
  }
});

test("one active subagent among finished ones still denies", () => {
  const agents = [
    { type: "Explore", status: "completed" },
    { type: "general-purpose", status: "idle" },
  ];
  assert.deepEqual(decideSpawn("Explore", agents), DENY);
});

test("denies any spawn while a spawn holds the reservation, even with no active subagent", () => {
  assert.deepEqual(decideSpawn(EXEC, [], true), DENY);
  assert.deepEqual(decideSpawn("Explore", [], true), DENY);
});

test("deny message names the rule, the reason and the alternative", () => {
  assert.match(DENY_MESSAGE, /only one subagent may run at a time/);
  assert.match(DENY_MESSAGE, /token limits/);
  assert.match(DENY_MESSAGE, /Wait for the running subagent/);
  assert.match(DENY_MESSAGE, /follow-ups/);
  assert.match(DENY_MESSAGE, /every project/);
});
