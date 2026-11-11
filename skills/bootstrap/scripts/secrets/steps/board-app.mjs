import { randomBytes } from "node:crypto";
import { awaitInstallation, buildManifest, convertManifest, newAppUrl, ownerType, waitForCallback } from "../github-app.mjs";
import { orgVariableExists } from "../github.mjs";
import { storeThenSet } from "../order.mjs";

const SECRET = "BOARD_SYNC_APP_PRIVATE_KEY";
const VARIABLE = "BOARD_SYNC_APP_CLIENT_ID";

async function run(ctx, deps, { vault, rotate, pollIntervalMs, pollLimitMs }) {
  if (rotate) {
    deps.log(`board-app can't rotate: GitHub has no API to make a new App key. Generate one in the App's settings and follow core:1 "By hand".`);
    return;
  }
  const type = await ownerType(deps, ctx.owner);
  if (type !== "Organization") {
    throw new Error(`The board-sync App is only for organisation owners, and ${ctx.owner} is a ${type}: use the board-token step instead`);
  }
  if (await orgVariableExists(deps, ctx.owner, VARIABLE)) {
    deps.log(`The board-sync App already exists for ${ctx.owner}: nothing to do.`);
    return;
  }
  const state = randomBytes(16).toString("hex");
  const { code } = await waitForCallback(deps, state, {
    manifestFor: redirectUrl =>
      buildManifest({ name: `${ctx.owner}-board-sync`, url: `https://github.com/${ctx.owner}`, permissions: { organization_projects: "write", issues: "read" } }, redirectUrl),
    actionUrl: newAppUrl("Organization", ctx.owner, state),
    onListening: ({ url }) => {
      deps.log(`Opening your browser: click "Create GitHub App" when GitHub asks.`);
      deps.openUrl(url);
    },
  });
  const app = await convertManifest(deps, code);
  await storeThenSet(deps, vault, ctx, {
    title: "board-sync App",
    fields: [
      { name: "App id", value: String(app.id), hidden: false },
      { name: "client id", value: app.clientId, hidden: false },
      { name: "private key", value: app.pem, hidden: true },
    ],
    note: `GitHub App ${app.htmlUrl}. The private key is the organisation secret ${SECRET}; the client id is the organisation variable ${VARIABLE}.`,
    secrets: [{ name: SECRET, value: app.pem, scope: "org" }],
    variables: [{ name: VARIABLE, value: app.clientId, scope: "org" }],
  });
  deps.log(`Install the App on ${ctx.owner}: choose "All repositories".`);
  deps.openUrl(`${app.htmlUrl}/installations/new`);
  const installation = await awaitInstallation(deps, ctx.owner, app, {
    intervalMs: pollIntervalMs,
    limitMs: pollLimitMs,
    notInstalledHint: `install it on ${ctx.owner} with "All repositories"; the secret and variable are already set`,
  });
  if (installation.repository_selection !== "all") {
    deps.log(`The App is installed on selected repositories only. Choose All repositories in its installation settings.`);
    throw new Error(`The board-sync App's installation must cover all repositories of ${ctx.owner}`);
  }
  deps.log(`The board-sync App is installed on all of ${ctx.owner}'s repositories.`);
}

export default { name: "board-app", secrets: () => [], folder: ctx => ctx.owner, run };
