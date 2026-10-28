import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, resolveModules, validateAnswers } from "../skills/bootstrap/scripts/render.mjs";

export const realModulesDir = fileURLToPath(new URL("../skills/bootstrap/modules", import.meta.url));

export function renderReal(selected, extraAnswers = {}) {
  const base = JSON.parse(readFileSync(new URL("./fixtures/answers-core.json", import.meta.url), "utf8"));
  const { answers } = validateAnswers({ ...base, ...extraAnswers });
  const dest = mkdtempSync(join(tmpdir(), "real-"));
  const modules = resolveModules(selected, realModulesDir);
  render({ modules, answers, modulesDir: realModulesDir, destDir: dest });
  return dest;
}

export function* files(dir, root = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path, root);
    else yield relative(root, path);
  }
}

export function brokenLinks(root) {
  const broken = [];
  const all = new Set(files(root));
  for (const file of all) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = relative(root, resolve(root, dirname(file), target.split("#")[0]));
      if (!all.has(path) && ![...all].some(f => f.startsWith(`${path}/`))) broken.push(`${file} -> ${target}`);
    }
  }
  return broken;
}
