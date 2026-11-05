import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSpawn, DENY_MESSAGE } from "../hooks/routing.js";

const FORCE = { action: "force", model: "sonnet" };
const DENY = { action: "deny", message: DENY_MESSAGE };

test("forces sonnet on an allowed spawn", () => {
  assert.deepEqual(decideSpawn(false, []), FORCE);
});

test("a fork passes through untouched, because its model is ignored", () => {
  assert.deepEqual(decideSpawn(true, []), { action: "pass" });
});

test("denies any spawn while a subagent is pending, running, waiting or idle", () => {
  for (const status of ["pending", "running", "waiting", "idle"]) {
    assert.deepEqual(decideSpawn(false, [{ type: "Explore", status }]), DENY);
    assert.deepEqual(decideSpawn(true, [{ type: "Explore", status }]), DENY);
  }
});

test("completed, failed and killed subagents free the slot", () => {
  for (const status of ["completed", "failed", "killed"]) {
    assert.deepEqual(decideSpawn(false, [{ type: "Explore", status }]), FORCE);
    assert.equal(decideSpawn(true, [{ type: "Explore", status }]).action, "pass");
  }
});

test("one active subagent among finished ones still denies", () => {
  const agents = [
    { type: "Explore", status: "completed" },
    { type: "general-purpose", status: "idle" },
  ];
  assert.deepEqual(decideSpawn(false, agents), DENY);
});

test("denies any spawn while a spawn holds the reservation, even with no active subagent", () => {
  assert.deepEqual(decideSpawn(false, [], true), DENY);
  assert.deepEqual(decideSpawn(true, [], true), DENY);
});

test("deny message names the rule, the reason and the alternative", () => {
  assert.match(DENY_MESSAGE, /only one subagent may run at a time/);
  assert.match(DENY_MESSAGE, /token limits/);
  assert.match(DENY_MESSAGE, /Wait for the running subagent/);
  assert.match(DENY_MESSAGE, /follow-ups/);
  assert.match(DENY_MESSAGE, /every project/);
});
