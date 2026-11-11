import { storeThenSet } from "../order.mjs";

const SECRET = "PROJECT_STATUS_PAT";

export function tokenUrl(ctx) {
  return `https://github.com/settings/tokens/new?scopes=project&description=${encodeURIComponent(`${ctx.slug} board sync`)}`;
}

export async function checkToken(deps, token) {
  const response = await deps.fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub rejected the token (HTTP ${response.status})`);
  const scopes = (response.headers.get("X-OAuth-Scopes") ?? "").split(",").map(scope => scope.trim()).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== "project") {
    throw new Error(`The token must have only the project scope; it has: ${scopes.join(", ") || "none"}`);
  }
  const expires = response.headers.get("GitHub-Authentication-Token-Expiration");
  if (!expires) deps.log("The token has no expiry: a one-year expiry is the rule, so make a new one if you can.");
  return { expires };
}

async function run(ctx, deps, { vault, rotate }) {
  deps.log("In the page that opens: set the expiration to 1 year, keep only the project scope, generate the token, then copy it.");
  deps.openUrl(tokenUrl(ctx));
  const token = (await deps.prompt("Paste the token: ", { hidden: true })).trim();
  if (!token) throw new Error("No token pasted");
  const { expires } = await checkToken(deps, token);
  await storeThenSet(deps, vault, ctx, {
    title: "board sync token",
    fields: [
      { name: "token", value: token, hidden: true },
      { name: "expires", value: expires ?? "never", hidden: false },
    ],
    note: `The board sync token, set as the GitHub secret ${SECRET} on ${ctx.repo}.`,
    secrets: [{ name: SECRET, value: token }],
    rotate,
  });
  deps.log("The board sync token is stored in Pass and set in GitHub.");
  if (rotate) deps.log("Delete the old token at https://github.com/settings/tokens");
}

export default { name: "board-token", secrets: () => [{ name: SECRET }], run };
