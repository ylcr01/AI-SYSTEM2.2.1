import assert from 'node:assert/strict';
import test from 'node:test';
import { createExperienceCandidate, saveExperienceCandidate } from '../../40-脚本/lib/experience-candidate.mjs';
import { loadExperienceRecords } from '../../40-脚本/lib/experience-dedupe.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from '../helpers.mjs';

function acceptedTask() {
  return {
    taskId: 'task-accepted',
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    goal: { summary: '修复支付回调重复处理' },
    changeSet: { fingerprint: 'abc' },
    specImpact: { affectedSpecificationIds: ['BR-PAY-001'] },
    specTraceability: { affectedSpecificationIds: ['EX-PAY-002'] },
    evidence: [{ result: { status: 'passed', summary: '重复回调集成测试通过' } }]
  };
}

test('Experience Candidate 只能从已验收 Task 生成', () => {
  assert.throws(() => createExperienceCandidate({ ...acceptedTask(), status: 'waiting_acceptance' }), /已验收/u);
});

test('高质量候选获得透明评分并保留来源规格', () => {
  const candidate = createExperienceCandidate(acceptedTask(), {
    rootCause: '第三方支付平台会重复发送相同事件，旧实现没有持久化幂等键',
    action: '在业务事务中按事件 ID 建立唯一幂等记录，重复事件直接返回已有结果',
    boundary: '仅适用于至少一次投递的支付回调和消息消费入口',
    keywords: ['支付回调', '幂等'],
    recurrenceCount: 2,
    impact: 'high'
  });
  assert.equal(candidate.quality.recommended, true);
  assert.deepEqual(candidate.source.specificationIds, ['BR-PAY-001','EX-PAY-002']);
});

test('保存候选时检测内容重复并阻止再次写入', (t) => {
  const root = tempDir(t);
  const input = {
    rootCause: '第三方支付平台会重复发送相同事件，旧实现没有持久化幂等键',
    action: '在业务事务中按事件 ID 建立唯一幂等记录，重复事件直接返回已有结果',
    boundary: '仅适用于至少一次投递的支付回调和消息消费入口',
    keywords: ['支付回调', '幂等'],
    recurrenceCount: 2,
    impact: 'high'
  };
  const first = saveExperienceCandidate(root, createExperienceCandidate(acceptedTask(), input));
  assert.equal(first.saved, true);
  const second = saveExperienceCandidate(root, createExperienceCandidate({ ...acceptedTask(), taskId: 'task-accepted-2' }, input));
  assert.equal(second.saved, false);
  assert.equal(second.reason, 'duplicate');
});


test('Markdown 正式经验参与去重，不再被静默忽略', (t) => {
  const root = tempDir(t);
  const directory = path.join(root, '.ai', '30-经验');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'EXP-PAY-001.md'), `---
id: EXP-PAY-001
status: active
keywords: [支付回调, 幂等]
---
# 支付回调幂等
## Trigger
支付平台重复发送同一事件
## Root Cause
第三方支付平台会重复发送相同事件，旧实现没有持久化幂等键
## Action
在业务事务中按事件 ID 建立唯一幂等记录，重复事件直接返回已有结果
## Boundary
仅适用于至少一次投递的支付回调和消息消费入口
`);
  const records = loadExperienceRecords(root);
  assert.equal(records.length, 1);
  const candidate = createExperienceCandidate(acceptedTask(), {
    rootCause: '第三方支付平台会重复发送相同事件，旧实现没有持久化幂等键',
    action: '在业务事务中按事件 ID 建立唯一幂等记录，重复事件直接返回已有结果',
    boundary: '仅适用于至少一次投递的支付回调和消息消费入口',
    keywords: ['支付回调', '幂等'], recurrenceCount: 2, impact: 'high'
  });
  const saved = saveExperienceCandidate(root, candidate);
  assert.equal(saved.saved, false);
  assert.equal(saved.reason, 'duplicate');
});

test('低质量候选默认不落盘，显式授权后才保存', (t) => {
  const root = tempDir(t);
  const candidate = createExperienceCandidate(acceptedTask(), {
    trigger: '问题', rootCause: '未知', action: '重试', boundary: '无', keywords: []
  });
  const blocked = saveExperienceCandidate(root, candidate);
  assert.equal(blocked.saved, false);
  assert.equal(blocked.reason, 'quality-insufficient');
  const allowed = saveExperienceCandidate(root, candidate, { allowLowQuality: true });
  assert.equal(allowed.saved, true);
});
