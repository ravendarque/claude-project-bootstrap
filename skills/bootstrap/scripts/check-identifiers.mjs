import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", ".superpowers"]);
const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|woff2?|zip|pem)$/i;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && !BINARY.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

export function findIdentifiers(rootDir, patterns, allow) {
  const hits = [];
  for (const path of walk(rootDir)) {
    const file = relative(rootDir, path);
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((text, index) => {
        if (allow.some(a => a.path === file && a.pattern.test(text))) return;
        for (const pattern of patterns) {
          const found = text.match(pattern);
          if (found) hits.push({ file, line: index + 1, match: found[0] });
        }
      });
  }
  return hits;
}

function loadPatterns(env) {
  const source = env.IDENTIFIER_DENYLIST_FILE
    ? readFileSync(env.IDENTIFIER_DENYLIST_FILE, "utf8")
    : (env.IDENTIFIER_DENYLIST ?? "");
  return source
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => new RegExp(line, "i"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const patterns = loadPatterns(process.env);
  if (patterns.length === 0) {
    console.error("No patterns: set IDENTIFIER_DENYLIST or IDENTIFIER_DENYLIST_FILE");
    process.exit(2);
  }
  const hits = findIdentifiers(process.argv[2] ?? ".", patterns, []);
  for (const hit of hits) console.log(`${hit.file}:${hit.line}: matches a denied identifier`);
  process.exit(hits.length ? 1 : 0);
}
