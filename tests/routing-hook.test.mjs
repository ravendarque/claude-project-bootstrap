import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "../hooks/register.js";

const EXEC = "project-bootstrap:bootstrap-executor";
const tick = () => new Promise((resolve) => setImmediate(resolve));

function load() {
  let hook;
  let onCatch;
  register((event, fn) => {
    assert.equal(event, "agent.spawn");
    hook = fn;
    return { catch: (c) => (onCatch = c) };
  });
  return { hook, onCatch };
}

const fakeApi = (agents = []) => ({
  agent: {
    list: async () => {
      await tick();
      return agents;
    },
  },
});

const fakeNext = async (e) => {
  await tick();
  return { model: e.model };
};

test("two concurrent executor spawns: one forced to sonnet, one denied, slot free after", async () => {
  const { hook } = load();
  const $ = fakeApi();
  const spawn = () => hook($, { subagentType: EXEC, model: "opus" }, fakeNext);
  const results = await Promise.all([spawn(), spawn()]);
  assert.deepEqual(results.filter((r) => r.model), [{ model: "sonnet" }]);
  assert.equal(results.filter((r) => r.deny).length, 1);
  assert.deepEqual(await spawn(), { model: "sonnet" });
});

test("a spawn denied by the list check releases the reservation", async () => {
  const { hook } = load();
  const busy = fakeApi([{ type: EXEC, status: "running" }]);
  const denied = await hook(busy, { subagentType: EXEC }, fakeNext);
  assert.ok(denied.deny);
  assert.deepEqual(await hook(fakeApi(), { subagentType: EXEC }, fakeNext), { model: "sonnet" });
});

test("a failing spawn releases the reservation", async () => {
  const { hook } = load();
  const boom = async () => {
    throw new Error("spawn failed");
  };
  await assert.rejects(hook(fakeApi(), { subagentType: EXEC }, boom), /spawn failed/);
  assert.deepEqual(await hook(fakeApi(), { subagentType: EXEC }, fakeNext), { model: "sonnet" });
});

test("other agent types pass through untouched while the slot is held", async () => {
  const { hook } = load();
  const $ = fakeApi();
  const held = hook($, { subagentType: EXEC }, fakeNext);
  const explore = await hook($, { subagentType: "Explore", model: "opus" }, fakeNext);
  assert.deepEqual(explore, { model: "opus" });
  await held;
});

test("the catch handler passes the event through unchanged", async () => {
  const { onCatch } = load();
  const event = { subagentType: EXEC, model: "opus" };
  assert.equal(await onCatch(fakeApi(), event, async (e) => e), event);
});
