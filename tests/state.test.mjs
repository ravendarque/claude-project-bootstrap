import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getId, loadState, markDone, markSkipped, nextStep, recordId, saveAnswers, saveRun } from "../skills/bootstrap/scripts/state.mjs";
import { fileURLToPath } from "node:url";
import { realModulesDir } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "state-"));
const order = ["preflight", "interview", "plan-confirmed", "scaffold"];

test("a fresh directory has empty state", () => {
  assert.deepEqual(loadState(tmp()), { steps: {}, answers: null, modules: [], ids: {}, skipped: {} });
});

test("markDone persists and nextStep returns the first step not done", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  markDone(dir, "interview");
  assert.equal(nextStep(dir, order), "plan-confirmed");
});

test("state survives reload from disk", () => {
  const dir = tmp();
  saveRun(dir, { answers: { name: "Demo" }, modules: ["core"] });
  markDone(dir, "preflight");
  const state = loadState(dir);
  assert.deepEqual(state.answers, { name: "Demo" });
  assert.deepEqual(state.modules, ["core"]);
  assert.equal(state.steps.preflight, "done");
});

test("nextStep returns null when everything is done", () => {
  const dir = tmp();
  for (const step of order) markDone(dir, step);
  assert.equal(nextStep(dir, order), null);
});

test("corrupt state throws rather than resetting", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".bootstrap"));
  writeFileSync(join(dir, ".bootstrap", "state.json"), "{not json");
  assert.throws(() => loadState(dir), { message: "Corrupt .bootstrap/state.json" });
});

test("recordId stores a created resource id and getId reads it back", () => {
  const dir = tmp();
  recordId(dir, "project_number", 7);
  assert.equal(getId(dir, "project_number"), 7);
  assert.equal(getId(dir, "missing"), undefined);
});

test("saveAnswers validates, saves the run and writes answers.json", () => {
  const dir = tmp();
  const { slug } = saveAnswers(dir, { name: "My App", owner: "o", visibility: "public" }, ["js-toolchain"], realModulesDir);
  assert.equal(slug, "my-app");
  const state = loadState(dir);
  assert.deepEqual(state.modules, ["js-toolchain"]);
  assert.equal(state.answers.slug, "my-app");
  assert.equal(JSON.parse(readFileSync(join(dir, ".bootstrap", "answers.json"), "utf8")).name, "My App");
});

test("saveAnswers applies the selected modules' slug limit", () => {
  assert.throws(
    () => saveAnswers(tmp(), { name: "x".repeat(45), visibility: "public", beta: false, zone_name: "example.com" }, ["cloudflare-opentofu"], realModulesDir),
    /allow at most 40/,
  );
});

test("state writes leave no partial file behind", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  assert.deepEqual(readdirSync(join(dir, ".bootstrap")), ["state.json"]);
});

test("saveAnswers requires visibility to be public or private", () => {
  for (const visibility of [undefined, "Private", "internal"]) {
    assert.throws(() => saveAnswers(tmp(), { name: "A", visibility }, [], realModulesDir), {
      message: "visibility must be public or private",
    });
  }
});

test("saveAnswers checks each selected module's questions by type", () => {
  const base = { name: "A", visibility: "public", zone_name: "example.com" };
  assert.throws(() => saveAnswers(tmp(), { ...base, beta: "no" }, ["cloudflare-opentofu"], realModulesDir), {
    message: "beta must be true or false",
  });
  assert.throws(() => saveAnswers(tmp(), { name: "A", visibility: "public", beta: true }, ["cloudflare-opentofu"], realModulesDir), {
    message: "zone_name is required",
  });
});

test("saveAnswers rejects a zone that isn't a hostname", () => {
  assert.throws(
    () => saveAnswers(tmp(), { name: "A", visibility: "public", beta: false, zone_name: 'ex"ample.com' }, ["cloudflare-opentofu"], realModulesDir),
    { message: "zone_name must be a domain name such as example.com" },
  );
});

const script = fileURLToPath(new URL("../skills/bootstrap/scripts/state.mjs", import.meta.url));
const cli = (...args) => spawnSync("node", [script, ...args], { encoding: "utf8" });

test("markSkipped persists the reason and nextStep passes over the step", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  markSkipped(dir, "interview", "free private repo");
  const state = loadState(dir);
  assert.equal(state.steps.interview, "skipped");
  assert.deepEqual(state.skipped, { interview: "free private repo" });
  assert.equal(nextStep(dir, order), "plan-confirmed");
});

test("a mix of done and skipped steps resumes at the first unsettled one", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  markSkipped(dir, "interview", "declined");
  markDone(dir, "plan-confirmed");
  assert.equal(nextStep(dir, order), "scaffold");
  markSkipped(dir, "scaffold", "declined");
  assert.equal(nextStep(dir, order), null);
});

test("markSkipped rejects a blank reason", () => {
  for (const reason of [undefined, "", "   "]) {
    assert.throws(() => markSkipped(tmp(), "interview", reason), { message: /reason/ });
  }
});

test("markSkipped refuses a step that is already done", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  assert.throws(() => markSkipped(dir, "preflight", "changed my mind"), { message: /already done/ });
  assert.equal(loadState(dir).steps.preflight, "done");
});

test("markDone after markSkipped clears the reason", () => {
  const dir = tmp();
  markSkipped(dir, "interview", "declined");
  markDone(dir, "interview");
  const state = loadState(dir);
  assert.equal(state.steps.interview, "done");
  assert.deepEqual(state.skipped, {});
});

test("an old state file without skipped still loads", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".bootstrap"));
  writeFileSync(join(dir, ".bootstrap", "state.json"), JSON.stringify({ steps: { preflight: "done" }, answers: null, modules: [], ids: {} }));
  assert.deepEqual(loadState(dir).skipped, {});
  markSkipped(dir, "interview", "declined");
  assert.deepEqual(loadState(dir).skipped, { interview: "declined" });
});

test("the skip command joins the reason words and records them", () => {
  const dir = tmp();
  const result = cli("skip", dir, "interview", "free", "private", "repo");
  assert.equal(result.status, 0);
  assert.deepEqual(loadState(dir).skipped, { interview: "free private repo" });
  assert.equal(cli("next", dir, order.join(",")).stdout.trim(), "preflight");
});

test("the skip command exits 2 without a reason", () => {
  const result = cli("skip", tmp(), "interview");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /state\.mjs skip/);
});
