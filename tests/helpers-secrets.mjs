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

export function projectDir({ owner = "sample-owner", name = "Sample Project", slug = "sample-project", zone_name, skippedEnvs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  saveRun(dir, { answers: { owner, name, slug, ...(zone_name && { zone_name }) }, modules: ["core"] });
  if (skippedEnvs) recordId(dir, "skipped_envs", skippedEnvs);
  return dir;
}
