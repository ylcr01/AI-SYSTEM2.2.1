import crypto from 'node:crypto';
import path from 'node:path';
import { atomicWriteText } from './atomic-file.mjs';
import { experienceFingerprint, findExactExperience, loadExperienceRecords } from './experience-dedupe.mjs';

function uniqueStrings(values = []) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function createId() {
  return `EXP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Experience Candidate 缺少${label}`);
  return text;
}

export function createExperienceCandidate(task, input = {}) {
  if (task?.status !== 'accepted') throw new Error('Experience Candidate 只能从已验收 Task 生成');
  const verification = uniqueStrings([
    ...(input.verification ?? []),
    ...(task.evidence ?? []).filter((item) => item.result?.status === 'passed').map((item) => item.result?.summary)
  ]);
  if (!verification.length) throw new Error('Experience Candidate 至少需要一条已通过验证');
  const candidate = {
    schemaVersion: 3,
    id: input.id ?? createId(),
    status: 'candidate',
    sourceTaskId: task.taskId,
    trigger: requiredText(input.trigger ?? task.goal?.summary, '触发条件'),
    rootCause: requiredText(input.rootCause, '根因'),
    action: requiredText(input.action, '处理动作'),
    verification,
    boundary: requiredText(input.boundary, '适用边界'),
    keywords: uniqueStrings(input.keywords ?? []),
    source: {
      taskId: task.taskId,
      taskAcceptedAt: task.acceptedAt ?? task.userAcceptance?.decidedAt ?? null,
      changeFingerprint: task.changeSet?.fingerprint ?? null,
      specificationIds: uniqueStrings([
        ...(task.specImpact?.affectedSpecificationIds ?? []),
        ...(task.specTraceability?.affectedSpecificationIds ?? [])
      ]),
      createdAt: new Date().toISOString()
    }
  };
  candidate.contentFingerprint = experienceFingerprint(candidate);
  return candidate;
}

function markdown(candidate) {
  return `---
id: ${candidate.id}
status: candidate
sourceTaskId: ${candidate.sourceTaskId}
contentFingerprint: ${candidate.contentFingerprint}
keywords: ${JSON.stringify(candidate.keywords)}
---

# ${candidate.trigger}

## Trigger

${candidate.trigger}

## Root Cause

${candidate.rootCause}

## Action

${candidate.action}

## Verification

${candidate.verification.map((item) => `- ${item}`).join('\n')}

## Boundary

${candidate.boundary}

## Source

- Task: ${candidate.source.taskId}
- Accepted At: ${candidate.source.taskAcceptedAt ?? 'unknown'}
- Change Fingerprint: ${candidate.source.changeFingerprint ?? 'unknown'}
- Specification IDs: ${candidate.source.specificationIds.join(', ') || 'none'}
`;
}

export function saveExperienceCandidate(root, candidate, options = {}) {
  const projectRoot = path.resolve(root);
  const duplicate = findExactExperience(candidate, options.records ?? loadExperienceRecords(projectRoot));
  if (duplicate) return { saved: false, file: null, reason: 'duplicate', duplicateOf: duplicate, candidate };
  const directory = path.join(projectRoot, '.ai', '30-经验', 'candidates');
  const file = path.join(directory, `${candidate.id}.md`);
  atomicWriteText(file, markdown(candidate), path.join(projectRoot, '.ai', '.pending'));
  return { saved: true, file, reason: null, duplicateOf: null, candidate };
}
