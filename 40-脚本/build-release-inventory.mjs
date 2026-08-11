import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceEntries } from './lib/source-fingerprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = path.join(ROOT, 'release-manifest.json');
const INVENTORY_FILE = path.join(ROOT, '80-运行记录', 'release', 'release-inventory.json');

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

const metrics = sourceMetrics();
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const inventory = {
  schemaVersion: 2,
  version: manifest.version,
  scope: 'deterministic-source',
  sourceFileCount: metrics.sourceFileCount,
  sourceBytes: metrics.sourceBytes,
  files: metrics.entries
};
fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
fs.writeFileSync(INVENTORY_FILE, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({
  output: INVENTORY_FILE,
  sourceFileCount: inventory.sourceFileCount,
  sourceBytes: inventory.sourceBytes
}, null, 2));
