import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("the plugin manifest doesn't pin a version, so updates follow the commit", () => {
  assert.equal("version" in read(".claude-plugin/plugin.json"), false);
});

test("no marketplace entry pins a version", () => {
  for (const entry of read(".claude-plugin/marketplace.json").plugins) {
    assert.equal("version" in entry, false, entry.name);
  }
});
