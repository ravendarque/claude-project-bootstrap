import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realDeps } from "./secrets/deps.mjs";
import { createGithub } from "./migrate/github.mjs";
import { runMigration } from "./migrate/phases.mjs";
import { defaultStateDir, isRepoName, openState } from "./migrate/state.mjs";

export const DEFAULT_ORG = "oneloneraven";

const USAGE = `Usage: migrate.mjs <repo> [--dry-run] [--org ${DEFAULT_ORG}] [--vault <name>] [--project-dir <dir>]`;
const ORG_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

async function checkGh(deps) {
  const { status } = await deps.exec("gh", ["auth", "status"]);
  if (status === 127) throw new Error("gh is not installed: install it from https://cli.github.com");
  if (status !== 0) throw new Error("gh is not signed in: run gh auth login");
}

export async function runCli(argv, deps, { stateDir = defaultStateDir() } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { "dry-run": { type: "boolean", default: false }, org: { type: "string", default: DEFAULT_ORG }, vault: { type: "string", default: "Dev" }, "project-dir": { type: "string" } },
    });
  } catch {
    deps.log(USAGE);
    return 2;
  }
  const [repo] = parsed.positionals;
  if (parsed.positionals.length !== 1 || !isRepoName(repo) || !ORG_NAME.test(parsed.values.org)) {
    deps.log(USAGE);
    return 2;
  }
  try {
    await checkGh(deps);
    const gh = createGithub(deps);
    const login = await gh.login();
    if (login.toLowerCase() === parsed.values.org.toLowerCase()) throw new Error(`You're signed in as ${login}, the target organisation: sign in as the repository's owner`);
    await runMigration({ deps, gh, store: openState(stateDir, repo), repo, org: parsed.values.org, login, vault: parsed.values.vault, projectDir: parsed.values["project-dir"], dry: parsed.values["dry-run"] });
    return 0;
  } catch (error) {
    deps.log(error.message);
    return 1;
  }
}

function launchedDirectly() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (launchedDirectly()) {
  const deps = { ...realDeps, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
  process.exitCode = await runCli(process.argv.slice(2), deps);
}
