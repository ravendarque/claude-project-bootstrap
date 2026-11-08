import { resolveEnv } from "./context.mjs";
import { setSecret, setVariable } from "./github.mjs";

export async function storeThenSet(deps, vault, ctx, { title, fields, note, secrets, variables = [], rotate = false }) {
  let previous = null;
  if (rotate) {
    previous = await vault.find(title);
    if (!previous) throw new Error(`No active item titled ${title} to rotate: run without --rotate`);
  }
  await vault.create(title, fields, note);
  const writes = [
    ...secrets.map(({ name, env, value }) => ({ name, write: () => setSecret(deps, ctx.repo, name, value, resolveEnv(ctx, env)) })),
    ...variables.map(({ name, value }) => ({ name, write: () => setVariable(deps, ctx.repo, name, value) })),
  ];
  for (const [index, { write }] of writes.entries()) {
    try {
      await write();
    } catch (cause) {
      throw new Error(`Stored ${title} in Pass; not set: ${writes.slice(index).map(w => w.name).join(", ")}`, { cause });
    }
  }
  if (previous) await vault.trash(previous);
}
