import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadContext } from "./secrets/context.mjs";
import { realDeps } from "./secrets/deps.mjs";
import { secretsExist } from "./secrets/github.mjs";
import { storeThenSet } from "./secrets/order.mjs";
import { Vault } from "./secrets/vault.mjs";

export { storeThenSet };

export const STEP_NAMES = ["release-app", "board-token", "android-keystore", "cloudflare-tokens", "cloudflare-r2"];

const USAGE = `Usage: secrets.mjs <step> <project dir> [--vault <name>] [--rotate]
Steps: ${STEP_NAMES.join(", ")}`;

async function checkTool(deps, tool, args, notInstalled, notSignedIn) {
  const { status } = await deps.exec(tool, args);
  if (status === 127) throw new Error(`${tool} is not installed: ${notInstalled}`);
  if (status !== 0) throw new Error(`${tool} is not signed in: ${notSignedIn}`);
}

export async function preflight(deps, step) {
  await checkTool(deps, "gh", ["auth", "status"], "install it from https://cli.github.com", "run gh auth login");
  await checkTool(deps, "pass-cli", ["info"], "install the Proton Pass CLI", "run pass-cli login");
  for (const tool of step.tools ?? []) {
    const { status } = await deps.exec(tool, ["-help"]);
    if (status === 127) throw new Error(`${tool} is not installed: install it, then re-run`);
  }
}

async function loadStep(name, steps) {
  if (steps) return steps[name];
  if (!STEP_NAMES.includes(name)) return undefined;
  const url = new URL(`./secrets/steps/${name}.mjs`, import.meta.url);
  if (!existsSync(fileURLToPath(url))) throw new Error(`Step ${name} isn't available in this version of the plugin`);
  return (await import(url)).default;
}

export async function runCli(argv, deps, { steps } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { vault: { type: "string", default: "Dev" }, rotate: { type: "boolean", default: false } } });
  } catch {
    deps.log(USAGE);
    return 2;
  }
  const [name, dir] = parsed.positionals;
  let step;
  try {
    step = name && dir && parsed.positionals.length === 2 ? await loadStep(name, steps) : undefined;
  } catch (error) {
    deps.log(error.message);
    return 1;
  }
  if (!step) {
    deps.log(USAGE);
    return 2;
  }
  try {
    const ctx = loadContext(dir);
    await preflight(deps, step);
    if (!parsed.values.rotate && (await secretsExist(deps, ctx, step.secrets(ctx)))) {
      deps.log(`The ${name} secrets already exist. Nothing to do: re-run with --rotate to replace them.`);
      return 0;
    }
    const vault = new Vault(deps, { vault: parsed.values.vault, folder: ctx.slug });
    await step.run(ctx, deps, { vault, rotate: parsed.values.rotate });
    return 0;
  } catch (error) {
    deps.log(error.message);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), realDeps);
}
