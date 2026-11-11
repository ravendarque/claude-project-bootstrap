import { loadState } from "../state.mjs";

export function loadContext(dir) {
  const { answers, ids } = loadState(dir);
  const missing = ["owner", "slug", "name"].filter(key => !answers?.[key]);
  if (missing.length) {
    throw new Error(`No bootstrap answers for ${missing.join(", ")} in ${dir}/.bootstrap/state.json: run this against a bootstrapped project directory`);
  }
  const { owner, slug, name, zone_name: zoneName } = answers;
  return {
    dir,
    owner,
    slug,
    name,
    repo: `${owner}/${slug}`,
    ...(zoneName && { zoneName }),
    skippedEnvs: (ids.skipped_envs ?? "").split(",").map(env => env.trim()).filter(Boolean),
    answers,
  };
}

export function resolveEnv(ctx, env) {
  return env && !ctx.skippedEnvs.includes(env) ? env : null;
}
