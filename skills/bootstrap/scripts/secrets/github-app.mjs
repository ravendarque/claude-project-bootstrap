import { createServer } from "node:http";
import { createSign } from "node:crypto";

const API = "https://api.github.com";
const API_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
const HOUR_MS = 60 * 60 * 1000;

export function buildManifest(ctx, redirectUrl) {
  const url = `https://github.com/${ctx.repo}`;
  return {
    name: `${ctx.slug}-release`,
    url,
    hook_attributes: { url, active: false },
    redirect_url: redirectUrl,
    public: false,
    default_permissions: { contents: "write", workflows: "write" },
  };
}

const base64url = value => Buffer.from(value).toString("base64url");

export function appJwt(clientId, pem, now) {
  const seconds = Math.floor(now.getTime() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: clientId }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(pem).toString("base64url");
  return `${unsigned}.${signature}`;
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export function newAppUrl(type, owner, state) {
  const settings = type === "Organization" ? `organizations/${encodeURIComponent(owner)}/settings` : "settings";
  return `https://github.com/${settings}/apps/new?state=${encodeURIComponent(state)}`;
}

export async function ownerType(deps, owner) {
  const response = await deps.fetch(`${API}/users/${encodeURIComponent(owner)}`, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`Couldn't look up the GitHub owner ${owner} (HTTP ${response.status})`);
  return (await response.json()).type;
}

function manifestPage(manifest, action) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Create the release App</title>
<form id="form" method="post" action="${escapeHtml(action)}">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
  <noscript><button type="submit">Continue to GitHub</button></noscript>
</form>
<script>document.getElementById("form").submit();</script>
`;
}

export function waitForCallback(deps, state, { manifestFor, onListening, actionUrl = newAppUrl("User", "", state), timeoutMs = HOUR_MS } = {}) {
  return new Promise((resolve, reject) => {
    let redirectUrl;
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const reply = (status, type, body) => {
        res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, Connection: "close" });
        res.end(body);
      };
      if (req.method !== "GET") return reply(405, "text/plain", "Method not allowed");
      if (url.pathname === "/") return reply(200, "text/html", manifestPage(manifestFor(redirectUrl), actionUrl));
      if (url.pathname !== "/callback") return reply(404, "text/plain", "Not found");
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || !code) return reply(400, "text/plain", "Wrong or missing state");
      if (settled) return reply(400, "text/plain", "Already handled");
      settled = true;
      reply(200, "text/plain", "You can close this tab");
      clearTimeout(timer);
      server.close();
      resolve({ code, url: redirectUrl });
    });
    const timer = setTimeout(() => {
      settled = true;
      server.close();
      server.closeAllConnections();
      reject(new Error("Timed out after an hour waiting for GitHub's callback: run the step again"));
    }, timeoutMs);
    server.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      redirectUrl = `${origin}/callback`;
      onListening?.({ url: `${origin}/` });
    });
  });
}

export async function convertManifest(deps, code) {
  const response = await deps.fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: API_HEADERS });
  if (!response.ok) throw new Error(`GitHub refused the manifest code (HTTP ${response.status}): run the step again`);
  const { id, client_id: clientId, pem, html_url: htmlUrl, slug } = await response.json();
  if (!id || !clientId || !pem || !htmlUrl) throw new Error("GitHub's conversion response was missing the App id, client id, key or URL");
  return { id, clientId, pem, htmlUrl, slug };
}

async function api(deps, path, token, init = {}) {
  const response = await deps.fetch(`${API}${path}`, { ...init, headers: { ...API_HEADERS, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed (HTTP ${response.status})`);
  return response.json();
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyInstallation(deps, ctx, { clientId, pem }, { intervalMs = 5000, limitMs = 10 * 60 * 1000 } = {}) {
  const attempts = Math.max(1, Math.ceil(limitMs / intervalMs));
  let installation;
  for (let attempt = 0; attempt < attempts && !installation; attempt++) {
    if (attempt) await sleep(intervalMs);
    const jwt = appJwt(clientId, pem, deps.now());
    const all = await api(deps, "/app/installations", jwt);
    installation = all.find(entry => entry.account?.login?.toLowerCase() === ctx.owner.toLowerCase());
  }
  if (!installation) throw new Error(`The App wasn't installed within ${Math.round(limitMs / 60000)} minutes: install it on ${ctx.repo} only, then set the secrets by hand (core:1 "By hand")`);
  const { token } = await api(deps, `/app/installations/${installation.id}/access_tokens`, appJwt(clientId, pem, deps.now()), { method: "POST" });
  const { repositories } = await api(deps, "/installation/repositories", token);
  const names = repositories.map(repo => repo.full_name);
  if (names.length !== 1 || names[0] !== ctx.repo) {
    deps.log(`The App can see ${names.join(", ") || "no repositories"}. In its installation settings choose "Only select repositories" and pick ${ctx.repo} alone.`);
    throw new Error(`The release App's installation must cover exactly ${ctx.repo}`);
  }
}
