import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { askId, isHexId } from "./cloudflare.mjs";
import { getId, recordId } from "../state.mjs";

const ACCOUNT_QUESTION = "Cloudflare account id (32 hex characters; on the zone's Overview page, bottom right) ";
const ZONE_KEY = "cloudflare_zone_id";

export function defaultConfigDir(env = process.env, home = homedir()) {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "claude-project-bootstrap");
}

export function checkFlagId(name, value) {
  if (value !== undefined && !isHexId(value.trim())) throw new Error(`${name} must be 32 hexadecimal characters`);
  return value?.trim();
}

function readConfig(configDir) {
  const file = join(configDir, "cloudflare.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(configDir, config) {
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, "cloudflare.json");
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

async function resolve(deps, { label, flag, stored, ask, store }) {
  let id;
  let source;
  if (flag !== undefined) {
    [id, source] = [flag, "flag"];
  } else if (stored && isHexId(stored)) {
    [id, source] = [stored, "stored"];
  } else {
    if (stored) deps.log(`Ignoring the stored Cloudflare ${label}: it isn't 32 hexadecimal characters`);
    [id, source] = [await ask(), "prompt"];
  }
  if (source !== "stored") store(id);
  deps.log(`Using Cloudflare ${label} ${id} (from ${source})`);
  return id;
}

export function resolveAccountId(ctx, deps, { accountId, configDir } = {}) {
  return resolve(deps, {
    label: "account id",
    flag: accountId,
    stored: configDir ? readConfig(configDir).account_id : undefined,
    ask: () => askId(deps, ACCOUNT_QUESTION),
    store: id => configDir && writeConfig(configDir, { ...readConfig(configDir), account_id: id }),
  });
}

export function resolveZoneId(ctx, deps, { zoneId } = {}) {
  return resolve(deps, {
    label: "zone id",
    flag: zoneId,
    stored: getId(ctx.dir, ZONE_KEY),
    ask: () => askId(deps, `Zone id for ${ctx.zoneName ?? "the zone"} (32 hex characters; on the zone's Overview page, bottom right) `),
    store: id => recordId(ctx.dir, ZONE_KEY, id),
  });
}
