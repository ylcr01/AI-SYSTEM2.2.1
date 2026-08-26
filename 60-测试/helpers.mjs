import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function tempDir(t, prefix = 'ai-rd-os-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function gitRepo(t, options = {}) {
  const root = tempDir(t, 'ai-rd-os-repo-');
  fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# sample\n');
  const proofTests = [
    "import test from 'node:test';",
    ...Array.from({ length: 20 }, (_, index) => `test('A${index + 1} proof', () => {});`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'tests', 'acceptance.test.mjs'), proofTests);
  const checks = options.checks ?? [{
    name: 'target-behavior',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    profiles: ['standard', 'controlled', 'release'],
    covers: ['behavior', 'negative-path'],
    sideEffect: 'none',
    estimatedCost: 'very-low',
    timeoutMs: 10000,
    acceptanceMode: 'none',
  }];
  fs.writeFileSync(path.join(root, '.ai', 'checks.json'), JSON.stringify({
    schemaVersion: 4,
    packageFallback: { mode: 'none', scripts: [] },
    checks,
  }, null, 2));
  for (const args of [
    ['init'],
    ['add', '.'],
    ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', 'baseline'],
  ]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return root;
}

export function taskCheck(t, repo, options = {}) {
  const mappings = options.mappings ?? [{
    acceptanceIds: options.acceptanceIds ?? ['A1'],
    covers: options.covers ?? ['behavior'],
    testName: options.testName,
  }];
  const cases = mappings.map((mapping, index) => {
    const acceptanceIds = mapping.acceptanceIds ?? ['A1'];
    return {
      id: mapping.id ?? `proof-${index + 1}`,
      acceptanceIds,
      covers: mapping.covers ?? ['behavior'],
      testFile: 'tests/acceptance.test.mjs',
      testName: mapping.testName ?? `${acceptanceIds[0]} proof`,
      expectedMatches: mapping.expectedMatches ?? 1,
    };
  });
  const file = path.join(tempDir(t), 'task-checks.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    checks: [{
      name: options.name ?? 'target-acceptance',
      runner: 'node-test',
      cases,
      estimatedCost: options.estimatedCost ?? 'very-low',
      timeoutMs: options.timeoutMs ?? 10000,
    }],
  }, null, 2));
  return file;
}

export function runNode(script, args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    timeout: options.timeout ?? 30000,
  });
}
