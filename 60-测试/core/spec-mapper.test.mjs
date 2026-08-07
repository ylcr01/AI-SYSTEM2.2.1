import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mapChangedFilesToSpecifications, extractSpecificationIds } from '../../40-脚本/lib/spec-mapper.mjs';
import { tempDir } from '../helpers.mjs';

test('Changed file 通过显式 spec-map 关联稳定规格 ID 和测试', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'order'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'order'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'order', 'cancel.ts'), 'export const cancel = true;\n');
  fs.writeFileSync(path.join(root, 'docs', 'modules', 'order.md'), '# 订单\nBR-ORD-001\nTR-ORD-002\n');
  fs.writeFileSync(path.join(root, 'tests', 'order', 'cancel.test.ts'), '// [BR-ORD-001][TR-ORD-002]\n');
  fs.writeFileSync(path.join(root, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'order',
      paths: ['src/order/**'],
      specificationFiles: ['docs/modules/order.md'],
      specificationIds: ['BR-ORD-*', 'TR-ORD-*'],
      testFiles: ['tests/order/cancel.test.ts'],
      decisionFiles: ['docs/modules/order/decisions/**']
    }]
  }, null, 2));

  const result = mapChangedFilesToSpecifications({
    gitRoot: root,
    changedFiles: [{ path: 'src/order/cancel.ts', status: 'M ' }]
  });
  assert.deepEqual(result.affectedSpecificationIds, ['BR-ORD-001', 'TR-ORD-002']);
  assert.deepEqual(result.testCoverage['BR-ORD-001'], ['tests/order/cancel.test.ts']);
  assert.equal(result.files[0].confidence, 'configured');
  assert.deepEqual(result.unmappedCodeFiles, []);
});

test('源码中的显式规格 ID 在没有映射配置时仍可追踪', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'policy.ts'), '// @spec BR-PERM-004\nexport {};\n');
  const result = mapChangedFilesToSpecifications({ gitRoot: root, changedFiles: ['src/policy.ts'] });
  assert.deepEqual(result.affectedSpecificationIds, ['BR-PERM-004']);
  assert.equal(result.files[0].confidence, 'explicit-inline');
});

test('规格 ID 提取只接受 BR/TR/SC/EX 稳定格式', () => {
  assert.deepEqual(extractSpecificationIds('BR-ORD-001 x TR-ORD-002 bad-1 SC-PAY-100'), ['BR-ORD-001','SC-PAY-100','TR-ORD-002']);
});

test('规格和测试 Glob 会展开为真实文件并形成覆盖', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'order'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'modules', 'order'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'order'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'order', 'cancel.ts'), 'export {};\n');
  fs.writeFileSync(path.join(root, 'docs', 'modules', 'order', 'README.md'), 'BR-ORD-010\n');
  fs.writeFileSync(path.join(root, 'tests', 'order', 'cancel.test.ts'), '// BR-ORD-010\n');
  fs.writeFileSync(path.join(root, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'order', paths: ['src/order/**'], specificationFiles: ['docs/modules/order/**/*.md'],
      specificationIds: ['BR-ORD-*'], testFiles: ['tests/order/**/*.test.ts'], decisionFiles: ['docs/modules/order/decisions/**']
    }]
  }));
  const result = mapChangedFilesToSpecifications({ gitRoot: root, changedFiles: ['src/order/cancel.ts'] });
  assert.deepEqual(result.affectedSpecificationIds, ['BR-ORD-010']);
  assert.deepEqual(result.specificationFiles, ['docs/modules/order/README.md']);
  assert.deepEqual(result.testCoverage['BR-ORD-010'], ['tests/order/cancel.test.ts']);
});

test('spec-map 拒绝仓库外路径', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{ id: 'bad', paths: ['src/**'], specificationFiles: ['../outside.md'], testFiles: [], decisionFiles: [] }]
  }));
  assert.throws(() => mapChangedFilesToSpecifications({ gitRoot: root, changedFiles: ['src/a.ts'] }), /不能越出仓库/u);
});
