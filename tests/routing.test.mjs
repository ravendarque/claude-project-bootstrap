import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSpawn, isExecutor, DENY_MESSAGE } from "../hooks/routing.js";

const EXEC = "project-bootstrap:bootstrap-executor";

test("other agent types pass through untouched", () => {
  for (const type of ["general-purpose", "Explore", "fork", "other:agent"]) {
    assert.deepEqual(decideSpawn(type, [{ type: EXEC, status: "running" }]), { action: "pass" });
  }
});

test("matches the executor by suffix, whatever the plugin prefix", () => {
  assert.equal(isExecutor("project-bootstrap@x:bootstrap-executor"), true);
  assert.equal(isExecutor("bootstrap-executor-extra"), false);
  assert.equal(isExecutor(undefined), false);
});

test("forces sonnet when no executor is active", () => {
  assert.deepEqual(decideSpawn(EXEC, []), { action: "force", model: "sonnet" });
});

test("denies while another executor is pending, running, waiting or idle", () => {
  for (const status of ["pending", "running", "waiting", "idle"]) {
    assert.deepEqual(decideSpawn(EXEC, [{ type: EXEC, status }]), { action: "deny", message: DENY_MESSAGE });
  }
});

test("completed, failed and killed executors free the slot", () => {
  for (const status of ["completed", "failed", "killed"]) {
    assert.equal(decideSpawn(EXEC, [{ type: EXEC, status }]).action, "force");
  }
});

test("non-executor agents never occupy the slot", () => {
  assert.equal(decideSpawn(EXEC, [{ type: "Explore", status: "running" }]).action, "force");
});

test("denies while a spawn holds the reservation, even with no active executor", () => {
  assert.deepEqual(decideSpawn(EXEC, [], true), { action: "deny", message: DENY_MESSAGE });
  assert.deepEqual(decideSpawn("Explore", [], true), { action: "pass" });
});

test("deny message points follow-ups at the existing executor", () => {
  assert.match(DENY_MESSAGE, /follow-ups to the existing executor/);
});
