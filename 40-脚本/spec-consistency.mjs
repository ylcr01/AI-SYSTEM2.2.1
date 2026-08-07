#!/usr/bin/env node
import { parseArgs, listArg, requiredArg } from './lib/args.mjs';
import { computeChangeSet } from './lib/git-state.mjs';
import { findTask } from './lib/state-manager.mjs';
import { createSpecImpact, mergeSpecImpact } from './lib/spec-impact.mjs';
import { mapChangedFilesToSpecifications } from './lib/spec-mapper.mjs';
import { evaluateSpecConsistency } from './lib/spec-consistency.mjs';

const args = parseArgs(process.argv.slice(2));
try {
  let gitRoot = args.cwd ?? process.cwd();
  let changedFiles = listArg(args['changed-file']).map((file) => ({ path: file, status: null }));
  let taskId = null;
  let specImpact = createSpecImpact({
    level: args['spec-impact'],
    declared: args['spec-impact'] !== undefined,
    reason: args['spec-impact-reason'],
    affectedSpecificationIds: listArg(args['spec-id'])
  });
  if (args['task-id']) {
    const record = findTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id') });
    taskId = record.task.taskId;
    const changeSet = computeChangeSet(record.task.baseline);
    gitRoot = changeSet.gitRoot;
    changedFiles = changeSet.files;
    specImpact = mergeSpecImpact(record.task.specImpact, {
      level: args['spec-impact'],
      reason: args['spec-impact-reason'],
      affectedSpecificationIds: args['spec-id'] !== undefined ? listArg(args['spec-id']) : undefined
    });
  }
  const traceability = mapChangedFilesToSpecifications({ gitRoot, changedFiles, configPath: args.config });
  const result = evaluateSpecConsistency({ gitRoot, taskId, specImpact, traceability, policyPath: args.policy });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  console.error(`规格一致性检查失败: ${error.message}`);
  process.exitCode = 1;
}
