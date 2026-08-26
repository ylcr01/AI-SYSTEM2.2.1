import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { deliverTask, prepareTask, resumeTask, saveTask } from '../../40-脚本/lib/task-runner.mjs';
import { gitRepo, taskCheck, tempDir } from '../helpers.mjs';

test('交付重新计算并清理已经失效的 Rationale Blocker', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd:repo, stateRoot, intent:'修复普通功能', acceptance:['功能正确'], scope:'.' });
  const taskFile = path.join(stateRoot, '进行中', `${prepared.task.taskId}.json`);
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  task.blockers = ['Change Rationale 未映射或无效: 旧 ChangeSet'];
  fs.writeFileSync(taskFile, JSON.stringify(task));
  fs.writeFileSync(path.join(repo, 'target.txt'), 'task change\n');

  const delivered = deliverTask({ stateRoot, taskId:prepared.task.taskId, taskCheckFile:taskCheck(t, repo) });
  assert.equal(delivered.task.status, 'waiting_acceptance');
});

test('恢复任务保留不能由当前事实重算的风险升级 Blocker', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd:repo, stateRoot, intent:'修复普通功能', acceptance:['功能正确'], scope:'.' });
  saveTask({ stateRoot, taskId:prepared.task.taskId });
  const taskFile = path.join(stateRoot, '进行中', `${prepared.task.taskId}.json`);
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  task.blockers = ['实际 ChangeSet 风险高于 direct 准备判断，必须重新对齐或获得用户明确委托'];
  fs.writeFileSync(taskFile, JSON.stringify(task));

  assert.deepEqual(resumeTask({ stateRoot, taskId:prepared.task.taskId }).task.blockers, task.blockers);
});
