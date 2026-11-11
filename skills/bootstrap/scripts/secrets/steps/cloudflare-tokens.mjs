import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPolicies, policiesMatch, resolvePermissions, withBootstrapToken } from "../cloudflare.mjs";
import { storeThenSet } from "../order.mjs";

const HEX_ID = /^[0-9a-f]{32}$/;
const title = token => `Cloudflare ${token} token`;

function readTokens(ctx) {
  const file = join(ctx.dir, ".bootstrap", "cloudflare", "tokens.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Can't read ${file}: render the cloudflare-opentofu module into this project first`);
  }
}

function oneYearFrom(now) {
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function askId(deps, question) {
  const id = (await deps.prompt(question)).trim();
  if (!HEX_ID.test(id)) throw new Error(`${question.replace(/ \(.*$/, "")} must be 32 hexadecimal characters`);
  return id;
}

function secretsFor(entry, value) {
  return (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }), value }));
}

async function createAll(client, deps, ctx, tokens, ids) {
  const created = [];
  try {
    for (const entry of tokens) {
      const groups = await resolvePermissions(client, ids.accountId, entry.permissions);
      const policies = buildPolicies(groups, ids);
      const made = await client.post(`/accounts/${ids.accountId}/tokens`, { name: `${ctx.slug} ${entry.token}`, policies, expires_on: oneYearFrom(deps.now()) });
      created.push(made.id);
      const actual = await client.get(`/accounts/${ids.accountId}/tokens/${made.id}`);
      if (!policiesMatch(policies, actual.policies)) {
        throw new Error(`The ${entry.token} token's policies did not match what was requested: nothing was stored`);
      }
      entry.made = { id: made.id, value: made.value };
    }
  } catch (error) {
    for (const id of created) await client.del(`/accounts/${ids.accountId}/tokens/${id}`).catch(() => deps.log(`Couldn't delete token ${id}: revoke it in the dashboard.`));
    throw error;
  }
  return created;
}

async function run(ctx, deps, { vault, rotate }) {
  const tokens = readTokens(ctx).map(entry => ({ ...entry }));
  const previous = {};
  for (const { token } of tokens) {
    previous[token] = await vault.find(title(token));
    if (previous[token] && !rotate) {
      throw new Error(`An earlier run left ${title(token)} in Pass but didn't finish setting the secrets: re-run with --rotate to replace it`);
    }
    if (!previous[token] && rotate) deps.log(`No earlier ${title(token)} in Pass: creating one`);
  }
  const accountId = await askId(deps, "Cloudflare account id (32 hex characters; on the zone's Overview page, bottom right) ");
  const zoneId = await askId(deps, `Zone id for ${ctx.zoneName ?? "the zone"} (32 hex characters; on the zone's Overview page, bottom right) `);
  const expires = oneYearFrom(deps.now());

  await withBootstrapToken(deps, accountId, async client => {
    const oldIds = {};
    for (const { token } of tokens) {
      if (previous[token]) oldIds[token] = await vault.field(previous[token], "token id");
    }
    await createAll(client, deps, ctx, tokens, { accountId, zoneId });
    let next = 0;
    try {
      for (const [index, entry] of tokens.entries()) {
        next = index;
        await storeThenSet(deps, vault, ctx, {
          title: title(entry.token),
          fields: [
            { name: "token", value: entry.made.value, hidden: true },
            { name: "token id", value: entry.made.id, hidden: false },
            { name: "expires", value: expires, hidden: false },
          ],
          note: `The Cloudflare ${entry.token} API token for ${ctx.repo}, set as the GitHub secret ${entry.secret}${entry.env ? ` in ${entry.env.join(" and ")}` : ""}.`,
          secrets: secretsFor(entry, entry.made.value),
          variables: index === 0 ? [{ name: "CLOUDFLARE_ACCOUNT_ID", value: accountId }] : [],
          rotate,
        });
      }
    } catch (error) {
      const unstored = tokens.slice(error.stored ? next + 1 : next);
      for (const { made } of unstored) {
        await client.del(`/accounts/${accountId}/tokens/${made.id}`).catch(() => deps.log(`Couldn't delete token ${made.id}: revoke it in the dashboard.`));
      }
      throw error;
    }
    for (const [name, id] of Object.entries(oldIds)) {
      try {
        await client.del(`/accounts/${accountId}/tokens/${id}`);
        deps.log(`Revoked the old ${name} token.`);
      } catch (error) {
        deps.log(`Couldn't revoke the old ${name} token (${error.message}): revoke it in the dashboard.`);
      }
    }
  });
  deps.log("The four Cloudflare tokens are stored in Pass and set in GitHub.");
}

export default {
  name: "cloudflare-tokens",
  secrets: ctx => readTokens(ctx).flatMap(entry => (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }) }))),
  run,
};
