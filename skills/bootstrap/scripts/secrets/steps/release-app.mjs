import { randomBytes } from "node:crypto";
import { appSettingsUrl, buildManifest, convertManifest, newAppUrl, ownerType, verifyInstallation, waitForCallback } from "../github-app.mjs";
import { setSecret, setVariable } from "../github.mjs";
import { storeAppThenSet } from "../order.mjs";

export { appJwt, buildManifest, newAppUrl, ownerType, waitForCallback } from "../github-app.mjs";

const SECRET = "RELEASE_APP_PRIVATE_KEY";
const VARIABLE = "RELEASE_APP_CLIENT_ID";
const TITLE = "release App";

async function resume(ctx, deps, vault, itemId, options) {
  deps.log("Resuming: the release App already exists in Pass");
  const clientId = await vault.field(itemId, "client id");
  const pem = await vault.field(itemId, "private key");
  const htmlUrl = await vault.field(itemId, "App URL").catch(() => "");
  await setSecret(deps, ctx.repo, SECRET, pem);
  await setVariable(deps, ctx.repo, VARIABLE, clientId);
  if (!htmlUrl) {
    deps.log(`The Pass item has no App URL: open the App's settings on GitHub and check it's installed on ${ctx.repo} only, with "Only select repositories".`);
    return;
  }
  deps.log(`Install the App on ${ctx.repo} only: choose "Only select repositories".`);
  deps.openUrl(`${htmlUrl}/installations/new`);
  await verifyInstallation(deps, ctx, { clientId, pem }, options);
  deps.log(`The release App is installed on ${ctx.repo} only.`);
}

async function run(ctx, deps, { vault, rotate, pollIntervalMs, pollLimitMs }) {
  if (rotate) {
    deps.log(`release-app can't rotate: GitHub has no API to make a new App key. Generate one in the App's settings and follow core:1 "By hand".`);
    return;
  }
  const earlier = await vault.find(TITLE);
  if (earlier) return resume(ctx, deps, vault, earlier, { intervalMs: pollIntervalMs, limitMs: pollLimitMs });
  const state = randomBytes(16).toString("hex");
  const type = await ownerType(deps, ctx.owner);
  const actionUrl = newAppUrl(type, ctx.owner, state);
  const { code } = await waitForCallback(deps, state, {
    manifestFor: redirectUrl => buildManifest({ name: `${ctx.slug}-release`, url: `https://github.com/${ctx.repo}`, permissions: { contents: "write", workflows: "write" } }, redirectUrl),
    actionUrl,
    onListening: ({ url }) => {
      deps.log(`Opening your browser: click "Create GitHub App" when GitHub asks.`);
      deps.openUrl(url);
    },
  });
  const app = await convertManifest(deps, code);
  await storeAppThenSet(deps, vault, ctx, app, appSettingsUrl(type, ctx.owner, app.slug), {
    title: TITLE,
    fields: [
      { name: "App id", value: String(app.id), hidden: false },
      { name: "client id", value: app.clientId, hidden: false },
      { name: "private key", value: app.pem, hidden: true },
      { name: "App URL", value: app.htmlUrl, hidden: false },
    ],
    note: `GitHub App ${app.htmlUrl}. The private key is the GitHub secret ${SECRET}; the client id is the repository variable ${VARIABLE}.`,
    secrets: [{ name: SECRET, value: app.pem }],
    variables: [{ name: VARIABLE, value: app.clientId }],
  });
  deps.log(`Install the App on ${ctx.repo} only: choose "Only select repositories".`);
  deps.openUrl(`${app.htmlUrl}/installations/new`);
  await verifyInstallation(deps, ctx, app, { intervalMs: pollIntervalMs, limitMs: pollLimitMs });
  deps.log(`The release App is installed on ${ctx.repo} only.`);
}

export default { name: "release-app", secrets: () => [{ name: SECRET }], run };
