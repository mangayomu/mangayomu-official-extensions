#!/usr/bin/env node
/**
 * Prepare the release catalog and package files for Vite's public directory.
 *
 * Copies repository.json, the release ZIPs (dist/), and each package source
 * tree into web/public so the hosted site can serve the catalog, the ZIPs,
 * and per-package Manifest/Source links.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "web", "public");
const repositoryPath = path.join(ROOT, "repository.json");
const releasePath = path.join(ROOT, "dist");
const repository = JSON.parse(fs.readFileSync(repositoryPath, "utf-8"));

if (!fs.existsSync(releasePath)) {
  throw new Error("Release directory not found. Run npm run build:zips before preparing the site.");
}

fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC, { recursive: true });
fs.copyFileSync(repositoryPath, path.join(PUBLIC, "repository.json"));
fs.cpSync(releasePath, path.join(PUBLIC, "dist"), { recursive: true });

for (const pkg of repository.packages) {
  const source = path.join(ROOT, pkg.id);
  if (!fs.existsSync(source)) throw new Error(`Package directory not found: ${pkg.id}`);
  fs.cpSync(source, path.join(PUBLIC, "packages", pkg.id), { recursive: true });
}

console.log(`[prepare-web] copied catalog and ${repository.packages.length} package(s) to web/public`);