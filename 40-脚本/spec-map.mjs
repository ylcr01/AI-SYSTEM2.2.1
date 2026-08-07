#!/usr/bin/env node
import { parseArgs, listArg } from './lib/args.mjs';
import { computeChangeSet } from './lib/git-state.mjs';
import { findTask } from './lib/state-manager.mjs';
import { mapChangedFilesToSpecifications } from './lib/spec-mapper.mjs';

const args = parseArgs(process.argv.slice(2));
try {
  let gitRoot = args.cwd ?? process.cwd();
  let changedFiles = listArg(args['changed-file']).map((file) => ({ path: file, status: null }));
  if (args['task-id']) {
    const record = findTask({ stateRoot: args['state-root'], taskId: String(args['task-id']) });
    const changeSet = computeChangeSet(record.task.baseline);
    gitRoot = changeSet.gitRoot;
    changedFiles = changeSet.files;
  }
  const result = mapChangedFilesToSpecifications({ gitRoot, changedFiles, configPath: args.config });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`规格映射失败: ${error.message}`);
  process.exitCode = 1;
}
