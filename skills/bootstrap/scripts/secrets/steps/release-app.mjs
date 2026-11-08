import { randomBytes } from "node:crypto";
import { buildManifest, convertManifest, verifyInstallation, waitForCallback } from "../github-app.mjs";
import { storeThenSet } from "../order.mjs";

export { appJwt, buildManifest, waitForCallback } from "../github-app.mjs";

const SECRET = "RELEASE_APP_PRIVATE_KEY";
const VARIABLE = "RELEASE_APP_CLIENT_ID";

async function run(ctx, deps, { vault, rotate, pollIntervalMs, pollLimitMs }) {
  if (rotate) {
    deps.log(`release-app can't rotate: GitHub has no API to make a new App key. Generate one in the App's settings and follow core:1 "By hand".`);
    return;
  }
  const state = randomBytes(16).toString("hex");
  const { code } = await waitForCallback(deps, state, {
    manifestFor: redirectUrl => buildManifest(ctx, redirectUrl),
    onListening: ({ url }) => {
      deps.log(`Opening your browser: click "Create GitHub App" when GitHub asks.`);
      deps.openUrl(url);
    },
  });
  const app = await convertManifest(deps, code);
  await storeThenSet(deps, vault, ctx, {
    title: "release App",
    fields: [
      { name: "App id", value: String(app.id), hidden: false },
      { name: "client id", value: app.clientId, hidden: false },
      { name: "private key", value: app.pem, hidden: true },
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
