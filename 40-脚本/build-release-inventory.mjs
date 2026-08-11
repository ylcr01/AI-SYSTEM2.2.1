import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceEntries } from './lib/source-fingerprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = path.join(ROOT, 'release-manifest.json');
const INVENTORY_FILE = path.join(ROOT, 'release-inventory.json');

function sourceMetrics() {
  const entries = sourceEntries(ROOT).map(([relative, sha256]) => ({
    path: relative,
    bytes: fs.statSync(path.join(ROOT, relative)).size,
    sha256
  }));
  return {
    entries,
    sourceFileCount: entries.length,
    sourceBytes: entries.reduce((sum, item) => sum + item.bytes, 0)
  };
}

function stabilizeManifest() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const metrics = sourceMetrics();
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    manifest.source = {
      inventoryScope: 'deterministic-source',
      sourceFileCount: metrics.sourceFileCount,
      sourceBytes: metrics.sourceBytes
    };
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (fs.readFileSync(MANIFEST_FILE, 'utf8') === serialized) return metrics;
    fs.writeFileSync(MANIFEST_FILE, serialized);
  }
  throw new Error('release-manifest.json 的源码统计未能稳定');
}

stabilizeManifest();
const metrics = sourceMetrics();
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const inventory = {
  schemaVersion: 2,
  version: manifest.version,
  scope: manifest.source.inventoryScope,
  sourceFileCount: metrics.sourceFileCount,
  sourceBytes: metrics.sourceBytes,
  files: metrics.entries
};
fs.writeFileSync(INVENTORY_FILE, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({
  output: INVENTORY_FILE,
  sourceFileCount: inventory.sourceFileCount,
  sourceBytes: inventory.sourceBytes
}, null, 2));
