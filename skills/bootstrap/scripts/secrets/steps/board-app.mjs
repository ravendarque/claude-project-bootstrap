import { randomBytes } from "node:crypto";
import { appSettingsUrl, awaitInstallation, buildManifest, convertManifest, fetchApp, newAppUrl, ownerType, waitForCallback } from "../github-app.mjs";
import { orgVariableExists, setOrgSecret, setOrgVariable } from "../github.mjs";
import { storeAppThenSet } from "../order.mjs";

const SECRET = "BOARD_SYNC_APP_PRIVATE_KEY";
const VARIABLE = "BOARD_SYNC_APP_CLIENT_ID";
const TITLE = "board-sync App";

async function variableExists(deps, owner) {
  try {
    return await orgVariableExists(deps, owner, VARIABLE);
  } catch (error) {
    if (error.message.includes("admin:org")) {
      throw new Error("board-app needs the admin:org scope: run gh auth refresh -h github.com -s admin:org, then re-run", { cause: error });
    }
    throw error;
  }
}

async function checkInstallation(ctx, deps, app, { pollIntervalMs, pollLimitMs }) {
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

async function resume(ctx, deps, vault, itemId, options) {
  deps.log("Resuming: the board-sync App already exists in Pass");
  const clientId = await vault.field(itemId, "client id");
  const pem = await vault.field(itemId, "private key");
  const htmlUrl = await vault.field(itemId, "App URL").catch(() => "");
  const existing = await fetchApp(deps, { clientId, pem });
  if (!existing.ok) throw new Error(`The board-sync App in Pass no longer exists on GitHub (HTTP ${existing.status}): move the Pass item to the bin, then re-run`);
  await setOrgSecret(deps, ctx.owner, SECRET, pem);
  await setOrgVariable(deps, ctx.owner, VARIABLE, clientId);
  if (!htmlUrl) {
    deps.log(`The Pass item has no App URL: open the App's settings on GitHub and install it on ${ctx.owner} with "All repositories".`);
    return;
  }
  deps.log(`Install the App on ${ctx.owner}: choose "All repositories".`);
  deps.openUrl(`${htmlUrl}/installations/new`);
  await checkInstallation(ctx, deps, { clientId, pem }, options);
}

async function confirmExisting(ctx, deps) {
  const slug = `${ctx.owner}-board-sync`;
  const result = await deps.exec("gh", ["api", `orgs/${ctx.owner}/installations`, "--paginate", "--jq", ".installations[] | [.app_slug, .repository_selection] | @tsv"]);
  if (result.status !== 0) throw new Error(`gh api orgs/${ctx.owner}/installations failed (exit ${result.status}): ${result.stderr.trim()}`);
  const row = result.stdout.split("\n").map(line => line.split("\t")).find(([appSlug]) => appSlug === slug);
  if (!row) throw new Error(`The board-sync App isn't installed on ${ctx.owner}: install it with "All repositories"`);
  if (row[1] !== "all") {
    deps.log(`The App is installed on selected repositories only. Choose All repositories in its installation settings.`);
    throw new Error(`The board-sync App's installation must cover all repositories of ${ctx.owner}`);
  }
  deps.log(`The board-sync App already exists for ${ctx.owner} and covers all repositories: nothing to do.`);
}

async function run(ctx, deps, { vault, rotate, pollIntervalMs, pollLimitMs }) {
  if (rotate) {
    deps.log(`board-app can't rotate: GitHub has no API to make a new App key. Generate one in the App's settings and follow core:2 "By hand".`);
    return;
  }
  const type = await ownerType(deps, ctx.owner);
  if (type !== "Organization") {
    throw new Error(`The board-sync App is only for organisation owners, and ${ctx.owner} is a ${type}: use the board-token step instead`);
  }
  if (await variableExists(deps, ctx.owner)) {
    await confirmExisting(ctx, deps);
    return;
  }
  const earlier = await vault.find(TITLE);
  if (earlier) return resume(ctx, deps, vault, earlier, { pollIntervalMs, pollLimitMs });
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
  await storeAppThenSet(deps, vault, ctx, app, appSettingsUrl("Organization", ctx.owner, app.slug), {
    title: TITLE,
    fields: [
      { name: "App id", value: String(app.id), hidden: false },
      { name: "client id", value: app.clientId, hidden: false },
      { name: "private key", value: app.pem, hidden: true },
      { name: "App URL", value: app.htmlUrl, hidden: false },
    ],
    note: `GitHub App ${app.htmlUrl}. The private key is the organisation secret ${SECRET}; the client id is the organisation variable ${VARIABLE}.`,
    secrets: [{ name: SECRET, value: app.pem, scope: "org" }],
    variables: [{ name: VARIABLE, value: app.clientId, scope: "org" }],
  });
  deps.log(`Install the App on ${ctx.owner}: choose "All repositories".`);
  deps.openUrl(`${app.htmlUrl}/installations/new`);
  await checkInstallation(ctx, deps, app, { pollIntervalMs, pollLimitMs });
}

export default { name: "board-app", secrets: () => [], folder: ctx => ctx.owner, run };
