export const MUTATION_GAP_MS = 1000;
export const MAX_RATE_LIMITS = 3;
export const DEFAULT_BACKOFF_MS = 60_000;

function splitResponse(stdout) {
  const status = /^HTTP\/\S+ (\d{3})/.exec(stdout);
  if (!status) return { status: null, headers: {}, text: stdout };
  const gap = /\r?\n\r?\n/.exec(stdout);
  const head = gap ? stdout.slice(0, gap.index) : stdout;
  const headers = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { status: Number(status[1]), headers, text: gap ? stdout.slice(gap.index + gap[0].length) : "" };
}

function parse({ status: exit, stdout = "", stderr = "" }) {
  const split = splitResponse(stdout);
  let status = split.status;
  if (status === null) status = exit === 0 ? 200 : Number(/HTTP (\d{3})/.exec(stderr)?.[1]) || 500;
  else if (exit !== 0 && status < 400) status = 500;
  let body = split.text;
  try {
    body = body.trim() ? JSON.parse(body) : null;
  } catch {
    body = split.text;
  }
  return { status, headers: split.headers, body, stderr };
}

const messageOf = response => String((response.body && typeof response.body === "object" ? response.body.message : response.body) ?? response.stderr ?? "").trim();

function isRateLimited(response) {
  if (response.status === 429) return true;
  if (response.status === 403 && (response.headers["retry-after"] || /rate limit|abuse/i.test(`${messageOf(response)} ${response.stderr}`))) return true;
  return Array.isArray(response.body?.errors) && response.body.errors.some(error => error.type === "RATE_LIMITED");
}

function backoffMs(response) {
  const seconds = Number(response.headers["retry-after"]);
  return response.headers["retry-after"] !== undefined && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_BACKOFF_MS;
}

export function createGithub(deps) {
  let mutated = false;

  async function call(args, { input, mutation = false } = {}) {
    if (mutation) {
      if (mutated) await deps.sleep(MUTATION_GAP_MS);
      mutated = true;
    }
    for (let limited = 1; ; limited += 1) {
      const response = parse(await deps.exec("gh", args, input === undefined ? {} : { input }));
      if (!isRateLimited(response)) return response;
      if (limited >= MAX_RATE_LIMITS) {
        throw new Error(`GitHub rate-limited gh ${args.slice(0, 2).join(" ")} ${MAX_RATE_LIMITS} times in a row: wait a while, then re-run to resume`);
      }
      deps.log(`GitHub is rate-limiting requests: waiting ${Math.round(backoffMs(response) / 1000)} s`);
      await deps.sleep(backoffMs(response));
    }
  }

  const fail = (what, response) => {
    const error = new Error(`gh ${what} failed (HTTP ${response.status}): ${messageOf(response)}`);
    error.status = response.status;
    return error;
  };

  async function rest(method, path, { fields = {}, allow404 = false } = {}) {
    const args = ["api", "--include", "-X", method, path, ...Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])];
    const response = await call(args, { mutation: method !== "GET" });
    if (allow404 && response.status === 404) return null;
    if (response.status >= 400) throw fail(`api ${method} ${path.split("?")[0]}`, response);
    return response.body;
  }

  async function graphql(query, variables = {}) {
    const response = await call(["api", "graphql", "--include", "--input", "-"], { input: JSON.stringify({ query, variables }), mutation: /^\s*mutation\b/.test(query) });
    if (response.status >= 400) throw fail("api graphql", response);
    const errors = response.body?.errors;
    if (errors?.length) throw new Error(`GitHub GraphQL error: ${errors.map(error => error.message).join("; ")}`);
    return response.body.data;
  }

  async function paginate(query, variables, pick) {
    const nodes = [];
    let after = variables.after ?? null;
    for (;;) {
      const connection = pick(await graphql(query, { ...variables, after }));
      nodes.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) return nodes;
      after = connection.pageInfo.endCursor;
    }
  }

  async function names(kind, repo) {
    const response = await call([kind, "list", "--repo", repo, "--json", "name"]);
    if (response.status >= 400) throw fail(`${kind} list`, response);
    return (Array.isArray(response.body) ? response.body : []).map(entry => entry.name);
  }

  async function remove(kind, repo, name) {
    const response = await call([kind, "delete", name, "--repo", repo], { mutation: true });
    if (response.status >= 400) throw fail(`${kind} delete`, response);
  }

  async function setVariable(repo, name, value) {
    const response = await call(["variable", "set", name, "--repo", repo], { input: value, mutation: true });
    if (response.status >= 400) throw fail("variable set", response);
  }

  async function login() {
    const result = await deps.exec("gh", ["api", "user", "--jq", ".login"]);
    if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Couldn't read the signed-in GitHub login: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }

  return {
    graphql,
    paginate,
    login,
    setVariable,
    secretNames: repo => names("secret", repo),
    variableNames: repo => names("variable", repo),
    deleteSecret: (repo, name) => remove("secret", repo, name),
    deleteVariable: (repo, name) => remove("variable", repo, name),
    repository: (owner, name) => rest("GET", `repos/${owner}/${name}`, { allow404: true }),
    transfer: (owner, name, newOwner) => rest("POST", `repos/${owner}/${name}/transfer`, { fields: { new_owner: newOwner } }),
    pages: (owner, name) => rest("GET", `repos/${owner}/${name}/pages`, { allow404: true }),
    fileExists: async (owner, name, path) => (await rest("GET", `repos/${owner}/${name}/contents/${path}`, { allow404: true })) !== null,
    async npmPackages(repoName) {
      const found = [];
      for (let page = 1; ; page += 1) {
        const batch = await rest("GET", `user/packages?package_type=npm&per_page=100&page=${page}`);
        found.push(...batch);
        if (batch.length < 100) break;
      }
      return found.filter(entry => entry.repository?.name === repoName).map(entry => entry.name);
    },
    async organisationId(org) {
      const data = await graphql("query OrganisationId($login: String!) { organization(login: $login) { id } }", { login: org });
      if (!data.organization) throw new Error(`The organisation ${org} wasn't found, or you can't see it`);
      return data.organization.id;
    },
  };
}
