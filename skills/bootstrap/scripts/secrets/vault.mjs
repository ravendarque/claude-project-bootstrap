async function pass(deps, args, input) {
  const result = await deps.exec("pass-cli", args, input === undefined ? {} : { input });
  if (result.status !== 0) {
    throw new Error(`pass-cli ${args.slice(0, 2).join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function parseFolders(stdout) {
  return JSON.parse(stdout || "[]").map(entry => ({ id: entry.id, name: entry.content?.name, parent: entry.parent_folder_id ?? null }));
}

function parseItems(stdout) {
  return (JSON.parse(stdout || "{}").items ?? []).map(entry => ({ id: entry.id, title: entry.title, folderId: entry.folder_id ?? null }));
}

export class Vault {
  #folderId;

  constructor(deps, { vault, folder }) {
    this.deps = deps;
    this.vault = vault;
    this.folder = folder;
  }

  async #matchingFolders() {
    const out = await pass(this.deps, ["folder", "list", "--vault-name", this.vault, "--output", "json"]);
    return parseFolders(out).filter(entry => entry.name === this.folder && entry.parent === null);
  }

  async folderId() {
    if (this.#folderId) return this.#folderId;
    let found = await this.#matchingFolders();
    if (!found.length) {
      await pass(this.deps, ["folder", "create", "--vault-name", this.vault, "--name", this.folder]);
      found = await this.#matchingFolders();
    }
    if (found.length !== 1) {
      throw new Error(`Found ${found.length} folders named ${this.folder} in vault ${this.vault}: expected one`);
    }
    this.#folderId = found[0].id;
    return this.#folderId;
  }

  async #activeIds(title) {
    const folderId = await this.folderId();
    const out = await pass(this.deps, ["item", "list", "--vault-name", this.vault, "--filter-state", "active", "--output", "json"]);
    return parseItems(out).filter(entry => entry.folderId === folderId && entry.title === title).map(entry => entry.id);
  }

  async find(title) {
    const ids = await this.#activeIds(title);
    if (ids.length > 1) throw new Error(`Found ${ids.length} active items titled ${title} in folder ${this.folder}: remove the extras and re-run`);
    return ids[0] ?? null;
  }

  async create(title, fields, note) {
    const folderId = await this.folderId();
    const before = new Set(await this.#activeIds(title));
    const template = {
      title,
      note: note ?? "",
      sections: [
        {
          section_name: "Credentials",
          fields: fields.map(({ name, value, hidden }) => ({ field_name: name, field_type: hidden ? "hidden" : "text", value })),
        },
      ],
      extra_fields: [],
    };
    await pass(this.deps, ["item", "create", "custom", "--from-template", "-", "--vault-name", this.vault, "--folder-id", folderId], JSON.stringify(template));
    const created = (await this.#activeIds(title)).filter(id => !before.has(id));
    if (created.length !== 1) throw new Error(`Created ${title} in Pass but could not identify the new item: check folder ${this.folder} in vault ${this.vault}`);
    return created[0];
  }

  async trash(itemId) {
    await pass(this.deps, ["item", "trash", "--vault-name", this.vault, "--item-id", itemId]);
  }
}
