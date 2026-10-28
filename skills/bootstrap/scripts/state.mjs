import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxSlugLength, resolveModules, validateAnswers } from "./render.mjs";

const EMPTY = { steps: {}, answers: null, modules: [], ids: {} };
const folder = dir => join(dir, ".bootstrap");
const file = dir => join(folder(dir), "state.json");

export function loadState(dir) {
  if (!existsSync(file(dir))) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(file(dir), "utf8")) };
  } catch {
    throw new Error("Corrupt .bootstrap/state.json");
  }
}

function writeAtomic(path, content) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function save(dir, state) {
  mkdirSync(folder(dir), { recursive: true });
  writeAtomic(file(dir), `${JSON.stringify(state, null, 2)}\n`);
}

export function saveRun(dir, { answers, modules }) {
  save(dir, { ...loadState(dir), answers, modules });
}

export function saveAnswers(dir, input, modules, modulesDir) {
  const limit = maxSlugLength(resolveModules(modules, modulesDir));
  const { answers, slug } = validateAnswers(input, { maxSlugLength: limit });
  saveRun(dir, { answers, modules });
  writeAtomic(join(folder(dir), "answers.json"), `${JSON.stringify(input, null, 2)}\n`);
  return { slug };
}

export function markDone(dir, stepId) {
  const state = loadState(dir);
  save(dir, { ...state, steps: { ...state.steps, [stepId]: "done" } });
}

export function recordId(dir, key, value) {
  const state = loadState(dir);
  save(dir, { ...state, ids: { ...state.ids, [key]: value } });
}

export function getId(dir, key) {
  return loadState(dir).ids[key];
}

export function nextStep(dir, orderedStepIds) {
  const { steps } = loadState(dir);
  return orderedStepIds.find(id => steps[id] !== "done") ?? null;
}

const USAGE = `Usage:
  state.mjs show <dir>
  state.mjs save-answers <dir> <answers.json> <modules,comma,separated>
  state.mjs done <dir> <step-id>
  state.mjs next <dir> <step-id,step-id,...>
  state.mjs record <dir> <key> <value>
  state.mjs get <dir> <key>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, ...rest] = process.argv.slice(2);
  const need = count => {
    if (!dir || rest.length < count) {
      console.error(USAGE);
      process.exit(2);
    }
  };
  const modulesDir = fileURLToPath(new URL("../modules", import.meta.url));
  if (command === "save-answers") {
    need(1);
    const input = JSON.parse(readFileSync(rest[0], "utf8"));
    console.log(saveAnswers(dir, input, (rest[1] ?? "").split(",").filter(Boolean), modulesDir).slug);
  } else if (command === "done") {
    need(1);
    markDone(dir, rest[0]);
  } else if (command === "next") {
    need(1);
    console.log(nextStep(dir, rest[0].split(",")) ?? "complete");
  } else if (command === "record") {
    need(2);
    recordId(dir, rest[0], rest[1]);
  } else if (command === "get") {
    need(1);
    console.log(getId(dir, rest[0]) ?? "");
  } else if (command === "show") {
    need(0);
    console.log(JSON.stringify(loadState(dir), null, 2));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
