export const API = "https://api.cloudflare.com/client/v4";
export const ACCOUNT_SCOPE = "com.cloudflare.api.account";
export const ZONE_SCOPE = "com.cloudflare.api.account.zone";

export function cfClient(deps, token) {
  async function request(method, path, body) {
    const response = await deps.fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const messages = (payload.errors ?? []).map(error => error.message).join("; ") || "no error message";
      throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}): ${messages}`);
    }
    return payload.result;
  }
  return {
    get: path => request("GET", path),
    post: (path, body) => request("POST", path, body),
    del: path => request("DELETE", path),
  };
}

export async function withBootstrapToken(deps, accountId, fn) {
  const token = (await deps.prompt("Paste the bootstrap token: ", { hidden: true })).trim();
  if (!token) throw new Error("No bootstrap token pasted");
  const client = cfClient(deps, token);
  const self = await client.get(`/accounts/${accountId}/tokens/verify`).catch(error => {
    throw new Error(`${error.message}: the bootstrap token didn't verify. If it exists, revoke it in the dashboard.`);
  });
  try {
    return await fn(client);
  } finally {
    try {
      await client.del(`/accounts/${accountId}/tokens/${self.id}`);
      deps.log("The bootstrap token is deleted.");
    } catch (error) {
      deps.log(`Couldn't delete the bootstrap token (${error.message}): revoke it in the dashboard.`);
    }
  }
}

export async function resolvePermissions(client, accountId, names) {
  const groups = await client.get(`/accounts/${accountId}/tokens/permission_groups`);
  return names.map(name => {
    const matches = groups.filter(group => group.name === name && (group.scopes.includes(ZONE_SCOPE) || group.scopes.includes(ACCOUNT_SCOPE)));
    if (matches.length !== 1) throw new Error(`Permission "${name}" matched ${matches.length} account or zone permission groups; expected 1`);
    return { id: matches[0].id, scope: matches[0].scopes.includes(ZONE_SCOPE) ? ZONE_SCOPE : ACCOUNT_SCOPE };
  });
}

export function buildPolicies(groups, { accountId, zoneId }) {
  const resources = { [ACCOUNT_SCOPE]: `${ACCOUNT_SCOPE}.${accountId}`, [ZONE_SCOPE]: `${ZONE_SCOPE}.${zoneId}` };
  return [ACCOUNT_SCOPE, ZONE_SCOPE]
    .map(scope => ({ scope, ids: groups.filter(group => group.scope === scope).map(group => ({ id: group.id })) }))
    .filter(({ ids }) => ids.length)
    .map(({ scope, ids }) => ({ effect: "allow", resources: { [resources[scope]]: "*" }, permission_groups: ids }));
}

function summarise(policies) {
  return policies
    .map(policy => JSON.stringify([Object.entries(policy.resources).sort(), policy.permission_groups.map(group => group.id).sort(), policy.effect ?? "allow"]))
    .sort();
}

export function policiesMatch(requested, actual) {
  return JSON.stringify(summarise(requested)) === JSON.stringify(summarise(actual ?? []));
}
