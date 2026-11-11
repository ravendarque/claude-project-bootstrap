import { resolveEnv } from "./context.mjs";
import { setOrgSecret, setOrgVariable, setSecret, setVariable } from "./github.mjs";

export async function storeAppThenSet(deps, vault, ctx, app, settingsUrl, spec) {
  try {
    await storeThenSet(deps, vault, ctx, spec);
  } catch (error) {
    if (error.stored) throw error;
    throw new Error(`The App ${app.slug} exists on GitHub but its key wasn't stored (${error.message}). Delete it at ${settingsUrl}/advanced, then re-run this step.`, { cause: error });
  }
}

export async function storeThenSet(deps, vault, ctx, { title, fields, note, secrets, variables = [], rotate = false }) {
  const previous = await vault.find(title);
  if (previous && !rotate) {
    throw new Error(`An earlier run left ${title} in Pass but didn't finish setting the secrets: re-run with --rotate to replace it`);
  }
  if (!previous && rotate) deps.log(`No earlier ${title} in Pass: creating one`);
  await vault.create(title, fields, note);
  const writes = [
    ...secrets.map(({ name, env, value, scope }) => ({
      name,
      write: () => (scope === "org" ? setOrgSecret(deps, ctx.owner, name, value) : setSecret(deps, ctx.repo, name, value, resolveEnv(ctx, env))),
    })),
    ...variables.map(({ name, value, scope }) => ({
      name,
      write: () => (scope === "org" ? setOrgVariable(deps, ctx.owner, name, value) : setVariable(deps, ctx.repo, name, value)),
    })),
  ];
  for (const [index, { write }] of writes.entries()) {
    try {
      await write();
    } catch (cause) {
      throw Object.assign(new Error(`Stored ${title} in Pass; not set: ${writes.slice(index).map(w => w.name).join(", ")}`, { cause }), { stored: true });
    }
  }
  if (previous) await vault.trash(previous);
}
