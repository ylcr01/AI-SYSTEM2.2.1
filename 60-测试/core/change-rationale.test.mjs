import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadChangeRationale, validateChangeRationale } from '../../40-脚本/lib/change-rationale.mjs';
import { tempDir } from '../helpers.mjs';

const task = { taskId: 'task-x', acceptance: [{ id: 'A1', description: '功能正确' }, { id: 'A2', description: '保护行为保持' }] };
const changeSet = { fingerprint: 'fp-1', files: [{ path: 'src/a.ts' }, { path: 'src/a.test.ts' }] };

function rationale(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'task-x',
    changeFingerprint: 'fp-1',
    items: [
      { files: ['src/a.ts'], supports: ['A1'], reason: '实现目标行为' },
      { files: ['src/a.test.ts'], supports: ['A1', 'A2'], reason: '验证目标与保护行为' },
    ],
    ...overrides,
  };
}

test('全量映射且引用真实文件与 Acceptance 时通过', () => {
  assert.equal(validateChangeRationale({ rationale: rationale(), task, changeSet }).ok, true);
});

test('GOAL 可作为特殊映射标记', () => {
  const value = rationale({ items: [{ files: ['src/a.ts'], supports: ['GOAL'], reason: '直接服务目标' }, { files: ['src/a.test.ts'], supports: ['A1'], reason: '验证' }] });
  assert.equal(validateChangeRationale({ rationale: value, task, changeSet }).ok, true);
});

test('Task ID 或 ChangeSet 指纹不匹配被拒绝', () => {
  assert.match(validateChangeRationale({ rationale: rationale({ taskId: 'task-y' }), task, changeSet }).invalid.join(' '), /Task 不匹配/u);
  assert.match(validateChangeRationale({ rationale: rationale({ changeFingerprint: 'fp-old' }), task, changeSet }).invalid.join(' '), /旧 ChangeSet/u);
});

test('未知文件、未知 Acceptance 与空 reason 被拒绝', () => {
  const result = validateChangeRationale({
    rationale: rationale({
      items: [
        { files: ['src/a.ts', 'src/ghost.ts'], supports: ['A1', 'A99'], reason: '' },
        { files: ['src/a.test.ts'], supports: ['A1'], reason: '验证' },
      ],
    }),
    task,
    changeSet,
  });
  assert.equal(result.ok, false);
  assert.match(result.invalid.join(' '), /未知 ChangeSet 文件/u);
  assert.match(result.invalid.join(' '), /未知 Acceptance/u);
  assert.match(result.invalid.join(' '), /空 reason/u);
});

test('未映射文件被完整列出', () => {
  const result = validateChangeRationale({
    rationale: rationale({ items: [{ files: ['src/a.ts'], supports: ['A1'], reason: '实现' }] }),
    task,
    changeSet,
  });
  assert.deepEqual(result.unmappedFiles, ['src/a.test.ts']);
});

test('缺少 rationale 时全部 ChangeSet 文件均视为未映射', () => {
  const result = validateChangeRationale({ rationale: null, task, changeSet });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unmappedFiles, ['src/a.ts', 'src/a.test.ts']);
});

test('无效 JSON 明确报错', (t) => {
  const file = path.join(tempDir(t), 'bad.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => loadChangeRationale(file), /不是有效 JSON/u);
});
