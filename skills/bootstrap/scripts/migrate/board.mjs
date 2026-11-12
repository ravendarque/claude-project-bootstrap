const PAGE = "pageInfo { hasNextPage endCursor }";
const FIELD = "field { ... on ProjectV2FieldCommon { name dataType } }";
const valuesField = cursor => `fieldValues(first: 100, after: ${cursor}) { nodes { __typename
  ... on ProjectV2ItemFieldSingleSelectValue { name ${FIELD} }
  ... on ProjectV2ItemFieldNumberValue { number ${FIELD} }
  ... on ProjectV2ItemFieldTextValue { text ${FIELD} }
  ... on ProjectV2ItemFieldDateValue { date ${FIELD} }
  ... on ProjectV2ItemFieldIterationValue { title ${FIELD} }
} ${PAGE} }`;

const LINKED = `query LinkedBoards($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) { projectsV2(first: 100, after: $after) { nodes { id number title } ${PAGE} } }
}`;
const META = "query BoardMeta($id: ID!) { node(id: $id) { ... on ProjectV2 { id number title public } } }";
const FIELDS = `query BoardFields($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 { fields(first: 100, after: $after) { nodes {
    ... on ProjectV2FieldCommon { id name dataType }
    ... on ProjectV2SingleSelectField { options { id name } }
  } ${PAGE} } } }
}`;
const ITEMS = `query BoardItems($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) { nodes {
    id isArchived type
    content { ... on Issue { id url repository { nameWithOwner } } ... on PullRequest { id url repository { nameWithOwner } } ... on DraftIssue { id } }
    ${valuesField("null")}
  } ${PAGE} } } }
}`;
const ITEM_VALUES = `query ItemValues($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2Item { ${valuesField("$after")} } }
}`;
const ORGANISATION_BOARDS = `query OrganisationBoards($login: String!, $title: String!, $after: String) {
  organization(login: $login) { projectsV2(first: 100, after: $after, query: $title) { nodes { id number title } ${PAGE} } }
}`;
const CONTENT_ITEMS = `query ContentItems($id: ID!, $after: String) {
  node(id: $id) {
    ... on Issue { projectItems(first: 100, after: $after, includeArchived: true) { nodes { id project { id } } ${PAGE} } }
    ... on PullRequest { projectItems(first: 100, after: $after, includeArchived: true) { nodes { id project { id } } ${PAGE} } }
  }
}`;
const WORKFLOWS = `query BoardWorkflows($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 { workflows(first: 100, after: $after) { nodes { name enabled } ${PAGE} } } }
}`;

const VALUE_TYPES = new Set(["SINGLE_SELECT", "NUMBER", "TEXT", "DATE", "ITERATION"]);

export const isValueField = dataType => VALUE_TYPES.has(dataType);

export const isCopyable = item => (item.type === "ISSUE" || item.type === "PULL_REQUEST") && Boolean(item.url);

function toValue(node) {
  switch (node.__typename) {
    case "ProjectV2ItemFieldSingleSelectValue":
      return { type: "single", value: node.name };
    case "ProjectV2ItemFieldNumberValue":
      return { type: "number", value: node.number };
    case "ProjectV2ItemFieldTextValue":
      return { type: "text", value: node.text };
    case "ProjectV2ItemFieldDateValue":
      return { type: "date", value: node.date };
    case "ProjectV2ItemFieldIterationValue":
      return { type: "iteration", value: node.title };
    default:
      return null;
  }
}

function toValues(nodes) {
  const values = {};
  for (const node of nodes) {
    const name = node.field?.name;
    const value = toValue(node);
    if (name && value && isValueField(node.field.dataType)) values[name] = value;
  }
  return values;
}

export const copyableValues = item => Object.fromEntries(Object.entries(item.values).filter(([, value]) => value.type !== "iteration"));

export function linkedBoards(gh, owner, name) {
  return gh.paginate(LINKED, { owner, name }, data => data.repository.projectsV2);
}

export async function readBoard(gh, id) {
  const { node } = await gh.graphql(META, { id });
  const fields = await gh.paginate(FIELDS, { id }, data => data.node.fields);
  return { id: node.id, number: node.number, title: node.title, public: node.public, fields: fields.map(field => ({ id: field.id, name: field.name, dataType: field.dataType, options: field.options ?? [] })) };
}

export async function readItems(gh, id) {
  const nodes = await gh.paginate(ITEMS, { id }, data => data.node.items);
  const items = [];
  for (const node of nodes) {
    let values = node.fieldValues.nodes;
    if (node.fieldValues.pageInfo.hasNextPage) {
      const more = await gh.paginate(ITEM_VALUES, { id: node.id, after: node.fieldValues.pageInfo.endCursor }, data => data.node.fieldValues);
      values = [...values, ...more];
    }
    items.push({ id: node.id, archived: node.isArchived, type: node.type, contentId: node.content?.id ?? null, url: node.content?.url ?? null, repository: node.content?.repository?.nameWithOwner ?? null, values: toValues(values) });
  }
  return items;
}

export async function boardsInOrganisation(gh, org, title) {
  const nodes = await gh.paginate(ORGANISATION_BOARDS, { login: org, title }, data => data.organization.projectsV2);
  return nodes.filter(node => node.title === title);
}

export async function findItemOnBoard(gh, boardId, contentId) {
  const nodes = await gh.paginate(CONTENT_ITEMS, { id: contentId }, data => data.node.projectItems);
  return nodes.find(node => node.project.id === boardId)?.id ?? null;
}

export async function boardWorkflows(gh, id) {
  return gh.paginate(WORKFLOWS, { id }, data => data.node.workflows);
}

export async function copyBoard(gh, { sourceId, ownerId, title }) {
  const data = await gh.graphql(
    "mutation CopyBoard($input: CopyProjectV2Input!) { copyProjectV2(input: $input) { projectV2 { id number title } } }",
    { input: { projectId: sourceId, ownerId, title, includeDraftIssues: true } },
  );
  return data.copyProjectV2.projectV2;
}

export async function makePrivate(gh, id) {
  await gh.graphql("mutation MakePrivate($input: UpdateProjectV2Input!) { updateProjectV2(input: $input) { projectV2 { id } } }", { input: { projectId: id, public: false } });
}

export async function addItem(gh, boardId, contentId) {
  const data = await gh.graphql(
    "mutation AddItem($input: AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input: $input) { item { id } } }",
    { input: { projectId: boardId, contentId } },
  );
  return data.addProjectV2ItemById.item.id;
}

export async function archiveItem(gh, boardId, itemId) {
  await gh.graphql("mutation ArchiveItem($input: ArchiveProjectV2ItemInput!) { archiveProjectV2Item(input: $input) { item { id } } }", { input: { projectId: boardId, itemId } });
}

export async function unarchiveItem(gh, boardId, itemId) {
  await gh.graphql("mutation UnarchiveItem($input: UnarchiveProjectV2ItemInput!) { unarchiveProjectV2Item(input: $input) { item { id } } }", { input: { projectId: boardId, itemId } });
}

export async function clearValue(gh, board, itemId, fieldName) {
  const field = board.fields.find(entry => entry.name === fieldName);
  if (!field) throw new Error(`The new board has no field named ${fieldName}`);
  await gh.graphql(
    "mutation ClearValue($input: ClearProjectV2ItemFieldValueInput!) { clearProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }",
    { input: { projectId: board.id, itemId, fieldId: field.id } },
  );
}

export async function deleteItem(gh, boardId, itemId) {
  await gh.graphql("mutation DeleteItem($input: DeleteProjectV2ItemInput!) { deleteProjectV2Item(input: $input) { deletedItemId } }", { input: { projectId: boardId, itemId } });
}

export async function linkRepository(gh, boardId, repositoryId) {
  await gh.graphql("mutation LinkRepo($input: LinkProjectV2ToRepositoryInput!) { linkProjectV2ToRepository(input: $input) { repository { id } } }", { input: { projectId: boardId, repositoryId } });
}

export async function deleteBoard(gh, boardId) {
  await gh.graphql("mutation DeleteBoard($input: DeleteProjectV2Input!) { deleteProjectV2(input: $input) { projectV2 { id } } }", { input: { projectId: boardId } });
}

function valueInput(field, { type, value }) {
  if (type === "single") {
    const option = field.options.find(entry => entry.name === value);
    if (!option) throw new Error(`The new board's ${field.name} field has no option named ${value}`);
    return { singleSelectOptionId: option.id };
  }
  return { [type]: value };
}

export async function setValue(gh, board, itemId, fieldName, value) {
  const field = board.fields.find(entry => entry.name === fieldName);
  if (!field) throw new Error(`The new board has no field named ${fieldName}`);
  await gh.graphql(
    "mutation SetValue($input: UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }",
    { input: { projectId: board.id, itemId, fieldId: field.id, value: valueInput(field, value) } },
  );
}

export async function applyValues(gh, board, itemId, values) {
  for (const [name, value] of Object.entries(values)) await setValue(gh, board, itemId, name, value);
}

export function compareBoards(oldItems, newItems) {
  const found = new Map();
  const issues = [];
  for (const item of newItems.filter(entry => entry.url)) {
    if (found.has(item.url)) issues.push({ kind: "duplicate", url: item.url });
    found.set(item.url, item);
  }
  const expectedUrls = new Set(oldItems.filter(isCopyable).map(item => item.url));
  for (const item of newItems) if (item.url && !expectedUrls.has(item.url)) issues.push({ kind: "unexpected", url: item.url });
  for (const old of oldItems.filter(isCopyable)) {
    const current = found.get(old.url);
    if (!current) {
      issues.push({ kind: "missing", url: old.url });
      continue;
    }
    if (current.archived !== old.archived) issues.push({ kind: "archived", url: old.url, expected: old.archived });
    const expected = copyableValues(old);
    for (const [field, value] of Object.entries(expected)) {
      const actual = current.values[field];
      if (!actual || actual.type !== value.type || actual.value !== value.value) issues.push({ kind: "value", url: old.url, field, expected: value, actual });
    }
    for (const field of Object.keys(copyableValues(current))) if (!(field in expected)) issues.push({ kind: "extra", url: old.url, field });
  }
  return { issues };
}

export const countDrafts = items => items.filter(item => item.type === "DRAFT_ISSUE").length;

export function describeIssue(issue) {
  if (issue.kind === "drafts") return `the new board has ${issue.found} draft issues, the old one has ${issue.old}`;
  if (issue.kind === "value") return `${issue.url}: ${issue.field} should be ${JSON.stringify(issue.expected.value)}, found ${issue.actual ? JSON.stringify(issue.actual.value) : "nothing"}`;
  if (issue.kind === "extra") return `${issue.url}: ${issue.field} has a value on the new board but none on the old one`;
  if (issue.kind === "archived") return `${issue.url}: should${issue.expected ? "" : " not"} be archived`;
  if (issue.kind === "unexpected") return `${issue.url}: is on the new board but wasn't on the old one`;
  return `${issue.url}: ${issue.kind === "missing" ? "isn't on the new board" : "is on the new board more than once"}`;
}
