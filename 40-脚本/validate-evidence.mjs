import fs from 'node:fs';
import path from 'node:path';
import { listArg, parseArgs, requiredArg } from './lib/args.mjs';
import { evidenceSummary, validateEvidenceSet } from './lib/evidence.mjs';

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function validationMode(args) {
  const modes = [];
  if (args.mode !== undefined) modes.push(String(args.mode).trim());
  if (args.proof === true) modes.push('proof');
  if (args['schema-only'] === true) modes.push('schema-only');
  const unique = [...new Set(modes.filter(Boolean))];
  if (unique.length !== 1 || !['proof', 'schema-only'].includes(unique[0])) {
    throw new Error('必须显式选择且只能选择一种校验语义: --mode proof|schema-only（或 --proof / --schema-only）');
  }
  return unique[0];
}

function systemEvidenceHashes(args) {
  const inline = listArg(args['system-evidence-hash']);
  if (!args['system-evidence-hashes-file']) return inline;
  const stored = readJson(args['system-evidence-hashes-file']);
  const values = Array.isArray(stored) ? stored : stored?.systemEvidenceHashes;
  if (!Array.isArray(values)) throw new Error('system-evidence-hashes-file 必须是数组或包含 systemEvidenceHashes 数组');
  return [...new Set([...inline, ...values.map(String)])];
}

const args = parseArgs(process.argv.slice(2));

try {
  const mode = validationMode(args);
  const value = readJson(requiredArg(args, 'file'));
  const evidence = Array.isArray(value) ? value : [value];
  const acceptance = args['acceptance-file'] ? readJson(args['acceptance-file']) : [];
  if (!Array.isArray(acceptance)) throw new Error('acceptance-file 必须是数组');
  if (mode === 'proof' && !args['acceptance-file']) {
    throw new Error('proof 模式必须提供 --acceptance-file，schema-only 模式才只校验结构');
  }
  const context = {
    taskId: requiredArg(args, 'task-id'),
    changeFingerprint: requiredArg(args, 'change-fingerprint'),
    inputCycle: Number(args['input-cycle'] ?? 0),
    gitRoot: args['git-root'] ?? process.cwd(),
    acceptance,
  };
  const result = mode === 'proof'
    ? evidenceSummary({
      acceptance,
      evidence,
      requiredCovers: listArg(args['required-cover']),
      systemEvidenceHashes: systemEvidenceHashes(args),
      context,
    })
    : validateEvidenceSet(evidence, context);
  const proofSatisfied = mode === 'proof'
    ? result.invalid.length === 0
      && result.missingAcceptance.length === 0
      && result.missingCovers.length === 0
    : null;
  console.log(JSON.stringify({ mode, proofSatisfied, ...result }, null, 2));
  if (result.invalid.length || proofSatisfied === false) process.exitCode = 1;
} catch (error) {
  console.error(`Evidence 校验失败: ${error.message}`);
  process.exitCode = 1;
}
