import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('中央验证预算生命周期已经退役', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.equal(fs.existsSync(path.join(root, '40-脚本', 'lib', 'verification-budget.mjs')), false);
});
