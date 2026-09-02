#!/usr/bin/env node
import { parseArgs, listArg } from './lib/args.mjs';
import { mapChangedFilesToSpecifications } from './lib/spec-mapper.mjs';

const args = parseArgs(process.argv.slice(2));
try {
  const gitRoot = args.cwd ?? process.cwd();
  const changedFiles = listArg(args['changed-file']).map((file) => ({ path: file, status: null }));
  const result = mapChangedFilesToSpecifications({ gitRoot, changedFiles, configPath: args.config });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`规格映射失败: ${error.message}`);
  process.exitCode = 1;
}
