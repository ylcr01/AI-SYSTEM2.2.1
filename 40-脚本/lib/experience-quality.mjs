const PLACEHOLDERS = new Set(['', '待补充', '未知', '无', 'none', 'n/a', 'todo', 'tbd']);

function meaningful(value, minimum = 8) {
  const text = String(value ?? '').trim();
  return text.length >= minimum && !PLACEHOLDERS.has(text.toLowerCase());
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

export function scoreExperienceCandidate(candidate = {}) {
  const breakdown = [];
  let score = 0;
  function add(id, points, earned, reason) {
    const value = earned ? points : 0;
    score += value;
    breakdown.push({ id, points, earned: value, passed: earned, reason });
  }

  add('accepted-source', 15, candidate.source?.taskStatus === 'accepted', '只允许已验收任务形成可靠候选');
  add('root-cause', 20, meaningful(candidate.rootCause, 12), '根因应具体、可操作，而不是现象描述');
  add('action', 15, meaningful(candidate.action, 12), '处理动作应能指导未来任务');
  add('verification', 20, uniqueStrings(candidate.verification).length > 0, '至少存在一条可信验证结果');
  add('boundary', 10, meaningful(candidate.boundary, 8), '经验必须说明适用边界');
  add('keywords', 8, uniqueStrings(candidate.keywords).length >= 2, '至少两个检索关键词有助于按需加载');
  add('recurrence', 7, Number(candidate.recurrenceCount ?? 1) >= 2, '重复发生或有多个独立来源时价值更高');
  add('impact', 5, ['medium','high','critical'].includes(candidate.impact), '中高影响经验优先保留');

  const genericTrigger = !meaningful(candidate.trigger, 6);
  if (genericTrigger) {
    score = Math.max(0, score - 10);
    breakdown.push({ id: 'generic-trigger-penalty', points: -10, earned: -10, passed: false, reason: '触发条件过于泛化' });
  }

  const grade = score >= 80 ? 'recommended' : score >= 60 ? 'review' : 'insufficient';
  return {
    score,
    grade,
    recommended: grade === 'recommended',
    breakdown,
    thresholds: { recommended: 80, review: 60 }
  };
}
