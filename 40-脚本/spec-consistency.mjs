#!/usr/bin/env node
import { parseArgs, listArg } from './lib/args.mjs';
import { createSpecImpact } from './lib/spec-impact.mjs';
import { mapChangedFilesToSpecifications } from './lib/spec-mapper.mjs';
import { evaluateSpecConsistency } from './lib/spec-consistency.mjs';

const args = parseArgs(process.argv.slice(2));
try {
  const gitRoot = args.cwd ?? process.cwd();
  const changedFiles = listArg(args['changed-file']).map((file) => ({ path: file, status: null }));
  const specImpact = createSpecImpact({
    level: args['spec-impact'],
    declared: args['spec-impact'] !== undefined,
    reason: args['spec-impact-reason'],
    affectedSpecificationIds: listArg(args['spec-id'])
  });
  const traceability = mapChangedFilesToSpecifications({ gitRoot, changedFiles, configPath: args.config });
  const result = evaluateSpecConsistency({ gitRoot, specImpact, traceability, policyPath: args.policy });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  console.error(`规格一致性检查失败: ${error.message}`);
  process.exitCode = 1;
}
