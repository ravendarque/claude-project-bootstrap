import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordId, saveRun } from "../skills/bootstrap/scripts/state.mjs";

export function stubDeps(respond = () => ({ status: 0, stdout: "", stderr: "" })) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    exec: async (cmd, args, options = {}) => {
      calls.push({ cmd, args, input: options.input, env: options.env });
      return { status: 0, stdout: "", stderr: "", ...(await respond(cmd, args, options)) };
    },
    prompt: async () => "",
    openUrl: () => {},
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
    now: () => new Date("2026-11-08T12:00:00Z"),
    log: line => logs.push(line),
  };
}

export function vaultResponder({ slug = "sample-project", items = [] } = {}) {
  const live = [...items];
  let created = false;
  return (cmd, args, options) => {
    if (cmd !== "pass-cli") return {};
    const key = args.slice(0, 2).join(" ");
    if (key === "folder list") {
      return { stdout: JSON.stringify(created ? [{ id: "f1", parent_folder_id: null, content: { name: slug } }] : []) };
    }
    if (key === "folder create") created = true;
    if (key === "item list") return { stdout: JSON.stringify({ items: live, folders: [] }) };
    if (key === "item create") live.push({ id: `new${live.length}`, title: JSON.parse(options.input).title, folder_id: "f1" });
    return {};
  };
}

export function projectDir({ owner = "sample-owner", name = "Sample Project", slug = "sample-project", zone_name, skippedEnvs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  saveRun(dir, { answers: { owner, name, slug, ...(zone_name && { zone_name }) }, modules: ["core"] });
  if (skippedEnvs) recordId(dir, "skipped_envs", skippedEnvs);
  return dir;
}
