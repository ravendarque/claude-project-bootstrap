import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { openState } from "../skills/bootstrap/scripts/migrate/state.mjs";
import { runCli } from "../skills/bootstrap/scripts/migrate.mjs";
import { createFake, migrationDeps, scriptedAnswers, seedWorld, stateDir, summarise } from "./helpers-migrate.mjs";

const ARGV = ["widgets", "--org", "acme"];

function setup(options) {
  const fake = createFake();
  const seeded = seedWorld(fake, options);
  const dir = stateDir();
  const go = (answers, argv = ARGV) => runCli(argv, migrationDeps(fake, answers ?? scriptedAnswers(fake)), { stateDir: dir });
  return { fake, dir, go, ...seeded };
}

const withoutIterations = summary =>
  Object.fromEntries(Object.entries(summary).map(([key, { archived, values }]) => [key, { archived, values: Object.fromEntries(Object.entries(values).filter(([, value]) => value.type !== "iteration")) }]));

const newBoard = fake => [...fake.projects.values()].find(project => project.owner === "acme");
const graphqlOps = fake => fake.calls.filter(call => call.args[1] === "graphql").map(call => /(?:query|mutation)\s+(\w+)/.exec(JSON.parse(call.input).query)[1]);

test("a full migration copies every value, keeps archived items archived, and tidies up", async () => {
  const { fake, go, board, repo } = setup();
  const before = withoutIterations(summarise(board));
  const draftBefore = board.items.find(item => item.type === "DRAFT_ISSUE");

  assert.equal(await go(), 0, fake.logs?.join("\n"));

  const copy = newBoard(fake);
  assert.equal(copy.title, "Widgets");
  assert.equal(copy.public, false);
  assert.deepEqual(withoutIterations(summarise(copy)), before);
  assert.equal(copy.items.filter(item => item.isArchived).length, 1);
  assert.equal(copy.items.filter(item => item.type !== "DRAFT_ISSUE").length, 5);
  const draft = copy.items.filter(item => item.type === "DRAFT_ISSUE");
  assert.equal(draft.length, 1);
  assert.deepEqual(draft[0].values, draftBefore.values);
  assert.equal(fake.projects.has(board.id), false);

  assert.ok(fake.repos.has("acme/widgets"));
  assert.ok(fake.repos.get("acme/widgets").linked.includes(copy.id));
  const status = copy.fields.find(field => field.name === "Status");
  assert.equal(repo.variables.get("PROJECT_ID"), copy.id);
  assert.equal(repo.variables.get("PROJECT_STATUS_FIELD_ID"), status.id);
  assert.equal(status.options.find(option => option.id === repo.variables.get("PROJECT_IN_PROGRESS_OPTION")).name, "In Progress");
  assert.equal(status.options.find(option => option.id === repo.variables.get("PROJECT_IN_REVIEW_OPTION")).name, "In review");
  assert.equal(repo.secrets.has("PROJECT_STATUS_PAT"), false);

  const logs = fake.logs.join("\n");
  assert.match(logs, /Iteration field Sprint isn't copied/);
  assert.match(logs, /Pages: check the custom domain/);
  assert.match(logs, /Packages widgets-lib need a new scope/);
  assert.ok(graphqlOps(fake).includes("ItemValues"));
});

test("it takes the personal login from gh and transfers with it", async () => {
  const { fake, go } = setup({ withBoard: false, releaseApp: false, syncWorkflow: false });
  assert.equal(await go(), 0, fake.logs?.join("\n"));
  const post = fake.calls.find(call => call.args.includes("POST"));
  assert.deepEqual(post.args.slice(post.args.indexOf("-X")), ["-X", "POST", "repos/alice/widgets/transfer", "-f", "new_owner=acme"]);
});

test("the organisation defaults to oneloneraven", async () => {
  const fake = createFake({ org: "oneloneraven" });
  seedWorld(fake, { withBoard: false, releaseApp: false, syncWorkflow: false });
  const code = await runCli(["widgets"], migrationDeps(fake), { stateDir: stateDir() });
  assert.equal(code, 0, fake.logs?.join("\n"));
  assert.ok(fake.repos.has("oneloneraven/widgets"));
});

test("a mutation is never closer than a second to the one before", async () => {
  const { fake, go } = setup();
  assert.equal(await go(), 0, fake.logs?.join("\n"));
  assert.equal(fake.sleeps.filter(ms => ms === 1000).length, fake.mutations.length - 1);
});

test("a killed run resumes from the mapping without duplicating items", async () => {
  const { fake, dir, go, board } = setup();
  fake.crash = { op: "AddItem", nth: 3 };
  assert.equal(await go(), 1);
  assert.match(fake.logs.join("\n"), /killed/);
  assert.equal(newBoard(fake).items.filter(item => item.contentId).length, 3);

  fake.crash = null;
  assert.equal(await go(), 0, fake.logs.join("\n"));
  const copy = newBoard(fake);
  const contentIds = copy.items.filter(item => item.contentId).map(item => item.contentId);
  assert.equal(contentIds.length, 5);
  assert.equal(new Set(contentIds).size, 5);
  assert.equal(fake.mutations.filter(label => label === "AddItem").length, 5);
  assert.equal(fake.mutations.filter(label => label === "transfer").length, 1);
  assert.equal(fake.mutations.filter(label => label === "CopyBoard").length, 1);
  assert.match(fake.logs.join("\n"), /Skipping transfer: already done/);
  assert.equal(fake.projects.has(board.id), false);
  assert.ok(readdirSync(dir).includes("widgets.json"));
});

test("a killed run after the board copy adopts that copy rather than making another", async () => {
  const { fake, go } = setup();
  fake.crash = { op: "CopyBoard", nth: 1 };
  assert.equal(await go(), 1);
  fake.crash = null;
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.equal([...fake.projects.values()].filter(project => project.owner === "acme").length, 1);
});

test("verify re-applies a value a board workflow overwrote", async () => {
  const { fake, go } = setup();
  const seen = new Set();
  fake.hooks.afterSet = (project, item, field) => {
    if (project.owner !== "acme" || field !== "Status" || seen.has(item.id) || item.values.Status.value !== "Done") return;
    seen.add(item.id);
    item.values.Status = { type: "single", value: "Todo" };
  };
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.match(fake.logs.join("\n"), /Verify pass 1: re-applying/);
  assert.ok(newBoard(fake).items.filter(item => item.values.Status?.value === "Done").length >= 2);
});

test("verify stops the migration before the old board is deleted when a mismatch survives three passes", async () => {
  const { fake, go, board } = setup();
  fake.hooks.afterSet = (project, item, field) => {
    if (project.owner === "acme" && field === "Status" && item.values.Status.value === "Done") item.values.Status = { type: "single", value: "Todo" };
  };
  assert.equal(await go(), 1);
  const logs = fake.logs.join("\n");
  assert.equal(fake.logs.filter(line => line.startsWith("Verify pass")).length, 3);
  assert.match(logs, /Verification found \d+ differences after 3 passes/);
  assert.match(logs, /Status should be "Done", found "Todo"/);
  assert.equal(fake.projects.has(board.id), true);
  assert.equal(fake.mutations.includes("DeleteBoard"), false);
  assert.equal(fake.mutations.includes("LinkRepo"), false);
});

test("inventory refuses a repository linked to two boards", async () => {
  const { fake, go } = setup();
  fake.addProject({ owner: "alice", title: "Second", repo: "alice/widgets" });
  assert.equal(await go(), 1);
  assert.match(fake.logs.join("\n"), /linked to 2 boards/);
  assert.deepEqual(fake.mutations, []);
});

test("inventory refuses when the organisation already has the repository", async () => {
  const { fake, go } = setup();
  fake.addRepo("acme", "widgets");
  assert.equal(await go(), 1);
  assert.match(fake.logs.join("\n"), /acme already has a repository named widgets/);
  assert.deepEqual(fake.mutations, []);
});

test("--dry-run prints the plan and makes no mutation or state", async () => {
  const { fake, dir, go } = setup();
  assert.equal(await go(undefined, [...ARGV, "--dry-run"]), 0, fake.logs.join("\n"));
  assert.deepEqual(fake.mutations, []);
  assert.deepEqual(fake.sleeps, []);
  assert.deepEqual(readdirSync(dir), []);
  const logs = fake.logs.join("\n");
  assert.match(logs, /Plan: move alice\/widgets to acme\/widgets/);
  assert.match(logs, /Board: Widgets \(#1\), 6 items \(4 issues, 1 pull requests, 1 drafts, 0 redacted\), 1 archived/);
  assert.match(logs, /Secrets: PROJECT_STATUS_PAT, RELEASE_APP_PRIVATE_KEY/);
  assert.match(logs, /Release App: yes/);
  assert.equal(fake.repos.has("alice/widgets"), true);
});

test("the old board is only deleted when its exact title is typed", async () => {
  const { fake, go, board } = setup();
  const scripted = scriptedAnswers(fake);
  assert.equal(await go(question => (/exact title/.test(question) ? "widgets" : scripted(question))), 1);
  assert.equal(fake.projects.has(board.id), true);
  assert.equal(fake.prompts.filter(question => /exact title/.test(question)).length, 3);
  assert.equal(fake.mutations.includes("DeleteBoard"), false);

  assert.equal(await go(scripted), 0, fake.logs.join("\n"));
  assert.equal(fake.projects.has(board.id), false);
  assert.equal(fake.mutations.filter(label => label === "DeleteBoard").length, 1);
});

test("the release-app phase bins the old Pass item and deletes the two names without reading a value", async () => {
  const { fake, go, repo } = setup({ withBoard: false, syncWorkflow: false });
  const scripted = scriptedAnswers(fake);
  let atPrompt;
  assert.equal(
    await go(question => {
      if (/new release App/.test(question)) atPrompt = { secrets: [...repo.secrets], variables: [...repo.variables.keys()], trashed: [...fake.trashed] };
      return scripted(question);
    }),
    0,
    fake.logs.join("\n"),
  );
  assert.deepEqual(atPrompt, { secrets: [], variables: ["UNRELATED"], trashed: ["-oldpassid"] });
  const trash = fake.calls.find(call => call.cmd === "pass-cli" && call.args[1] === "trash");
  assert.ok(trash.args.includes("--item-id=-oldpassid"));
  assert.equal(fake.calls.some(call => call.cmd === "pass-cli" && (call.args.includes("view") || call.args.includes("--field"))), false);
  assert.equal(fake.calls.some(call => call.cmd === "gh" && (call.args.includes("set") && call.args[0] === "secret")), false);
  assert.ok(fake.mutations.includes("secret delete RELEASE_APP_PRIVATE_KEY"));
  assert.ok(fake.mutations.includes("variable delete RELEASE_APP_CLIENT_ID"));
  assert.equal(JSON.stringify(fake.calls).includes("Iv1"), false);
});

test("the release-app phase fails if the new secret and variable aren't there afterwards", async () => {
  const { fake, go } = setup({ withBoard: false, syncWorkflow: false });
  assert.equal(await go(() => "done"), 1);
  assert.match(fake.logs.join("\n"), /still missing secret RELEASE_APP_PRIVATE_KEY and variable RELEASE_APP_CLIENT_ID/);
});

test("the board-sync phase deletes PROJECT_STATUS_PAT only after confirmation", async () => {
  const { fake, go, repo } = setup({ withBoard: false, releaseApp: false });
  assert.equal(await go(() => "not yet"), 1);
  assert.equal(repo.secrets.has("PROJECT_STATUS_PAT"), true);
  assert.equal(fake.mutations.some(label => label.startsWith("secret delete")), false);

  const scripted = scriptedAnswers(fake);
  let atPrompt;
  assert.equal(
    await go(question => {
      if (/App variant/.test(question)) atPrompt = repo.secrets.has("PROJECT_STATUS_PAT");
      return scripted(question);
    }),
    0,
    fake.logs.join("\n"),
  );
  assert.equal(atPrompt, true);
  assert.equal(repo.secrets.has("PROJECT_STATUS_PAT"), false);
});

test("link waits until Auto-add is actually enabled", async () => {
  const { fake, go } = setup({ releaseApp: false, syncWorkflow: false });
  assert.equal(await go(() => "done"), 1);
  assert.match(fake.logs.join("\n"), /Auto-add still isn't enabled/);
  assert.equal(fake.prompts.filter(question => /Auto-add/.test(question)).length, 3);
});

test("a repository with no board skips the board phases", async () => {
  const { fake, go } = setup({ withBoard: false, releaseApp: false, syncWorkflow: false });
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.deepEqual(fake.mutations, ["transfer"]);
  assert.match(fake.logs.join("\n"), /Board: none linked/);
});

test("usage errors exit 2", async () => {
  const { fake, go } = setup();
  assert.equal(await go(undefined, []), 2);
  assert.equal(await go(undefined, ["../escape"]), 2);
  assert.equal(await go(undefined, ["widgets", "extra"]), 2);
  assert.equal(await go(undefined, ["widgets", "--nope"]), 2);
  assert.match(fake.logs.join("\n"), /Usage: migrate.mjs/);
});

test("it refuses to run as the organisation itself", async () => {
  const fake = createFake({ login: "acme" });
  seedWorld(fake);
  assert.equal(await runCli(ARGV, migrationDeps(fake), { stateDir: stateDir() }), 1);
  assert.match(fake.logs.join("\n"), /signed in as acme, the target organisation/);
});

test("verify unarchives an item a board workflow archived that the old board kept active", async () => {
  const { fake, go, board } = setup();
  const target = board.items.find(item => item.values.Status?.value === "Todo" && item.contentId);
  fake.hooks.afterSet = (project, item, field) => {
    if (project.owner === "acme" && field === "Status" && item.contentId === target.contentId) item.isArchived = true;
  };
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.ok(fake.mutations.includes("UnarchiveItem"));
  assert.equal(newBoard(fake).items.find(item => item.contentId === target.contentId).isArchived, false);
});

test("verify clears a value a board workflow set where the old item had none", async () => {
  const { fake, go, board } = setup();
  const contentId = fake.addContent("alice/widgets");
  fake.addItem(board, { contentId, values: { Priority: { type: "single", value: "P0" } } });
  fake.hooks.afterAdd = (project, item) => {
    if (project.owner === "acme" && item.contentId === contentId) item.values.Status = { type: "single", value: "Todo" };
  };
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.match(fake.logs.join("\n"), /Verify pass 1/);
  assert.ok(fake.mutations.includes("ClearValue"));
  const item = newBoard(fake).items.find(entry => entry.contentId === contentId);
  assert.deepEqual(item.values, { Priority: { type: "single", value: "P0" } });
});

test("the link phase can be run twice without a second link or an error", async () => {
  const { fake, dir, go } = setup();
  assert.equal(await go(), 0, fake.logs.join("\n"));
  const state = openState(dir, "widgets");
  delete state.data.phases.link;
  state.save();
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.equal(fake.logs.filter(line => line === "Phase link").length, 2);
  assert.equal(fake.mutations.filter(label => label === "LinkRepo").length, 1);
  assert.equal(fake.repos.get("acme/widgets").linked.length, 1);
});

test("board-sync keeps PROJECT_STATUS_PAT until the default branch really uses the App token", async () => {
  const { fake, go, repo } = setup({ withBoard: false, releaseApp: false });
  assert.equal(await go(() => "done"), 1);
  assert.match(fake.logs.join("\n"), /doesn't use actions\/create-github-app-token yet/);
  assert.equal(fake.prompts.filter(question => /App variant/.test(question)).length, 3);
  assert.equal(repo.secrets.has("PROJECT_STATUS_PAT"), true);
});

test("verify removes items a board workflow added that were never on the old board, and nothing is added twice", async () => {
  const { fake, go, board } = setup();
  const parent = board.items.find(item => item.contentId && !item.isArchived);
  const child = fake.addItem(board, { contentId: fake.addContent("alice/widgets"), values: { Status: { type: "single", value: "Todo" } } });
  const stray = fake.addContent("alice/widgets");
  fake.hooks.afterAdd = (project, item) => {
    if (project.owner !== "acme" || item.contentId !== parent.contentId) return;
    fake.addItem(project, { contentId: child.contentId });
    fake.addItem(project, { contentId: stray });
  };
  assert.equal(await go(), 0, fake.logs.join("\n"));
  const items = newBoard(fake).items.filter(entry => entry.contentId);
  assert.equal(new Set(items.map(entry => entry.contentId)).size, items.length);
  assert.equal(items.some(entry => entry.contentId === stray), false);
  assert.equal(items.filter(entry => entry.contentId === child.contentId).length, 1);
  assert.equal(items.find(entry => entry.contentId === child.contentId).values.Status.value, "Todo");
  assert.ok(fake.mutations.includes("DeleteItem"));
  assert.equal(fake.mutations.filter(label => label === "AddItem").length, 5);
});

test("verify waits for late workflows to land before each comparison", async () => {
  const { fake, go } = setup();
  fake.hooks.afterAdd = (project, item) => {
    if (project.owner === "acme") fake.late.push(() => (item.values.Status = { type: "single", value: "Todo" }));
  };
  assert.equal(await go(), 0, fake.logs.join("\n"));
  const settles = fake.sleeps.filter(ms => ms === 30_000).length;
  assert.match(fake.logs.join("\n"), /Verify pass 1/);
  assert.equal(settles, 1 + fake.logs.filter(line => line.startsWith("Verify pass")).length);
});

test("release-app doesn't create a Pass folder, and says when no old item was found", async () => {
  const { fake, go } = setup({ withBoard: false, syncWorkflow: false, passFolder: false });
  assert.equal(await go(), 0, fake.logs.join("\n"));
  assert.equal(fake.calls.some(call => call.cmd === "pass-cli" && call.args[1] === "create"), false);
  assert.match(fake.logs.join("\n"), /No old release App item was found in Dev\/widgets/);
  assert.deepEqual(fake.trashed, []);
});
