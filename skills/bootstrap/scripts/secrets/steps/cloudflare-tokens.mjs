import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askId, buildPolicies, createVerified, findEarlierItems, oneYearFrom, readOldIds, resolvePermissions, revokeOld, storeEach, withBootstrapToken } from "../cloudflare.mjs";
import { storeThenSet } from "../order.mjs";

const title = token => `Cloudflare ${token} token`;

function readTokens(ctx) {
  const file = join(ctx.dir, ".bootstrap", "cloudflare", "tokens.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Can't read ${file}: render the cloudflare-opentofu module into this project first`);
  }
}

const secretsFor = (entry, value) => (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }), value }));

async function run(ctx, deps, { vault, rotate }) {
  const tokens = readTokens(ctx);
  const previous = await findEarlierItems(deps, vault, tokens.map(entry => title(entry.token)), rotate);
  const accountId = await askId(deps, "Cloudflare account id (32 hex characters; on the zone's Overview page, bottom right) ");
  const zoneId = await askId(deps, `Zone id for ${ctx.zoneName ?? "the zone"} (32 hex characters; on the zone's Overview page, bottom right) `);
  const expires = oneYearFrom(deps.now());

  await withBootstrapToken(deps, accountId, async client => {
    const oldIds = await readOldIds(vault, previous);
    const specs = [];
    for (const entry of tokens) {
      const groups = await resolvePermissions(client, accountId, entry.permissions);
      specs.push({ label: entry.token, name: `${ctx.slug} ${entry.token}`, policies: buildPolicies(groups, { accountId, zoneId }) });
    }
    const made = await createVerified(client, deps, accountId, specs);
    await storeEach(client, deps, accountId, made, (token, index) => {
      const entry = tokens[index];
      return storeThenSet(deps, vault, ctx, {
        title: title(entry.token),
        fields: [
          { name: "token", value: token.value, hidden: true },
          { name: "token id", value: token.id, hidden: false },
          { name: "expires", value: expires, hidden: false },
        ],
        note: `The Cloudflare ${entry.token} API token for ${ctx.repo}, set as the GitHub secret ${entry.secret}${entry.env ? ` in ${entry.env.join(" and ")}` : ""}.`,
        secrets: secretsFor(entry, token.value),
        variables: index === 0 ? [{ name: "CLOUDFLARE_ACCOUNT_ID", value: accountId }] : [],
        rotate,
      });
    });
    await revokeOld(client, deps, accountId, Object.fromEntries(Object.entries(oldIds).map(([item, id]) => [item.replace(/^Cloudflare | token$/g, ""), id])));
  });
  deps.log("The four Cloudflare tokens are stored in Pass and set in GitHub.");
}

export default {
  name: "cloudflare-tokens",
  secrets: ctx => readTokens(ctx).flatMap(entry => (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }) }))),
  run,
};
