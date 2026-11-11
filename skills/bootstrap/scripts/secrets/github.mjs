import { resolveEnv } from "./context.mjs";

async function gh(deps, args, input) {
  const result = await deps.exec("gh", args, input === undefined ? {} : { input });
  if (result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

const envArgs = env => (env ? ["--env", env] : []);

export async function secretExists(deps, repo, name, env) {
  const out = await gh(deps, ["secret", "list", "--repo", repo, ...envArgs(env), "--json", "name"]);
  return JSON.parse(out || "[]").some(entry => entry.name === name);
}

export async function setSecret(deps, repo, name, value, env) {
  await gh(deps, ["secret", "set", name, "--repo", repo, ...envArgs(env)], value);
}

export async function setVariable(deps, repo, name, value) {
  await gh(deps, ["variable", "set", name, "--repo", repo], value);
}

export async function orgVariableExists(deps, org, name) {
  const out = await gh(deps, ["variable", "list", "--org", org, "--json", "name"]);
  return JSON.parse(out || "[]").some(entry => entry.name === name);
}

async function ghOrgWrite(deps, args, value) {
  try {
    await gh(deps, args, value);
  } catch (error) {
    if (error.message.includes("admin:org")) {
      throw new Error("Setting organisation secrets and variables needs the admin:org scope: run gh auth refresh -h github.com -s admin:org, then re-run", { cause: error });
    }
    throw error;
  }
}

export async function setOrgSecret(deps, org, name, value) {
  await ghOrgWrite(deps, ["secret", "set", name, "--org", org, "--visibility", "all"], value);
}

export async function setOrgVariable(deps, org, name, value) {
  await ghOrgWrite(deps, ["variable", "set", name, "--org", org, "--visibility", "all"], value);
}

export async function secretsExist(deps, ctx, secrets) {
  for (const { name, env } of secrets) {
    if (!(await secretExists(deps, ctx.repo, name, resolveEnv(ctx, env)))) return false;
  }
  return true;
}
