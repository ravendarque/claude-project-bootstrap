import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const reply = (status, body, headers = {}) => {
  const head = Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join("");
  return {
    status: status >= 400 ? 1 : 0,
    stdout: `HTTP/2.0 ${status} X\r\n${head}\r\n${body === undefined ? "" : JSON.stringify(body)}`,
    stderr: status >= 400 ? `gh: ${body?.message ?? "error"} (HTTP ${status})` : "",
  };
};

const text = stdout => ({ status: 0, stdout, stderr: "" });

export function createFake({ login = "alice", pageSize = 3, org = "acme" } = {}) {
  let counter = 0;
  const id = prefix => `${prefix}_${++counter}`;
  const world = {
    login,
    org,
    repos: new Map(),
    projects: new Map(),
    contents: new Map(),
    pending: null,
    limits: [],
    mutations: [],
    calls: [],
    prompts: [],
    sleeps: [],
    passItems: [],
    trashed: [],
    packages: [],
    crash: null,
    hooks: {},
    transferPolls: 2,
    late: [],
  };
  const numbers = new Map();
  const nextNumber = owner => {
    numbers.set(owner, (numbers.get(owner) ?? 0) + 1);
    return numbers.get(owner);
  };

  const urlOf = contentId => {
    const content = world.contents.get(contentId);
    return `https://github.com/${content.repo}/${content.kind === "PULL_REQUEST" ? "pull" : "issues"}/${content.number}`;
  };

  function addRepo(owner, name, extra = {}) {
    const repo = { node_id: id("R"), owner, name, secrets: new Set(), variables: new Map(), pages: null, files: new Map(), linked: [], ...extra };
    world.repos.set(`${owner}/${name}`, repo);
    return repo;
  }

  function addProject({ owner, title, fields = [], repo = null }) {
    const project = { id: id("P"), number: nextNumber(owner), title, owner, public: true, fields: [], items: [], workflows: [{ name: "Auto-add to project", enabled: false }, { name: "Item added to project", enabled: true }] };
    project.fields = [{ id: id("F"), name: "Title", dataType: "TITLE", options: null }, ...fields.map(field => ({ id: id("F"), options: null, ...field, options: field.options ? field.options.map(name => ({ id: id("O"), name })) : null }))];
    world.projects.set(project.id, project);
    if (repo) world.repos.get(repo).linked.push(project.id);
    return project;
  }

  function addContent(repo, kind = "ISSUE") {
    const contentId = id(kind === "PULL_REQUEST" ? "PR" : "I");
    world.contents.set(contentId, { repo, kind, number: world.contents.size + 1 });
    return contentId;
  }

  function addItem(project, { contentId = null, type = "ISSUE", archived = false, values = {}, title } = {}) {
    const item = { id: id("PVTI"), isArchived: archived, type, contentId, title, values: { ...values } };
    project.items.push(item);
    return item;
  }

  const connection = (list, after, map = entry => entry) => {
    const start = after ? Number(after) : 0;
    const end = start + pageSize;
    return { nodes: list.slice(start, end).map(map), pageInfo: { hasNextPage: end < list.length, endCursor: String(end) } };
  };

  const DATA_TYPES = { single: "SINGLE_SELECT", number: "NUMBER", text: "TEXT", date: "DATE", iteration: "ITERATION" };
  const valueNode = (name, { type, value }) => {
    const field = { name, dataType: DATA_TYPES[type] };
    if (type === "single") return { __typename: "ProjectV2ItemFieldSingleSelectValue", name: value, field };
    if (type === "number") return { __typename: "ProjectV2ItemFieldNumberValue", number: value, field };
    if (type === "text") return { __typename: "ProjectV2ItemFieldTextValue", text: value, field };
    if (type === "date") return { __typename: "ProjectV2ItemFieldDateValue", date: value, field };
    return { __typename: "ProjectV2ItemFieldIterationValue", title: value, field };
  };

  const valueNodes = item => [
    { __typename: "ProjectV2ItemFieldTextValue", text: "Some title", field: { name: "Title", dataType: "TITLE" } },
    { __typename: "ProjectV2ItemFieldRepositoryValue" },
    { __typename: "ProjectV2ItemFieldDateValue", date: "2026-01-01", field: { name: "Created", dataType: "CREATED" } },
    { __typename: "ProjectV2ItemFieldDateValue", date: "2026-02-02", field: { name: "Closed", dataType: "CLOSED" } },
    { __typename: "ProjectV2ItemFieldTextValue", text: "x", field: { name: "Updated", dataType: "UPDATED" } },
    ...Object.entries(item.values).map(([name, value]) => valueNode(name, value)),
  ];

  const itemNode = item => ({
    id: item.id,
    isArchived: item.isArchived,
    type: item.type,
    content: item.type === "DRAFT_ISSUE" ? { id: item.id } : item.type === "REDACTED" ? null : { id: item.contentId, url: urlOf(item.contentId), repository: { nameWithOwner: world.contents.get(item.contentId).repo } },
    fieldValues: connection(valueNodes(item), null),
  });

  const findItem = itemId => {
    for (const project of world.projects.values()) {
      const item = project.items.find(entry => entry.id === itemId);
      if (item) return { project, item };
    }
    return null;
  };

  function mutate(label) {
    world.mutations.push(label);
  }

  function handleGraphql(op, v) {
    switch (op) {
      case "LinkedBoards": {
        const repo = world.repos.get(`${v.owner}/${v.name}`);
        return { repository: { projectsV2: connection(repo.linked.map(pid => world.projects.get(pid)), v.after, p => ({ id: p.id, number: p.number, title: p.title })) } };
      }
      case "BoardMeta": {
        const p = world.projects.get(v.id);
        return { node: { id: p.id, number: p.number, title: p.title, public: p.public } };
      }
      case "BoardFields":
        return { node: { fields: connection(world.projects.get(v.id).fields, v.after, f => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options && { options: f.options }) })) } };
      case "BoardItems":
        while (world.late.length) world.late.shift()();
        return { node: { items: connection(world.projects.get(v.id).items, v.after, itemNode) } };
      case "ContentItems": {
        const nodes = [];
        for (const project of world.projects.values()) for (const item of project.items) if (item.contentId === v.id) nodes.push({ id: item.id, project: { id: project.id } });
        return { node: { projectItems: connection(nodes, v.after) } };
      }
      case "DeleteItem": {
        mutate("DeleteItem");
        const project = world.projects.get(v.input.projectId);
        project.items = project.items.filter(item => item.id !== v.input.itemId);
        return { deleteProjectV2Item: { deletedItemId: v.input.itemId } };
      }
      case "ItemValues":
        return { node: { fieldValues: connection(valueNodes(findItem(v.id).item), v.after) } };
      case "OrganisationBoards":
        return { organization: { projectsV2: connection([...world.projects.values()].filter(p => p.owner === v.login && p.title.includes(v.title)), v.after, p => ({ id: p.id, number: p.number, title: p.title })) } };
      case "BoardWorkflows":
        return { node: { workflows: connection(world.projects.get(v.id).workflows, v.after) } };
      case "OrganisationId":
        return { organization: v.login === world.org ? { id: "ORG_1" } : null };
      case "CopyBoard": {
        mutate("CopyBoard");
        const source = world.projects.get(v.input.projectId);
        const copy = addProject({ owner: world.org, title: v.input.title });
        copy.fields = structuredClone(source.fields).map(f => ({ ...f, id: id("F"), options: f.options?.map(o => ({ ...o, id: id("O") })) ?? null }));
        copy.workflows = structuredClone(source.workflows).map(w => ({ ...w, enabled: false }));
        for (const draft of source.items.filter(item => item.type === "DRAFT_ISSUE")) addItem(copy, { type: "DRAFT_ISSUE", title: draft.title, values: structuredClone(draft.values) });
        return { copyProjectV2: { projectV2: { id: copy.id, number: copy.number, title: copy.title } } };
      }
      case "MakePrivate":
        mutate("MakePrivate");
        world.projects.get(v.input.projectId).public = v.input.public;
        return { updateProjectV2: { projectV2: { id: v.input.projectId } } };
      case "AddItem": {
        mutate("AddItem");
        const project = world.projects.get(v.input.projectId);
        const existing = project.items.find(item => item.contentId === v.input.contentId);
        const item = existing ?? addItem(project, { contentId: v.input.contentId });
        if (!existing) world.hooks.afterAdd?.(project, item);
        return { addProjectV2ItemById: { item: { id: item.id } } };
      }
      case "SetValue": {
        mutate("SetValue");
        const { projectId, itemId, fieldId, value } = v.input;
        const project = world.projects.get(projectId);
        const field = project.fields.find(entry => entry.id === fieldId);
        const item = project.items.find(entry => entry.id === itemId);
        if (value.singleSelectOptionId) item.values[field.name] = { type: "single", value: field.options.find(o => o.id === value.singleSelectOptionId).name };
        else if ("number" in value) item.values[field.name] = { type: "number", value: value.number };
        else if ("text" in value) item.values[field.name] = { type: "text", value: value.text };
        else item.values[field.name] = { type: "date", value: value.date };
        world.hooks.afterSet?.(project, item, field.name);
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: itemId } } };
      }
      case "ArchiveItem": {
        mutate("ArchiveItem");
        world.projects.get(v.input.projectId).items.find(item => item.id === v.input.itemId).isArchived = true;
        return { archiveProjectV2Item: { item: { id: v.input.itemId } } };
      }
      case "UnarchiveItem":
        mutate("UnarchiveItem");
        world.projects.get(v.input.projectId).items.find(item => item.id === v.input.itemId).isArchived = false;
        return { unarchiveProjectV2Item: { item: { id: v.input.itemId } } };
      case "ClearValue": {
        mutate("ClearValue");
        const project = world.projects.get(v.input.projectId);
        const field = project.fields.find(entry => entry.id === v.input.fieldId);
        delete project.items.find(item => item.id === v.input.itemId).values[field.name];
        return { clearProjectV2ItemFieldValue: { projectV2Item: { id: v.input.itemId } } };
      }
      case "LinkRepo": {
        mutate("LinkRepo");
        const repo = [...world.repos.values()].find(entry => entry.node_id === v.input.repositoryId);
        if (!repo.linked.includes(v.input.projectId)) repo.linked.push(v.input.projectId);
        return { linkProjectV2ToRepository: { repository: { id: v.input.repositoryId } } };
      }
      case "DeleteBoard":
        mutate("DeleteBoard");
        world.projects.delete(v.input.projectId);
        return { deleteProjectV2: { projectV2: { id: v.input.projectId } } };
      default:
        throw new Error(`fake GitHub: unknown GraphQL operation ${op}`);
    }
  }

  function limited(label, graphql) {
    const limit = world.limits.find(entry => entry.remaining > 0 && entry.match.test(label));
    if (!limit) return null;
    limit.remaining -= 1;
    limit.seen = (limit.seen ?? 0) + 1;
    if (graphql) return reply(200, { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] });
    return reply(limit.status ?? 403, { message: "You have exceeded a secondary rate limit" }, limit.retryAfter === undefined ? {} : { "Retry-After": String(limit.retryAfter) });
  }

  function rest(method, path) {
    const [route] = path.split("?");
    const repoMatch = /^repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(route);
    if (method === "GET" && repoMatch && !repoMatch[3]) {
      const key = `${repoMatch[1]}/${repoMatch[2]}`;
      if (world.pending?.key === key) {
        if (world.pending.polls-- > 0) return reply(404, { message: "Not Found" });
        world.pending = null;
      }
      const repo = world.hooks.repositoryRead?.(key) === false ? null : world.repos.get(key);
      return repo ? reply(200, { node_id: repo.node_id, html_url: `https://github.com/${key}` }) : reply(404, { message: "Not Found" });
    }
    if (method === "POST" && repoMatch?.[3] === "transfer") {
      mutate("transfer");
      const from = `${repoMatch[1]}/${repoMatch[2]}`;
      const repo = world.repos.get(from);
      world.repos.delete(from);
      repo.owner = world.org;
      repo.linked = [];
      for (const content of world.contents.values()) if (content.repo === from) content.repo = `${world.org}/${repoMatch[2]}`;
      world.repos.set(`${world.org}/${repoMatch[2]}`, repo);
      world.pending = { key: `${world.org}/${repoMatch[2]}`, polls: world.transferPolls };
      return reply(202, {});
    }
    if (method === "GET" && repoMatch?.[3] === "pages") {
      const repo = world.repos.get(`${repoMatch[1]}/${repoMatch[2]}`);
      return repo.pages ? reply(200, repo.pages) : reply(404, { message: "Not Found" });
    }
    if (method === "GET" && repoMatch?.[3]?.startsWith("contents/")) {
      const repo = world.repos.get(`${repoMatch[1]}/${repoMatch[2]}`);
      const file = repo.files.get(repoMatch[3].slice("contents/".length));
      return file === undefined ? reply(404, { message: "Not Found" }) : reply(200, { type: "file", encoding: "base64", content: Buffer.from(file).toString("base64") });
    }
    if (method === "GET" && route === "user/packages") return reply(200, world.packages);
    throw new Error(`fake GitHub: unknown REST call ${method} ${path}`);
  }

  function exec(cmd, args, options = {}) {
    world.calls.push({ cmd, args, input: options.input });
    if (cmd === "pass-cli") return passCli(args);
    if (cmd !== "gh") throw new Error(`fake: unexpected command ${cmd}`);
    if (args[0] === "auth") return text("");
    if (args[0] === "api" && args[1] === "user") return text(`${world.login}\n`);
    if (args[0] === "api" && args[1] === "graphql") {
      const { query, variables } = JSON.parse(options.input);
      const op = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)[1];
      const blocked = limited(op, true);
      if (blocked) return blocked;
      const crash = world.crash?.op === op ? world.crash : null;
      if (crash) crash.seen = (crash.seen ?? 0) + 1;
      if (crash?.before && crash.seen === crash.nth) throw new Error("killed");
      const data = handleGraphql(op, variables);
      if (crash && !crash.before && crash.seen === crash.nth) throw new Error("killed");
      return reply(200, { data });
    }
    if (args[0] === "api") {
      const method = args[args.indexOf("-X") + 1];
      const path = args[args.indexOf("-X") + 2];
      const blocked = limited(`${method} ${path}`, false);
      return blocked ?? rest(method, path);
    }
    const repo = world.repos.get(args[args.indexOf("--repo") + 1]);
    const [kind, action, name] = args;
    if (kind === "variable" && action === "get") {
      const failure = world.hooks.variableGet?.(args[args.indexOf("--repo") + 1], name);
      if (failure) return failure;
      return repo?.variables.has(name) ? text(`${repo.variables.get(name)}\n`) : { status: 1, stdout: "", stderr: `variable ${name} was not found` };
    }
    if (kind === "secret" && action === "list") return text(JSON.stringify([...repo.secrets].map(entry => ({ name: entry }))));
    if (kind === "secret" && action === "delete") {
      mutate(`secret delete ${name}`);
      repo.secrets.delete(name);
      return text("");
    }
    if (kind === "variable" && action === "list") return text(JSON.stringify([...repo.variables.keys()].map(entry => ({ name: entry }))));
    if (kind === "variable" && action === "set") {
      mutate(`variable set ${name}`);
      repo.variables.set(name, options.input);
      return text("");
    }
    if (kind === "variable" && action === "delete") {
      mutate(`variable delete ${name}`);
      repo.variables.delete(name);
      return text("");
    }
    throw new Error(`fake GitHub: unknown command gh ${args.join(" ")}`);
  }

  function passCli(args) {
    const key = args.slice(0, 2).join(" ");
    if (key === "folder list") return text(JSON.stringify(world.passFolder ? [{ id: "f1", parent_folder_id: null, content: { name: world.passFolder } }] : []));
    if (key === "item list") return text(JSON.stringify({ items: world.passItems.filter(item => !world.trashed.includes(item.id)) }));
    if (key === "item trash") {
      world.trashed.push(args.find(arg => arg.startsWith("--item-id=")).slice("--item-id=".length));
      return text("");
    }
    throw new Error(`fake pass-cli: ${args.join(" ")} must not be called`);
  }

  return Object.assign(world, { exec, addRepo, addProject, addContent, addItem, urlOf, itemNode });
}

export function seedWorld(fake, { releaseApp = true, syncWorkflow = true, withBoard = true, passFolder = true } = {}) {
  const repo = fake.addRepo(fake.login, "widgets", {
    pages: { html_url: "https://widgets.example.com/", cname: "widgets.example.com" },
  });
  repo.variables.set("UNRELATED", "x");
  if (syncWorkflow) {
    repo.files.set(".github/workflows/project-status-sync.yml", "token: ${{ secrets.PROJECT_STATUS_PAT }}");
    repo.secrets.add("PROJECT_STATUS_PAT");
  }
  if (releaseApp) {
    repo.secrets.add("RELEASE_APP_PRIVATE_KEY");
    repo.variables.set("RELEASE_APP_CLIENT_ID", "Iv1.old");
    if (passFolder) fake.passFolder = "widgets";
    fake.passItems.push({ id: "-oldpassid", title: "release App", folder_id: "f1" });
  }
  fake.packages = [{ name: "widgets-lib", repository: { name: "widgets" } }, { name: "other", repository: { name: "elsewhere" } }];
  if (!withBoard) return { repo };
  const board = fake.addProject({
    owner: fake.login,
    title: "Widgets",
    repo: `${fake.login}/widgets`,
    fields: [
      { name: "Status", dataType: "SINGLE_SELECT", options: ["Todo", "In Progress", "In review", "Done"] },
      { name: "Priority", dataType: "SINGLE_SELECT", options: ["P0", "P1"] },
      { name: "Estimate", dataType: "NUMBER" },
      { name: "Notes", dataType: "TEXT" },
      { name: "Due", dataType: "DATE" },
      { name: "Sprint", dataType: "ITERATION" },
    ],
  });
  const slug = `${fake.login}/widgets`;
  const issue = (values, extra = {}) => fake.addItem(board, { contentId: fake.addContent(slug), values, ...extra });
  issue({ Status: { type: "single", value: "Todo" }, Priority: { type: "single", value: "P1" }, Estimate: { type: "number", value: 3 } });
  issue({ Status: { type: "single", value: "Done" }, Notes: { type: "text", value: "shipped" }, Due: { type: "date", value: "2026-12-01" }, Sprint: { type: "iteration", value: "Sprint 4" } });
  issue({ Status: { type: "single", value: "In Progress" } });
  fake.addItem(board, { contentId: fake.addContent(slug, "PULL_REQUEST"), type: "PULL_REQUEST", values: { Status: { type: "single", value: "In review" }, Estimate: { type: "number", value: 5 } } });
  fake.addItem(board, { type: "DRAFT_ISSUE", title: "A draft", values: { Status: { type: "single", value: "Todo" }, Notes: { type: "text", value: "think" } } });
  issue({ Status: { type: "single", value: "Done" }, Priority: { type: "single", value: "P0" } }, { archived: true });
  return { repo, board };
}

export function migrationDeps(fake, answers = () => "done") {
  return {
    exec: async (cmd, args, options) => fake.exec(cmd, args, options),
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
    prompt: async question => {
      fake.prompts.push(question);
      return answers(question);
    },
    openUrl: () => {},
    sleep: async ms => {
      fake.sleeps.push(ms);
    },
    now: () => new Date("2026-11-12T12:00:00Z"),
    log: line => (fake.logs ??= []).push(line),
  };
}

export function scriptedAnswers(fake, title = "Widgets") {
  return question => {
    if (/Auto-add/.test(question)) {
      for (const project of fake.projects.values()) if (project.owner === fake.org) project.workflows.find(w => w.name === "Auto-add to project").enabled = true;
    }
    if (/App variant/.test(question)) fake.repos.get(`${fake.org}/widgets`).files.set(".github/workflows/project-status-sync.yml", "uses: actions/create-github-app-token@v1");
    if (/new release App/.test(question)) {
      const repo = fake.repos.get(`${fake.org}/widgets`);
      repo.secrets.add("RELEASE_APP_PRIVATE_KEY");
      repo.variables.set("RELEASE_APP_CLIENT_ID", "Iv1.new");
    }
    return /exact title/.test(question) ? title : "done";
  };
}

export const stateDir = () => mkdtempSync(join(tmpdir(), "migrate-"));

export function summarise(project) {
  return Object.fromEntries(project.items.filter(item => item.type !== "DRAFT_ISSUE").map(item => [item.contentId, { archived: item.isArchived, values: item.values }]));
}
