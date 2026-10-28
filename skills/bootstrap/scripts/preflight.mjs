import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveModules } from "./render.mjs";

export function checkTarget(dir) {
  if (!existsSync(dir)) return { ok: false, reason: "Directory does not exist" };
  if (!statSync(dir).isDirectory()) return { ok: false, reason: "Not a directory" };
  if (existsSync(join(dir, ".bootstrap", "state.json"))) return { ok: true, resume: true };
  const entries = readdirSync(dir).filter(name => name !== ".bootstrap");
  if (entries.length) return { ok: false, reason: `Directory is not empty: ${entries.sort().join(", ")}` };
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" });
  if (inside.stdout.trim() === "true") return { ok: false, reason: "Directory is inside an existing git work tree" };
  return { ok: true };
}

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: "utf8", ...options });
const ok = result => result.status === 0;

function signingWorks() {
  if (run("git", ["config", "--get", "commit.gpgsign"]).stdout.trim() !== "true") return false;
  const repo = mkdtempSync(join(tmpdir(), "sign-"));
  try {
    run("git", ["init", "-q"], { cwd: repo });
    return ok(run("git", ["commit", "-q", "-S", "--allow-empty", "-m", "signing check"], { cwd: repo, timeout: 20000 }));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const TOOLS = {
  core: [
    { tool: "git", check: () => ok(run("git", ["--version"])), fix: "Install git" },
    {
      tool: "gh with project scope",
      check: () => {
        const status = run("gh", ["auth", "status"]);
        return ok(status) && /'project'/.test(status.stdout + status.stderr);
      },
      fix: "Run `gh auth login`, then `gh auth refresh -s project`",
    },
    { tool: "jq", check: () => ok(run("jq", ["--version"])), fix: "Install jq (the generated Claude hook and workflows use it)" },
    {
      tool: "commit signing",
      check: signingWorks,
      fix: "Configure SSH or GPG commit signing and set `git config --global commit.gpgsign true`; load the key into your agent",
    },
  ],
  "js-toolchain": [
    {
      tool: "node >= 22",
      check: () => Number(run("node", ["--version"]).stdout.replace(/^v/, "").split(".")[0]) >= 22,
      fix: "Install Node 22 or later",
    },
    { tool: "pnpm", check: () => ok(run("pnpm", ["--version"])), fix: "Run `corepack enable pnpm` or install pnpm" },
  ],
  "web-app": [
    { tool: "firefox", check: () => ok(run("firefox", ["--version"])), fix: "Install Firefox (end-to-end tests run in it)" },
  ],
  "cloudflare-opentofu": [
    { tool: "tofu", check: () => ok(run("tofu", ["version"])), fix: "Install OpenTofu (https://opentofu.org/docs/intro/install/)" },
    {
      tool: "wrangler",
      check: () => ok(run("pnpm", ["dlx", "wrangler", "--version"], { timeout: 120000 })),
      fix: "Make sure `pnpm dlx wrangler --version` works",
    },
  ],
};

function toolEntries(selected, modulesDir) {
  return resolveModules(selected, modulesDir).flatMap(m => TOOLS[m.name] ?? []);
}

export function toolsFor(selected, modulesDir) {
  return toolEntries(selected, modulesDir).map(t => t.tool);
}

export function checkTools(selected, modulesDir) {
  return toolEntries(selected, modulesDir).map(({ tool, check, fix }) => ({ tool, ok: check(), fix }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { tools: { type: "string" } },
  });
  const modulesDir = fileURLToPath(new URL("../modules", import.meta.url));
  const result =
    values.tools === undefined
      ? checkTarget(positionals[0] ?? ".")
      : checkTools(values.tools.split(",").filter(Boolean), modulesDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit((Array.isArray(result) ? result.every(t => t.ok) : result.ok) ? 0 : 1);
}
