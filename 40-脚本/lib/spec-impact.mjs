export const SPEC_IMPACTS = Object.freeze({
  NONE: 'none',
  UPDATED: 'updated',
  DECISION_REQUIRED: 'decision-required'
});

const VALUES = new Set(Object.values(SPEC_IMPACTS));

export function normalizeSpecImpact(value) {
  const normalized = String(value ?? SPEC_IMPACTS.NONE).trim().toLowerCase();
  if (!VALUES.has(normalized)) throw new Error(`无效 specImpact: ${normalized}`);
  return normalized;
}

export function createSpecImpact(input = {}) {
  const explicitLevel = input.level !== undefined && input.level !== null && input.level !== '';
  const level = normalizeSpecImpact(input.level);
  const ids = [...new Set((input.affectedSpecificationIds ?? []).map(String).map((item) => item.trim()).filter(Boolean))].sort();
  return {
    level,
    declared: input.declared ?? explicitLevel,
    reason: input.reason ? String(input.reason).trim() : null,
    affectedSpecificationIds: ids
  };
}

export function mergeSpecImpact(current = {}, override = {}) {
  const hasLevel = override.level !== undefined && override.level !== null && override.level !== '';
  const hasIds = Array.isArray(override.affectedSpecificationIds);
  const hasReason = override.reason !== undefined;
  return createSpecImpact({
    level: hasLevel ? override.level : current.level,
    declared: hasLevel ? true : (override.declared ?? current.declared ?? false),
    reason: hasReason ? override.reason : current.reason,
    affectedSpecificationIds: hasIds ? override.affectedSpecificationIds : (current.affectedSpecificationIds ?? [])
  });
}

export function explainSpecImpact(value) {
  return ({
    none: '实现变化，不改变确认后的业务规格',
    updated: '当前业务规则或模块规格已同步更新',
    'decision-required': '重大业务或架构取舍，必须同时记录 Decision'
  })[normalizeSpecImpact(value)] ?? '';
}
