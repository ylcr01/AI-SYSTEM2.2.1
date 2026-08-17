import fs from 'node:fs';
import path from 'node:path';

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

export function loadChangeRationale(file) {
  if (!file) return null;
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (error) {
    throw new Error(`无法读取 Change Rationale 文件: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Change Rationale 文件不是有效 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Change Rationale 必须是 JSON 对象');
  }
  return {
    schemaVersion: 1,
    taskId: String(value.taskId ?? '').trim(),
    changeFingerprint: String(value.changeFingerprint ?? '').trim(),
    items: Array.isArray(value.items)
      ? value.items.map((item) => ({
        files: uniqueStrings(item?.files),
        supports: uniqueStrings(item?.supports),
        reason: String(item?.reason ?? '').trim(),
      }))
      : [],
  };
}

export function validateChangeRationale({ rationale, task, changeSet }) {
  if (!rationale) {
    return {
      ok: false,
      invalid: ['missing-rationale'],
      unmappedFiles: [...new Set((changeSet?.files ?? []).map((item) => item.path))],
    };
  }
  const invalid = [];
  if (rationale.taskId !== task.taskId) invalid.push(`Rationale Task 不匹配: ${rationale.taskId}`);
  if (rationale.changeFingerprint !== changeSet.fingerprint) invalid.push('Rationale 对应旧 ChangeSet');
  const changed = new Set((changeSet?.files ?? []).map((item) => item.path));
  const knownAcceptance = new Set((task.acceptance ?? []).map((item) => item.id));
  const covered = new Set();
  for (const item of rationale.items ?? []) {
    if (!item.reason) invalid.push('存在空 reason');
    for (const id of item.supports) {
      if (id !== 'GOAL' && !knownAcceptance.has(id)) invalid.push(`未知 Acceptance: ${id}`);
    }
    for (const file of item.files) {
      if (!changed.has(file)) invalid.push(`未知 ChangeSet 文件: ${file}`);
      else covered.add(file);
    }
  }
  const unmappedFiles = [...changed].filter((file) => !covered.has(file));
  return {
    ok: invalid.length === 0 && unmappedFiles.length === 0,
    invalid,
    unmappedFiles,
  };
}

export function changeRationaleSummary(result) {
  if (!result) return null;
  return {
    ok: result.ok,
    invalid: result.invalid ?? [],
    unmappedFiles: result.unmappedFiles ?? [],
  };
}
