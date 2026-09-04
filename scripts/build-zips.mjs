#!/usr/bin/env node
/**
 * Build the official MangaYomu repository release ZIPs and refresh
 * repository.json (relative dist/ URLs + pinned sha256 + package tags).
 *
 * Mirrors scripts/build-zips.mjs from the community extensions repository:
 * each package (extension.json + server/ + client/ + tests) is packed from a
 * normalized copy so unchanged content produces reproducible ZIPs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const REPOSITORY = path.join(ROOT, "repository.json");
const STAGING = path.join(ROOT, ".staging");

function normalizeTree(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) normalizeTree(full);
    else fs.utimesSync(full, new Date(0), new Date(0));
  }
  fs.utimesSync(dir, new Date(0), new Date(0));
}

function stagedPackage(root, id) {
  const source = path.join(root, id);
  const staged = path.join(STAGING, id);
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  fs.cpSync(source, staged, { recursive: true });
  normalizeTree(staged);
  return staged;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function packageTags(manifest) {
  if (Array.isArray(manifest.tags)) return manifest.tags;
  if (manifest.contributes && Array.isArray(manifest.contributes.sources) && manifest.contributes.sources.length > 0) {
    return ["source"];
  }
  return [];
}

const packages = ["local-source"];

fs.mkdirSync(DIST, { recursive: true });

const repository = JSON.parse(fs.readFileSync(REPOSITORY, "utf-8"));
repository.repositoryVersion = 1;
repository.name = "Official MangaYomu Extensions";
repository.packages = [];

for (const id of packages) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, id, "extension.json"), "utf-8"));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${id}/extension.json must declare an explicit x.y.z version`);
  }
  const zipName = `${id}-${version}.zip`;
  const zipPath = path.join(DIST, zipName);

  fs.rmSync(zipPath, { force: true });
  const staged = stagedPackage(ROOT, id);
  try {
    execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: staged });
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }

  repository.packages.push({
    id: manifest.id,
    name: manifest.name,
    version,
    url: `dist/${zipName}`,
    sha256: sha256(zipPath),
    tags: packageTags(manifest),
  });
  console.log(`[build] ${id} -> ${zipName} (${sha256(zipPath).slice(0, 12)}…)`);
}

fs.rmSync(STAGING, { recursive: true, force: true });
fs.writeFileSync(REPOSITORY, JSON.stringify(repository, null, 2) + "\n");
console.log(`[build] updated ${path.relative(ROOT, REPOSITORY)}`);