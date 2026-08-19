import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathContains, normalizePath } from './registry.mjs';

export const PRESERVATION_MODES = ['preserve-unrequested', 'preserve-all-observable', 'reference-equivalent'];
export const PRESERVATION_LEVEL = Object.freeze({
  'preserve-unrequested': 0,
  'preserve-all-observable': 1,
  'reference-equivalent': 2,
});

const REFERENCE_BEHAVIOR_CATEGORIES = new Set([
  'business', 'interaction', 'state', 'permission', 'data', 'error', 'contract', 'compatibility', 'other'
]);

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function normalizePathText(value) {
  return String(value ?? '').trim().replaceAll('\\', '/');
}

export function preservationModeLevel(mode) {
  return PRESERVATION_LEVEL[String(mode ?? '')] ?? -1;
}

function normalizeBehavior(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Reference Behavior 必须是对象');
  }
  const id = String(item.id ?? '').trim();
  const description = String(item.description ?? '').trim();
  const category = String(item.category ?? 'other').trim();
  const sourceFiles = uniqueStrings(item.sourceFiles).map(normalizePathText);
  if (!id) throw new Error('Reference Behavior 缺少 id');
  if (!description) throw new Error(`Reference Behavior ${id} 缺少 description`);
  if (!sourceFiles.length) throw new Error(`Reference Behavior ${id} 缺少 sourceFiles`);
  if (!REFERENCE_BEHAVIOR_CATEGORIES.has(category)) {
    throw new Error(`Reference Behavior ${id} 的 category 无效: ${category}`);
  }
  return { id, category, description, sourceFiles };
}

function normalizeExcludedFile(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('excludedFiles 条目必须是对象');
  }
  const filePath = normalizePathText(item.path);
  const reason = String(item.reason ?? '').trim();
  if (!filePath) throw new Error('excludedFiles 条目缺少 path');
  if (!reason) throw new Error(`excludedFiles ${filePath} 缺少 reason`);
  return { path: filePath, reason };
}

function normalizeAllowedDifference(item, behaviorIds) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('allowedDifferences 条目必须是对象');
  }
  const behaviorId = String(item.behaviorId ?? '').trim();
  const description = String(item.description ?? '').trim();
  if (!behaviorId) throw new Error('allowedDifferences 条目缺少 behaviorId');
  if (!description) throw new Error(`allowedDifferences ${behaviorId} 缺少 description`);
  if (!behaviorIds.has(behaviorId)) {
    throw new Error(`allowedDifferences 引用了不存在的 Behavior: ${behaviorId}`);
  }
  return { behaviorId, description };
}

export function normalizePreservation(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mode = String(value.mode ?? 'preserve-unrequested').trim() || 'preserve-unrequested';
  if (!PRESERVATION_MODES.includes(mode)) throw new Error(`preservation.mode 无效: ${mode}`);
  const constraints = uniqueStrings(value.constraints);
  const referenceRoots = uniqueStrings(value.referenceRoots).map(normalizePathText);
  const behaviors = Array.isArray(value.behaviors) ? value.behaviors.map(normalizeBehavior) : [];
  const behaviorIds = new Set(behaviors.map((item) => item.id));
  if (behaviorIds.size !== behaviors.length) throw new Error('Reference Behavior id 必须唯一');
  const excludedFiles = Array.isArray(value.excludedFiles) ? value.excludedFiles.map(normalizeExcludedFile) : [];
  const allowedDifferences = Array.isArray(value.allowedDifferences)
    ? value.allowedDifferences.map((item) => normalizeAllowedDifference(item, behaviorIds))
    : [];
  const strict = mode === 'preserve-all-observable' || mode === 'reference-equivalent';
  if (strict && !referenceRoots.length) {
    throw new Error(`${mode} 必须至少有一个 referenceRoots`);
  }
  if (strict && !behaviors.length) {
    throw new Error(`preservation-behaviors-required: ${mode} 至少需要一个 Reference Behavior`);
  }
  return {
    mode,
    constraints,
    referenceRoots,
    behaviors,
    excludedFiles,
    allowedDifferences
  };
}

export function isStrictPreservation(preservation) {
  return preservation?.mode === 'preserve-all-observable'
    || preservation?.mode === 'reference-equivalent';
}

export function validateReferenceAttribution({ referenceFiles = [], behaviors = [], excludedFiles = [] }) {
  const referenceSet = new Set(referenceFiles);
  const attributed = new Set([
    ...behaviors.flatMap((item) => item.sourceFiles),
    ...excludedFiles.map((item) => item.path)
  ]);
  const unmapped = referenceFiles.filter((file) => !attributed.has(file));
  const foreign = [
    ...behaviors.flatMap((item) => item.sourceFiles),
    ...excludedFiles.map((item) => item.path)
  ].filter((file) => !referenceSet.has(file));
  return { ok: unmapped.length === 0 && foreign.length === 0, unmapped, foreign };
}

export function buildReferenceInventory({ gitRoot, baselineHead, referenceRoots = [], behaviors = [], excludedFiles = [] }) {
  const root = path.resolve(gitRoot);
  if (!referenceRoots.length) {
    return { referenceCommit: baselineHead ?? null, referenceFiles: [], unmapped: [] };
  }
  for (const relative of referenceRoots) {
    const absolute = path.resolve(root, relative);
    if (!pathContains(root, normalizePath(absolute))) {
      throw new Error(`Reference Root 越出 Git Root: ${relative}`);
    }
  }
  const result = spawnSync('git', ['-C', root, 'ls-files', ...referenceRoots], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`无法读取 Reference 文件清单: ${String(result.stderr || result.error?.message || '').trim()}`);
  }
  const referenceFiles = result.stdout
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizePathText)
    .sort();
  const { unmapped, foreign } = validateReferenceAttribution({ referenceFiles, behaviors, excludedFiles });
  return { referenceCommit: baselineHead ?? null, referenceFiles, unmapped, foreign };
}

export function referenceBehaviorAcceptanceItems(preservation) {
  if (!preservation?.behaviors?.length) return [];
  const allowedByBehavior = new Map(preservation.allowedDifferences.map((item) => [item.behaviorId, item]));
  return preservation.behaviors.map((behavior) => {
    const allowed = allowedByBehavior.get(behavior.id);
    return {
      description: allowed
        ? `按批准差异验证 ${behavior.id}：${allowed.description}`
        : `保持参考行为 ${behavior.id}：${behavior.description}`,
      source: 'reference-behavior',
      referenceBehaviorId: behavior.id,
      requiredCovers: ['behavior'],
      requiredCoversInferred: false,
      status: 'open'
    };
  });
}

export function preservationCoverageSummary({ acceptance = [], acceptanceCoverage = {} }) {
  const referenceItems = acceptance.filter((item) => item.source === 'reference-behavior');
  if (!referenceItems.length) return null;
  const missingBehaviorIds = referenceItems
    .filter((item) => !acceptanceCoverage[item.id]?.satisfied)
    .map((item) => item.referenceBehaviorId);
  return {
    behaviorCount: referenceItems.length,
    verifiedBehaviorCount: referenceItems.length - missingBehaviorIds.length,
    missingBehaviorIds,
    complete: missingBehaviorIds.length === 0
  };
}
