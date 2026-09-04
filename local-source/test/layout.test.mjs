#!/usr/bin/env node
/**
 * Package layout contract: the release package includes the manifest, a
 * server runtime, a self-contained browser client, and discoverable tests.
 * Run: node local-source/test/layout.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PKG = path.join(ROOT, "local-source");

const requiredFiles = [
  "extension.json",
  "server/index.mjs",
  "client/index.mjs",
  "test/manifest.test.mjs",
  "test/server.test.mjs",
];
for (const rel of requiredFiles) {
  assert.ok(fs.existsSync(path.join(PKG, rel)), `package must contain ${rel}`);
}

// Client entry must be browser-importable: no node: imports, no bare npm ids.
const clientSource = fs.readFileSync(path.join(PKG, "client", "index.mjs"), "utf-8");
assert.doesNotMatch(clientSource, /from ["']node:/, "client must not import node: modules");
assert.doesNotMatch(clientSource, /from ["'][^./]/, "client must not import bare npm packages");
assert.ok(clientSource.includes("MangaYomuExtensionRuntime"), "client must use the host extension runtime");
assert.ok(clientSource.includes("export default activate"), "client must export a default activation");

// Server entry must export a createExtension-compatible default factory.
const serverSource = fs.readFileSync(path.join(PKG, "server", "index.mjs"), "utf-8");
assert.ok(serverSource.includes("export default function createExtension"), "server must export createExtension");

console.log("layout.test: ok");