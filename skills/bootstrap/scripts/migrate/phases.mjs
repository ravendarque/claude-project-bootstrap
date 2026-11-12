import { Vault } from "../secrets/vault.mjs";
import {
  addItem,
  applyValues,
  archiveItem,
  boardWorkflows,
  boardsInOrganisation,
  compareBoards,
  copyBoard,
  copyableValues,
  countDrafts,
  deleteBoard,
  describeIssue,
  isCopyable,
  linkRepository,
  linkedBoards,
  makePrivate,
  readBoard,
  readItems,
  setValue,
  unarchiveItem,
  clearValue,
} from "./board.mjs";

const SYNC_WORKFLOW = ".github/workflows/project-status-sync.yml";
const SYNC_TEMPLATE = "skills/bootstrap/modules/core/templates/github/workflows/project-status-sync-app.yml";
const SYNC_SECRET = "PROJECT_STATUS_PAT";
const RELEASE_SECRET = "RELEASE_APP_PRIVATE_KEY";
const RELEASE_VARIABLE = "RELEASE_APP_CLIENT_ID";
const RELEASE_ITEM = "release App";
const TRANSFER_POLL_MS = 5000;
const TRANSFER_LIMIT_MS = 120_000;
const MAX_VERIFY_PASSES = 3;
const MAX_ANSWERS = 5;
const PROGRESS_EVERY = 25;

const typedDone = answer => answer.trim().toLowerCase() === "done";

async function waitFor(deps, question, accept = typedDone) {
  for (let attempt = 0; attempt < MAX_ANSWERS; attempt += 1) {
    if (accept((await deps.prompt(question)) ?? "")) return;
  }
  throw new Error("No confirmation received: re-run to resume from this phase");
}

const slug = ctx => `${ctx.org}/${ctx.repo}`;
const boardUrl = (ctx, board) => `https://github.com/orgs/${ctx.org}/projects/${board.number}`;

function countsOf(items) {
  const counts = { ISSUE: 0, PULL_REQUEST: 0, DRAFT_ISSUE: 0, REDACTED: 0, archived: 0, total: items.length };
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    if (item.archived) counts.archived += 1;
  }
  return counts;
}

function printPlan(ctx, inventory) {
  const { deps, login, org, repo } = ctx;
  deps.log(`Plan: move ${login}/${repo} to ${org}/${repo}`);
  if (inventory.board) {
    const { board } = inventory;
    const { counts } = board;
    deps.log(`Board: ${board.title} (#${board.number}), ${counts.total} items (${counts.ISSUE} issues, ${counts.PULL_REQUEST} pull requests, ${counts.DRAFT_ISSUE} drafts, ${counts.REDACTED} redacted), ${counts.archived} archived`);
    deps.log(`Board fields: ${board.fields.map(field => (field.options.length ? `${field.name} (${field.options.length} options)` : field.name)).join(", ")}`);
  } else {
    deps.log("Board: none linked, so the board phases will be skipped");
  }
  deps.log(`Secrets: ${inventory.secrets.join(", ") || "none"}`);
  deps.log(`Variables: ${inventory.variables.join(", ") || "none"}`);
  deps.log(`Pages: ${inventory.pages ? `${inventory.pages.cname ?? inventory.pages.url}` : "none"}`);
  deps.log(`Packages: ${inventory.packages ? inventory.packages.join(", ") || "none" : "couldn't be listed"}`);
  deps.log(`Release App: ${inventory.releaseApp ? "yes, it needs recreating in the organisation" : "no"}`);
  deps.log(`Board sync workflow: ${inventory.syncWorkflow ? "yes, it needs the App variant" : "no"}`);
  deps.log(`Phases: ${PHASES.map(phase => phase.name).join(", ")}`);
}

async function inventory(ctx) {
  const { gh, deps, store, login, org, repo } = ctx;
  if (ctx.dry && store.isDone("inventory")) {
    deps.log("Inventory is already recorded, so this is the stored plan");
    printPlan(ctx, store.data.inventory);
    return;
  }
  if (!(await gh.repository(login, repo))) throw new Error(`${login}/${repo} doesn't exist, so there's nothing to move`);
  if (await gh.repository(org, repo)) throw new Error(`${org} already has a repository named ${repo}: resolve that before migrating`);
  const linked = await linkedBoards(gh, login, repo);
  if (linked.length > 1) {
    throw new Error(`${login}/${repo} is linked to ${linked.length} boards (${linked.map(entry => entry.title).join(", ")}): unlink all but one, then re-run`);
  }
  let board = null;
  if (linked.length === 1) {
    const meta = await readBoard(gh, linked[0].id);
    const items = await readItems(gh, meta.id);
    board = { id: meta.id, number: meta.number, title: meta.title, fields: meta.fields.map(({ name, dataType, options }) => ({ name, dataType, options: options.map(option => option.name) })), counts: countsOf(items) };
  }
  const secrets = await gh.secretNames(`${login}/${repo}`);
  const variables = await gh.variableNames(`${login}/${repo}`);
  const pages = await gh.pages(login, repo);
  const packages = await gh.npmPackages(repo).catch(() => null);
  store.data.inventory = {
    board,
    secrets,
    variables,
    pages: pages ? { url: pages.html_url ?? null, cname: pages.cname ?? null } : null,
    packages,
    releaseApp: secrets.includes(RELEASE_SECRET),
    syncWorkflow: await gh.fileExists(login, repo, SYNC_WORKFLOW),
  };
  printPlan(ctx, store.data.inventory);
}

async function transfer(ctx) {
  const { gh, deps, login, org, repo } = ctx;
  if (!(await gh.repository(org, repo))) await gh.transfer(login, repo, org);
  for (let waited = 0; waited <= TRANSFER_LIMIT_MS; waited += TRANSFER_POLL_MS) {
    if (await gh.repository(org, repo)) {
      deps.log(`${slug(ctx)} is now in the organisation`);
      return;
    }
    await deps.sleep(TRANSFER_POLL_MS);
  }
  throw new Error(`${slug(ctx)} didn't appear within 2 minutes of the transfer: check GitHub, then re-run`);
}

function checkFieldsCopied(oldBoard, newBoard) {
  const problems = [];
  for (const field of oldBoard.fields) {
    const copy = newBoard.fields.find(entry => entry.name === field.name);
    if (!copy) problems.push(`field ${field.name} is missing`);
    else for (const option of field.options) if (!copy.options.some(entry => entry.name === option)) problems.push(`${field.name} has no option ${option}`);
  }
  if (problems.length) throw new Error(`The copied board differs from the old one: ${problems.join("; ")}`);
}

async function copyBoardPhase(ctx) {
  const { gh, deps, store, org } = ctx;
  const { data } = store;
  const old = data.inventory.board;
  if (!old) return deps.log("No board to copy");
  if (!data.newBoard) {
    let created = null;
    if (data.copy.started) {
      const found = await boardsInOrganisation(gh, org, old.title);
      if (found.length > 1) throw new Error(`${org} has ${found.length} boards titled ${old.title} from an earlier attempt: delete the extras, then re-run`);
      created = found[0] ?? null;
    }
    if (!created) {
      data.copy.started = true;
      store.save();
      created = await copyBoard(gh, { sourceId: old.id, ownerId: await gh.organisationId(org), title: old.title });
    }
    data.newBoard = { id: created.id, number: created.number, title: created.title, private: false, fields: [] };
    store.save();
  }
  if (!data.newBoard.private) {
    await makePrivate(gh, data.newBoard.id);
    data.newBoard.private = true;
    store.save();
  }
  const fresh = await readBoard(gh, data.newBoard.id);
  data.newBoard.fields = fresh.fields;
  store.save();
  checkFieldsCopied(old, fresh);
  deps.log(`The new board is ${boardUrl(ctx, data.newBoard)}`);
}

async function placeItem(ctx, old, entry) {
  const { gh, store } = ctx;
  const board = store.data.newBoard;
  await applyValues(gh, board, entry.newId, copyableValues(old));
  if (old.archived) await archiveItem(gh, board.id, entry.newId);
  entry.done = true;
  store.save();
}

async function itemsPhase(ctx) {
  const { gh, deps, store } = ctx;
  const { data } = store;
  if (!data.inventory.board) return deps.log("No board, so no items to copy");
  const oldItems = await readItems(gh, data.inventory.board.id);
  const existing = new Map((await readItems(gh, data.newBoard.id)).filter(item => item.url).map(item => [item.url, item]));
  const copyable = oldItems.filter(isCopyable);
  const redacted = oldItems.filter(item => item.type === "REDACTED").length;
  if (redacted) store.note(`${redacted} redacted items can't be read, so they weren't copied`);
  const iterations = new Set(oldItems.flatMap(item => Object.entries(item.values).filter(([, value]) => value.type === "iteration").map(([name]) => name)));
  for (const name of iterations) store.note(`Iteration field ${name} isn't copied: set its values by hand`);
  let done = 0;
  for (const old of copyable) {
    let entry = data.mapping[old.id];
    if (!entry?.done) {
      if (!entry) {
        const found = existing.get(old.url);
        entry = { newId: found ? found.id : await addItem(gh, data.newBoard.id, old.contentId), done: false };
        data.mapping[old.id] = entry;
        store.save();
      }
      await placeItem(ctx, old, entry);
    }
    done += 1;
    if (done % PROGRESS_EVERY === 0) deps.log(`Copied ${done} of ${copyable.length} items`);
  }
  deps.log(`Copied ${done} of ${copyable.length} items`);
}

async function repair(ctx, issue, oldByUrl, newByUrl) {
  const { gh, store } = ctx;
  const board = store.data.newBoard;
  const old = oldByUrl.get(issue.url);
  if (issue.kind === "missing") {
    const entry = { newId: await addItem(gh, board.id, old.contentId), done: false };
    store.data.mapping[old.id] = entry;
    store.save();
    await placeItem(ctx, old, entry);
  } else if (issue.kind === "value") {
    await setValue(gh, board, newByUrl.get(issue.url).id, issue.field, issue.expected);
  } else if (issue.kind === "extra") {
    await clearValue(gh, board, newByUrl.get(issue.url).id, issue.field);
  } else if (issue.kind === "archived") {
    const { id } = newByUrl.get(issue.url);
    await (issue.expected ? archiveItem(gh, board.id, id) : unarchiveItem(gh, board.id, id));
  }
}

const fixable = issue => ["missing", "value", "extra", "archived"].includes(issue.kind);

async function verifyPhase(ctx) {
  const { gh, deps, store } = ctx;
  const { data } = store;
  if (!data.inventory.board) return deps.log("No board, so nothing to verify");
  const check = async () => {
    const oldItems = await readItems(gh, data.inventory.board.id);
    const newItems = await readItems(gh, data.newBoard.id);
    const { issues } = compareBoards(oldItems, newItems);
    const drafts = { old: countDrafts(oldItems), found: countDrafts(newItems) };
    if (drafts.old !== drafts.found) issues.push({ kind: "drafts", ...drafts });
    return { issues, oldItems, newItems };
  };
  let result = await check();
  let passes = 0;
  while (result.issues.some(fixable) && passes < MAX_VERIFY_PASSES) {
    passes += 1;
    deps.log(`Verify pass ${passes}: re-applying ${result.issues.filter(fixable).length} differences`);
    const oldByUrl = new Map(result.oldItems.map(item => [item.url, item]));
    const newByUrl = new Map(result.newItems.map(item => [item.url, item]));
    for (const issue of result.issues.filter(fixable)) await repair(ctx, issue, oldByUrl, newByUrl);
    result = await check();
  }
  if (result.issues.length) {
    data.verify = { passed: false, passes, remaining: result.issues.slice(0, 20).map(describeIssue) };
    store.save();
    throw new Error(`Verification found ${result.issues.length} differences after ${passes} passes, so the old board is kept. First ones:\n${data.verify.remaining.join("\n")}`);
  }
  data.verify = { passed: true, passes };
  store.save();
  deps.log(`Verified: the new board matches the old one (${passes} repair passes)`);
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

async function linkPhase(ctx) {
  const { gh, deps, store, org, repo } = ctx;
  const { data } = store;
  const { newBoard } = data;
  if (!newBoard) return deps.log("No board to link");
  const target = await gh.repository(org, repo);
  if (!(await linkedBoards(gh, org, repo)).some(entry => entry.id === newBoard.id)) await linkRepository(gh, newBoard.id, target.node_id);
  const status = newBoard.fields.find(field => sameName(field.name, "Status") && field.options.length);
  if (!status) throw new Error("The new board has no Status field with options, so the board sync variables can't be set");
  const option = name => {
    const found = status.options.find(entry => sameName(entry.name, name));
    if (!found) throw new Error(`The new board's Status field has no ${name} option: add one, then re-run`);
    return found.id;
  };
  const repoSlug = slug(ctx);
  await gh.setVariable(repoSlug, "PROJECT_ID", newBoard.id);
  await gh.setVariable(repoSlug, "PROJECT_STATUS_FIELD_ID", status.id);
  await gh.setVariable(repoSlug, "PROJECT_IN_PROGRESS_OPTION", option("In progress"));
  await gh.setVariable(repoSlug, "PROJECT_IN_REVIEW_OPTION", option("In review"));
  for (let attempt = 1; ; attempt += 1) {
    await waitFor(deps, `Open ${boardUrl(ctx, newBoard)}/workflows, turn on Auto-add for ${slug(ctx)} with the filter is:issue, then type done: `);
    const workflows = await boardWorkflows(gh, newBoard.id);
    if (workflows.some(workflow => /auto-add to project/i.test(workflow.name) && workflow.enabled)) return deps.log("Auto-add is enabled");
    if (attempt >= 3) throw new Error("Auto-add still isn't enabled on the new board: enable it, then re-run");
    deps.log("Auto-add isn't enabled yet");
  }
}

async function boardSyncPhase(ctx) {
  const { gh, deps, repo, org } = ctx;
  if (!ctx.store.data.inventory.syncWorkflow) return deps.log(`${repo} has no ${SYNC_WORKFLOW}, so there's nothing to switch`);
  deps.log(`${slug(ctx)} needs the App variant of board sync, from ${SYNC_TEMPLATE}. Put it in through that repository's own PR process.`);
  await waitFor(deps, "Type done once the App variant is merged: ");
  if ((await gh.secretNames(slug(ctx))).includes(SYNC_SECRET)) {
    await gh.deleteSecret(slug(ctx), SYNC_SECRET);
    deps.log(`Deleted ${SYNC_SECRET} from ${org}/${repo}`);
  }
}

async function releaseAppPhase(ctx) {
  const { gh, deps, repo } = ctx;
  if (!ctx.store.data.inventory.releaseApp) return deps.log(`${repo} has no release App`);
  const vault = new Vault(deps, { vault: ctx.vault, folder: repo });
  const item = await vault.find(RELEASE_ITEM);
  if (item) {
    await vault.trash(item);
    deps.log(`Moved the old ${RELEASE_ITEM} item in Pass to the bin`);
  }
  if ((await gh.secretNames(slug(ctx))).includes(RELEASE_SECRET)) await gh.deleteSecret(slug(ctx), RELEASE_SECRET);
  if ((await gh.variableNames(slug(ctx))).includes(RELEASE_VARIABLE)) await gh.deleteVariable(slug(ctx), RELEASE_VARIABLE);
  deps.log(`Run: node skills/bootstrap/scripts/secrets.mjs release-app <project dir>. Then delete the old personal App in your account's settings.`);
  await waitFor(deps, "Type done once the new release App is set up: ");
  const missing = [];
  if (!(await gh.secretNames(slug(ctx))).includes(RELEASE_SECRET)) missing.push(`secret ${RELEASE_SECRET}`);
  if (!(await gh.variableNames(slug(ctx))).includes(RELEASE_VARIABLE)) missing.push(`variable ${RELEASE_VARIABLE}`);
  if (missing.length) throw new Error(`${slug(ctx)} is still missing ${missing.join(" and ")}: run release-app, then re-run`);
}

async function deleteOldBoardPhase(ctx) {
  const { gh, deps, store } = ctx;
  const old = store.data.inventory.board;
  if (!old) return deps.log("No old board to delete");
  if (!store.data.verify?.passed) throw new Error("The new board hasn't been verified, so the old board is kept");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await deps.prompt(`Type the old board's exact title to delete it for good (${old.title}): `)) === old.title) {
      await deleteBoard(gh, old.id);
      return deps.log(`Deleted the old board ${old.title}`);
    }
    deps.log("That isn't the board's exact title");
  }
  throw new Error("The title didn't match, so the old board wasn't deleted");
}

export const PHASES = [
  { name: "inventory", run: inventory },
  { name: "transfer", run: transfer },
  { name: "copy-board", run: copyBoardPhase },
  { name: "items", run: itemsPhase },
  { name: "verify", run: verifyPhase },
  { name: "link", run: linkPhase },
  { name: "board-sync", run: boardSyncPhase },
  { name: "release-app", run: releaseAppPhase },
  { name: "delete-old-board", run: deleteOldBoardPhase },
];

function report(ctx) {
  const { deps, store } = ctx;
  const { inventory: found, notes } = store.data;
  const left = [...notes];
  if (found.pages) left.push(`Pages: check the custom domain on ${slug(ctx)} (${found.pages.cname ?? found.pages.url}) and that the site still answers`);
  if (found.packages?.length) left.push(`Packages ${found.packages.join(", ")} need a new scope and a republish, from the repository`);
  if (found.packages === null) left.push("Packages couldn't be listed: check for npm packages that need a new scope");
  if (left.length) deps.log(`Still to do by hand:\n${left.map(line => `- ${line}`).join("\n")}`);
  deps.log(`Migration of ${ctx.repo} is complete`);
}

export async function runMigration(ctx) {
  for (const phase of PHASES) {
    if (ctx.dry && phase.name !== "inventory") break;
    if (!ctx.dry && ctx.store.isDone(phase.name)) {
      ctx.deps.log(`Skipping ${phase.name}: already done`);
      continue;
    }
    ctx.deps.log(`Phase ${phase.name}`);
    await phase.run(ctx);
    if (!ctx.dry) ctx.store.markDone(phase.name);
  }
  if (!ctx.dry) report(ctx);
}
