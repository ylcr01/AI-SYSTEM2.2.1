import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, '70-文档/implementation-contract.json'), 'utf8'));
const total = contract.acceptance.reduce((sum, item) => sum + item.weight, 0);
if (total !== 100) throw new Error('验收权重必须为 100');

const cache = new Map();
function run(spec) {
  const key = JSON.stringify(spec);
  if (cache.has(key)) return cache.get(key);
  const startedAt = new Date().toISOString();
  const executable = spec.command === 'node' ? process.execPath : spec.command;
  const result = spawnSync(executable, spec.args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024
  });
  const value = {
    command: spec.command,
    args: spec.args,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
    status: result.status === 0 && !result.error ? 'passed' : 'failed',
    stdout: String(result.stdout ?? '').slice(-4000),
    stderr: String(result.stderr ?? '').slice(-4000),
    error: result.error?.message ?? null
  };
  cache.set(key, value);
  return value;
}

const items = contract.acceptance.map((item) => {
  const commands = item.verification.map(run);
  return {
    ...item,
    status: commands.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    commands,
    residualIssues: commands.filter((result) => result.status !== 'passed')
      .map((result) => result.error ?? result.stderr)
  };
});
const passedWeight = items.filter((item) => item.status === 'passed')
  .reduce((sum, item) => sum + item.weight, 0);
const critical = items.filter((item) => item.critical);
const report = {
  schemaVersion: 1,
  designId: contract.designId,
  generatedAt: new Date().toISOString(),
  sourceFingerprint: sourceFingerprint(ROOT),
  critical: {
    total: critical.length,
    passed: critical.filter((item) => item.status === 'passed').length
  },
  weight: { total, passed: passedWeight },
  fidelity: passedWeight / total * 100,
  technicalGateEligible: critical.every((item) => item.status === 'passed')
    && passedWeight / total * 100 >= contract.releaseGate.minimumFidelity,
  userAcceptance: 'pending',
  releaseEligible: false,
  acceptance: items
};
const output = path.join(ROOT, contract.resultPath);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  critical: report.critical,
  fidelity: report.fidelity,
  technicalGateEligible: report.technicalGateEligible,
  sourceFingerprint: report.sourceFingerprint
}, null, 2));
if (!report.technicalGateEligible) process.exitCode = 1;
