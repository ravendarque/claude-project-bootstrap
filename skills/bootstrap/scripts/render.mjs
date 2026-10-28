import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|woff2?|zip|pem)$/i;
const PLACEHOLDER = /(?<!\$)\{\{\s*([a-z0-9_]+)\s*\}\}/g;

function loadManifest(name, modulesDir) {
  const path = join(modulesDir, name, "manifest.json");
  if (!existsSync(path)) throw new Error(`Unknown module: ${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function resolveModules(selected, modulesDir) {
  const ordered = [];
  const visiting = [];
  const visit = (name, requiredBy) => {
    if (ordered.some(m => m.name === name)) return;
    if (visiting.includes(name)) throw new Error(`Dependency cycle: ${[...visiting.slice(visiting.indexOf(name)), name].join(" -> ")}`);
    let manifest;
    try {
      manifest = loadManifest(name, modulesDir);
    } catch (error) {
      if (requiredBy) throw new Error(`Missing dependency: ${requiredBy} requires ${name}`);
      throw error;
    }
    visiting.push(name);
    for (const dep of manifest.dependsOn ?? []) visit(dep, name);
    visiting.pop();
    ordered.push(manifest);
  };
  visit("core");
  for (const name of selected) visit(name);
  return ordered;
}

export function maxSlugLength(modules) {
  return Math.min(63, ...modules.map(m => m.maxSlugLength ?? 63));
}

const DEFAULT_LICENSOR = "Ravendarque (https://github.com/ravendarque)";

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function validateAnswers(input, { maxSlugLength: limit = 63 } = {}) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Project name is required");
  const full = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(full)) throw new Error("Project name must start with a letter");
  if (full.length > limit && limit < 63) {
    throw new Error(
      `Project name gives the slug ${full} (${full.length} characters); the selected modules allow at most ${limit}`,
    );
  }
  const slug = full.slice(0, 63).replace(/-+$/, "");
  const answers = {
    licensor: DEFAULT_LICENSOR,
    ...input,
    name,
    slug,
    private: input.visibility === "private",
    name_js: JSON.stringify(name),
    name_html: escapeHtml(name),
    greeting_js: JSON.stringify(`Hello from ${name}`),
  };
  return { answers, slug };
}

function screeningTable(modules) {
  const rows = modules.flatMap(m => m.screening ?? []);
  return [
    "| Dependency | Maintainer | On a list | Note |",
    "|---|---|---|---|",
    ...rows.map(r => `| ${r.dependency} | ${r.maintainer} | ${r.listed} | ${r.note ?? ""} |`),
  ].join("\n");
}

function standardsFragments(modules, modulesDir) {
  return modules
    .map(m => join(modulesDir, m.name, "templates", "standards-fragment.md"))
    .filter(existsSync)
    .map(path => readFileSync(path, "utf8").trimEnd())
    .join("\n\n");
}

function allowBuildsYaml(modules) {
  return Object.entries(Object.assign({}, ...modules.map(m => m.allowBuilds ?? {})))
    .map(([name, { allow, reason }]) => `  # ${reason}\n  ${name}: ${allow}`)
    .join("\n");
}

function deepMerge(base, extra) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const isObject = value && typeof value === "object" && !Array.isArray(value);
    merged[key] = isObject && merged[key] && typeof merged[key] === "object" ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

function deriveKeys(modules, answers, modulesDir) {
  const checks = [
    ...new Set(
      modules
        .flatMap(m => m.requiredChecks ?? [])
        .map(check => (typeof check === "string" ? { context: check } : check))
        .filter(check => included(check, answers))
        .map(check => check.context),
    ),
  ];
  return {
    required_checks_json: JSON.stringify(checks.map(context => ({ context }))),
    claude_index: modules.flatMap(m => m.claudeIndexLines ?? []).join("\n"),
    claude_stack_section: modules.some(m => m.claudeIndexLines?.length)
      ? `\n## Stack\n\n${modules.flatMap(m => m.claudeIndexLines ?? []).join("\n")}\n`
      : "",
    coding_standards_modules: standardsFragments(modules, modulesDir),
    screening_table: screeningTable(modules),
    allow_builds_yaml: allowBuildsYaml(modules),
    release_paths_json: JSON.stringify(
      {
        noneAllowed: [...new Set(modules.flatMap(m => m.releasePaths?.noneAllowed ?? []))],
        noneForbidden: [...new Set(modules.flatMap(m => m.releasePaths?.noneForbidden ?? []))],
      },
      null,
      2,
    ),
    ...(answers.owner && { repo_url: `https://github.com/${answers.owner}/${answers.slug}` }),
  };
}

function included(file, answers) {
  if (!file.when) return true;
  const negated = file.when.startsWith("!");
  const value = Boolean(answers[negated ? file.when.slice(1) : file.when]);
  return negated ? !value : value;
}

function substitute(text, values, to) {
  return text.replace(PLACEHOLDER, (match, key) => {
    if (values[key] === undefined) throw new Error(`Unresolved placeholder {{${key}}} in ${to}`);
    return String(values[key]);
  });
}

export function render({ modules, answers, modulesDir, destDir, dryRun = false, stage }) {
  const values = { ...answers, ...deriveKeys(modules, answers, modulesDir) };
  const root = resolve(destDir);
  const outputs = new Map();
  const owners = new Map();
  for (const module of modules) {
    for (const file of module.files ?? []) {
      if (!included(file, answers)) continue;
      if (stage && (file.stage ?? "initial") !== stage) continue;
      const target = resolve(root, normalize(file.to));
      const rel = relative(root, target);
      if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`Path escapes destination: ${file.to}`);
      }
      const source = join(modulesDir, module.name, file.from);
      const content = BINARY.test(source)
        ? readFileSync(source)
        : substitute(readFileSync(source, "utf8"), values, file.to);
      const owner = owners.get(rel);
      if (file.merge) {
        if (!owner) throw new Error(`${module.name} merges into ${rel}, but no earlier module writes it`);
        outputs.set(rel, `${JSON.stringify(deepMerge(JSON.parse(outputs.get(rel)), JSON.parse(content)), null, 2)}\n`);
        continue;
      }
      if (owner && !(module.overrides ?? []).includes(rel)) {
        throw new Error(`${rel} is written by both ${owner} and ${module.name}; declare it in ${module.name}'s overrides`);
      }
      owners.set(rel, module.name);
      outputs.set(rel, content);
    }
  }
  for (const rel of outputs.keys()) {
    if ([...outputs.keys()].some(other => other.startsWith(`${rel}${sep}`))) {
      throw new Error(`${rel} is both a file and a directory`);
    }
  }
  if (!dryRun) {
    for (const [rel, content] of outputs) {
      const target = join(root, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
  return [...outputs.keys()];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      modules: { type: "string", default: "" },
      answers: { type: "string" },
      dest: { type: "string" },
      "modules-dir": { type: "string", default: fileURLToPath(new URL("../modules", import.meta.url)) },
      "dry-run": { type: "boolean", default: false },
      stage: { type: "string" },
    },
  });
  const selected = values.modules.split(",").filter(Boolean);
  const modules = resolveModules(selected, values["modules-dir"]);
  const { answers } = validateAnswers(JSON.parse(readFileSync(values.answers, "utf8")));
  const written = render({
    modules,
    answers,
    modulesDir: values["modules-dir"],
    destDir: values.dest,
    dryRun: values["dry-run"],
    stage: values.stage,
  });
  console.log(written.sort().join("\n"));
}
