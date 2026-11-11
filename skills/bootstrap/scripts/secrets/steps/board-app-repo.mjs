import { setSecret, setVariable } from "../github.mjs";

const TITLE = "board-sync App";
const SECRET = "BOARD_SYNC_APP_PRIVATE_KEY";
const VARIABLE = "BOARD_SYNC_APP_CLIENT_ID";

async function run(ctx, deps, { vault }) {
  if (ctx.answers.visibility !== "private") {
    throw new Error(`${ctx.repo} isn't private: public repositories read the organisation secret, so there's nothing to copy`);
  }
  const itemId = await vault.find(TITLE);
  if (!itemId) throw new Error(`No ${TITLE} item in the ${ctx.owner} folder in Pass: run board-app first`);
  const clientId = await vault.field(itemId, "client id");
  const key = await vault.field(itemId, "private key");
  await setSecret(deps, ctx.repo, SECRET, key);
  await setVariable(deps, ctx.repo, VARIABLE, clientId);
  deps.log(`The board-sync App's key and client id are set on ${ctx.repo}.`);
}

export default { name: "board-app-repo", secrets: () => [{ name: SECRET }], folder: ctx => ctx.owner, run };
