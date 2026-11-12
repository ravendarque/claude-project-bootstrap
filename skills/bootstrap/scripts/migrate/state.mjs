import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

const fresh = repo => ({ version: 1, repo, phases: {}, inventory: null, copy: { started: false }, newBoard: null, mapping: {}, verify: null, notes: [] });

export function defaultStateDir(env = process.env, home = homedir()) {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "claude-project-bootstrap", "migrate");
}

export function isRepoName(value) {
  return REPO_NAME.test(value);
}

export function openState(dir, repo) {
  if (!isRepoName(repo)) throw new Error(`${repo} isn't a valid repository name`);
  const path = join(dir, `${repo}.json`);
  let data = fresh(repo);
  if (existsSync(path)) {
    try {
      data = { ...data, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch {
      throw new Error(`Corrupt migration state at ${path}`);
    }
  }
  const save = () => {
    mkdirSync(dir, { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temp, path);
  };
  return {
    path,
    data,
    save,
    isDone: phase => data.phases[phase] === "done",
    markDone(phase) {
      data.phases[phase] = "done";
      save();
    },
    note(line) {
      if (!data.notes.includes(line)) data.notes.push(line);
      save();
    },
  };
}
