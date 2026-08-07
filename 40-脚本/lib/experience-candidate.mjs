import crypto from 'node:crypto';
import path from 'node:path';
import { atomicWriteJson } from './atomic-file.mjs';
import { experienceFingerprint, findSimilarExperiences, loadExperienceRecords } from './experience-dedupe.mjs';
import { scoreExperienceCandidate } from './experience-quality.mjs';

function createId() {
  return `EXP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

export function createExperienceCandidate(task, input = {}) {
  if (task?.status !== 'accepted') throw new Error('Experience Candidate 只能从已验收 Task 生成');
  const verification = uniqueStrings([
    ...(input.verification ?? []),
    ...(task.evidence ?? []).filter((item) => item.result?.status === 'passed').map((item) => item.result?.summary)
  ]);
  const candidate = {
    schemaVersion: 2,
    id: input.id ?? createId(),
    status: 'candidate',
    lifecycle: 'candidate',
    sourceTaskId: task.taskId,
    trigger: String(input.trigger ?? task.goal?.summary ?? '').trim(),
    rootCause: String(input.rootCause ?? '').trim(),
    action: String(input.action ?? '').trim(),
    verification,
    boundary: String(input.boundary ?? '').trim(),
    source: {
      taskId: task.taskId,
      taskStatus: task.status,
      taskAcceptedAt: task.acceptedAt ?? task.userAcceptance?.decidedAt ?? null,
      changeFingerprint: task.changeSet?.fingerprint ?? null,
      specificationIds: uniqueStrings([
        ...(task.specImpact?.affectedSpecificationIds ?? []),
        ...(task.specTraceability?.affectedSpecificationIds ?? [])
      ]),
      createdAt: new Date().toISOString()
    },
    keywords: uniqueStrings(input.keywords ?? []),
    recurrenceCount: Math.max(1, Number(input.recurrenceCount ?? 1)),
    impact: ['low','medium','high','critical'].includes(input.impact) ? input.impact : 'low'
  };
  candidate.contentFingerprint = experienceFingerprint(candidate);
  candidate.quality = scoreExperienceCandidate(candidate);
  return candidate;
}

export function assessExperienceCandidate(root, candidate, options = {}) {
  const records = options.records ?? loadExperienceRecords(root);
  const deduplication = findSimilarExperiences(candidate, records, options);
  return {
    ...candidate,
    quality: scoreExperienceCandidate(candidate),
    deduplication
  };
}

export function saveExperienceCandidate(root, candidate, options = {}) {
  const projectRoot = path.resolve(root);
  const assessed = assessExperienceCandidate(projectRoot, candidate, options);
  if (assessed.deduplication.duplicate && options.allowDuplicate !== true) {
    return {
      saved: false,
      file: null,
      reason: 'duplicate',
      duplicateOf: assessed.deduplication.bestMatch,
      candidate: assessed
    };
  }
  if (assessed.quality.grade === 'insufficient' && options.allowLowQuality !== true) {
    return {
      saved: false,
      file: null,
      reason: 'quality-insufficient',
      duplicateOf: null,
      candidate: assessed
    };
  }
  const directory = path.join(projectRoot, '.ai', '30-经验', 'candidates');
  const file = path.join(directory, `${assessed.id}.json`);
  atomicWriteJson(file, assessed, path.join(projectRoot, '.ai', '.pending'));
  return { saved: true, file, reason: null, duplicateOf: null, candidate: assessed };
}
