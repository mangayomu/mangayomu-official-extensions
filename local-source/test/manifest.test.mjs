#!/usr/bin/env node
/**
 * Manifest contract for the Local Source package: manifestVersion, explicit
 * x.y.z version, official tags, client/server entrypoints and source
 * contribution. Run: node local-source/test/manifest.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "local-source", "extension.json"), "utf-8"));
const repository = JSON.parse(fs.readFileSync(path.join(ROOT, "repository.json"), "utf-8"));

assert.equal(manifest.manifestVersion, 1, "manifestVersion must be 1");
assert.equal(manifest.id, "local-source", "package id must be local-source");
assert.equal(typeof manifest.name, "string", "name must be a string");
assert.ok(manifest.name.length > 0, "name must not be empty");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "version must be an explicit x.y.z semver");

assert.ok(Array.isArray(manifest.tags), "manifest must declare tags");
for (const tag of ["source", "official", "local"]) {
  assert.ok(manifest.tags.includes(tag), `manifest tags must include "${tag}"`);
}

assert.equal(typeof manifest.entrypoints.server, "string", "server entrypoint must be present");
assert.equal(typeof manifest.entrypoints.client, "string", "client entrypoint must be present");
assert.equal(manifest.entrypoints.server, "server/index.mjs");
assert.equal(manifest.entrypoints.client, "client/index.mjs");

assert.ok(manifest.contributes && Array.isArray(manifest.contributes.sources), "must contribute sources");
const source = manifest.contributes.sources[0];
assert.equal(source.id, "local", "source contribution id must be local");
assert.equal(source.name, "Local Source", "source contribution name");
assert.equal(source.lang, "en");
assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{1,62}$/, "package id matches the manifest id pattern");
assert.match(source.id, /^[a-z0-9][a-z0-9-]{1,62}$/, "source id matches the manifest id pattern");

// Client contribution must be declared so the host can mount the panels.
assert.ok(manifest.contributes.client, "manifest must declare a client contribution");
assert.deepEqual(manifest.contributes.client.settingsPanels, ["local-library"], "settingsPanels must match the client panel id");
assert.deepEqual(manifest.contributes.client.browseSources, ["local"], "browseSources must include the local source id");

// Repository entry must expose the version and official/source tags.
assert.equal(repository.repositoryVersion, 1, "repositoryVersion must be 1");
const entry = repository.packages.find((pkg) => pkg.id === "local-source");
assert.ok(entry, "repository must list local-source");
assert.match(entry.version, /^\d+\.\d+\.\d+$/, "repository package entry must be semver");
assert.ok(Array.isArray(entry.tags) && entry.tags.includes("source"), "repository entry tags must include source");
assert.match(entry.url, /^dist\/local-source-1\.0\.0\.zip$/, "repository entry must use relative dist URL");
assert.match(entry.sha256, /^[0-9a-f]{64}$/, "repository entry sha256 must be 64 hex chars");

console.log("manifest.test: ok");