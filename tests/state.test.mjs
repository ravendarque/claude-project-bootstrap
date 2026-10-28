import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getId, loadState, markDone, nextStep, recordId, saveAnswers, saveRun } from "../skills/bootstrap/scripts/state.mjs";
import { realModulesDir } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "state-"));
const order = ["preflight", "interview", "plan-confirmed", "scaffold"];

test("a fresh directory has empty state", () => {
  assert.deepEqual(loadState(tmp()), { steps: {}, answers: null, modules: [], ids: {} });
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
    () => saveAnswers(tmp(), { name: "x".repeat(45) }, ["cloudflare-opentofu"], realModulesDir),
    /allow at most 40/,
  );
});

test("state writes leave no partial file behind", () => {
  const dir = tmp();
  markDone(dir, "preflight");
  assert.deepEqual(readdirSync(join(dir, ".bootstrap")), ["state.json"]);
});
