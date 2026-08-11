import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sourceFingerprint } from '../../40-脚本/lib/source-fingerprint.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

test('源码指纹忽略 Git 与运行产物但绑定真实源码', (t) => {
  const root = tempDir(t, 'ai-rd-os-fingerprint-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '80-运行记录'), { recursive: true });
  fs.mkdirSync(path.join(root, '70-文档', '验证记录'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source.mjs'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, '.git', 'index'), 'first');
  fs.writeFileSync(path.join(root, '80-运行记录', 'task.json'), 'first');
  fs.writeFileSync(path.join(root, '70-文档', '验证记录', 'result.json'), 'first');

  const first = sourceFingerprint(root);
  fs.writeFileSync(path.join(root, '.git', 'index'), 'second');
  fs.writeFileSync(path.join(root, '80-运行记录', 'task.json'), 'second');
  fs.writeFileSync(path.join(root, '70-文档', '验证记录', 'result.json'), 'second');
  assert.equal(sourceFingerprint(root), first);

  fs.writeFileSync(path.join(root, 'source.mjs'), 'export const value = 2;\n');
  assert.notEqual(sourceFingerprint(root), first);
});

test('源码指纹忽略本次 ChangeSet 中已删除的跟踪文件', (t) => {
  const root = gitRepo(t);
  fs.rmSync(path.join(root, 'README.md'));
  assert.doesNotThrow(() => sourceFingerprint(root));
});
